/**
 * 表格 → 课程
 *
 * 各格式读取器（Sheet / RTF / PDF）先把文件统一成「归一化二维文本网格」，
 * 这里负责把网格解析成课程。兼容两类常见教务导出布局：
 *
 * A) 「大节 × 星期」网格
 *      第 0 列 = 第一/二/…大节，第 1..7 列 = 周一..周日
 *      单元格内每门课是多行块：名称 / (附注) / 教师 / 周次([周])[节次节] / 地点
 *
 * B) 「节次块 × 星期」网格
 *      星期表头跨多列合并（如「星期一」占 B:D 三列），行首是「第3节-第4节」这类节次标签
 *      单元格文本自带星期，形如：
 *          03001710 刑事诉讼法学01班
 *          秦宗文,吴进娥
 *          周一 3-4节 1-18周
 *          仙Ⅰ-101
 *
 * 两种布局的共同点：单元格里总有「一行」承载节次与周次，本解析器以该行为锚点，
 * 前一行取教师、后一行取地点、首行取名称、其余归入附注，从而不必假设固定行数。
 */
import type { Course } from '../types'
import { uid } from '../utils'

export interface MergeRange {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

/** 各读取器统一的中间结构 */
export interface RawTable {
  rows: string[][]
  merges?: MergeRange[]
  /** 已知「列 → 星期」映射（按坐标重建表格时可直接给出） */
  colToWeekday?: Map<number, number>
  /** 读取阶段产生的提示 */
  warnings: string[]
}

export const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
}

/** 匹配「周一 / 星期一 / 礼拜天」。排除「周次」「周边」这类非星期用法。 */
const WEEKDAY_RE = /(?:星期|周|礼拜)\s*([一二三四五六日天])(?![一二三四五六七八九十])/
/** 节次标签，如 第3节-第4节 / 第7节 / 三大节 */
const SECTION_RE = /大节|^\s*第?\s*[一二三四五六七八九十\d]+\s*(?:[-~—~至]\s*[一二三四五六七八九十\d]+\s*)?(?:大)?节?\s*$/
/** 形如 [01-02-03节] */
const BRACKET_PERIOD_RE = /\[([^\]]*?)\s*节\]/
/** 形如 ([周]) / (周) / 【周】/ ([周次]) */
const WEEK_TAG_RE = /[([（【]\s*\[?\s*周(?:次)?\s*\]?\s*[)\])】]/g
/** 周次标签：把「标签前那串数字」抠出来（兼容 1-7,10-11,14-16([周]) 这种写法） */
const WEEK_TAG_CAPTURE_RE =
  /([0-9][0-9,，、;；\-~—~至\s]*?)\s*[([（【]\s*\[?\s*周(?:次)?\s*\]?\s*[)\])】]/
/** 形如 1-18周 / 1-7周(单) */
const WEEKS_RE = /([0-9]{1,2}(?:\s*[-~—~至]\s*[0-9]{1,2})?(?:\s*[,，、;；]\s*[0-9]{1,2}(?:\s*[-~—~至]\s*[0-9]{1,2})?)*)\s*周/
/** 单双周标记 */
const PARITY_RE = /[(（【]\s*(单|双)\s*(?:周)?\s*[)）】]/
/** 课程编号前缀，如 03001710 / 03000040B / 00000080C（PDF 抽出的文字里编号与名称常无空格） */
const CODE_RE = /^([0-9]{5,}[0-9A-Z]{0,3})\s*(.+)$/
/** 单元格里只有「星期一」这类表头文字（合并单元格展开后的残留） */
const PURE_WEEKDAY_RE = /^(?:星期|周|礼拜)\s*[一二三四五六日天]$/
/** 单元格里只有这些说明性文字（整行横向合并后的残留） */
const JUNK_LABEL_RE = /^(?:备注|调课信息|说明|其它|其他|无|暂无|时间|上午|下午|时间段|节次)$/

export function normCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim()
}

/**
 * 展开合并单元格：把左上角的值填充到整个合并区域。
 * 这一步对「星期表头跨列合并」的布局是必需的——展开后每一列都能查到自己的星期。
 */
