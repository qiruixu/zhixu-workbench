/** 电子表格读取器：.xls / .xlsx / .xlt / .csv / .tsv / 伪装的 HTML 表格 */
import * as XLSX from 'xlsx'
import { normCell, type MergeRange, type RawTable } from '../grid'

/** 解码为文本（UTF-8；带 BOM 时 TextDecoder 会自动去掉） */
function decodeUtf8(data: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(new Uint8Array(data))
}

function sheetToRows(ws: XLSX.WorkSheet): { rows: string[][]; merges: MergeRange[] } {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  })
  const width = aoa.reduce((m, r) => Math.max(m, r?.length ?? 0), 0)
  const rows: string[][] = aoa.map((r) =>
    Array.from({ length: width }, (_, i) => normCell(r?.[i]))
  )
  const merges: MergeRange[] = (ws['!merges'] ?? []).map((m) => ({
    s: { r: m.s.r, c: m.s.c },
    e: { r: m.e.r, c: m.e.c },
  }))
  return { rows, merges }
}

function pickBestSheet(wb: XLSX.WorkBook): XLSX.WorkSheet | undefined {
  let best: XLSX.WorkSheet | undefined
  let bestScore = -1
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const ref = ws['!ref']
    const range = ref ? XLSX.utils.decode_range(ref) : null
    const score = range ? (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1) : 0
    if (score > bestScore) {
      bestScore = score
      best = ws
    }
  }
  return best ?? wb.Sheets[wb.SheetNames[0]]
}

/**
 * 以指定方式读取工作簿。
 * ⚠️ 实测差异：在浏览器里 `XLSX.read(ArrayBuffer, {type:'array'})` 读 CSV 时，
 * 中文会被按 Latin-1 解码成乱码（Node 下不会），导致「星期一」识别失败。
 * 因此文本类文件必须走 `type:'string'`（先按 UTF-8 解码成字符串）。
 */
function tryRead(mode: 'array' | 'string', data: ArrayBuffer): XLSX.WorkBook {
  return mode === 'string'
    ? XLSX.read(decodeUtf8(data), { type: 'string' })
    : XLSX.read(data, { type: 'array' })
}

export function readSheetTable(fileName: string, data: ArrayBuffer): RawTable {
  const warnings: string[] = []
  const preferString = /\.(csv|tsv|txt|html?|xml)$/i.test(fileName)
  const modes: Array<'array' | 'string'> = preferString ? ['string', 'array'] : ['array', 'string']

  let table: { rows: string[][]; merges: MergeRange[] } | null = null
  let lastError: unknown = null
  for (const mode of modes) {
    try {
      const ws = pickBestSheet(tryRead(mode, data))
      if (!ws) continue
      const got = sheetToRows(ws)
      if (!table || got.rows.length > table.rows.length) table = got
      // 已经能确定星期表头就没必要再试
      if (got.rows.some((r) => r.filter((c) => /(?:星期|周|礼拜)\s*[一二三四五六日天]/.test(c)).length >= 3)) {
        table = got
        break
      }
    } catch (e) {
      lastError = e
    }
  }

  if (!table) {
    throw new Error(
      lastError instanceof Error
        ? `无法读取该表格文件：${lastError.message}`
        : '无法读取该表格文件，请确认它是完整的课表导出文件。'
    )
  }
  return { rows: table.rows, merges: table.merges, warnings }
}
