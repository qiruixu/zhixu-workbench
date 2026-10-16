/**
 * iCalendar（.ics）课表读取器
 *
 * 适配「WakeUpSchedule / 课程表类 App」导出的 .ics，以及学校教务系统导出的通用 VEVENT。
 *
 * 这类课表**不是网格**，而是「事件 + 每周重复规则」：
 *   SUMMARY:信号与系统(EE150.01)
 *   DTSTART;TZID=Asia/Shanghai:20260915T081500
 *   DTEND;TZID=Asia/Shanghai:20260915T095500
 *   RRULE:FREQ=WEEKLY;UNTIL=20270104T160000Z;INTERVAL=1
 *   LOCATION:教学中心301 徐林
 *   DESCRIPTION:第1 - 2节\n教学中心301\n徐林
 *
 * 因此这里绕过 grid.ts，直接产出 Course：
 *  · 星期 / 节次：取自 DTSTART 与 DESCRIPTION 里的「第N - M节」；
 *  · 周次：由 DTSTART..RRULE.UNTIL 的实际日期推算；
 *  · **学期起始周**：取所有事件里最早一节的「所在周的周一」，
 *    这样「当前第几周」可以由日期自动算出，无需用户手填。
 *
 * 由于 ICS 给的是**绝对日期**而非「第几周」，这里的 weekNumbers 与
 * meta.semesterStart 必须成对使用（都由同一批日期推算），否则周次会对不上。
 */
import type { Course } from '../../types'
import { uid } from '../../utils'
import { periodLabelOf } from '../grid'
import {
  dateKeyOf,
  mondayKeyOf,
  parseDateKey,
  weeksBetween,
} from '../dates'

export interface IcsParseResult {
  courses: Course[]
  /** 自动推算的「开学第一周周一」(YYYY-MM-DD) */
  semesterStart: string
  remarks: string[]
  warnings: string[]
}

/** ICS 行折叠还原（RFC 5545：以空格/Tab 开头的行是上一行的续行） */
function unfold(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (/^[ \t]/.test(raw) && out.length) {
      out[out.length - 1] += raw.slice(1)
    } else if (raw.trim() !== '' || out.length) {
      out.push(raw)
    }
  }
  return out
}

/** ICS 文本转义还原：\n → 换行，\, → ,  \; → ;  \\ → \ */
function unescapeIcs(s: string): string {
  return s
    .replace(/\\n|\\N/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .replace(/_{2,}/g, ' ')
    .trim()
}

/** 取某字段的值（带可选参数，如 DTSTART;TZID=Asia/Shanghai:xxx） */
function field(lines: string[], name: string): string | undefined {
  const re = new RegExp(`^${name}([^:]*):(.*)$`, 'i')
  for (const l of lines) {
    const m = l.match(re)
    if (m) return m[2].trim()
  }
  return undefined
}

/** 解析 YYYYMMDD[THHMMSS[Z]] → 本地 Date */
function parseIcsDate(v: string | undefined): Date | null {
  if (!v) return null
  const m = v
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/i)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  // 带 Z 的是 UTC，转成本地；不带 Z 的按本地时间处理（DTSTART 通常带 TZID=Asia/Shanghai）
  if (z) {
    return new Date(
      Date.UTC(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h ?? 0),
        Number(mi ?? 0),
        Number(s ?? 0)
      )
    )
  }
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h ?? 0),
    Number(mi ?? 0),
    Number(s ?? 0)
  )
}

/** 「第1 - 2节」/「第12节」→ [1,2] / [12] */
function parsePeriods(text: string): number[] {
  const m = text.match(/第?\s*(\d{1,2})\s*[-~—~至]\s*(\d{1,2})\s*节/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const out: number[] = []
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
    return out
  }
  const single = text.match(/第?\s*(\d{1,2})\s*节/)
  return single ? [Number(single[1])] : []
}

/** 课程号，如 EE150.01 / SI140A.01 / PHYS1183.05 */
const ICS_CODE_RE = /\(([A-Za-z]{1,6}\d[\w.]*)\)\s*$/

/** 把周次数字压缩成「1-16」这样的区间文案 */
function formatWeekRanges(nums: number[]): string {
  const arr = [...new Set(nums)].sort((a, b) => a - b)
  if (!arr.length) return ''
  const parts: string[] = []
  let s = arr[0]
  let p = arr[0]
  for (let i = 1; i <= arr.length; i++) {
    const n = arr[i]
    if (n !== undefined && n === p + 1) {
      p = n
      continue
    }
    parts.push(s === p ? String(s) : `${s}-${p}`)
    s = p = n as number
  }
  return parts.join(',')
}

interface RawEvent {
  summary: string
  code?: string
  start: Date
  end: Date | null
  location: string
  teacher: string
  periods: number[]
  /** 该事件实际发生的（相对学期起始周的）周序号，1-based */
  weeks: number[]
  description: string
}

