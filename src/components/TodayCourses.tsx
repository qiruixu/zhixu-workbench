import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileSpreadsheet,
  GraduationCap,
  MapPin,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  User as UserIcon,
  Wand2,
} from 'lucide-react'
import { db } from '../lib/db'
import type { Course, TimetableMeta, WeekAnchor } from '../lib/types'
import {
  clearTimetable,
  coursesOnDate,
  dateKeyOf,
  formatMonthDay,
  importTimetableFile,
  isTimetableFile,
  loadTimetable,
  resolveWeek,
  saveWeekAnchor,
  shiftDay,
  todayKey,
  WEEK_ANCHOR_KEY,
  WEEK_LABELS_CN,
  weekdayOfDateKey,
  weekFromSemesterStart,
} from '../lib/timetable/repo'
import { inferWeek, semesterStartFromText } from '../lib/timetable/infer'
import { cn, timeAgo } from '../lib/utils'
import { useApp } from '../store/ctx'
import { IconButton, Spinner } from './ui'

const FORMAT_LABEL: Record<string, string> = {
  sheet: '表格',
  rtf: 'RTF 文档',
  pdf: 'PDF',
}

function useAnchor(value: unknown): WeekAnchor | null {
  return useMemo(() => {
    const v = value as WeekAnchor | undefined
    if (!v || typeof v.week !== 'number' || typeof v.onDate !== 'string') return null
    return v
  }, [value])
}