export function expandMerges(rows: string[][], merges: MergeRange[] | undefined, width: number): void {
  if (!merges?.length) return
  for (const m of merges) {
    const src = rows[m.s.r]?.[m.s.c]
    if (!src) continue
    for (let r = m.s.r; r <= m.e.r; r++) {
      if (!rows[r]) rows[r] = Array.from({ length: width }, () => '')
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue
        if (!rows[r][c]) rows[r][c] = src
      }
    }
  }
}

/** 从 1-7,10-11,14-16 这类文本展开成周序号数组（含单双周过滤） */
export function parseWeekNumbers(text: string, parity?: 'odd' | 'even'): number[] {
  const out = new Set<number>()
  for (const part of text.split(/[,，、;；]/)) {
    const t = part.trim()
    if (!t) continue
    const range = t.match(/^(\d{1,2})\s*[-~—~至]\s*(\d{1,2})$/)
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i > 0 && i <= 60) out.add(i)
      continue
    }
    const single = t.match(/^(\d{1,2})$/)
    if (single) {
      const n = Number(single[1])
      if (n > 0 && n <= 60) out.add(n)
    }
  }
  let list = [...out]
  if (parity === 'odd') list = list.filter((n) => n % 2 === 1)
  if (parity === 'even') list = list.filter((n) => n % 2 === 0)
  return list.sort((a, b) => a - b)
}

/** 从 [01-02-03节] 中取出小节号 */
function parseBracketPeriods(text: string): number[] {
  const m = text.match(BRACKET_PERIOD_RE)
  if (!m) return []
  return m[1]
    .split(/[-~—、,，\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
}

export function periodLabelOf(periods: number[]): string {
  if (periods.length === 0) return ''
  const s = [...periods].sort((a, b) => a - b)
  if (s.length === 1) return `第${s[0]}节`
  const contiguous = s.every((v, i) => i === 0 || v === s[i - 1] + 1)
  return contiguous ? `第${s[0]}-${s[s.length - 1]}节` : `第${s.join('、')}节`
}

interface SchedInfo {
  /** 文本里写明的星期（比表格列更具体，优先采信） */
  weekday?: number
  periods: number[]
  weeks?: string
  weekNumbers: number[]
  parity?: 'odd' | 'even'
}

/**
 * 解析「节次 + 周次」行（单元格里的锚点行）。
 * 支持：
 *   `周一 3-4节 1-18周`
 *   `周一 7-8节 1-7周(单)`
 *   `(1-2节)7-18周/场地:明达楼`
 *   `1-7,10-11,14-16([周])[01-02-03节]`
 */
function parseSchedLine(line: string): SchedInfo | null {
  // 形如「/场地:xxx」的地点信息先摘掉，避免污染周次解析
  const noVenue = line.replace(/\/\s*场地\s*[:：][^/]*/g, ' ')
  const bracketPeriods = parseBracketPeriods(noVenue)

  const parityM = noVenue.match(PARITY_RE)
  const parity = parityM
    ? parityM[1] === '单'
      ? ('odd' as const)
      : ('even' as const)
    : undefined

  // 周次有两种常见写法：
  //   a) 1-7,10-11,14-16([周])  —— 「周」在括号里，数字在括号前
  //   b) 1-18周 / 1-7周(单)     —— 数字紧跟「周」
  let weeksText = ''
  const tagM = noVenue.match(WEEK_TAG_CAPTURE_RE)
  if (tagM) {
    weeksText = tagM[1].trim()
  } else {
    const cleaned = noVenue.replace(BRACKET_PERIOD_RE, ' ').replace(PARITY_RE, ' ')
    const m = cleaned.match(WEEKS_RE)
    if (m) weeksText = m[1].trim()
  }

  // 节次：优先 [xx节] 括号形式，其次「3-4节」
  let periods = bracketPeriods
  if (!periods.length) {
    const work = noVenue
      .replace(BRACKET_PERIOD_RE, ' ')
      .replace(PARITY_RE, ' ')
      .replace(WEEK_TAG_RE, ' ')
    const pm =
      work.match(/第?\s*(\d{1,2})\s*[-~—~至]\s*(\d{1,2})\s*节/) ??
      work.match(/第?\s*(\d{1,2})\s*节/)
    if (pm) {
      const a = Number(pm[1])
      const b = pm[2] ? Number(pm[2]) : a
      periods = []
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) periods.push(i)
    }
  }

  const wdM = noVenue.match(WEEKDAY_RE)
  const weekday = wdM ? CN_NUM[wdM[1]] : undefined

  if (!periods.length && !weeksText) return null

  return {
    weekday,
    periods,
    weeks: weeksText
      ? parity
        ? `${weeksText}(${parity === 'odd' ? '单' : '双'})`
        : weeksText
      : undefined,
    weekNumbers: weeksText ? parseWeekNumbers(weeksText, parity) : [],
    parity,
  }
}

/** 判断一行是否只是「节次标签」（作为单元格内的课程行时需要排除） */
function isSectionLabel(text: string): boolean {
  if (!text) return false
  if (/^\s*第?\s*\d{1,2}\s*[-~—~]\s*\d{1,2}\s*节\s*$/.test(text)) return true
  return SECTION_RE.test(text) && !WEEKS_RE.test(text)
}

/** 解析一个课程单元格（可能含多行 / 多门课） */
export function parseCourseCell(
  cellText: string,
  weekday: number,
  section: string,
  sectionPeriods: number[]
): Course[] {
  // 紧凑格式：整格只有一行，却把「名称 课程号(周次) (节次) 地点  教师」连着写，
  // 一格里还可能挤多门课（同一门课的不同周次/教室）。典型见中国石油大学（北京）克拉玛依校区的 .docx 课表。
  // 与「按空行分块」的多行格式不同，必须先按 (…周) 锚点切开。
  if (isCompactCell(cellText)) return parseCompactCell(cellText, weekday, section, sectionPeriods)

  const out: Course[] = []
  for (const block of cellText.split(/\n\s*\n/)) {
    const c = parseCourseBlock(block, weekday, section, sectionPeriods)
    if (c) out.push(c)
  }
  return out
}

/** 紧凑格式判据：同时出现「(N~M,N周)」与「(N-M节)」这种圆括号写法 */
const COMPACT_WEEK_RE =
  /[([（]\s*\d{1,2}(?:\s*[-~—~至]\s*\d{1,2})?(?:\s*[,，、;；]\s*\d{1,2}(?:\s*[-~—~至]\s*\d{1,2})?)*\s*周\s*[)\])】]/
