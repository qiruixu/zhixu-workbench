/**
 * AI 上下文：把「课表 / 日程备忘 / 位置天气」整理成一段可注入对话的文本。
 *
 * 目的：让 AI 能基于用户的真实安排制定计划，而不是空谈。
 * 原则：
 *  - 只提供数据，不替用户做判断；
 *  - 数据量有上限（近若干天），避免把上下文撑爆；
 *  - 明确告知模型「没有的信息就说不确定」，避免它编造位置/课表。
 */
import { db } from '../db'
import { toDateKey } from '../memoRepo'
import {
  coursesOnDate,
  loadTimetable,
  loadWeekAnchor,
  resolveWeek,
  weekdayOf,
  weekdayOfDateKey,
  WEEK_LABELS_CN,
} from '../timetable/repo'
import { fetchWeather, loadLocation, placeLabel, weatherText } from '../weather'
import type { Course, MemoNote, TimetableMeta, WeekAnchor } from '../types'

export interface AIContextOptions {
  includeTimetable: boolean
  includeMemos: boolean
  includeWeather: boolean
  /** 课程展望天数 */
  courseDays?: number
  /** 待办展望天数 */
  memoDays?: number
}

export interface AIContextResult {
  /** 注入用的文本；无任何内容时为 null */
  text: string | null
  /** 实际包含的板块，用于在界面上提示用户 */
  sections: string[]
}

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 取今天的周次：优先用户设定的周次锚点（会随自然周自动推进），其次按开学日推算 */
async function currentWeek(meta: TimetableMeta | undefined): Promise<number | null> {
  const anchor = await loadWeekAnchor()
  return resolveWeek(anchor, meta?.semesterStart, toDateKey(new Date()))
}

/** 渲染未来若干天的课程（每天的周次单独计算，跨周时不会错） */
function renderCourses(
  meta: TimetableMeta,
  anchor: WeekAnchor | null,
  days: number
): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    const key = toDateKey(d)
    const wd = weekdayOfDateKey(key)
    const week = resolveWeek(anchor, meta.semesterStart, key)
    const list = coursesOnDate(meta, key, week).filter((c) => c.active || c.unknown)
    const tag = i === 0 ? '今天' : i === 1 ? '明天' : '后天'
    const head = `${key}（${tag} 周${WEEK_LABELS_CN[wd - 1]}）`
    if (list.length === 0) {
      out.push(`- ${head}：无课`)
      continue
    }
    const items = list.map(({ course }) => {
      const seg = [
        course.periodLabel || course.section || '',
        course.name,
        course.location ? `@${course.location}` : '',
        course.teacher ? `(${course.teacher})` : '',
        course.weeks ? `第${course.weeks}周` : '',
      ].filter(Boolean)
      return seg.join(' ')
    })
    out.push(`- ${head}：${items.join('；')}`)
  }
  return out
}

/**
 * 课表全览：按星期几分组，列出每门课的节次/名称/周次/地点/教师。
 * 与「未来几天明细」互补——明细覆盖近期，全览覆盖整个学期的结构，
 * 让 AI 既能答「下周一第一节是什么」，也能答「某门课第几周到第几周上」。
 */
function renderOverview(meta: TimetableMeta): string[] {
  const byDay = new Map<number, Course[]>()
  for (const c of meta.courses) {
    const arr = byDay.get(c.weekday) ?? []
    arr.push(c)
    byDay.set(c.weekday, arr)
  }
  const out: string[] = []
  for (let wd = 1; wd <= 7; wd++) {
    const list = (byDay.get(wd) ?? []).sort(
      (a, b) => (a.periods[0] ?? 99) - (b.periods[0] ?? 99) || a.name.localeCompare(b.name, 'zh')
    )
    if (list.length === 0) continue
    const items = list.map((c) => {
      const seg = [
        c.periodLabel || c.section || '',
        c.name,
        c.weeks ? `第${c.weeks}周` : '',
        c.location ? `@${c.location}` : '',
        c.teacher ? `(${c.teacher})` : '',
      ].filter(Boolean)
      return seg.join(' ')
    })
    out.push(`- 周${WEEK_LABELS_CN[wd - 1]}：${items.join('；')}`)
  }
  return out
}

