/**
 * PDF 读取器（自研，不引入重型依赖）
 *
 * 教务系统「打印成 PDF」的课表结构相对固定：一张带边框的表格 + 绝对定位的文字。
 * 这里的做法：
 *   1) 解析间接对象 → 取出所有 FlateDecode 数据流（用浏览器原生 DecompressionStream 解压）
 *   2) 解析字体资源，为每个字体建立「字节 → Unicode」解码器：
 *        · 有 /ToUnicode CMap  → 用 beginbfchar / beginbfrange 建表（Identity-H 子集字体靠它）
 *        · /Encoding 为 UniGB-UCS2-H / UniGB-UTF16-H 等 → 双字节大端即 UCS-2
 *        · 标准 14 字体 → 单字节近似
 *   3) 扫描内容流，按文本算子（BT / Tf / Td / TD / Tm / T* / Tj / TJ）取出带坐标的文字片段
 *   4) 用「星期表头」的文字 x 坐标切分列、按 y 从上到下排列，还原成网格
 *
 * 注意：PDF 属于「尽力解析」。若字体缺少 ToUnicode 与可用编码（少数子集字体），
 * 个别文字可能无法还原，此时会给出来自读取层的提醒，请以 xls/xlsx 课表为准确来源。
 */
import { CN_NUM, type RawTable } from '../grid'

const WEEKDAY_LABEL_RE = /^(?:星期|周|礼拜)\s*([一二三四五六日天])$/
const PERIOD_ONLY_RE = /^(?:第)?\s*\d{1,2}\s*(?:[-~—~至]\s*\d{1,2})?\s*节$/
const SECTION_ONLY_RE = /^第?\s*[一二三四五六七八九十\d]+\s*大节$/

/* ----------------------------- 基础工具 ----------------------------- */

function latin1(bytes: Uint8Array): string {
  let out = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return out
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  for (const fmt of ['deflate', 'deflate-raw'] as const) {
    try {
      const ds = new DecompressionStream(fmt)
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds)
      const buf = await new Response(stream).arrayBuffer()
      if (buf.byteLength > 0) return new Uint8Array(buf)
    } catch {
      /* 换下一种格式 */
    }
  }
  return null
}

/* ----------------------------- PDF 对象 ----------------------------- */

interface PdfObj {
  num: number
  dict: string
  streamBytes?: Uint8Array
}

function parseObjects(buf: Uint8Array): Map<number, PdfObj> {
  const raw = latin1(buf)
  const objs = new Map<number, PdfObj>()
  const re = /(\d+)\s+\d+\s+obj\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const num = Number(m[1])
    const bodyStart = m.index + m[0].length
    const endIdx = raw.indexOf('endobj', bodyStart)
    const bodyEnd = endIdx < 0 ? raw.length : endIdx
    const streamKw = raw.indexOf('stream', bodyStart)
    if (streamKw >= 0 && streamKw < bodyEnd) {
      const dict = raw.slice(bodyStart, streamKw)
      let s = streamKw + 'stream'.length
      if (raw[s] === '\r') s++
      if (raw[s] === '\n') s++
      const e = raw.indexOf('endstream', s)
      const streamEnd = e < 0 ? bodyEnd : e
      // 优先按 /Length 精确切片；否则退回到 endstream 并去掉尾部换行。
      // 注意：DecompressionStream 是严格实现，多一个字节就会报
      // 「Trailing junk found after the end of the compressed stream」。
      const lenVal = dictValue(dict, '/Length')
      let length = Number.NaN
      if (lenVal !== undefined) {
        if (/^\d+$/.test(lenVal.trim())) length = Number(lenVal.trim())
        else {
          const r = refNum(lenVal)
          if (r !== undefined) {
            const target = objs.get(r)
            const t = target?.dict.match(/\d+/g)
            if (t) length = Number(t[t.length - 1])
          }
        }
      }
      let end = streamEnd
      if (Number.isFinite(length) && length > 0 && s + length <= streamEnd) {
        end = s + length
      } else {
        while (end > s && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end--
      }
      objs.set(num, { num, dict, streamBytes: buf.subarray(s, end) })
    } else {
      objs.set(num, { num, dict: raw.slice(bodyStart, bodyEnd) })
    }
    re.lastIndex = bodyEnd
  }
  return objs
}

