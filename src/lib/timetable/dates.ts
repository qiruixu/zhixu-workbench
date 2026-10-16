/**
 * 日期 / 周次工具（纯函数，无任何存储依赖）
 *
 * 单独成模块是为了让 ics.ts 之类的读取器也能用，
 * 而不必反向依赖 repo.ts（那会形成 读取器 → repo → parser → 读取器 的循环引用）。
 */

/** YYYY-MM-DD（本地时区，不用 toISOString 以免时区偏移） */
export function dateKeyOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function todayKey(): string {
  return dateKeyOf(new Date())
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** 该日期是周几，1=周一 … 7=周日 */
export function weekdayOfDateKey(key: string): number {
  return ((parseDateKey(key).getDay() + 6) % 7) + 1
}

export function weekdayOf(date = new Date()): number {
  return ((date.getDay() + 6) % 7) + 1
}

/** 按天偏移，返回新的日期 key */
export function shiftDay(key: string, delta: number): string {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + delta)
  return dateKeyOf(d)
}

/** 该日期所在自然周的周一 */
export function mondayKeyOf(key: string): string {
  const d = parseDateKey(key)
  const wd = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - wd)
  return dateKeyOf(d)
}

/** 两个日期相隔多少个自然周 */
export function weeksBetween(fromKey: string, toKey: string): number {
  const a = parseDateKey(mondayKeyOf(fromKey))
  const b = parseDateKey(mondayKeyOf(toKey))
  return Math.round((b.getTime() - a.getTime()) / (7 * 86400000))
}

/** 展示用日期文案，如「10 月 16 日」 */
export function formatMonthDay(key: string): string {
  const d = parseDateKey(key)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}
