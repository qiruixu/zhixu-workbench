import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Plus,
  Trash2,
} from 'lucide-react'
import { db } from '../lib/db'
import type { MemoNote, TimetableMeta, WeekAnchor } from '../lib/types'
import { addMemo, deleteMemo, toDateKey, todayKey, toggleMemo } from '../lib/memoRepo'
import {
  coursesOnDate,
  loadTimetable,
  resolveWeek,
  WEEK_ANCHOR_KEY,
} from '../lib/timetable/repo'
import { cn } from '../lib/utils'
import { useApp } from '../store/ctx'
import { IconButton, Textarea } from './ui'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function MemoCalendar() {
  const { toast, confirm, focusDate, setFocusDate } = useApp()
  const today = todayKey()
  const now = new Date()

  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth()) // 0-based
  const [draft, setDraft] = useState('')

  const selected = focusDate

  const meta = useLiveQuery(() => loadTimetable(), [], undefined as TimetableMeta | undefined)
  const anchorRow = useLiveQuery(() => db.settings.get(WEEK_ANCHOR_KEY), [], undefined)

  const monthNotes = useLiveQuery(
    () => {
      const from = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`
      const to = toDateKey(new Date(viewYear, viewMonth + 1, 0))
      return db.memos.where('date').between(from, to, true, true).toArray()
    },
    [viewYear, viewMonth],
    [] as MemoNote[]
  )

  const dayNotes = useLiveQuery(
    () => db.memos.where('date').equals(selected).toArray(),
    [selected],
    [] as MemoNote[]
  )

  const countByDate = useMemo(() => {
    const map: Record<string, { total: number; open: number }> = {}
    for (const n of monthNotes) {
      const c = (map[n.date] ??= { total: 0, open: 0 })
      c.total++
      if (!n.done) c.open++
    }
    return map
  }, [monthNotes])

  // 外部（课表按天切换 / 点日历）改变了聚焦日期时，把月视图跟过去
  useEffect(() => {
    const [y, m] = focusDate.split('-').map(Number)
    if (!y || !m) return
    if (y !== viewYear || m - 1 !== viewMonth) {
      setViewYear(y)
      setViewMonth(m - 1)
    }
  }, [focusDate, viewYear, viewMonth])

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    // 周一为一周起点：把周日的 0 转成 7
    const lead = (first.getDay() + 6) % 7
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const out: Array<{ key: string; day: number; inMonth: boolean }> = []
    for (let i = 0; i < lead; i++) {
      const d = new Date(viewYear, viewMonth, i - lead + 1)
      out.push({ key: toDateKey(d), day: d.getDate(), inMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ key: toDateKey(new Date(viewYear, viewMonth, d)), day: d, inMonth: true })
    }
    while (out.length % 7 !== 0) {
      const last = new Date(viewYear, viewMonth, daysInMonth + (out.length % 7))
      out.push({ key: toDateKey(last), day: last.getDate(), inMonth: false })
    }
    return out
  }, [viewYear, viewMonth])

  // 哪些日期有课（右上角小圆点提示；点它会联动课表）
  const courseDays = useMemo(() => {
    const set = new Set<string>()
    if (!meta) return set
    const v = anchorRow?.value as WeekAnchor | undefined
    const anchor = v && typeof v.week === 'number' ? v : null
    for (const c of cells) {
      const wk = resolveWeek(anchor, meta.semesterStart, c.key)
      const list = coursesOnDate(meta, c.key, wk)
      if (list.some((d) => d.active || d.unknown)) set.add(c.key)
    }
    return set
  }, [meta, anchorRow, cells])

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    // 聚焦日期跟着跳到该月（当月则回到今天）
    const isCurrentMonth =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    setFocusDate(isCurrentMonth ? today : toDateKey(d))
  }

  const goToday = () => {
    setViewYear(now.getFullYear())
    setViewMonth(now.getMonth())
    setFocusDate(today)
  }

  const submit = async () => {
    const text = draft.trim()
    if (!text) return
    await addMemo(selected, text)
    setDraft('')
    toast('已添加备忘', 'success')
  }

  const remove = async (n: MemoNote) => {
    const ok = await confirm({
      title: '删除这条备忘？',
      description: n.text.slice(0, 60),
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    await deleteMemo(n.id)
  }

  const selectedLabel = (() => {
    const [y, m, d] = selected.split('-').map(Number)
    const wd = WEEK_LABELS[(new Date(y, m - 1, d).getDay() + 6) % 7]
    const prefix = selected === today ? '今天 · ' : ''
    return `${prefix}${m} 月 ${d} 日 周${wd}`
  })()

  const openCount = dayNotes.filter((n) => !n.done).length

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-surface p-3 sm:p-4">
      {/* 头部 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} className="text-primary" />
          <span className="text-[14px] font-semibold text-text">日程备忘</span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton title="上个月" onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={16} />
          </IconButton>
          <button
            onClick={goToday}
            className="rounded-lg px-2 py-1 text-[12.5px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            {viewYear} 年 {viewMonth + 1} 月
          </button>
          <IconButton title="下个月" onClick={() => shiftMonth(1)}>
            <ChevronRight size={16} />
          </IconButton>
        </div>
      </div>

      {/* 星期表头 */}
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEK_LABELS.map((w) => (
          <div key={w} className="py-1 text-center text-[11.5px] font-medium text-faint">
            {w}
          </div>
        ))}
      </div>

      {/* 日期格 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => {
          const info = countByDate[c.key]
          const isToday = c.key === today
          const isSelected = c.key === selected
          return (
            <button
              key={c.key}
              onClick={() => setFocusDate(c.key)}
              title={courseDays.has(c.key) ? '这天有课（点我，课表会跳过来）' : undefined}
              className={cn(
                'relative flex h-9 flex-col items-center justify-center rounded-lg text-[12.5px] transition-all',
                !c.inMonth && 'text-faint/50',
                c.inMonth && !isSelected && 'text-text hover:bg-surface-2',
                isSelected && 'bg-primary font-semibold text-primary-fg',
                isToday && !isSelected && 'ring-1 ring-primary/60'
              )}
            >
              <span>{c.day}</span>
              <span className="mt-0.5 flex items-center gap-0.5">
                {info
                  ? Array.from({ length: Math.min(info.total, 3) }).map((_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-1 w-1 rounded-full',
                          isSelected ? 'bg-primary-fg' : info.open > 0 ? 'bg-primary' : 'bg-faint'
                        )}
                      />
                    ))
                  : null}
              </span>
              {courseDays.has(c.key) ? (
                <span
                  className={cn(
                    'absolute right-1 top-1 h-1 w-1 rounded-full',
                    isSelected ? 'bg-primary-fg/70' : 'bg-primary/45'
                  )}
                />
              ) : null}
            </button>
          )
        })}
      </div>

      {/* 选中日期 */}
      <div className="mt-4 flex-1 border-t border-border pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-medium text-text">{selectedLabel}</span>
          <span className="text-[11.5px] text-faint">
            {dayNotes.length === 0 ? '暂无安排' : `共 ${dayNotes.length} 条 · 待办 ${openCount}`}
          </span>
        </div>

        <div className="space-y-1.5">
          {dayNotes.map((n) => (
            <div
              key={n.id}
              className="group flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2"
            >
              <button
                onClick={() => void toggleMemo(n.id)}
                title={n.done ? '标记为未完成' : '标记为完成'}
                className="mt-0.5 shrink-0 text-faint transition-colors hover:text-primary"
              >
                {n.done ? (
                  <Check size={14} className="text-success" />
                ) : (
                  <Circle size={14} />
                )}
              </button>
              <span
                className={cn(
                  'min-w-0 flex-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed',
                  n.done ? 'text-faint line-through' : 'text-text'
                )}
              >
                {n.text}
              </span>
              <button
                onClick={() => void remove(n)}
                title="删除"
                className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={12.5} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2.5 flex items-end gap-2">
          <Textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder="在这天添加待办，Enter 保存"
            className="min-h-[36px] flex-1 text-[12.5px]"
          />
          <button
            onClick={() => void submit()}
            disabled={!draft.trim()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-primary px-3 text-[12.5px] font-medium text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            <Plus size={13} /> 添加
          </button>
        </div>
      </div>
    </div>
  )
}