/**
 * 从字典里取 `key` 后的原始片段。
 * 两个容易踩的坑，这里都处理了：
 *  1) 键名必须完整匹配——否则 `/Font` 会命中 `/FontBBox`、`/FontDescriptor`；
 *  2) 值可能是间接引用 `10 0 R`，不能读到空格就截断。
 */
function dictValue(dict: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = dict.match(new RegExp(`${escaped}(?![A-Za-z0-9])`))
  if (!found || found.index === undefined) return undefined
  let s = found.index + key.length
  while (s < dict.length && (dict[s] === ' ' || dict[s] === '\t')) s++
  if (s >= dict.length) return undefined
  const c = dict[s]

  if (c === '[') {
    // 简单起见只取到第一个 ]（足够覆盖 /Kids /Font 这类用法）
    const e = dict.indexOf(']', s)
    return dict.slice(s, e < 0 ? dict.length : e + 1)
  }
  if (c === '<' && dict[s + 1] === '<') {
    let depth = 0
    let j = s
    for (; j < dict.length; j++) {
      if (dict[j] === '<' && dict[j + 1] === '<') {
        depth++
        j++
      } else if (dict[j] === '>' && dict[j + 1] === '>') {
        depth--
        j++
        if (depth === 0) return dict.slice(s, j + 1)
      }
    }
    return dict.slice(s, j)
  }
  if (c === '/') {
    const m = dict.slice(s + 1).match(/^[^\s/\[\]<>()]*/)
    return m ? `/${m[0]}` : undefined
  }
  // 数字或间接引用：读到分隔符为止（`10 0 R` / `6985`）
  let e = s
  while (e < dict.length && !/[/[\]<>()\r\n]/.test(dict[e])) e++
  const v = dict.slice(s, e).trim()
  return v || undefined
}

function refNum(v: string | undefined): number | undefined {
  const m = v?.match(/^(\d+)\s+\d+\s+R$/)
  return m ? Number(m[1]) : undefined
}

/* ----------------------------- 字体解码 ----------------------------- */

interface FontInfo {
  /** 码 → Unicode */
  map?: Map<number, string>
  /** 双字节编码（Identity-H / UniGB-UCS2-H 等） */
  twoByte: boolean
  /** 无法可靠解码（子集字体且无 ToUnicode） */
  unmappable: boolean
  name: string
}

function hexToUnicode(hex: string): string {
  let out = ''
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
  }
  return out
}

function parseToUnicodeMap(text: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(m[1], 16), hexToUnicode(m[2]))
    }
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = blk[1]
    // 数组形式：<lo> <hi> [<u1> <u2> ...]
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g)) {
      const lo = parseInt(m[1], 16)
      const items = [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1])
      items.forEach((h, i) => map.set(lo + i, hexToUnicode(h)))
    }
    // 简单形式：<lo> <hi> <dst>
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*$/)
      if (!m) continue
      const lo = parseInt(m[1], 16)
      const hi = parseInt(m[2], 16)
      const dst = parseInt(m[3], 16)
      for (let c = lo; c <= hi && c - lo < 65535; c++) {
        map.set(c, String.fromCodePoint(dst + (c - lo)))
      }
    }
  }
  return map
}

