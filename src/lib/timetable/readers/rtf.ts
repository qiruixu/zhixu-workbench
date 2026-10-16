/**
 * RTF 读取器
 *
 * 不少教务系统导出的「.doc」其实是 RTF（`{\rtf1...}`），表头还常常是
 * iText 之类库生成的 —— 表格用 `\trowd ... \cell ... \row` 描述。
 * 这里做一个「够用」的 RTF 子集解析：
 *   · 剔除 fonttbl / colortbl / stylesheet / info / pict 等目的地组（pict 里是二进制图，必须跳过）
 *   · 识别 \row / \cell / \par / \tab 还原行列
 *   · 识别 \clvmrg / \clmrg（合并单元格的延续格）→ 视为空格
 *   · 文本解码支持 \uN? （UTF-16 码位）与 \'hh 字节串（按 GBK 解码）
 */
import { CN_NUM, type RawTable } from '../grid'

const SKIP_DESTS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'pntext', 'listtable',
  'listoverridetable', 'generator', 'filetbl', 'revtbl', 'rsidtbl', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'mmathPr', 'xmlnstbl',
  'wgrffmtfilter', 'panose', 'falt', 'header', 'footer', 'footnote', 'annotation',
  'object', 'shppict', 'nonshppict', 'formfield', 'fldinst', 'xmlopen',
])