const COMPACT_PERIOD_RE = /[([（]\s*\d{1,2}\s*[-~—~至]\s*\d{1,2}\s*节\s*[)\])】]/
/** 课程号，如 160627M006.04 / 100616M003.17 */
const COMPACT_CODE_RE = /\d{6,}[A-Za-z0-9]*\.\d{1,3}/
/** 教师工号，如 (2025563001) */
const TEACHER_ID_RE = /\(\s*\d{4,}\s*\)/g
/** 「教学班组成」噪声起点：非 2026 / 2025; / 能源与动力工程25-[1-2]班 … */
const CLASS_NOISE_RE =
  /(?:非\s*\d{4}|\d{4}\s*[;；]|[\u4e00-\u9fa5]{2,}\d{2}\s*[-–]\s*\[?\d)/

function isCompactCell(text: string): boolean {
  return COMPACT_WEEK_RE.test(text) && COMPACT_PERIOD_RE.test(text)
}

/** 紧凑单元格 → 多门课 */
function parseCompactCell(
  cellText: string,
  weekday: number,
  section: string,
  sectionPeriods: number[]
): Course[] {
  // 1) 按「(…周)」的起点切段：段前那截是 名称+课程号（后续段则为空，继承上一门）
  const starts: number[] = []
  let m: RegExpExecArray | null
  const anchor = new RegExp(COMPACT_WEEK_RE.source, 'g')
  while ((m = anchor.exec(cellText))) starts.push(m.index)

  let prefix = ''
  let parts: string[] = []
  if (starts.length) {
    prefix = cellText.slice(0, starts[0]).trim()
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1] : cellText.length
      parts.push(cellText.slice(starts[i], end).trim())
    }
  } else {
    // 没有周次标记：退化成按「(…节)」切
    const pAnchor = /[([（]\s*\d{1,2}\s*[-~—~至]\s*\d{1,2}\s*节\s*[)\])】]/g
    const pStarts: number[] = []
    while ((m = pAnchor.exec(cellText))) pStarts.push(m.index)
    if (!pStarts.length) return []
    prefix = cellText.slice(0, pStarts[0]).trim()
    for (let i = 0; i < pStarts.length; i++) {
      const end = i + 1 < pStarts.length ? pStarts[i + 1] : cellText.length
      parts.push(cellText.slice(pStarts[i], end).trim())
    }
  }

  // 2) 前缀里拆 名称 / 课程号
  let name = prefix
  let code: string | undefined
  const cm = prefix.match(new RegExp(`^(.*?)(${COMPACT_CODE_RE.source})\\s*$`))
  if (cm && cm[1].trim()) {
    code = cm[2]
    name = cm[1].trim()
  }

  const out: Course[] = []
  let lastName = name
  let lastCode = code

  for (const part of parts) {
    // 周次
    const weeksM = part.match(COMPACT_WEEK_RE)
    const weeksText = weeksM ? weeksM[0].replace(/[([（【\])）】]|周/g, '').trim() : ''
    // 节次
    const periodM = part.match(COMPACT_PERIOD_RE)
    const periods = periodM ? periodsFromSectionLabel(periodM[0]) : []
    // 去掉周次/节次标记后剩「地点 + 教师 + 噪声」
    let rest = part
    if (periodM) rest = rest.replace(periodM[0], ' ')
    if (weeksM) rest = rest.replace(weeksM[0], ' ')
    rest = rest.trim()

    // 地点 / 教师：优先按两个及以上空格切
    let location = ''
    let teacherPart = rest
    const bySpace = rest.split(/\s{2,}/).filter((s) => s.trim())
    if (bySpace.length >= 2) {
      location = bySpace[0].trim()
      teacherPart = bySpace.slice(1).join(' ').trim()
    } else {
      // 退化：以「名字(工号)」作为教师起点
      const tm = rest.match(/^(.*?)(?=[^\s()]+\(\s*\d{4,}\s*\))/)
      if (tm && tm[1].trim()) {
        location = tm[1].trim()
        teacherPart = rest.slice(tm[1].length).trim()
      }
    }

    // 教师：剥掉工号与「教学班组成」噪声
    let teacher = teacherPart.replace(TEACHER_ID_RE, ' ').replace(/\s*\/\s*/g, '/')
    const noiseM = teacher.match(CLASS_NOISE_RE)
    if (noiseM && noiseM.index !== undefined) {
      teacher = teacher.slice(0, noiseM.index)
    }
    teacher = teacher.replace(/[\s,，、;；/]+$/, '').replace(/^[\s,，、;；/]+/, '').trim()
    // 噪声剥离可能切出空教师（说明整段其实是班级组成），此时退回上一门课的教师
    if (!teacher) teacher = ''

    const effectiveName = name || lastName
    const effectiveCode = code ?? lastCode
    if (!effectiveName && !weeksText && !periods.length) continue
    lastName = effectiveName
    lastCode = effectiveCode

    out.push({
      id: uid('c-'),
      name: effectiveName,
      code: effectiveCode,
      weekday,
      section: section || undefined,
      periods,
      periodLabel: periodLabelOf(periods),
      weeks: weeksText || undefined,
      weekNumbers: weeksText ? parseWeekNumbers(weeksText) : [],
      location: location || undefined,
      teacher: teacher || undefined,
      raw: part,
    })
  }
  return out
}

