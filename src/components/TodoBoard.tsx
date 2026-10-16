import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ListTodo, Plus, Trash2 } from 'lucide-react'
import { db } from '../lib/db'
import type { Todo } from '../lib/types'
import {
  addTodo,
  daysUntilDue,
  deleteTodo,
  dueText,
  sortTodos,
  toggleTodo,
} from '../lib/todoRepo'
import { cn } from '../lib/utils'
import { useApp } from '../store/ctx'

/** 截止日期显示成 10/25 这种简短形式 */
function fmtDue(due?: string): string {
  if (!due) return ''
  return `${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}`
}

export function TodoBoard() {
  const { toast } = useApp()
  const [text, setText] = useState('')
  const [due, setDue] = useState('')

  const all = useLiveQuery(() => db.todos.toArray(), [], [] as Todo[])
  const list = sortTodos(all)
  const pending = list.filter((t) => !t.done)
  const done = list.filter((t) => t.done)

  const submit = async () => {
    const t = text.trim()
    if (!t) return
    await addTodo(t, due || undefined)
    setText('')
    setDue('')
    toast(due ? `已添加待办（截止 ${fmtDue(due)}）` : '已添加待办', 'success')
  }

  return (
    <div
      data-guide="todos"
      className="flex h-full min-h-0 flex-col rounded-2xl border border-border bg-surface p-4"
    >
      {/* 头部 */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListTodo size={16} className="shrink-0 text-primary" />
          <span className="text-[14px] font-semibold text-text">待办</span>
          <span className="truncate text-[11.5px] text-faint">
            {pending.length ? `${pending.length} 项待完成` : '全部完成'}
          </span>
        </div>
      </div>

      {/* 添加行 */}
      <div className="mb-3 flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          placeholder="待办内容…"
          className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 text-[12.5px] text-text outline-none transition-colors placeholder:text-faint focus:border-primary"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          title="截止日期（可选）"
          className="h-9 w-[128px] shrink-0 rounded-xl border border-border bg-surface-2 px-2 text-[12px] text-muted outline-none transition-colors focus:border-primary"
        />
        <button
          onClick={() => void submit()}
          disabled={!text.trim()}
          title="添加待办"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {pending.length === 0 ? (
          <div className="flex h-full min-h-[104px] flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-6 text-center">
            <ListTodo size={22} className="text-faint" />
            <p className="mt-2 text-[13px] text-muted">
              {done.length ? '待办都完成了' : '还没有待办'}
            </p>
            <p className="mt-1 max-w-[260px] text-[11.5px] leading-relaxed text-faint">
              和「日程」不同：待办会一直留在这里，直到你完成或过了截止日
            </p>
          </div>
        ) : (
          pending.map((t) => <TodoRow key={t.id} todo={t} />)
        )}

        {done.length ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-[12px] text-faint hover:text-muted">
              已完成（{done.length}）
            </summary>
            <div className="mt-1.5 space-y-1.5 opacity-55">
              {done.slice(0, 20).map((t) => (
                <TodoRow key={t.id} todo={t} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  )
}

function TodoRow({ todo }: { todo: Todo }) {
  const { confirm } = useApp()
  const days = daysUntilDue(todo.due)
  const overdue = !todo.done && days != null && days < 0
  const urgent = !todo.done && days != null && days >= 0 && days <= 1
  const label = dueText(todo.due)

  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors',
        overdue ? 'border-danger/40 bg-danger-soft' : 'border-border bg-surface-2'
      )}
    >
      <button
        onClick={() => void toggleTodo(todo.id)}
        title={todo.done ? '标记为未完成' : '标记为已完成'}
        className={cn(
          'mt-0.5 flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border transition-colors',
          todo.done
            ? 'border-primary bg-primary text-primary-fg'
            : 'border-border-strong hover:border-primary'
        )}
      >
        {todo.done ? <Check size={11} /> : null}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'text-[13px] leading-relaxed text-text',
            todo.done && 'line-through opacity-60'
          )}
        >
          {todo.text}
        </div>
        {todo.due && label ? (
          <div
            className={cn(
              'mt-0.5 text-[11px]',
              overdue ? 'font-medium text-danger' : urgent ? 'text-warning' : 'text-faint'
            )}
          >
            截止 {fmtDue(todo.due)}
            {label !== todo.due ? `　${label}` : ''}
          </div>
        ) : (
          <div className="mt-0.5 text-[11px] text-faint">未设截止日期</div>
        )}
      </div>

      <button
        onClick={async () => {
          const ok = await confirm({
            title: '删除这条待办？',
            description: todo.text,
            confirmText: '删除',
            danger: true,
          })
          if (ok) await deleteTodo(todo.id)
        }}
        title="删除"
        className="shrink-0 rounded-md p-1 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}
