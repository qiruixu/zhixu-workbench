/** 课表数据仓库 + 日期 / 周次计算 */
import { db } from '../db'
import type { Course, TimetableMeta, WeekAnchor } from '../types'
import { parseTimetable } from './parser'

export const WEEK_LABELS_CN = ['一', '二', '三', '四', '五', '六', '日']

/** 周次锚点存放的 settings key */
export const WEEK_ANCHOR_KEY = 'timetableWeekAnchor'

/* ------------------------------ 存取 ------------------------------ */

export async function loadTimetable(): Promise<TimetableMeta | undefined> {
  return db.timetable.get('current')
}

export async function saveTimetable(meta: TimetableMeta): Promise<void> {
  await db.timetable.put({ ...meta, id: 'current' })
}

export async function clearTimetable(): Promise<void> {
  await db.timetable.delete('current')
  await db.settings.delete('timetableWeek')
  await db.settings.delete(WEEK_ANCHOR_KEY)
}

/**
 * 从用户拖入 / 选择的文件导入课表。
 * 会保留用户此前设定的「开学第一周周一」与「周次锚点」——更新课表不应该丢掉学期进度。
 *
 * 例外：**日历（.ics）格式自带绝对日期**，课表里的周次是按日期推算的，
 * 必须沿用它推算出的学期起始，否则周次对不上。此时会：
 *   · 用 ICS 推算的 semesterStart 覆盖；
 *   · 把已有的周次锚点**重新对齐**到这个起始周（保留锚点日期，只换算周次编号），
 *     保证「当前第几周」与课程周次同一套编号。
 */
export async function importTimetableFile(file: File): Promise<TimetableMeta> {
  const buf = await file.arrayBuffer()
  const parsed = await parseTimetable(file.name, buf)
  if (parsed.courses.length === 0) {
    throw new Error(parsed.warnings[0] ?? '未能从该文件中解析出课程')
  }
  const prev = await loadTimetable()
  const warnings = [...parsed.warnings]

  let semesterStart = prev?.semesterStart
  if (parsed.sourceFormat === 'ics' && parsed.semesterStart) {
    semesterStart = parsed.semesterStart
    // 锚点改成与新学期起始同一套编号
    const anchor = await loadWeekAnchor()
    if (anchor) {
      const rebased = weeksBetween(semesterStart, anchor.onDate) + 1
      if (rebased !== anchor.week) {
        warnings.push(
          `日历课表按日期自动推算周次（学期起始 ${semesterStart}），原周次锚点「${anchor.onDate} 是第 ${anchor.week} 周」已换算为「第 ${rebased} 周」以保持一致。`
        )
        await saveWeekAnchor(rebased, anchor.onDate)
      }
    } else {
      warnings.push(
        `日历课表按日期自动推算周次，学期起始周（周一）取 ${semesterStart}。如与你的学校不一致，可在课表设置里调整周次锚点。`
      )
    }
  }

  const next: TimetableMeta = {
    ...parsed,
    semesterStart,
    warnings,
  }
  await saveTimetable(next)
  return next
}

export function isTimetableFile(file: File): boolean {
  return /\.(xls|xlsx|xlt|xltm|xlsx?\.xml|csv|tsv|txt|html?|rtf|doc|docx|pdf|ics)$/i.test(file.name)
}

/* ---------------------------- 日期工具 ----------------------------
 * 实现见 ./dates.ts（纯函数独立成模块，供 ics.ts 等读取器复用而不产生循环依赖）
 * ---------------------------------------------------------------- */
export {
  dateKeyOf,
  todayKey,
  parseDateKey,
  weekdayOfDateKey,
  weekdayOf,
  shiftDay,
  mondayKeyOf,
  weeksBetween,
  formatMonthDay,
} from './dates'

import {
  dateKeyOf,
  mondayKeyOf,
  parseDateKey,
  weeksBetween,
  weekdayOfDateKey,
} from './dates'

/* ---------------------------- 周次计算 ---------------------------- */

/**
 * 依据「周次锚点」推算给定日期是第几周。
 * 锚点记录的是「某天是第 N 周」，之后每过一个自然周自动 +1，
 * 所以用户设置一次即可，学期往后走周次会自己更新。
 */
export function weekFromAnchor(anchor: WeekAnchor | null, dateKey: string): number | null {
  if (!anchor || !anchor.week) return null
  const delta = weeksBetween(anchor.onDate, dateKey)
  const week = anchor.week + delta
  return week >= 1 && week <= 60 ? week : null
}

/** 依据「开学第一周周一」推算给定日期属于第几周；无效返回 null */
export function weekFromSemesterStart(startKey: string, dateKey: string): number | null {
  if (!startKey) return null
  const week = weeksBetween(startKey, dateKey) + 1
  return week >= 1 && week <= 60 ? week : null
}

/**
 * 综合得出某个日期对应的周次。
 * 优先级：用户锚点 > 开学日推算 > 未知（null，此时不做周次过滤）
 */
export function resolveWeek(
  anchor: WeekAnchor | null,
  semesterStart: string | undefined,
  dateKey: string
): number | null {
  const byAnchor = weekFromAnchor(anchor, dateKey)
  if (byAnchor != null) return byAnchor
  if (semesterStart) return weekFromSemesterStart(semesterStart, dateKey)
  return null
}

export async function loadWeekAnchor(): Promise<WeekAnchor | null> {
  const row = await db.settings.get(WEEK_ANCHOR_KEY)
  const v = row?.value as WeekAnchor | undefined
  if (!v || typeof v.week !== 'number' || typeof v.onDate !== 'string') return null
  return v
}

export async function saveWeekAnchor(week: number, onDate: string): Promise<WeekAnchor> {
  const anchor: WeekAnchor = { week: Math.min(60, Math.max(1, week)), onDate }
  await db.settings.put({ key: WEEK_ANCHOR_KEY, value: anchor })
  return anchor
}

/** 该课程是否在第 week 周上课（周次信息缺失时视为「未知」） */
export function courseInWeek(course: Course, week: number): boolean | 'unknown' {
  if (!course.weekNumbers.length) return 'unknown'
  return course.weekNumbers.includes(week)
}

export interface DayCourse {
  course: Course
  /** 该天是否（在当周）上课 */
  active: boolean
  /** 周次信息缺失，无法判断 */
  unknown: boolean
}

/**
 * 取某天（周几）的课程，并标注当周是否上课。
 * week 传 null 表示「尚未确定周次」——此时不做周次过滤，全部视为当天课程，
 * 避免用户还没设置开学日时看到一片「本周不上」而误以为数据有问题。
 */
export function coursesOfWeekday(
  meta: TimetableMeta | undefined,
  weekday: number,
  week: number | null
): DayCourse[] {
  if (!meta) return []
  return meta.courses
    .filter((c) => c.weekday === weekday)
    .map((course) => {
      if (week == null) return { course, active: true, unknown: false }
      const inWeek = courseInWeek(course, week)
      return {
        course,
        active: inWeek === true,
        unknown: inWeek === 'unknown',
      }
    })
    .sort(
      (a, b) =>
        (a.course.periods[0] ?? 99) - (b.course.periods[0] ?? 99) ||
        a.course.name.localeCompare(b.course.name, 'zh')
    )
}

/** 取某个日期（YYYY-MM-DD）的课程 */
export function coursesOnDate(
  meta: TimetableMeta | undefined,
  dateKey: string,
  week: number | null
): DayCourse[] {
  return coursesOfWeekday(meta, weekdayOfDateKey(dateKey), week)
}
