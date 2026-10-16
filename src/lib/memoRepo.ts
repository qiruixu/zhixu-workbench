/** 日程备忘数据仓库 */
import { db } from './db'
import type { MemoNote } from './types'
import { uid } from './utils'

/** YYYY-MM-DD（本地时区，不用 toISOString 以免时区偏移） */
export function toDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function todayKey(): string {
  return toDateKey(new Date())
}

export async function listMemosByDate(date: string): Promise<MemoNote[]> {
  const list = await db.memos.where('date').equals(date).toArray()
  return list.sort((a, b) => a.createdAt - b.createdAt)
}

export async function listMemosByMonth(year: number, month0: number): Promise<MemoNote[]> {
  const from = `${year}-${String(month0 + 1).padStart(2, '0')}-01`
  const end = new Date(year, month0 + 1, 0)
  const to = toDateKey(end)
  const list = await db.memos.where('date').between(from, to, true, true).toArray()
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
}

export async function addMemo(date: string, text: string, color?: string): Promise<MemoNote> {
  const now = Date.now()
  const note: MemoNote = {
    id: uid('memo-'),
    date,
    text: text.trim(),
    done: false,
    color,
    createdAt: now,
    updatedAt: now,
  }
  await db.memos.put(note)
  return note
}

export async function updateMemo(id: string, patch: Partial<MemoNote>): Promise<void> {
  const cur = await db.memos.get(id)
  if (!cur) return
  const next: MemoNote = { ...cur, ...patch, updatedAt: Date.now() }
  if (patch.text !== undefined) next.text = patch.text.trim()
  await db.memos.put(next)
}

export async function toggleMemo(id: string): Promise<void> {
  const cur = await db.memos.get(id)
  if (cur) await db.memos.put({ ...cur, done: !cur.done, updatedAt: Date.now() })
}

export async function deleteMemo(id: string): Promise<void> {
  await db.memos.delete(id)
}

/** 某个月里「有备忘的日期 → 条数」，用于日历打点 */
export function countByDate(notes: MemoNote[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const n of notes) map[n.date] = (map[n.date] ?? 0) + 1
  return map
}
