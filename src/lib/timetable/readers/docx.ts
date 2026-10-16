/**
 * Word 文档（.docx）课表读取器
 *
 * .docx 其实是 ZIP 包，课表在 `word/document.xml` 里的 <w:tbl> 表格中。
 * 这里不引入 jszip/docx 之类依赖，直接用浏览器/Node 自带的 DecompressionStream
 * 解出 document.xml，再按 OOXML 的 <w:tr>/<w:tc> 还原行列。
 *
 * 适配的典型样例：中国石油大学（北京）克拉玛依校区这类「紧凑网格」课表 ——
 * 单元格里一门课挤成一行：
 *   大学物理B（Ⅱ）160627M006.04(1~15周) (1-2节) C9楼I区105  宋钢(2025563001)非 2026;能源与动力工程25-[1-2]班
 * 单元格内还可能连着排多门课（同一门课的不同周次/教室），见 grid.ts 的紧凑解析。
 */
import type { MergeRange, RawTable } from '../grid'

/* ------------------------------ ZIP 解析 ------------------------------ */

function latin1(u8: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u8.length; i += 4096) {
    s += String.fromCharCode(...u8.subarray(i, Math.min(i + 4096, u8.length)))
  }
  return s
}

interface ZipEntry {
  name: string
  method: number
  compSize: number
  localOff: number
}