/** 「教学班/学分/学时」这类详情字段：出现在 PDF 的详细信息层里，不是课表内容 */
const DETAIL_NOISE_RE =
  /\/\s*(?:教学班|考核方式|课程学时|总学时|周学时|学分|选课备注|上课备注|考试方式|教室容量|课程性质|开课学院)\s*[:：]?/

/** 这一行像「任课教师」吗？用于避免把名称折行、★ 标记误当成教师 */
function looksLikeTeacher(s: string): boolean {
  const t = s.trim()
  if (!t || t.length > 24) return false
  if (/[★☆○●◎△▲※]/.test(t)) return false // 标记符号 → 不是教师
  if (/^\d/.test(t)) return false // 以数字开头（如「1★」）→ 不是教师
  if (/[节周场地教室楼\/|]/.test(t)) return false // 含地点/节次字眼
  return /[一-龥A-Za-z]/.test(t)
}

function parseCourseBlock(
  rawBlock: string,
  weekday: number,
  section: string,
  sectionPeriods: number[]
): Course | null {
  // PDF 的「详细信息层」会把教学班组成、学分学时整段塞进单元格，
  // 而且常常同一段文字画两遍（双图层重叠）。先在详情字段处切断，后面的都不看。
  const block = rawBlock.split(DETAIL_NOISE_RE)[0]

  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !isSectionLabel(l))
  if (lines.length === 0) return null

  // 锚点行：能解析出节次或周次的那一行
  let schedIdx = -1
  let sched: SchedInfo | null = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = parseSchedLine(lines[i])
    if (s && (s.periods.length || s.weekNumbers.length)) {
      schedIdx = i
      sched = s
      break
    }
  }

  // 名称行：取首行，剥掉课程编号前缀
  let nameLine = lines[0]
  let code: string | undefined
  const cm = nameLine.match(CODE_RE)
  if (cm) {
    code = cm[1]
    nameLine = cm[2].trim()
  }
  // 名称里常见的标记（★必修、○选修、△等）单独留作附注，不污染名称
  const markM = nameLine.match(/[\s]*([★☆○●◎△▲※]+)\s*$/)
  const mark = markM ? markM[1] : ''
  if (markM) nameLine = nameLine.slice(0, markM.index).trim()
  nameLine = nameLine.replace(/^[\s*※#-]+/, '').trim()

  // 去掉名称里的「（N-M节）」等残留
  nameLine = nameLine.replace(/[(（]\s*\d{1,2}\s*[-~—]\s*\d{1,2}\s*节\s*[)）]/g, '').trim()
  // 名称行本身就是节次/地点行时（PDF 抽取丢名称的残片），把节次与场地标记剥掉
  const stripSchedFromName = (s: string) =>
    s
      .replace(/[(（]\s*\d{1,2}\s*[-~—~至]\s*\d{1,2}\s*节\s*[)）]/g, ' ')
      .replace(/\/\s*场地\s*[:：][^/\n]*/g, ' ')
      .replace(/\/\s*教师\s*[:：][^/\n]*/g, ' ')
      .replace(/\d{1,2}\s*[-~—~至]\s*\d{1,2}\s*(?:周|周次)/g, ' ')
      .replace(/第?\s*\d{1,2}\s*周/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  if (!sched) {
    // 没有可靠锚点：只当作一个名称，不猜测含义。
    // PDF 末尾常有「本页课程索引/图例」——一格里堆一串课名却没有节次，
    // 这种多行堆叠一律不认，避免凭空造课。
    if (lines.length > 2) return null
    if (lines.length > 1 && sectionPeriods.length === 0) return null
    const bare = stripSchedFromName(nameLine)
    if (!bare) return null
    // 只剩标点/符号的残片也不算课程名
    if (/^[\s()（）[\]【】*※#\-—_·.、，,]+$/.test(bare)) return null
    return {
      id: uid('c-'),
      name: bare,
      code,
      weekday,
      section: section || undefined,
      periods: sectionPeriods,
      periodLabel: periodLabelOf(sectionPeriods),
      weekNumbers: [],
      note: mark || undefined,
      raw: block,
    }
  }

  const before = lines.slice(1, schedIdx)
  const after = lines.slice(schedIdx + 1)

  // 教师：锚点行的上一行（必须长得像教师名，否则当作名称折行/附注）
  const prevLine = schedIdx - 1 >= 1 ? lines[schedIdx - 1] : undefined
  const teacher = prevLine && looksLikeTeacher(prevLine) ? prevLine : undefined
  // 附注：名称与教师之间的内容
  const noteParts = before.filter((l) => l !== teacher)

  // 名称被表格折行折断时（PDF 窄列里很常见，如「习近平新时代中国特色社会主」+
  // 「义思想概论08班」，或「大学生心理健康教育-」+「1★」），
  // 把紧跟其后、看起来仍是名称的小段**连续**接回去（可能折了不止一行）。
  //
  // ⚠️ 判据要严：以 ★/○ 等标记结尾、且本身就是中文名的（如「基础英语Ⅰ★」），
  // 是**另一门课的名字**（PDF 双图层把两格文字叠在了一起），不能拼进当前名称。
  let nameText = nameLine
  while (noteParts.length >= 1) {
    const cand = noteParts[0]
    const isSeparateName = /[★☆○●◎△▲※]\s*$/.test(cand) && /[一-龥]{2}/.test(cand)
    const looksLikeContinuation =
      !isSeparateName &&
      cand.length <= 12 &&
      nameText.length + cand.length <= 26 && // 别一路拼下去，把隔壁课程/地点也吞了
      !/^[一-龥]{2,3}$/.test(cand) && // 纯 2-3 个汉字，多半是教师/人名，不是名称续接
      !/[,，、:：/／;；]/.test(cand) &&
      !/\d{6,}/.test(cand) && // 含课程编号（如 00330100）→ 是另一门课的片段
      !/[楼馆室场区园廊]|[ⅠⅡⅢⅣⅤⅥ]/.test(cand) && // 含地点字眼（如「仙Ⅱ-403」）→ 不是名称
      !/^\d+$/.test(cand) &&
      cand !== teacher &&
      !/[(（]\s*\d/.test(cand) // 「(1-2节)…」这类不是名称续接
    if (!looksLikeContinuation) break
    nameText = `${nameText}${cand}`
    noteParts.shift()
  }
  // 续接完成后再补上 ★ / ○ 标记（放到续接之前会被误当成续接文本拼回名称）
  if (mark) noteParts.push(mark)
  // 续接进来的片段可能自带标记尾巴（「1★」），统一从名称上摘掉
  const tailMark = nameText.match(/[\s]*([★☆○●◎△▲※]+)\s*$/)
  if (tailMark && !mark) {
    nameText = nameText.slice(0, tailMark.index).trim()
    noteParts.push(tailMark[1])
  }

  // 地点 / 教师：优先取显式标记（PDF 的信息层用「/场地:」「/教师:」标注），
  // 比「位置启发式」稳得多，也不会被双图层重复文字带偏。
  const locM = block.match(/\/\s*场地\s*[:：]\s*([^/()（）\n]+)/)
  const teaM = block.match(/\/\s*教师\s*[:：]\s*([^/\n]+)/)
  let location: string | undefined
  let teacherOut = teacher
  if (locM) location = locM[1].trim()
  if (teaM) {
    const t = teaM[1].replace(/\(\s*\d{4,}\s*\)/g, ' ').trim()
    if (t) teacherOut = t
  }
  if (!location) {
    location = after.join(' / ').trim() || undefined
  }
  // 表格把「(单)」这类奇偶周标记折到下一行时，不要把它当地点
  if (location) {
    location =
      location.replace(/^\s*[（(]?\s*[单双]\s*(?:周)?\s*[)）]?\s*[/／]?\s*/, '').trim() || undefined
  }

  const periods = sched.periods.length ? sched.periods : sectionPeriods
  const effectiveWeekday = sched.weekday ?? weekday

  // 名称行就是节次行、且剥完什么都没剩 → 丢名称的残片，不硬凑一门课
  const finalName = stripSchedFromName(nameText || lines[0])
  if (!finalName) return null
  if (/^[\s()（）[\]【】*※#\-—_·.、，,]+$/.test(finalName)) return null

  return {
    id: uid('c-'),
    name: finalName,
    code,
    weekday: effectiveWeekday,
    section: section || undefined,
    periods,
    periodLabel: periodLabelOf(periods),
    weeks: sched.weeks,
    weekNumbers: sched.weekNumbers,
    location: location || undefined,
    teacher: teacherOut || undefined,
    note: noteParts.length ? noteParts.join(' / ') : undefined,
    parity: sched.parity,
    raw: block,
  }
}

/** 找出星期表头所在行，并给出「列 → 星期」映射 */
export function findWeekdayHeader(
  rows: string[][],
  maxScan = 40
): { row: number; map: Map<number, number> } | null {
  let best: { row: number; map: Map<number, number> } | null = null
  for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
    const map = new Map<number, number>()
    rows[r]?.forEach((cell, c) => {
      const m = cell?.match(WEEKDAY_RE)
      if (m && CN_NUM[m[1]] && cell.trim().length <= 8) map.set(c, CN_NUM[m[1]])
    })
    const distinct = new Set(map.values()).size
    if (map.size >= 3 && distinct >= 3) {
      if (!best || distinct > new Set(best.map.values()).size) best = { row: r, map }
    }
  }
  return best
}

/** 从节次标签里取节次号，如「第3节-第4节」→ [3,4] */
export function periodsFromSectionLabel(label: string): number[] {
  const m = label.match(/第?\s*(\d{1,2})\s*[-~—~至]\s*(\d{1,2})\s*节/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const out: number[] = []
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
    return out
  }
  const single = label.match(/第?\s*(\d{1,2})\s*节/)
  if (single) return [Number(single[1])]
  return []
}

export interface GridParseResult {
  courses: Course[]
  /** 备注 / 调课信息等表格尾部的补充说明 */
  remarks: string[]
  warnings: string[]
  headerRow: number
}

/** 网格 → 课程 */
export function gridToCourses(raw: RawTable): GridParseResult {
  const warnings = [...raw.warnings]
  const { rows } = raw
  const width = rows.reduce((m, r) => Math.max(m, r?.length ?? 0), 0)
  expandMerges(rows, raw.merges, width)

  const header = findWeekdayHeader(rows)
  const headerRow = header?.row ?? -1
  const colToWeekday = header?.map ?? raw.colToWeekday ?? new Map<number, number>()

  const courses: Course[] = []
  const remarkSet = new Set<string>()
  const seen = new Set<string>()
  let currentSection = ''
  let currentSectionPeriods: number[] = []

  if (headerRow >= 0) {
    const maxCol = Math.max(width - 1, ...(raw.colToWeekday ? [Math.max(...raw.colToWeekday.keys())] : [0]))
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? []
      const label = (row[0] ?? '').trim()
      const rowText = row.filter(Boolean).join(' ')

      // 备注 / 调课信息行。
      // ⚠️ 必须从「单元格开头」匹配，否则 PDF 信息层里的「/选课备注:」会误触发，
      // 把整段教学班详情都当成备注收进来。
      const remarkCell = row.find((c) => /^\s*(?:备注|调课信息)\s*[:：]/.test(c ?? ''))
      if (remarkCell) {
        const cleaned = remarkCell.replace(/^\s*(?:备注|调课信息)\s*[:：]/, ' ')
        for (const piece of cleaned.split(/[;；\n]/)) {
          const t = piece.trim()
          if (t && t.length < 200) remarkSet.add(t)
        }
        continue
      }
      if (/^\s*(调课信息|说明|其他)\s*$/.test(label) && !row.slice(1).some(Boolean)) continue

      // 整行横向合并的说明行（如「调课信息」「无」）展开后每列都是同一段文字，直接跳过
      const others = row.slice(1).filter((c) => c !== '')
      if (label && others.length > 0 && others.every((c) => c === label)) continue

      if (label && isSectionLabel(label) && !WEEKS_RE.test(label)) {
        currentSection = label
        currentSectionPeriods = periodsFromSectionLabel(label)
        // 行首标签本身不是课程内容
      }

      for (let c = 1; c <= maxCol; c++) {
        const weekday = colToWeekday.get(c)
        if (!weekday) continue
        const cell = (row[c] ?? '').trim()
        if (!cell) continue
        // 表头竖向合并展开后，表头文字会落到表头下方的行里，需要排除
        if (PURE_WEEKDAY_RE.test(cell) || JUNK_LABEL_RE.test(cell)) continue
        if (isSectionLabel(cell) && !WEEKS_RE.test(cell)) continue
        for (const course of parseCourseCell(cell, weekday, currentSection, currentSectionPeriods)) {
          const key = [
            course.name,
            course.weekday,
            course.periods.join('-'),
            course.weeks ?? '',
            course.location ?? '',
          ].join('|')
          if (seen.has(key)) continue
          seen.add(key)
          courses.push(course)
        }
      }
    }
  } else {
    warnings.push('未能在表格中找到「星期一…星期日」表头，无法确定星期列，已保留原始表格供人工核对。')
  }

  if (courses.length === 0 && headerRow >= 0) {
    warnings.push('找到表头但未解析出任何课程，可能课表格式与预期不同，请核对原始表格。')
  }

  courses.sort(
    (a, b) =>
      a.weekday - b.weekday ||
      (a.periods[0] ?? 99) - (b.periods[0] ?? 99) ||
      a.name.localeCompare(b.name, 'zh')
  )

  return { courses, remarks: [...remarkSet], warnings, headerRow }
}