export function TodayCourses() {
  const { toast, confirm, focusDate, setFocusDate } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [weekDraft, setWeekDraft] = useState('')

  const meta = useLiveQuery(() => loadTimetable(), [], undefined as TimetableMeta | undefined)
  const anchorRow = useLiveQuery(() => db.settings.get(WEEK_ANCHOR_KEY), [], undefined)
  const anchor = useAnchor(anchorRow?.value)

  const today = todayKey()
  const isToday = focusDate === today
  const weekday = weekdayOfDateKey(focusDate)
  // 周次跟着「当前浏览的日期」走，翻到下一周时数字会自己更新
  const week = resolveWeek(anchor, meta?.semesterStart, focusDate)

  useEffect(() => {
    setWeekDraft(week == null ? '' : String(week))
  }, [week])

  const dayList = useMemo(
    () => coursesOnDate(meta, focusDate, week),
    [meta, focusDate, week]
  )
  const activeList = dayList.filter((c) => c.active || c.unknown)
  const inactiveList = dayList.filter((c) => !c.active && !c.unknown)

  /** 设定「某天是第几周」→ 之后按自然周自动推进 */
  const applyWeek = async (n: number) => {
    const w = Math.min(60, Math.max(1, n))
    await saveWeekAnchor(w, focusDate)
    if (meta) {
      await db.timetable.put({
        ...meta,
        weekAuto: {
          source: 'manual',
          confidence: 'high',
          note: '你手动设定的周次',
          at: Date.now(),
        },
      })
    }
    setWeekDraft(String(w))
    toast(`已把 ${formatMonthDay(focusDate)} 设为第 ${w} 周，之后会自动更新`, 'success')
  }

  /** 根据课表内容自动定位「当前是第几周」 */
  const autoLocate = async () => {
    if (!meta) return
    const inf = inferWeek(meta.courses, meta.semester, todayKey())
    if (!inf) {
      const sem = semesterStartFromText(meta.semester)
      toast(
        sem
          ? `课表标注的是「${sem.label}」，当前日期不在该学期内，请手动设定周次`
          : '课表里没有日期或学期信息，无法自动判断，请手动设定',
        'info'
      )
      return
    }
    await db.timetable.put({
      ...meta,
      semesterStart: inf.semesterStart,
      weekAuto: {
        source: inf.source,
        confidence: inf.confidence,
        note: inf.note,
        at: Date.now(),
      },
    })
    await saveWeekAnchor(inf.week, todayKey())
    setFocusDate(todayKey())
    toast(`已自动定位：今天是第 ${inf.week} 周（${inf.note}）`, 'success')
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = Array.from(files).find(isTimetableFile) ?? files[0]
    setBusy(true)
    try {
      const next = await importTimetableFile(file)
      toast(`课表已更新：解析到 ${next.courses.length} 门课程`, 'success')
      if (next.warnings.length) toast(next.warnings[0], 'info')
      setShowSettings(false)
    } catch (e) {
      toast(e instanceof Error ? e.message : '课表解析失败', 'error')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const setSemesterStart = async (value: string) => {
    if (!meta) return
    await db.timetable.put({
      ...meta,
      semesterStart: value || undefined,
      weekAuto: value
        ? { source: 'manual', confidence: 'high', note: '按你填写的开学日推算', at: Date.now() }
        : meta.weekAuto,
    })
    if (value) {
      const w = weekFromSemesterStart(value, focusDate)
      if (w) await saveWeekAnchor(w, focusDate)
      toast(w ? `已按开学日推算：当前是第 ${w} 周` : '开学日已保存', 'success')
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: '清除已导入的课表？',
      description: '将删除解析出的课程数据，你之前设置的开学日与周次也会一并清除。',
      confirmText: '清除课表',
      danger: true,
    })
    if (!ok) return
    await clearTimetable()
    toast('课表已清除', 'success')
  }

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return
      setDragging(false)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      void handleFiles(e.dataTransfer.files)
    },
  }

  return (
    <div
      {...dropProps}
      data-dropzone="timetable"
      className={cn(
        'relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-surface p-4 transition-colors',
        dragging ? 'border-primary ring-2 ring-primary/25' : 'border-border'
      )}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-primary/8 backdrop-blur-[1px]">
          <Upload size={24} className="text-primary" />
          <span className="text-[13px] font-medium text-primary">松开即可更新课表</span>
        </div>
      ) : null}

      {/* 头部 */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <GraduationCap size={16} className="shrink-0 text-primary" />
          <span className="shrink-0 whitespace-nowrap text-[14px] font-semibold text-text">
            课程表
          </span>
          {meta?.courses.length ? (
            <span className="min-w-0 truncate whitespace-nowrap text-[11.5px] text-faint">
              {meta.courses.length} 门课
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {meta ? (
            <>
              <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 px-0.5">
                <IconButton title="上一周" onClick={() => setFocusDate(shiftDay(focusDate, -7))}>
                  <ChevronLeft size={14} />
                </IconButton>
                <span className="min-w-[46px] whitespace-nowrap text-center text-[11.5px] font-medium text-text">
                  {week == null ? '未设周次' : `第 ${week} 周`}
                </span>
                <IconButton title="下一周" onClick={() => setFocusDate(shiftDay(focusDate, 7))}>
                  <ChevronRight size={14} />
                </IconButton>
              </div>
              <IconButton
                title="课表设置"
                onClick={() => setShowSettings((v) => !v)}
                className={showSettings ? 'text-primary' : undefined}
              >
                <Settings2 size={15} />
              </IconButton>
            </>
          ) : null}
        </div>
      </div>

      {/* 按天切换 */}
      {meta ? (
        <div className="mb-3 flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-1.5 py-1">
          <IconButton title="前一天" onClick={() => setFocusDate(shiftDay(focusDate, -1))}>
            <ChevronLeft size={16} />
          </IconButton>
          <button
            onClick={() => setFocusDate(today)}
            title="回到今天"
            className="min-w-0 flex-1 rounded-lg px-2 py-1 text-center transition-colors hover:bg-surface"
          >
            <span className="text-[13px] font-semibold text-text">{formatMonthDay(focusDate)}</span>
            <span className="ml-1.5 text-[12px] text-muted">
              周{WEEK_LABELS_CN[weekday - 1]}
            </span>
            <span
              className={cn(
                'ml-1.5 rounded-full px-1.5 py-0.5 text-[10.5px]',
                isToday ? 'bg-primary-soft text-primary' : 'bg-surface text-faint'
              )}
            >
              {isToday ? '今天' : '回到今天'}
            </span>
          </button>
          <IconButton title="后一天" onClick={() => setFocusDate(shiftDay(focusDate, 1))}>
            <ChevronRight size={16} />
          </IconButton>
        </div>
      ) : null}

      {/* 设置条 */}
      {meta && showSettings ? (
        <div className="mb-3 space-y-2.5 rounded-xl border border-border bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-text">
              <Wand2 size={13} className="text-primary" /> 自动定位周次
            </span>
            <button
              onClick={() => void autoLocate()}
              className="rounded-lg border border-primary/40 bg-primary-soft px-2.5 py-1.5 text-[12px] text-primary transition-colors hover:bg-primary/15"
            >
              根据课表自动判断
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-faint">
            依据课表里的学期信息（或常见开学周）推断「今天是第几周」，之后每自然周自动 +1。
            {meta.weekAuto ? ` 当前来源：${meta.weekAuto.note}` : ''}
          </p>

          <div className="border-t border-border pt-2.5">
            <span className="mb-1 block text-[12px] font-medium text-text">
              自定义周次（记住后会自动往后更新）
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">
                {formatMonthDay(focusDate)} 是第
              </span>
              <input
                type="number"
                min={1}
                max={60}
                value={weekDraft}
                onChange={(e) => setWeekDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void applyWeek(Number(weekDraft) || 1)
                }}
                placeholder="7"
                className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-center text-[12.5px] text-text outline-none focus:border-primary"
              />
              <span className="text-[12px] text-muted">周</span>
              <button
                onClick={() => void applyWeek(Number(weekDraft) || 1)}
                disabled={!weekDraft}
                className="rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface disabled:opacity-40"
              >
                应用
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-faint">
              设定一次即可：之后每过一个自然周，周次会自己 +1，不用手动改。
            </p>
          </div>

          <label className="block border-t border-border pt-2.5">
            <span className="mb-1 block text-[12px] font-medium text-text">
              或：开学第一周的周一（用于自动推算）
            </span>
            <input
              type="date"
              value={meta.semesterStart ?? ''}
              onChange={(e) => void setSemesterStart(e.target.value)}
              className="h-8.5 w-full rounded-lg border border-border bg-surface px-2.5 text-[12.5px] text-text outline-none focus:border-primary"
            />
          </label>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <button
              onClick={remove}
              className="flex items-center gap-1 text-[12px] text-danger hover:underline"
            >
              <Trash2 size={12} /> 清除课表
            </button>
            <span className="text-[11px] text-faint">
              允许重新拖入文件随时更新
            </span>
          </div>
          {meta.warnings.length ? (
            <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warning">
              <CircleAlert size={13} className="mt-0.5 shrink-0" />
              {meta.warnings.join('；')}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 周次来源说明：已自动定位 / 尚未定位 */}
      {meta && week != null && meta.weekAuto ? (
        <p className="mb-2.5 flex flex-wrap items-center gap-x-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-muted">
          <Sparkles size={12} className="shrink-0 text-primary" />
          <span className="font-medium text-text">已自动定位：当前第 {week} 周</span>
          <span className="text-faint">· {meta.weekAuto.note}</span>
          {meta.weekAuto.source !== 'manual' && meta.weekAuto.confidence !== 'high' ? (
            <button onClick={() => setShowSettings(true)} className="text-primary hover:underline">
              如不符，点此校准
            </button>
          ) : null}
        </p>
      ) : null}

      {/* 未设周次时的说明：避免用户误以为课表数据有问题 */}
      {meta && week == null ? (
        <p className="mb-2.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-muted">
          尚未确定当前周次，这里显示当天全部课程（不按周次过滤）。
          {meta.semester ? `课表标注「${meta.semester}」。` : ''}
          <button onClick={() => void autoLocate()} className="mx-1 text-primary hover:underline">
            让系统自动定位
          </button>
          或点右上角齿轮手动设定。
        </p>
      ) : null}

      {/* 主体 */}
      {!meta ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
          {busy ? (
            <>
              <Spinner />
              <p className="mt-2 text-[13px] text-muted">正在解析课表…</p>
            </>
          ) : (
            <>
              <FileSpreadsheet size={26} className="text-faint" />
              <p className="mt-2.5 text-[13.5px] font-medium text-text">把课表文件拖到这里</p>
              <p className="mt-1 max-w-[300px] text-[12px] leading-relaxed text-muted">
                支持 .xls / .xlsx / .csv / .rtf（含 .doc）/ .pdf。导入后即可按天查看课程与教室，随时可再次拖入更新。
              </p>
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-3 rounded-xl border border-border-strong bg-surface px-3 py-1.5 text-[12.5px] text-text transition-colors hover:bg-surface-2"
              >
                选择文件
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {dayList.length === 0 ? (
            <div className="flex min-h-[100px] flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-6 text-center">
              <CalendarRange size={22} className="text-faint" />
              <p className="mt-2 text-[13px] text-muted">
                {isToday ? '今天没有课' : '这天没有课'}
              </p>
              <p className="mt-1 text-[11.5px] text-faint">
                周{WEEK_LABELS_CN[weekday - 1]}没有排课
              </p>
            </div>
          ) : (
            <>
              {activeList.map(({ course, unknown }) => (
                <CourseRow key={course.id} course={course} unknown={unknown} />
              ))}
              {inactiveList.length ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[12px] text-faint hover:text-muted">
                    本周不上（{inactiveList.length}）
                  </summary>
                  <div className="mt-1.5 space-y-1.5 opacity-55">
                    {inactiveList.map(({ course }) => (
                      <CourseRow key={course.id} course={course} muted />
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}

          {meta.remarks.length ? (
            <details className="mt-1 shrink-0">
              <summary className="cursor-pointer text-[12px] text-faint hover:text-muted">
                其它安排（{meta.remarks.length}）
              </summary>
              <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-muted">
                {meta.remarks.map((r, i) => (
                  <li key={i} className="min-w-0 [overflow-wrap:anywhere]">
                    · {r}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      {/* 底部：来源信息 */}
      {meta ? (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <span className="min-w-0 truncate text-[11px] text-faint" title={meta.fileName}>
            {meta.fileName}
            {meta.sourceFormat ? ` · ${FORMAT_LABEL[meta.sourceFormat] ?? ''}` : ''} ·{' '}
            {timeAgo(meta.importedAt)}更新
          </span>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex shrink-0 items-center gap-1 text-[11.5px] text-primary hover:underline disabled:opacity-50"
          >
            {busy ? <Spinner className="h-3 w-3" /> : <RefreshCw size={12} />} 更新课表
          </button>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept=".xls,.xlsx,.xlt,.xltx,.csv,.tsv,.rtf,.doc,.docx,.pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,application/rtf"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </div>
  )
}

/**
 * 教师列表在窄面板里放不下（一节大课可能有 10+ 位老师）。
 * 超过 2 位就折叠成「张三、李四 等 11 人」，完整名单放 title，hover 可见。
 */
function teacherLabel(teacher: string): string {
  const list = teacher
    .split(/[,，、;；/]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (list.length <= 2) return list.join('、') || teacher
  return `${list.slice(0, 2).join('、')} 等 ${list.length} 人`
}

function CourseRow({ course, muted, unknown }: { course: Course; muted?: boolean; unknown?: boolean }) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 transition-colors',
        !muted && 'hover:border-primary/40'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <span
              className="line-clamp-2 min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-text"
              title={course.name}
            >
              {course.name}
            </span>
            {course.note ? (
              <span
                className="max-w-[40%] shrink-0 truncate text-[11px] text-faint"
                title={course.note}
              >
                {course.note}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
            {course.location ? (
              <span className="flex min-w-0 items-center gap-1" title={course.location}>
                <MapPin size={11} className="shrink-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{course.location}</span>
              </span>
            ) : null}
            {course.teacher ? (
              <span className="flex min-w-0 items-center gap-1" title={course.teacher}>
                <UserIcon size={11} className="shrink-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {teacherLabel(course.teacher)}
                </span>
              </span>
            ) : null}
            {course.weeks ? <span className="shrink-0">第 {course.weeks} 周</span> : null}
            {unknown ? <span className="shrink-0 text-warning">周次未识别</span> : null}
          </div>
        </div>
        {course.periodLabel ? (
          <span className="shrink-0 rounded-lg bg-primary-soft px-2 py-1 text-[11px] font-medium text-primary">
            {course.periodLabel}
          </span>
        ) : null}
      </div>
      {course.section ? (
        <div className="mt-1.5 truncate text-[11px] text-faint">{course.section}</div>
      ) : null}
    </div>
  )
}

export { dateKeyOf }