function fontFromDict(
  name: string,
  dict: string,
  objs: Map<number, PdfObj>,
  cmapCache: Map<number, Map<number, string>>
): FontInfo {
  const baseFont = (dictValue(dict, '/BaseFont') ?? '').replace(/^\//, '')
  const encVal = dictValue(dict, '/Encoding')
  let encName = ''
  if (encVal?.startsWith('/')) encName = encVal.slice(1)
  else if (refNum(encVal) !== undefined) {
    const encDict = objs.get(refNum(encVal)!)?.dict ?? ''
    const base = dictValue(encDict, '/BaseEncoding')
    if (base?.startsWith('/')) encName = base.slice(1)
  }

  // ToUnicode
  const tuRef = refNum(dictValue(dict, '/ToUnicode'))
  if (tuRef !== undefined) {
    let cached = cmapCache.get(tuRef)
    if (!cached) {
      const o = objs.get(tuRef)
      if (o?.streamBytes) {
        // 这里已经同步拿到字节，解压放到外面统一做（见 buildFonts）
        cached = new Map()
      }
      cmapCache.set(tuRef, cached ?? new Map())
    }
  }

  const twoByte =
    /Identity-[HV]/.test(encName) ||
    /UniGB|UniCNS|UniJIS|UniKS|UTF16/.test(encName) ||
    /Type0/.test(dict)
  const isUnicodeEnc = /UniGB|UniCNS|UniJIS|UniKS|UTF16/.test(encName)
  const isStd14 =
    /Helvetica|Times|Courier|Symbol|Zapf|Arial/i.test(baseFont) && !twoByte

  return {
    map: undefined,
    twoByte: twoByte || (!encName && !isStd14),
    unmappable: twoByte && !isUnicodeEnc,
    name: baseFont || name,
  }
}

async function buildFonts(
  objs: Map<number, PdfObj>
): Promise<{ fonts: Map<string, FontInfo>; warnings: string[] }> {
  const warnings: string[] = []
  const fonts = new Map<string, FontInfo>()

  // 预解压全部 ToUnicode 数据流
  const cmaps = new Map<number, Map<number, string>>()
  for (const o of objs.values()) {
    if (!o.streamBytes) continue
    const isFlate = /FlateDecode/.test(o.dict)
    const data = isFlate ? await inflate(o.streamBytes) : o.streamBytes
    if (!data || data.byteLength < 16) continue
    const text = latin1(data.subarray(0, Math.min(data.byteLength, 400000)))
    if (/beginbfchar|beginbfrange/.test(text)) {
      cmaps.set(o.num, parseToUnicodeMap(text))
    }
  }

  // F1 → 字体对象
  const seen = new Set<number>()
  for (const o of objs.values()) {
    const fontDictVal = dictValue(o.dict, '/Font')
    if (!fontDictVal) continue
    const inner = fontDictVal.startsWith('<<')
      ? fontDictVal
      : (refNum(fontDictVal) !== undefined ? objs.get(refNum(fontDictVal)!)?.dict : undefined) ?? ''
    for (const m of inner.matchAll(/\/([A-Za-z0-9#._+-]+)\s+(\d+)\s+\d+\s+R/g)) {
      const resName = m[1]
      const objNum = Number(m[2])
      const fo = objs.get(objNum)
      if (!fo) continue
      const info = fontFromDict(resName, fo.dict, objs, cmaps)
      const tuRef = refNum(dictValue(fo.dict, '/ToUnicode'))
      if (tuRef !== undefined) info.map = cmaps.get(tuRef)
      if (info.unmappable && !info.map && !seen.has(objNum)) {
        seen.add(objNum)
        warnings.push(`PDF 中字体「${info.name}」缺少 Unicode 映射，部分文字（多为地点）可能无法还原。`)
      }
      if (!fonts.has(resName) || info.map) fonts.set(resName, info)
    }
  }
  return { fonts, warnings }
}

/* ----------------------------- 内容流扫描 ----------------------------- */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; bytes: number[] }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: 'delim'; v: string }

function* scanContent(s: string): Generator<Tok> {
  let i = 0
  const n = s.length
  while (i < n) {
    const ch = s[i]
    if (ch === '%' ) {
      while (i < n && s[i] !== '\n') i++
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\0') {
      i++
      continue
    }
    if (ch === '(') {
      const bytes: number[] = []
      let depth = 1
      i++
      while (i < n && depth > 0) {
        const c = s[i]
        if (c === '\\') {
          const nx = s[i + 1]
          if (nx === 'n') { bytes.push(10); i += 2; continue }
          if (nx === 'r') { bytes.push(13); i += 2; continue }
          if (nx === 't') { bytes.push(9); i += 2; continue }
          if (nx === 'b') { bytes.push(8); i += 2; continue }
          if (nx === 'f') { bytes.push(12); i += 2; continue }
          if (nx === '\r') { i += 2; if (s[i] === '\n') i++; continue }
          if (nx === '\n') { i += 2; continue }
          if (nx >= '0' && nx <= '7') {
            const mm = s.slice(i + 1).match(/^[0-7]{1,3}/)
            if (mm) { bytes.push(parseInt(mm[0], 8) & 0xff); i += 1 + mm[0].length; continue }
          }
          bytes.push(nx.charCodeAt(0) & 0xff)
          i += 2
          continue
        }
        if (c === '(') { depth++; bytes.push(40); i++; continue }
        if (c === ')') {
          depth--
          if (depth === 0) { i++; break }
          bytes.push(41)
          i++
          continue
        }
        bytes.push(c.charCodeAt(0) & 0xff)
        i++
      }
      yield { t: 'str', bytes }
      continue
    }
    if (ch === '<' && s[i + 1] !== '<') {
      const j = s.indexOf('>', i)
      const hex = s.slice(i + 1, j < 0 ? n : j).replace(/[^0-9A-Fa-f]/g, '')
      const bytes: number[] = []
      for (let k = 0; k + 2 <= hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2), 16))
      yield { t: 'str', bytes }
      i = (j < 0 ? n : j) + 1
      continue
    }
    if (ch === '<' || ch === '>' || ch === '[' || ch === ']' || ch === '{' || ch === '}') {
      yield { t: 'delim', v: ch }
      i++
      continue
    }
    if (ch === '/') {
      const mm = s.slice(i + 1).match(/^[^\s/\[\]<>(){}%]*/)
      yield { t: 'name', v: mm ? mm[0] : '' }
      i += 1 + (mm ? mm[0].length : 0)
      continue
    }
    const nm = s.slice(i).match(/^[+-]?(?:\d+\.?\d*|\.\d+)/)
    if (nm && nm[0] !== '.' && nm[0] !== '-') {
      yield { t: 'num', v: Number(nm[0]) }
      i += nm[0].length
      continue
    }
    const om = s.slice(i).match(/^[A-Za-z*'"]+/)
    if (om) {
      yield { t: 'op', v: om[0] }
      i += om[0].length
      continue
    }
    i++
  }
}

interface Piece {
  x: number
  y: number
  text: string
  /** 字号，用于判断相邻片段是否属于同一段文字 */
  size?: number
}

function decodeBytes(bytes: number[], font: FontInfo | undefined): string {
  if (!bytes.length) return ''
  if (font?.map?.size) {
    let out = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1]
      out += font.map.get(code) ?? ''
    }
    return out
  }
  if (font?.twoByte) {
    let out = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    }
    return out
  }
  return bytes.map((b) => String.fromCharCode(b)).join('')
}

