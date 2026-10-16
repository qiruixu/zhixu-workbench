import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  FolderCog,
  GripVertical,
  LayoutDashboard,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { db } from '../lib/db'
import type { Category, Site } from '../lib/types'
import {
  bumpOpen,
  deleteSite,
  moveSiteToCategory,
  reorderSites,
  toggleFavorite,
  togglePinned,
} from '../lib/navRepo'
import { cn, hostnameOf } from '../lib/utils'
import { useApp } from '../store/ctx'
import { SiteIcon } from '../components/SiteIcon'
import { SiteEditorModal } from '../components/SiteEditorModal'
import { CategoryManagerModal } from '../components/CategoryManagerModal'
import { LayoutPanel, gridClass } from '../components/LayoutPanel'
import { MemoCalendar } from '../components/MemoCalendar'
import { TodayCourses } from '../components/TodayCourses'
import { WeatherCard } from '../components/WeatherCard'
import { Button, EmptyState, IconButton } from '../components/ui'

interface Section {
  id: string
  name: string | null
  color?: string
  categoryId: string | null
  sites: Site[]
}

/* ------------------------------- 网站卡片 ------------------------------- */

function SiteCard({
  site,
  dragDisabled,
  onOpen,
  onEdit,
  onDelete,
}: {
  site: Site
  dragDisabled: boolean
  onOpen: (s: Site) => void
  onEdit: (s: Site) => void
  onDelete: (s: Site) => void
}) {
  const { settings } = useApp()
  const L = settings.layout
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: site.id,
    disabled: dragDisabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  }

  const pad = L.cardSize === 'sm' ? 'p-2.5' : L.cardSize === 'lg' ? 'p-4' : 'p-3'
  const iconSize = L.cardSize === 'sm' ? 28 : L.cardSize === 'lg' ? 40 : 34

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex flex-col rounded-2xl border border-border bg-surface transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-md)]',
        pad
      )}
    >
      <button
        onClick={() => onOpen(site)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
        title={`在新标签页打开 ${site.url}`}
      >
        <SiteIcon url={site.url} iconUrl={site.iconUrl} title={site.title} size={iconSize} radius={9} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="truncate text-[13.5px] font-medium leading-5 text-text">{site.title}</span>
            {site.pinned ? <Pin size={11} className="shrink-0 text-primary" /> : null}
          </span>
          {L.cardSize !== 'sm' ? (
            <span className="mt-0.5 block truncate text-[11.5px] text-faint">{hostnameOf(site.url)}</span>
          ) : null}
        </span>
      </button>

      {/* 悬浮操作 */}
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-lg bg-surface/85 opacity-100 backdrop-blur transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <button
          {...attributes}
          {...listeners}
          disabled={dragDisabled}
          title="拖动排序"
          className={cn(
            'hidden h-7 w-6 items-center justify-center rounded-lg text-faint md:flex',
            dragDisabled ? 'cursor-not-allowed opacity-30' : 'cursor-grab hover:text-text active:cursor-grabbing'
          )}
        >
          <GripVertical size={13} />
        </button>
        <IconButton
          title={site.favorite ? '取消收藏' : '收藏'}
          className="h-7 w-7"
          onClick={() => void toggleFavorite(site.id)}
        >
          <Star size={13} className={cn(site.favorite && 'fill-warning text-warning')} />
        </IconButton>
        <IconButton
          title={site.pinned ? '取消置顶' : '置顶'}
          className="h-7 w-7"
          onClick={() => void togglePinned(site.id)}
        >
          {site.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </IconButton>
        <IconButton title="编辑" className="h-7 w-7" onClick={() => onEdit(site)}>
          <Pencil size={13} />
        </IconButton>
        <IconButton
          title="删除"
          className="h-7 w-7 hover:text-danger"
          onClick={() => onDelete(site)}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
    </div>
  )
}

/* ------------------------------- 首页 ------------------------------- */