export function readIcsTable(data: ArrayBuffer): IcsParseResult {
  const bytes = new Uint8Array(data)
  // ICS 基本都是 UTF-8；带 BOM 时去掉
  let text = new TextDecoder('utf-8').decode(bytes)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const lines = unfold(text)
  const warnings: string[] = []
  const events: RawEvent[] = []

  // 切 VEVENT
  const blocks: string[][] = []
  let cur: string[] | null = null
  for (const l of lines) {
    const t = l.trim()
    if (/^BEGIN:VEVENT$/i.test(t)) {
      cur = []
      continue
    }
    if (/^END:VEVENT$/i.test(t)) {
      if (cur) blocks.push(cur)
      cur = null
      continue
    }
    if (cur) cur.push(l)
  }

  if (!blocks.length) {
    return {
      courses: [],
      semesterStart: '',
      remarks: [],
      warnings: ['该日历文件里没有课程事件（VEVENT）。'],
    }
  }

  // 先算出所有事件的实际日期，用于推学期起始周
  const starts: Date[] = []
  for (const b of blocks) {
    const s = parseIcsDate(field(b, 'DTSTART'))
    if (s) starts.push(s)
  }
  if (!starts.length) {
    return {
      courses: [],
      semesterStart: '',
      remarks: [],
      warnings: ['日历事件里没有可识别的开始时间（DTSTART）。'],
    }
  }
  const earliest = new Date(Math.min(...starts.map((d) => d.getTime())))
  const semesterStart = mondayKeyOf(dateKeyOf(earliest))

  for (const b of blocks) {
    const summary = unescapeIcs(field(b, 'SUMMARY') ?? '')
    const start = parseIcsDate(field(b, 'DTSTART'))
    const end = parseIcsDate(field(b, 'DTEND'))
    if (!summary || !start) continue

    const desc = unescapeIcs(field(b, 'DESCRIPTION') ?? '')
    const descLines = desc
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const periods = descLines.length ? parsePeriods(descLines[0]) : parsePeriods(desc)

    // LOCATION 在 WakeUpSchedule 里是「地点 教师」；DESCRIPTION 更干净（分三行）
    const location = (descLines[1] ?? unescapeIcs(field(b, 'LOCATION') ?? '')).trim()
    const teacher = (descLines[2] ?? '').trim()

    // 名称 / 课程号：尾巴括号里是课程号
    let name = summary
    let code: string | undefined
    const cm = summary.match(ICS_CODE_RE)
    if (cm) {
      code = cm[1]
      name = summary.slice(0, cm.index).trim()
    }

    // 周次：DTSTART 起每周 INTERVAL 一次，直到 UNTIL。
    // ⚠️ 必须按**实际发生时刻**与 UNTIL 比较，不能只按「周跨度」推算 ——
    // WakeUpSchedule 这类导出器会把 UNTIL 写成「最后一次上课当天的 00:00」，
    // 只比周会多算出一次（例：UNTIL=10-26 00:00 时，10-26 19:50 那次已超出）。
    const rrule = field(b, 'RRULE') ?? ''
    const until = parseIcsDate(rrule.match(/UNTIL=([^;]+)/i)?.[1])
    const interval = Math.max(1, Number(rrule.match(/INTERVAL=(\d+)/i)?.[1] ?? '1'))
    const exdates = (field(b, 'EXDATE') ?? '')
      .split(',')
      .map((s) => parseIcsDate(s))
      .filter((d): d is Date => !!d)

    const baseWeek = weeksBetween(semesterStart, mondayKeyOf(dateKeyOf(start))) + 1
    const weeks: number[] = []
    for (let k = 0; ; k += interval) {
      const occur = new Date(start.getTime() + k * 7 * 86400000)
      if (until && occur.getTime() > until.getTime()) break
      if (!until && k > 52) break // 无 UNTIL 的兜底，最多排一年
      const occurDate = dateKeyOf(occur)
      if (exdates.some((e) => dateKeyOf(e) === occurDate)) continue
      weeks.push(baseWeek + k)
      if (weeks.length > 60) break
    }

    events.push({
      summary: name,
      code,
      start,
      end,
      location,
      teacher,
      periods,
      weeks,
      description: desc,
    })
  }

  if (!events.length) {
    return {
      courses: [],
      semesterStart,
      remarks: [],
      warnings: ['未能从日历事件里解析出任何课程。'],
    }
  }

  // 同一课程被拆成多个事件（不同周次/不同教室）时合并，避免界面出现一排重复卡片
  const merged = new Map<string, Course>()
  for (const ev of events) {
    const weekday = ((ev.start.getDay() + 6) % 7) + 1
    const key = [
      ev.summary,
      weekday,
      ev.periods.join('-'),
      ev.location,
      ev.teacher,
    ].join('|')
    const prev = merged.get(key)
    if (prev) {
      prev.weekNumbers = [
        ...new Set([...prev.weekNumbers, ...ev.weeks]),
      ].sort((a, b) => a - b)
      continue
    }
    merged.set(key, {
      id: uid('c-'),
      name: ev.summary,
      code: ev.code,
      weekday,
      periods: ev.periods.length ? ev.periods : [],
      periodLabel: periodLabelOf(ev.periods),
      weeks: formatWeekRanges(ev.weeks),
      weekNumbers: [...ev.weeks],
      location: ev.location || undefined,
      teacher: ev.teacher || undefined,
      raw: ev.description || undefined,
    })
  }

  const courses = [...merged.values()]
  // 合并后重算周次文案
  for (const c of courses) c.weeks = formatWeekRanges(c.weekNumbers) || undefined

  courses.sort(
    (a, b) =>
      a.weekday - b.weekday ||
      (a.periods[0] ?? 99) - (b.periods[0] ?? 99) ||
      a.name.localeCompare(b.name, 'zh')
  )

  const warningsOut = [...warnings]
  if (!events.some((e) => e.teacher)) {
    warningsOut.push('日历事件里没有任课教师信息。')
  }
  if (!events.some((e) => e.periods.length)) {
    warningsOut.push('未能识别出节次（第N - M节），课程只按日期与时间显示。')
  }

  return {
    courses,
    semesterStart,
    remarks: [],
    warnings: warningsOut,
  }
}