function extractPieces(content: string, fonts: Map<string, FontInfo>): Piece[] {
  const pieces: Piece[] = []
  let fontName = ''
  let fontSize = 0
  let x = 0
  let y = 0
  let leading = 0
  let ops: Tok[] = []

  const pushText = () => {
    const strs = ops.filter((o): o is Extract<Tok, { t: 'str' }> => o.t === 'str')
    if (!strs.length) return
    const text = strs.map((s) => decodeBytes(s.bytes, fonts.get(fontName))).join('')
    const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
    if (clean) pieces.push({ x, y, text: clean, size: fontSize || undefined })
  }

  const nums = (): number[] => ops.filter((o): o is Extract<Tok, { t: 'num' }> => o.t === 'num').map((o) => o.v)

  for (const tok of scanContent(content)) {
    if (tok.t !== 'op') {
      ops.push(tok)
      continue
    }
    switch (tok.v) {
      case 'BT':
        x = 0
        y = 0
        break
      case 'Tf': {
        const nameTok = ops.filter((o): o is Extract<Tok, { t: 'name' }> => o.t === 'name').pop()
        if (nameTok) fontName = nameTok.v
        const sizeNums = nums()
        if (sizeNums.length) fontSize = sizeNums[sizeNums.length - 1]
        break
      }
      case 'Td': {
        const v = nums()
        if (v.length >= 2) {
          x += v[v.length - 2]
          y += v[v.length - 1]
        }
        break
      }
      case 'TD': {
        const v = nums()
        if (v.length >= 2) {
          leading = -v[v.length - 1]
          x += v[v.length - 2]
          y += v[v.length - 1]
        }
        break
      }
      case 'Tm': {
        const v = nums()
        if (v.length >= 6) {
          x = v[v.length - 2]
          y = v[v.length - 1]
        }
        break
      }
      case 'T*':
        y -= leading
        break
      case 'Tj':
        pushText()
        break
      case "'":
        y -= leading
        pushText()
        break
      case '"':
        y -= leading
        pushText()
        break
      case 'TJ':
        pushText()
        break
      default:
        break
    }
    ops = []
  }
  return pieces
}

/* ----------------------------- 还原成网格 ----------------------------- */