function renderMemos(memos: MemoNote[]): string[] {
  if (memos.length === 0) return ['- （未来两周内没有记录待办）']
  const byDate = new Map<string, MemoNote[]>()
  for (const m of memos) {
    const arr = byDate.get(m.date) ?? []
    arr.push(m)
    byDate.set(m.date, arr)
  }
  const todayKey = toDateKey(new Date())
  return [...byDate.keys()].sort().map((date) => {
    const items = (byDate.get(date) ?? []).map(
      (m) => `${m.text}${m.done ? '（已完成）' : '（未完成）'}`
    )
    return `- ${date}${date === todayKey ? '（今天）' : ''}：${items.join('；')}`
  })
}

export async function buildAIContext(opts: AIContextOptions): Promise<AIContextResult> {
  const sections: string[] = []
  const blocks: string[] = []
  const now = new Date()

  const meta = opts.includeTimetable ? await loadTimetable() : undefined
  const anchor = opts.includeTimetable ? await loadWeekAnchor() : null

  // 时间基准（有课表时附带周次）
  const week = meta ? await currentWeek(meta) : null
  const timeLine =
    `【当前时间】${fmtDate(now)} ${WEEK_LABELS_CN[weekdayOf(now) - 1]}曜日 ${fmtTime(now)}` +
    (week ? `，本学期第 ${week} 周` : '')
  blocks.push(timeLine)

  // 课表
  if (opts.includeTimetable && meta && meta.courses.length > 0) {
    const days = opts.courseDays ?? 7
    const lines: string[] = []
    lines.push(
      `【我的课表】${meta.semester ? `${meta.semester}，` : ''}共 ${meta.courses.length} 门课程`
    )
    lines.push(`（未来 ${days} 天明细）`)
    lines.push(...renderCourses(meta, anchor, days))
    lines.push('（完整课表：按星期列出所有课程及其周次范围，可用于回答任意周次/日期的问题）')
    lines.push(...renderOverview(meta))
    if (meta.remarks.length) lines.push(`- 其它安排：${meta.remarks.join('；')}`)
    blocks.push(lines.join('\n'))
    sections.push('课表')
  }

  // 日程备忘
  if (opts.includeMemos) {
    const todayKey = toDateKey(now)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (opts.memoDays ?? 14))
    const memos = await db.memos
      .where('date')
      .between(todayKey, toDateKey(end), true, true)
      .toArray()
    if (memos.length > 0) {
      blocks.push(
        [
          '【我的日程备忘】按日期列出（用户自己记录的待办）',
          ...renderMemos(memos.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)),
        ].join('\n')
      )
      sections.push('日程备忘')
    }
  }

  // 位置与天气
  if (opts.includeWeather) {
    const loc = await loadLocation()
    if (loc) {
      try {
        const w = await fetchWeather(loc.lat, loc.lon)
        const cur = w.current
        const d0 = {
          max: w.daily.max[0],
          min: w.daily.min[0],
          code: w.daily.code[0],
        }
        const bits = [
          `${placeLabel(loc)}`,
          `当前 ${cur.temp !== undefined ? Math.round(cur.temp) : '--'}°C ${weatherText(cur.code)}`,
          cur.feelsLike !== undefined ? `体感 ${Math.round(cur.feelsLike)}°C` : '',
          cur.humidity !== undefined ? `湿度 ${cur.humidity}%` : '',
          cur.windSpeed !== undefined ? `风速 ${cur.windSpeed}km/h` : '',
          d0.max !== undefined && d0.min !== undefined
            ? `今日 ${Math.round(d0.min)}~${Math.round(d0.max)}°C ${weatherText(d0.code)}`
            : '',
        ].filter(Boolean)
        blocks.push(`【我的位置与天气】${bits.join('，')}`)
        sections.push('位置天气')
      } catch {
        blocks.push(
          `【我的位置】${placeLabel(loc)}（天气数据暂时获取失败，请勿编造具体气温）`
        )
        sections.push('位置')
      }
    }
  }

  // 只有时间行时视为没有有效上下文
  if (sections.length === 0) return { text: null, sections }

  return {
    text:
      blocks.join('\n\n') +
      '\n\n（以上是用户在「智序工作台」中保存的真实数据。若其中缺少你需要的某项信息，请直接说明你不知道，不要凭空推测或编造。）',
    sections,
  }
}
