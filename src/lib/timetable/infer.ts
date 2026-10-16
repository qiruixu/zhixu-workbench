/**
 * 课表「当前是第几周」的自动定位。
 *
 * 背景：表格类课表（xls / xlsx / csv / rtf / doc / docx / pdf）里通常只有「第几周」
 * 这样的相对信息，没有绝对日期，因此无法直接算出「今天到底属于第几周」。
 * 本模块综合三类线索推断，并把「推断依据 + 置信度」一并返回，界面上明确告知用户
 * 这只是推测值、可以随时校准——不假装精确。
 *
 *   1) 文件里已经带了学期起始（.ics 日历课表会按事件日期直接推出来）——最高优先，不走这里；
 *   2) 文件里写了学年学期（如「2026-2027学年 第1学期」）——按学期惯例推算开学周；
 *   3) 什么线索都没有时，用「当前日期 + 课表覆盖到的周数」做启发式推算：
 *      国内高校第 1 周的周一通常落在 8 月下旬～9 月上旬（秋季）或 2 月下旬～3 月上旬（春季），
 *      取「能让今天落在第 1 周～学期结束周之间」且离今天最近的那个学期。
 */
import type { Course } from '../types'
import { mondayKeyOf, todayKey, weekFromSemesterStart } from './dates'

export type WeekAutoSource = 'calendar' | 'semester' | 'auto'

export interface WeekInference {
  /** 推断出的「开学第一周周一」 */
  semesterStart: string
  /** 今天属于第几周 */
  week: number
  source: WeekAutoSource
  confidence: 'high' | 'medium' | 'low'
  /** 给用户看的一句话依据说明 */
  note: string
}

/** 一学期最长按多少周算（课表只写到第 8 周时也能判断「现在还在学期内」） */
const SEMESTER_MAX_WEEKS = 20

/** 课表里出现过的最大周次，用于校验推断是否落在学期内 */
export function maxWeekOf(courses: Course[]): number {
  let m = 0
  for (const c of courses) {
    for (const w of c.weekNumbers) if (w > m) m = w
  }
  return m
}

/**
 * 从「学年学期」文本解析出开学周的周一。
 * 支持：`2026-2027学年 第1学期`、`2026-2027学年第一学期`、`学年学期: 2026-2027-1`
 */
export function semesterStartFromText(
  text: string | undefined
): { start: string; label: string } | null {
  if (!text) return null
  const t = text.replace(/\s/g, '')
  const m =
    t.match(/(\d{4})[-~至](\d{4})学年第?([一二12])学期/) ??
    t.match(/(\d{4})[-~](\d{4})[-_]?([12])(?:[^\d]|$)/)
  if (!m) return null
  const y1 = Number(m[1])
  const term: 1 | 2 = m[3] === '一' || m[3] === '1' ? 1 : 2
  const start =
    term === 1 ? mondayKeyOf(`${y1}-09-01`) : mondayKeyOf(`${y1 + 1}-03-01`)
  return { start, label: `${y1}-${y1 + 1}学年 第${term}学期` }
}

/** 候选开学周：按「离今天由近及远」排列的若干学期起始（周一） */
function seasonCandidates(dayKey: string): string[] {
  const y = Number(dayKey.slice(0, 4))
  return [
    mondayKeyOf(`${y}-09-01`), // 本学年秋季
    mondayKeyOf(`${y + 1}-03-01`), // 下一年春季
    mondayKeyOf(`${y}-03-01`), // 本年春季
    mondayKeyOf(`${y - 1}-09-01`), // 上一年秋季
  ]
    .sort()
    .reverse()
}

/**
 * 推断「今天」属于第几周。
 * @param courses   课表里的课程（用于取最大周次）
 * @param semesterText 课表里解析出的「学年学期」文本（可选）
 * @param dayKey    目标日期，默认今天
 * @returns 推断结果；线索不足、或今天明显不在任何学期区间内时返回 null
 */
export function inferWeek(
  courses: Course[],
  semesterText: string | undefined,
  dayKey: string = todayKey()
): WeekInference | null {
  const upper = Math.max(maxWeekOf(courses), SEMESTER_MAX_WEEKS)
  const inRange = (start: string): number | null => {
    const w = weekFromSemesterStart(start, dayKey)
    return w != null && w >= 1 && w <= upper ? w : null
  }

  // ① 课表里写了学年学期 → 按学期惯例推算
  const fromText = semesterStartFromText(semesterText)
  if (fromText) {
    const w = inRange(fromText.start)
    if (w != null) {
      return {
        semesterStart: fromText.start,
        week: w,
        source: 'semester',
        confidence: 'high',
        note: `按课表里的「${fromText.label}」推算`,
      }
    }
    // 文件已经明确说了是哪个学期，而今天不在该学期内（提前导入下学期课表 / 学期已结束）：
    // 这时宁可不猜，也不能拿「当前季节」的学期去顶替，否则周次会对不上。
    return null
  }

  // ② 没有学期线索 → 用常见开学周做启发式推算，取最近的、能让今天落在学期内的那个
  for (const start of seasonCandidates(dayKey)) {
    const w = inRange(start)
    if (w != null) {
      return {
        semesterStart: start,
        week: w,
        source: 'auto',
        confidence: 'low',
        note: `按常见开学周推测（第 1 周周一约 ${start}）`,
      }
    }
  }

  return null
}
