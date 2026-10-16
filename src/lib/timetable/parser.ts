/**
 * 课表解析器（入口）
 *
 * 按「文件真实格式」分派到对应读取器：
 *
 *   .xls / .xlsx / .xlt / .csv / .tsv / 伪装的 HTML 表格  → readers/sheet.ts（SheetJS）→ grid.ts
 *   RTF（很多教务导出的 .doc 其实是 RTF）                → readers/rtf.ts        → grid.ts
 *   .docx（Word 表格，含紧凑网格）                        → readers/docx.ts        → grid.ts
 *   PDF（打印/另存的课表）                               → readers/pdf.ts        → grid.ts
 *   .ics（WakeUpSchedule 等日历课表，事件+每周重复）      → readers/ics.ts（直接产出课程）
 *
 * 具体布局兼容性见 grid.ts 顶部说明。
 */
import type { Course, TimetableMeta } from '../types'
import { gridToCourses, type RawTable } from './grid'
import { readSheetTable } from './readers/sheet'
import { readRtfTable } from './readers/rtf'
import { readPdfTable } from './readers/pdf'
import { readDocxTable } from './readers/docx'
import { readIcsTable } from './readers/ics'

export type TimetableFormat = 'sheet' | 'rtf' | 'pdf' | 'docx' | 'ics'

/** OLE2 复合文档头（.xls / 旧版 .doc 共用） */
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0]

function bytesAt(data: ArrayBuffer, offset: number, len: number): number[] {
  const u8 = new Uint8Array(data, Math.min(offset, data.byteLength))
  return Array.from(u8.subarray(0, len))
}

function headAscii(data: ArrayBuffer, len = 1024): string {
  const u8 = new Uint8Array(data).subarray(0, Math.min(len, data.byteLength))
  let s = ''
  for (let i = 0; i < u8.length; i += 4096) {
    s += String.fromCharCode(...u8.subarray(i, Math.min(i + 4096, u8.length)))
  }
  return s
}

export function detectFormat(fileName: string, data: ArrayBuffer): TimetableFormat {
  const head = bytesAt(data, 0, 5)
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'

  const ascii = headAscii(data, 512)
  if (/^\s*\{\\rtf/i.test(ascii) || /^\s*\{\\rtf/i.test(headAscii(data, 64))) return 'rtf'

  // iCalendar：文本格式，文件头就是 BEGIN:VCALENDAR
  if (/^\s*BEGIN:VCALENDAR/i.test(ascii) || /BEGIN:VCALENDAR/i.test(ascii.slice(0, 256))) return 'ics'

  const isOle2 = OLE2.every((b, i) => head[i] === b)
  const isZip = head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()

  if (ext === 'pdf') return 'pdf'
  if (ext === 'rtf') return 'rtf'
  if (ext === 'ics') return 'ics'

  // .docx 是 ZIP 包（OOXML），.doc 旧版是 OLE2
  if (ext === 'docx') {
    if (isZip) return 'docx'
    throw new Error(
      '这个 .docx 不是标准 Word OOXML 文档，请在 Word / WPS 里「另存为」成 .docx 或 .xlsx 后再导入。'
    )
  }
  if (isOle2) return 'sheet'
  if (isZip) {
    // ZIP 但不是 xlsx 也不是 docx —— 可能是 .xlsx 伪装或其它 OOXML，交给 sheet 试
    return 'sheet'
  }

  // 纯文本：可能是 CSV/TSV/HTML 伪装成的 .xls
  if (/\.(doc|wps|wpt|odt)$/i.test(fileName)) {
    throw new Error(
      '这是旧版 Word 二进制文档，无法直接解析表格。请在 Word / WPS 里「另存为」成 .xlsx、.docx 或 .rtf 后再导入。'
    )
  }
  return 'sheet'
}

async function readTable(
  format: TimetableFormat,
  fileName: string,
  data: ArrayBuffer
): Promise<RawTable> {
  if (format === 'pdf') return readPdfTable(data)
  if (format === 'docx') {
    const t = await readDocxTable(data)
    if (!t.rows.length) {
      throw new Error(t.warnings[0] ?? 'DOCX 文档里没有可识别的表格，请另存为 .xlsx 后导入。')
    }
    return t
  }
  if (format === 'rtf') {
    const t = readRtfTable(data)
    if (!t.rows.length) {
      throw new Error('RTF 文档中没有可识别的表格结构，请在 Word / WPS 中另存为 .xlsx 后导入。')
    }
    return t
  }
  return readSheetTable(fileName, data)
}

/** 从表头若干行里提取学年学期与标题 */
function extractMeta(rows: string[][], fileName: string) {
  const flat = rows.slice(0, 8).flat().filter(Boolean)
  const joined = flat.join(' ')
  const semester = joined.match(
    /(\d{4}\s*[-/]\s*\d{4})\s*学年\s*第?\s*([一二1-2])\s*学期/
  )
  const semesterText = semester
    ? `${semester[1].replace(/\s/g, '')}学年 第${semester[2]}学期`
    : joined.match(/学年学期\s*[:：]\s*([0-9]{4}-[0-9]{4}-[0-9]|[^\s，,]+)/)?.[1]
  const titleLine = flat.find((c) => /课表/.test(c))
  const idFromName = fileName.match(/(\d{6,})/)?.[1]
  return { semester: semesterText, title: titleLine, studentId: idFromName }
}

export async function parseTimetable(fileName: string, data: ArrayBuffer): Promise<TimetableMeta> {
  const format = detectFormat(fileName, data)

  // ICS 是「事件 + 每周重复」模型，不走网格
  if (format === 'ics') {
    const ics = readIcsTable(data)
    const base: TimetableMeta = {
      id: 'current',
      fileName,
      importedAt: Date.now(),
      sourceFormat: format,
      studentId: fileName.match(/(\d{6,})/)?.[1],
      semesterStart: ics.semesterStart || undefined,
      sheetName: 'iCalendar',
      weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      periodTimes: {},
      courses: ics.courses as Course[],
      remarks: ics.remarks,
      warnings: ics.warnings,
      rawRows: [],
    }
    return base
  }

  const table = await readTable(format, fileName, data)
  const grid = gridToCourses(table)
  const meta = extractMeta(table.rows, fileName)

  const warnings = [...grid.warnings]

  return {
    id: 'current',
    fileName,
    importedAt: Date.now(),
    sourceFormat: format,
    title: meta.title,
    studentId: meta.studentId,
    semester: meta.semester,
    sheetName:
      format === 'pdf' ? 'PDF' : format === 'rtf' ? 'RTF' : format === 'docx' ? 'DOCX' : 'Sheet',
    weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    periodTimes: {},
    courses: grid.courses as Course[],
    remarks: grid.remarks,
    warnings,
    rawRows: table.rows.slice(0, 40).map((r) => r.slice(0, 12)),
  }
}

export type { RawTable }
