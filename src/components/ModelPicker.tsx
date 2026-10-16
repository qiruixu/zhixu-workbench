import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { getProvider } from '../lib/providers'
import { cn } from '../lib/utils'

/**
 * 模型选择器：把「模型列表」做成真正可选的下拉（带搜索 + 命名空间分组），
 * 而不是让手输模型名。列表由调用方传入（通常是动态拉取后的结果）。
 *
 * 之所以要搜索/分组：NVIDIA NIM 这类服务商一次返回几十个模型，
 * 且名字是「命名空间/模型」的长字符串，平铺成一个列表根本没法选。
 */
export function ModelPicker({
  models,
  value,
  onChange,
  providerId,
  placeholder = '选择模型',
  className,
}: {
  models: string[]
  value: string
  onChange: (model: string) => void
  providerId?: string
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groupByNs = Boolean(providerId && getProvider(providerId)?.groupByNamespace)

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? models.filter((m) => m.toLowerCase().includes(q))
      : models
    if (!groupByNs) {
      return [{ key: '', items: filtered }]
    }
    const map = new Map<string, string[]>()
    for (const m of filtered) {
      const ns = m.includes('/') ? m.split('/')[0] : '其他'
      const arr = map.get(ns) ?? []
      arr.push(m)
      map.set(ns, arr)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ns, items]) => ({ key: ns, items }))
  }, [models, query, groupByNs])

  const totalCount = grouped.reduce((n, g) => n + g.items.length, 0)

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-left text-[12.5px] transition-colors',
          open ? 'border-primary' : 'hover:border-primary/50'
        )}
      >
        <span className={cn('truncate font-mono', value ? 'text-text' : 'text-faint')}>
          {value || placeholder}
        </span>
        <ChevronDown
          size={13}
          className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+4px)] z-40 w-full min-w-[260px] overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-lg)] animate-pop">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
            <Search size={12} className="shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型…"
              autoFocus
              className="h-6 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-faint"
            />
            <span className="shrink-0 text-[10.5px] text-faint">{totalCount} 个</span>
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {totalCount === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-faint">
                {models.length ? '没有匹配的模型' : '还没有模型列表，先在上方「刷新列表」'}
              </p>
            ) : (
              grouped.map((g) => (
                <div key={g.key || 'all'}>
                  {g.key ? (
                    <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                      {g.key}
                    </div>
                  ) : null}
                  {g.items.map((m) => {
                    const isActive = m === value
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          onChange(m)
                          setOpen(false)
                          setQuery('')
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                          isActive ? 'bg-primary-soft' : 'hover:bg-surface-2'
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                            isActive
                              ? 'border-primary bg-primary text-primary-fg'
                              : 'border-border-strong'
                          )}
                        >
                          {isActive ? <Check size={9} /> : null}
                        </span>
                        <span
                          className={cn(
                            'truncate font-mono text-[11.5px]',
                            isActive ? 'text-primary' : 'text-text'
                          )}
                        >
                          {groupByNs && m.includes('/') ? m.split('/').slice(1).join('/') : m}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