/** 剔除不需要的组（含嵌套）。注意 `\binN` 后面是原始二进制，必须按长度跳过，否则花括号计数会失衡。 */
function stripDestinations(src: string): string {
  let out = ''
  let i = 0
  const stack: boolean[] = []
  let skipDepth = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '{') {
      let skip = false
      let j = i + 1
      while (j < src.length && (src[j] === '\r' || src[j] === '\n')) j++
      if (src[j] === '\\') {
        if (src[j + 1] === '*') {
          skip = true
        } else {
          const m = src.slice(j).match(/^\\([a-zA-Z]+)/)
          if (m && SKIP_DESTS.has(m[1].toLowerCase())) skip = true
        }
      }
      stack.push(skip)
      if (skip) skipDepth++
      i++
      continue
    }
    if (ch === '}') {
      const skipped = stack.pop()
      if (skipped) skipDepth--
      i++
      continue
    }
    if (skipDepth > 0) {
      // 被跳过的组里也可能藏着 \binN 二进制载荷，必须按长度跳过去
      if (ch === '\\') {
        const m = src.slice(i).match(/^\\bin(\d+)/)
        if (m) {
          i += m[0].length + Number(m[1])
          continue
        }
      }
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

let gbkDecoder: TextDecoder | null | undefined
function decodeGbkBytes(bytes: number[]): string {
  if (gbkDecoder === undefined) {
    try {
      gbkDecoder = new TextDecoder('gbk')
    } catch {
      gbkDecoder = null
    }
  }
  const u8 = new Uint8Array(bytes)
  if (gbkDecoder) {
    try {
      return gbkDecoder.decode(u8)
    } catch {
      /* 落到 utf-8 */
    }
  }
  try {
    return new TextDecoder('utf-8').decode(u8)
  } catch {
    return String.fromCharCode(...bytes)
  }
}

/** 逐字节转 latin1 字符串（分块，避免超长参数列表） */
function latin1(bytes: Uint8Array): string {
  let out = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return out
}

interface RtfTable {
  rows: string[][]
  warnings: string[]
}

/** 把 RTF 源文本还原成行列 */
export function readRtfTable(data: ArrayBuffer): RawTable {
  const bytes = new Uint8Array(data)
  const src = latin1(bytes)
  const warnings: string[] = []

  let body = stripDestinations(src)

  // 全局声明：\ucN 表示 \uN 之后有多少个回退字符需要跳过
  let uc = 1
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let cellIsMergeContinuation = false
  let hexBytes: number[] = []

  const flushHex = () => {
    if (hexBytes.length) {
      cell += decodeGbkBytes(hexBytes)
      hexBytes = []
    }
  }
  const endCell = () => {
    flushHex()
    row.push(cellIsMergeContinuation ? '' : cell.trim())
    cell = ''
    cellIsMergeContinuation = false
  }
  const endRow = () => {
    flushHex()
    // 收尾：若还有未 \cell 的内容，作为一个格子
    if (cell.trim() || row.length) {
      row.push(cellIsMergeContinuation ? '' : cell.trim())
      cell = ''
      cellIsMergeContinuation = false
    }
    if (row.some((c) => c !== '')) rows.push(row)
    else if (row.length) rows.push(row)
    row = []
  }

  let i = 0
  const n = body.length
  while (i < n) {
    const ch = body[i]
    if (ch === '\\') {
      const rest = body.slice(i)
      let m: RegExpMatchArray | null
      // \'hh 十六进制字节
      if ((m = rest.match(/^\\'([0-9a-fA-F]{2})/))) {
        hexBytes.push(parseInt(m[1], 16))
        i += m[0].length
        continue
      }
      // \uN 码位
      if ((m = rest.match(/^\\u(-?\d+) ?/))) {
        flushHex()
        const code = ((Number(m[1]) % 65536) + 65536) % 65536
        cell += String.fromCharCode(code)
        i += m[0].length
        // 跳过 uc 个回退字符（通常是 '?'）
        let skipped = 0
        while (skipped < uc && i < n && body[i] !== '\\' && body[i] !== '{' && body[i] !== '}') {
          i++
          skipped++
        }
        continue
      }
      if ((m = rest.match(/^\\uc(\d+)/))) {
        uc = Number(m[1])
        i += m[0].length
        continue
      }
      // \binN：后面跟 N 个原始字节（可能是二进制图片），必须整段跳过
      if ((m = rest.match(/^\\bin(\d+)/))) {
        i += m[0].length + Number(m[1])
        continue
      }
      if ((m = rest.match(/^\\row\b/))) {
        endRow()
        i += m[0].length
        continue
      }
      if ((m = rest.match(/^\\cell\b/))) {
        endCell()
        i += m[0].length
        continue
      }
      if ((m = rest.match(/^\\clvmrg\b/)) || (m = rest.match(/^\\clmrg\b/))) {
        cellIsMergeContinuation = true
        i += m[0].length
        continue
      }
      if ((m = rest.match(/^\\par\b/)) || (m = rest.match(/^\\line\b/))) {
        flushHex()
        cell += '\n'
        i += m[0].length
        continue
      }
      if ((m = rest.match(/^\\tab\b/))) {
        flushHex()
        cell += '\t'
        i += m[0].length
        continue
      }
      // 其它控制字（含 \trowd 之类表格属性）直接跳过
      if ((m = rest.match(/^\\[a-zA-Z]+(-?\d+)? ?/))) {
        i += m[0].length
        continue
      }
      // \~ 表示不换行空格；\<其它符号> 原样输出
      if (rest.length > 1) {
        const sym = rest[1]
        if (sym === '~') cell += ' '
        else if (sym === '{' || sym === '}' || sym === '\\') cell += sym
        i += 2
        continue
      }
      i++
      continue
    }
    if (ch === '{' || ch === '}') {
      i++
      continue
    }
    flushHex()
    cell += ch
    i++
  }
  endRow()
  body = ''

  // 去掉空行（但保留用于定位表头的行结构）
  const grid = rows.map((r) => r.map((c) => c.replace(/[ \t\u00a0]+/g, ' ').trim()))
  if (grid.length === 0) warnings.push('RTF 中未找到表格内容。')

  return { rows: grid, warnings }
}

/** 该 RTF 是否含有可以解析的表格结构 */
export function rtfHasTable(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data.slice(0, Math.min(data.byteLength, 200000)))
  const head = String.fromCharCode(...bytes)
  return /\\rtf/.test(head) && /\\trowd|\\cell\b/.test(head)
}

export { CN_NUM }