export default function Workbench() {
  const { settings, toast, confirm } = useApp()
  const L = settings.layout

  const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), [], [] as Category[])
  const sites = useLiveQuery(() => db.sites.toArray(), [], [] as Site[])

  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState<'all' | 'none' | string>('all')
  const [quick, setQuick] = useState<'all' | 'fav' | 'pin'>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingSite, setEditingSite] = useState<Site | null>(null)
  const [defaultCat, setDefaultCat] = useState<string | null>(null)
  const [showCatMgr, setShowCatMgr] = useState(false)
  const [showLayout, setShowLayout] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = sites.slice()
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.url.toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q)
      )
    }
    if (catFilter === 'none') list = list.filter((s) => !s.categoryId || !catById.has(s.categoryId))
    else if (catFilter !== 'all') list = list.filter((s) => s.categoryId === catFilter)
    if (quick === 'fav') list = list.filter((s) => s.favorite)
    if (quick === 'pin') list = list.filter((s) => s.pinned)
    list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order)
    return list
  }, [sites, query, catFilter, quick, catById])

  const sections = useMemo<Section[]>(() => {
    if (!L.groupByCategory) {
      return [{ id: '__all__', name: null, categoryId: null, sites: filtered }]
    }
    const out: Section[] = []
    for (const c of categories) {
      const list = filtered.filter((s) => s.categoryId === c.id)
      if (list.length) out.push({ id: c.id, name: c.name, color: c.color, categoryId: c.id, sites: list })
    }
    const orphans = filtered.filter((s) => !s.categoryId || !catById.has(s.categoryId))
    if (orphans.length) out.push({ id: '__none__', name: '未分类', categoryId: null, sites: orphans })
    return out
  }, [filtered, categories, catById, L.groupByCategory])

  const dragDisabled = query.trim().length > 0

  const stats = useMemo(
    () => ({
      sites: sites.length,
      categories: categories.length,
      favorites: sites.filter((s) => s.favorite).length,
    }),
    [sites, categories]
  )

  const openSite = (s: Site) => {
    window.open(s.url, '_blank', 'noopener,noreferrer')
    void bumpOpen(s.id)
  }

  const onOpenEditor = (site?: Site | null, catId?: string | null) => {
    setEditingSite(site ?? null)
    setDefaultCat(catId ?? null)
    setEditorOpen(true)
  }

  const onDelete = async (s: Site) => {
    const ok = await confirm({
      title: `删除「${s.title}」？`,
      description: '该网站将从工作台中移除，此操作不可撤销。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    await deleteSite(s.id)
    toast('已删除', 'success')
  }

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const aId = String(active.id)
    const oId = String(over.id)
    if (aId === oId) return

    const fromSec = sections.find((sec) => sec.sites.some((x) => x.id === aId))
    const toSec = sections.find((sec) => sec.sites.some((x) => x.id === oId))
    if (!fromSec || !toSec) return

    if (fromSec.id === toSec.id) {
      const ids = fromSec.sites.map((s) => s.id)
      const from = ids.indexOf(aId)
      const to = ids.indexOf(oId)
      if (from < 0 || to < 0) return
      void reorderSites(arrayMove(ids, from, to))
    } else {
      const targetIds = toSec.sites.map((s) => s.id)
      const to = targetIds.indexOf(oId)
      const next = [...targetIds]
      next.splice(to < 0 ? targetIds.length : to, 0, aId)
      void moveSiteToCategory(aId, toSec.categoryId, next)
      toast(`已移动到「${toSec.name ?? '未分类'}」`, 'success')
    }
  }

  const activeSite = activeId ? sites.find((s) => s.id === activeId) : null
  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 6) return '夜深了'
    if (h < 11) return '早上好'
    if (h < 14) return '中午好'
    if (h < 18) return '下午好'
    return '晚上好'
  })()

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 md:px-7 md:py-7">
      {/* Hero */}
      {L.showHero ? (
        <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[var(--bg-grad-1)] to-[var(--bg-grad-2)] p-5 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight text-text md:text-[26px]">
                {greeting}，这是你的工作台
              </h1>
              <p className="mt-1.5 text-[13.5px] text-muted">
                把常用网站集中到这里，拖拽即可整理；需要时让 AI 帮你归类。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowLayout(true)}>
                <Settings2 size={15} /> 布局
              </Button>
              <Button variant="primary" onClick={() => onOpenEditor(null, null)}>
                <Plus size={15} /> 添加网站
              </Button>
            </div>
          </div>

          {L.showStats ? (
            <div className="mt-5 grid grid-cols-3 gap-3 sm:max-w-md">
              {[
                { label: '网站', value: stats.sites, icon: LayoutDashboard },
                { label: '分类', value: stats.categories, icon: FolderCog },
                { label: '收藏', value: stats.favorites, icon: Star },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-xl border border-border bg-surface/70 px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5 text-[12px] text-muted">
                    <Icon size={13} /> {label}
                  </div>
                  <div className="mt-0.5 text-[19px] font-semibold tabular-nums text-text">{value}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 面板带：今日课程 + 日历备忘 + 天气 */}
      {(() => {
        const panels = [
          L.showTodayCourses ? <TodayCourses key="courses" /> : null,
          L.showMemoCalendar ? <MemoCalendar key="memo" /> : null,
          L.showWeather ? <WeatherCard key="weather" /> : null,
        ].filter(Boolean) as React.ReactNode[]
        if (!L.showDashboard || panels.length === 0) return null
        const gridCls =
          panels.length === 1
            ? 'grid-cols-1'
            : panels.length === 2
              ? 'lg:grid-cols-2'
              : 'lg:grid-cols-2 xl:grid-cols-[1.35fr_1fr_0.95fr]'
        return (
          <div className={cn('mb-5 grid gap-4', gridCls)}>
            {panels.map((node, i) => (
              <div
                key={i}
                className={cn(
                  panels.length === 3 && i === 2 && 'lg:col-span-2 xl:col-span-1'
                )}
              >
                {node}
              </div>
            ))}
          </div>
        )
      })()}

      {/* 工具栏 */}
      <div className="mb-4 space-y-3">
        {L.showSearch ? (
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索网站名称、网址或备注…"
              className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-9 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-faint hover:text-text"
              >
                <X size={15} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {L.showQuickFilter ? (
            <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
              {[
                { k: 'all', label: '全部' },
                { k: 'fav', label: '收藏' },
                { k: 'pin', label: '置顶' },
              ].map(({ k, label }) => (
                <button
                  key={k}
                  onClick={() => setQuick(k as typeof quick)}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
                    quick === k ? 'bg-primary text-primary-fg' : 'text-muted hover:text-text'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <button
              onClick={() => setCatFilter('all')}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12.5px] transition-colors',
                catFilter === 'all'
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border bg-surface text-muted hover:text-text'
              )}
            >
              全部分类
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCatFilter(c.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors',
                  catFilter === c.id
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-border bg-surface text-muted hover:text-text'
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: c.color || '#6366f1' }} />
                {c.name}
              </button>
            ))}
            <button
              onClick={() => setCatFilter('none')}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12.5px] transition-colors',
                catFilter === 'none'
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border bg-surface text-muted hover:text-text'
              )}
            >
              未分类
            </button>
            <button
              onClick={() => setShowCatMgr(true)}
              className="rounded-full border border-dashed border-border-strong px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-primary hover:text-text"
            >
              <FolderCog size={12} className="mr-1 inline" /> 管理分类
            </button>
          </div>
        </div>
      </div>

      {/* 内容 */}
      {sites.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard size={30} />}
          title="工作台还是空的"
          description="添加你常用的网站，比如学校官网、图书馆、GitHub 或新闻站。也可以用「设置 → 导入」恢复之前的备份。"
          action={
            <Button variant="primary" onClick={() => onOpenEditor(null, null)}>
              <Plus size={15} /> 添加第一个网站
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={30} />}
          title="没有匹配的网站"
          description="换个关键词，或切换分类/筛选条件试试。"
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery('')
                setCatFilter('all')
                setQuick('all')
              }}
            >
              清除筛选
            </Button>
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <div className="space-y-6">
            {dragDisabled ? (
              <p className="text-[12px] text-faint">搜索状态下已暂停拖拽排序，清空搜索后可继续拖动。</p>
            ) : null}
            {sections.map((sec) => (
              <section key={sec.id}>
                {sec.name ? (
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="h-3.5 w-1.5 rounded-full" style={{ background: sec.color || '#64748b' }} />
                    <h2 className="text-[14px] font-semibold text-text">{sec.name}</h2>
                    <span className="text-[12px] text-faint">{sec.sites.length}</span>
                    <button
                      onClick={() => onOpenEditor(null, sec.categoryId)}
                      className="ml-1 rounded-md p-1 text-faint transition-colors hover:text-primary"
                      title="向该分类添加网站"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ) : null}
                <SortableContext items={sec.sites.map((s) => s.id)} strategy={rectSortingStrategy}>
                  <div className={gridClass(L)}>
                    {sec.sites.map((s) => (
                      <SiteCard
                        key={s.id}
                        site={s}
                        dragDisabled={dragDisabled}
                        onOpen={openSite}
                        onEdit={(x) => onOpenEditor(x)}
                        onDelete={onDelete}
                      />
                    ))}
                  </div>
                </SortableContext>
              </section>
            ))}
          </div>

          <DragOverlay>
            {activeSite ? (
              <div className="flex w-52 items-center gap-2.5 rounded-2xl border border-primary/50 bg-surface p-3 shadow-[var(--shadow-lg)]">
                <SiteIcon url={activeSite.url} iconUrl={activeSite.iconUrl} title={activeSite.title} size={32} />
                <span className="truncate text-[13px] font-medium text-text">{activeSite.title}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <SiteEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        site={editingSite}
        categories={categories}
        defaultCategoryId={defaultCat}
      />
      <CategoryManagerModal open={showCatMgr} onClose={() => setShowCatMgr(false)} />
      <LayoutPanel open={showLayout} onClose={() => setShowLayout(false)} />
    </div>
  )
}
