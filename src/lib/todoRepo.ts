/**
 * 待办数据仓库
 *
 * 「待办」与「日程」的区别（产品定义）：
 *  - 日程（memos）：绑定在某一天，只有那天重要（如「10/20 下午开会」）；
 *  - 待办（todos）：有截止日期，**在截止之前一直需要留意**（如「10/25 前交作业」），
 *    因此单独列表面板、按截止日期排序、逾期高亮。
 */
import { db } from './db'
import type { Todo } from './types'
import { uid } from './utils'
import { todayKey } from './memoRepo'

/** 排序：未完成在前；未完成按截止日期升序（无截止排最后）；已完成按完成时间倒序 */
export function sortTodos(list: Todo[]): Todo[] {
  return list.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (a.done) return (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt)
    const ad = a.due ?? '9999-99-99'
    const bd = b.due ?? '9999-99-99'
    if (ad !== bd) return ad < bd ? -1 : 1
    return a.createdAt - b.createdAt
  })
}

export async function listTodos(): Promise<Todo[]> {
  return sortTodos(await db.todos.toArray())
}

export async function addTodo(text: string, due?: string): Promise<Todo> {
  const now = Date.now()
  const todo: Todo = {
    id: uid('todo-'),
    text: text.trim(),
    due: due || undefined,
    done: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.todos.put(todo)
  return todo
}

export async function updateTodo(id: string, patch: Partial<Todo>): Promise<void> {
  const cur = await db.todos.get(id)
  if (!cur) return
  const next: Todo = { ...cur, ...patch, updatedAt: Date.now() }
  if (patch.text !== undefined) next.text = patch.text.trim()
  if (patch.due !== undefined) next.due = patch.due || undefined
  await db.todos.put(next)
}

export async function toggleTodo(id: string): Promise<void> {
  const cur = await db.todos.get(id)
  if (!cur) return
  const done = !cur.done
  await db.todos.put({
    ...cur,
    done,
    doneAt: done ? Date.now() : undefined,
    updatedAt: Date.now(),
  })
}

export async function deleteTodo(id: string): Promise<void> {
  await db.todos.delete(id)
}

/** 距截止还有几天（负数 = 已逾期）；无截止日期返回 null */
export function daysUntilDue(due: string | undefined, today = todayKey()): number | null {
  if (!due) return null
  const a = new Date(`${due}T00:00:00`)
  const b = new Date(`${today}T00:00:00`)
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

/** 截止文案：已逾期 N 天 / 今天截止 / 明天截止 / 还有 N 天 / 原样日期 */
export function dueText(due: string | undefined, today = todayKey()): string | null {
  const d = daysUntilDue(due, today)
  if (d == null) return null
  if (d < 0) return `已逾期 ${-d} 天`
  if (d === 0) return '今天截止'
  if (d === 1) return '明天截止'
  if (d <= 7) return `还有 ${d} 天`
  return due as string
}