/** 从 ZIP 中央目录里取全部条目（局部头在数据描述符模式下长度为 0，必须走中央目录） */
function readZipEntries(buf: Uint8Array): ZipEntry[] {
  const raw = latin1(buf)
  let eocd = -1
  for (let i = raw.length - 22; i >= 0; i--) {
    if (raw.slice(i, i + 4) === 'PK\u0005\u0006') {
      eocd = i
      break
    }
  }
  if (eocd < 0) return []
  const cdCount = buf[eocd + 10] | (buf[eocd + 11] << 8)
  const cdOffset =
    (buf[eocd + 16] | (buf[eocd + 17] << 8) | (buf[eocd + 18] << 16) | (buf[eocd + 19] << 24)) >>> 0

  const entries: ZipEntry[] = []
  let off = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (raw.slice(off, off + 4) !== 'PK\u0001\u0002') break
    const method = buf[off + 10] | (buf[off + 11] << 8)
    const compSize = (buf[off + 20] | (buf[off + 21] << 8) | (buf[off + 22] << 16) | (buf[off + 23] << 24)) >>> 0
    const nameLen = buf[off + 28] | (buf[off + 29] << 8)
    const extraLen = buf[off + 30] | (buf[off + 31] << 8)
    const commentLen = buf[off + 32] | (buf[off + 33] << 8)
    const localOff = (buf[off + 42] | (buf[off + 43] << 8) | (buf[off + 44] << 16) | (buf[off + 45] << 24)) >>> 0
    entries.push({ name: raw.slice(off + 46, off + 46 + nameLen), method, compSize, localOff })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(u8: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([u8 as BlobPart]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 取出 ZIP 里的某个文件内容 */
async function readZipFile(buf: Uint8Array, name: string): Promise<string | null> {
  const entries = readZipEntries(buf)
  const e = entries.find((x) => x.name === name)
  if (!e) return null
  const lo = e.localOff
  const lNameLen = buf[lo + 26] | (buf[lo + 27] << 8)
  const lExtraLen = buf[lo + 28] | (buf[lo + 29] << 8)
  const dataStart = lo + 30 + lNameLen + lExtraLen
  const comp = buf.subarray(dataStart, dataStart + e.compSize)
  const out = e.method === 0 ? comp : await inflateRaw(comp)
  return new TextDecoder('utf-8').decode(out)
}

/* ---------------------------- OOXML 表格解析 ---------------------------- */

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

interface Cell {
  text: string
  /** 该单元格横向占据的列数 */
  gridSpan: number
  /** 是否是纵向合并的延续格（内容继承上一行） */
  vMergeContinue: boolean
}

/** 拆出一个 <w:tr> 里的所有 <w:tc> */
function parseRow(rowXml: string): Cell[] {
  const cells: Cell[] = []
  // <w:tc ...> ... </w:tc>；用非贪婪 + 嵌套计数处理 <w:tc> 内还有嵌套表格的情况
  const tcRe = /<w:tc(?:\s[^>]*)?>/g
  let m: RegExpExecArray | null
  const starts: number[] = []
  while ((m = tcRe.exec(rowXml))) starts.push(m.index)
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    // 找到配对的 </w:tc>
    let depth = 0
    let end = -1
    const scan = /<w:tc(?:\s[^>]*)?>|<\/w:tc>/g
    scan.lastIndex = start
    let s: RegExpExecArray | null
    while ((s = scan.exec(rowXml))) {
      if (s[0].startsWith('</')) {
        depth--
        if (depth === 0) {
          end = scan.lastIndex
          break
        }
      } else {
        depth++
      }
    }
    if (end < 0) end = rowXml.length
    const inner = rowXml.slice(start, end)

    const spanM = inner.match(/<w:gridSpan\s+w:val="(\d+)"/)
    const gridSpan = spanM ? Math.max(1, Number(spanM[1])) : 1
    const vMergeContinue = /<w:vMerge(?:\s+w:val="continue")?\s*\/>/.test(inner) ||
      /<w:vMerge\s+w:val="continue"\s*\/>/.test(inner)

    // 单元格文本：拼接所有 <w:t>，段落之间用空格分隔
    const parts: string[] = []
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
    let tm: RegExpExecArray | null
    while ((tm = tRe.exec(inner))) parts.push(unescapeXml(tm[1]))
    const text = parts.join('').replace(/\s+/g, ' ').trim()

    cells.push({ text, gridSpan, vMergeContinue })
  }
  return cells
}

/** 把单元格按 gridSpan 展开成固定列数；vMerge 延续格回填上一行内容 */
function normalizeRows(rawRows: Cell[][]): { rows: string[][]; merges: MergeRange[] } {
  const width = rawRows.reduce(
    (m, r) => Math.max(m, r.reduce((n, c) => n + c.gridSpan, 0)),
    0
  )
  const rows: string[][] = []
  const merges: MergeRange[] = []
  const prevByCol: (string | undefined)[] = new Array(width).fill(undefined)

  rawRows.forEach((cells, r) => {
    const row: string[] = new Array(width).fill('')
    let c = 0
    for (const cell of cells) {
      if (c >= width) break
      let text = cell.text
      if (cell.vMergeContinue && !text) {
        text = prevByCol[c] ?? ''
      }
      for (let k = 0; k < cell.gridSpan && c + k < width; k++) {
        row[c + k] = text
        prevByCol[c + k] = text
      }
      if (cell.gridSpan > 1) {
        merges.push({ s: { r, c }, e: { r, c: c + cell.gridSpan - 1 } })
      }
      c += cell.gridSpan
    }
    rows.push(row)
  })
  return { rows, merges }
}

/* ------------------------------ 对外接口 ------------------------------ */

export async function readDocxTable(data: ArrayBuffer): Promise<RawTable> {
  const buf = new Uint8Array(data)
  const xml = await readZipFile(buf, 'word/document.xml')
  if (!xml) {
    return {
      rows: [],
      warnings: ['这个 .docx 里没有 word/document.xml，无法读取课表（可能是旧版 .doc 二进制）。'],
    }
  }

  // 只取 <w:tbl> 表格；课表一定在表格里
  const tblMatch = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)
  const tblXml = tblMatch ? tblMatch[0] : xml

  const trRe = /<w:tr(?:\s[^>]*)?>/g
  const rowStarts: number[] = []
  let m: RegExpExecArray | null
  while ((m = trRe.exec(tblXml))) rowStarts.push(m.index)

  const rawRows: Cell[][] = []
  for (let i = 0; i < rowStarts.length; i++) {
    const start = rowStarts[i]
    const end = i + 1 < rowStarts.length ? rowStarts[i + 1] : tblXml.length
    rawRows.push(parseRow(tblXml.slice(start, end)))
  }

  if (!rawRows.length) {
    return { rows: [], warnings: ['文档里没有可识别的表格（<w:tbl>）。'] }
  }

  const { rows, merges } = normalizeRows(rawRows)
  return { rows, merges, warnings: [] }
}