/** 噪声行：PDF 里常混入「教学班组成/学分/学时」等长说明，不属于课程信息 */
function isNoise(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (t.length > 48) return true
  if (/[:：]/.test(t)) return true
  if (/\//.test(t)) return true
  if (/[;；]/.test(t)) return true
  if (/^[)\]}.,，。、;；]/.test(t)) return true
  if (/^(时间|上午|下午|时间段|节次|备注|说明|无|调课信息)$/.test(t)) return true
  if (/书院|拔尖|考核|学时|学分|选课|教学班|周学时|总学时|上机|讲课|组成/.test(t)) return true
  return false
}

/** 该行是否承载节次/周次（一次课程的锚点） */
function looksLikeSchedule(text: string): boolean {
  if (/\[[^\]]*节\]/.test(text)) return true
  if (/\d{1,2}\s*[-~—~至]\s*\d{1,2}\s*节/.test(text)) return true
  if (/\d{1,2}\s*节/.test(text) && /周/.test(text)) return true
  if (/(?:星期|周|礼拜)\s*[一二三四五六日天]/.test(text) && /\d/.test(text)) return true
  return false
}

/**
 * 看起来像「上课地点」的行。
 * 只在节次行之后用来判断要不要接回上一门课，因此判据收得比较紧，
 * 避免把下一门课的名字误当成地点吸进来。
 */
function isLocationLike(text: string): boolean {
  const s = text.trim()
  if (!s || s.length > 18) return false
  if (/[周节]/.test(s)) return false
  if (/^(星期|礼拜)/.test(s)) return false
  // 课程名常带 ★/○ 这类标记，地点不会有
  if (/[★☆○●◎△▲※]/.test(s)) return false
  if (/[楼室馆场]|校区|教室|机房/.test(s)) return true
  // 「最多 3 个汉字 + 字母/罗马数字/数字/连字符」且含数字，如 仙Ⅰ-101、逸B-410、教222
  if (/^[\u4e00-\u9fa5]{0,3}[A-Za-z\u2160-\u217F\d\s\-.]+$/.test(s) && /\d/.test(s)) return true
  return false
}

/** 「单」/「双」这类被表格拆到下一行的奇偶周标记 */
function isParityFragment(text: string): boolean {
  return /^[（(]?\s*[单双]\s*(周)?\s*[)）]?$/.test(text.trim())
}

function piecesToTable(pieces: Piece[], warnings: string[]): RawTable {
  // 0) 合并同一行里紧挨着的文字片段
  //    有些生成器（如 iText 导出的表格）会把每个字单独放一次，不合并就无法识别「星期一」
  const merged = mergePieces(pieces)

  // 1) 找星期表头
  const headerItems = merged
    .map((p) => ({ ...p, wd: NEW_RE(p.text) }))
    .filter((p) => p.wd != null)

  if (headerItems.length < 3) {
    warnings.push('PDF 中未找到「星期一…星期日」表头，无法确定星期列。')
    return { rows: [], warnings }
  }
  // 同一 y（容差 2）里星期列最多的一组即表头行
  const groups = new Map<number, typeof headerItems>()
  for (const it of headerItems) {
    const key = Math.round(it.y / 2) * 2
    const arr = groups.get(key) ?? []
    arr.push(it)
    groups.set(key, arr)
  }
  let header = headerItems
  let bestCount = 0
  for (const [, arr] of groups) {
    if (arr.length > bestCount) {
      bestCount = arr.length
      header = arr
    }
  }
  if (header.length < 3) {
    warnings.push('PDF 表头文字过于零散，未能可靠确定星期列。')
    return { rows: [], warnings }
  }

  header.sort((a, b) => a.x - b.x)
  const headerY = Math.max(...header.map((h) => h.y))
  const xs = header.map((h) => h.x)
  // 列边界取相邻表头中值
  const bounds: Array<{ lo: number; hi: number; wd: number }> = []
  for (let i = 0; i < header.length; i++) {
    const w = i + 1 < xs.length ? xs[i + 1] - xs[i] : xs[i] - xs[i - 1] || 80
    const lo = i === 0 ? xs[i] - w / 2 : (xs[i - 1] + xs[i]) / 2
    const hi = i === header.length - 1 ? xs[i] + w / 2 : (xs[i] + xs[i + 1]) / 2
    bounds.push({ lo, hi, wd: header[i].wd! })
  }

  // 2) 逐列收集文字片段（只取表头下方的内容）
  const body = merged.filter((p) => p.y < headerY - 2)
  const colItems: Piece[][] = bounds.map(() => [])
  for (const p of body) {
    const idx = bounds.findIndex((b) => p.x >= b.lo && p.x < b.hi)
    if (idx < 0) continue
    colItems[idx].push(p)
  }

  // 3) 每列按 y 从上到下切分成多门课
  //
  // 规则：
  //  · 遇到「节次行」收尾一门课（紧凑排版靠它切得最准）；
  //  · 节次行后紧跟的「地点行 / 单双周标记」一起收进来（PDF 里地点常单独占一行）；
  //  · 剩下「无节次行、紧贴上一门课」的碎组并回去。
  const blocksPerCol: string[][][] = colItems.map((items) => {
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
    const valid = sorted.filter((it) => looksLikeSchedule(it.text) || !isNoise(it.text))

    const gaps: number[] = []
    for (let i = 1; i < valid.length; i++) {
      const d = valid[i - 1].y - valid[i].y
      if (d > 0.5) gaps.push(d)
    }
    const sortedGaps = [...gaps].sort((a, b) => a - b)
    const median = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0
    const smallLimit = median > 0 ? median * 1.6 : Number.POSITIVE_INFINITY

    interface Grp {
      lines: string[]
      headY: number
      tailY: number
      hasSched: boolean
    }
    const raw: Grp[] = []
    let cur: Grp | null = null
    const ensure = (it: Piece): Grp => {
      if (!cur) cur = { lines: [], headY: it.y, tailY: it.y, hasSched: false }
      return cur
    }

    for (let i = 0; i < valid.length; i++) {
      const it = valid[i]
      const g = ensure(it)
      if (g.lines[g.lines.length - 1] !== it.text) g.lines.push(it.text)
      g.tailY = it.y
      if (looksLikeSchedule(it.text)) {
        g.hasSched = true
        // 节次行后面最多再吸收 2 行「地点 / 单双周标记」
        for (let k = 0; k < 2; k++) {
          const nxt = valid[i + 1]
          if (!nxt) break
          if (!isLocationLike(nxt.text) && !isParityFragment(nxt.text)) break
          g.lines.push(nxt.text)
          g.tailY = nxt.y
          i++
        }
        raw.push(g)
        cur = null
      }
    }
    if (cur) raw.push(cur)

    const merged: Grp[] = []
    for (const g of raw) {
      const prev = merged[merged.length - 1]
      const gap = prev ? prev.tailY - g.headY : Number.POSITIVE_INFINITY
      if (!g.hasSched && prev?.hasSched && gap <= smallLimit) {
        prev.lines.push(...g.lines)
        prev.tailY = g.tailY
      } else {
        merged.push({ ...g, lines: [...g.lines] })
      }
    }

    // 只有节次行、没有课名的「组」说明它是表格拆行造成的重复片段，丢弃
    const named = merged.filter((g) => g.lines.some((l) => !looksLikeSchedule(l)))
    return (named.length ? named : merged).map((g) => g.lines)
  })

  // 4) 组装成「表头 + 若干行」的网格，交给通用网格解析
  const maxBlocks = Math.max(0, ...blocksPerCol.map((b) => b.length))
  if (maxBlocks === 0) {
    warnings.push('PDF 中未识别出课程单元格，可能是版式与预期不同。')
    return { rows: [], warnings }
  }
  const rows: string[][] = []
  rows.push(['', ...header.map((h) => h.text.trim())])
  for (let i = 0; i < maxBlocks; i++) {
    rows.push(['', ...blocksPerCol.map((b) => (b[i] ? b[i].join('\n') : ''))])
  }
  return { rows, warnings }
}

function NEW_RE(text: string): number | null {
  const m = text.trim().match(WEEKDAY_LABEL_RE)
  if (!m) return null
  return CN_NUM[m[1]] ?? null
}

/**
 * 合并同一行里紧挨着的文字片段。
 * 有些生成器（如 iText 导出的表格）会把每个字单独放一次，不合并就认不出「星期一」。
 * 判据用「相邻片段起点步距的中位数」：同一段文字内步距小且均匀，跨列时步距明显更大；
 * 再用字号设一个上限，避免只有两个片段的行被误合并。
 */
function mergePieces(pieces: Piece[]): Piece[] {
  if (!pieces.length) return []
  // 按 y 分行（容差 1.5pt）
  const lines: Piece[][] = []
  for (const p of [...pieces].sort((a, b) => b.y - a.y)) {
    const line = lines.find((l) => Math.abs(l[0].y - p.y) <= 1.5)
    if (line) line.push(p)
    else lines.push([p])
  }

  const out: Piece[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    const steps: number[] = []
    for (let i = 1; i < line.length; i++) {
      const d = line[i].x - line[i - 1].x
      if (d > 0.5) steps.push(d)
    }
    const maxSize = Math.max(...line.map((p) => p.size ?? 10), 10)
    // 一行内的「段内步距」不会超过字号太多；超出这个上限的间距一律视为列间隔
    const cap = Math.max(10, maxSize * 1.3)
    const intra = steps.filter((d) => d <= cap)
    const threshold = intra.length ? Math.max(...intra) * 1.05 : 0

    let cur = { ...line[0] }
    let lastX = line[0].x
    for (let i = 1; i < line.length; i++) {
      const p = line[i]
      if (threshold > 0 && p.x - lastX <= threshold) {
        cur.text += p.text
      } else {
        out.push(cur)
        cur = { ...p }
      }
      lastX = p.x
    }
    out.push(cur)
  }
  return out.sort((a, b) => b.y - a.y || a.x - b.x)
}

/* ----------------------------- 对外接口 ----------------------------- */

interface Extracted {
  objs: Map<number, PdfObj>
  fonts: Map<string, FontInfo>
  pieces: Piece[]
  fontWarnings: string[]
}

/** 解析对象 + 字体 + 内容流，抽出全部文字片段（readPdfTable 与调试入口共用） */
async function extractAll(data: ArrayBuffer): Promise<Extracted> {
  const buf = new Uint8Array(data)
  const objs = parseObjects(buf)
  if (objs.size === 0) return { objs, fonts: new Map(), pieces: [], fontWarnings: [] }

  const { fonts, warnings: fontWarnings } = await buildFonts(objs)

  const contents: string[] = []
  for (const o of objs.values()) {
    if (!o.streamBytes) continue
    const isFlate = /FlateDecode/.test(o.dict)
    const out = isFlate ? await inflate(o.streamBytes) : o.streamBytes
    if (!out) continue
    const text = latin1(out)
    if (/\bTJ\b|\bTj\b/.test(text)) contents.push(text)
  }

  const pieces: Piece[] = []
  for (const c of contents) pieces.push(...extractPieces(c, fonts))
  return { objs, fonts, pieces, fontWarnings }
}

export async function readPdfTable(data: ArrayBuffer): Promise<RawTable> {
  const { objs, pieces, fontWarnings } = await extractAll(data)
  if (objs.size === 0) {
    return { rows: [], warnings: ['无法解析该 PDF 的内部结构。'] }
  }
  if (!pieces.length) {
    return {
      rows: [],
      warnings: [
        ...fontWarnings,
        'PDF 中没有可读取的文字内容（可能是扫描件图片，或使用了无 Unicode 映射的子集字体）。',
      ],
    }
  }

  const inner: string[] = []
  const table = piecesToTable(pieces, inner)
  if (table.rows.length === 0) {
    table.warnings = [...new Set([...fontWarnings, ...inner])]
    return table
  }
  // 成功成表时，字体映射的提示属于噪音；改为给一条「PDF 属实验性」的明确说明
  const extra = inner.filter((w) => !/缺少 Unicode 映射/.test(w))
  table.warnings = [
    ...new Set([
      ...extra,
      'PDF 为实验性解析：被表格折行的长课程名、以及源文件里重复的单元格可能提取不全。若同一份课表还有 .xls / .xlsx / .csv 导出，建议优先用表格文件。',
    ]),
  ]
  return table
}

/** 仅供调试与测试：返回从 PDF 中抽出的文字片段（含坐标） */
export async function extractPdfText(
  data: ArrayBuffer
): Promise<Array<{ x: number; y: number; text: string }>> {
  const { pieces } = await extractAll(data)
  return pieces
}


/** 内容是否像 PDF */
export function isPdf(data: ArrayBuffer): boolean {
  const b = new Uint8Array(data, 0, Math.min(5, data.byteLength))
  return String.fromCharCode(...b).startsWith('%PDF')
}

export { PERIOD_ONLY_RE, SECTION_ONLY_RE }
