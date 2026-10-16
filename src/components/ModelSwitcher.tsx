import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, Loader2, RefreshCw, Search, Settings2, Sparkles } from 'lucide-react'
import { db, resolveApiKey } from '../lib/db'
import type { AIConfig } from '../lib/types'
import { saveConfig, withFetchedModels } from '../lib/aiConfigRepo'
import { fetchModels } from '../lib/ai/client'
import { getProvider } from '../lib/providers'
import { cn } from '../lib/utils'
import { useApp } from '../store/ctx'
import { Badge } from './ui'

/**
 * 会话中的「服务商 / 模型」切换器：
 *  - 切换当前使用的 API 配置
 *  - 切换当前配置下的模型（可从服务端刷新列表，也可手动填写）
 * 切换会写回配置本身，因此是「真切换」，不是只改显示。
 */
export function ModelSwitcher({
  onSwitched,
}: {
  onSwitched?: (cfg: AIConfig) => void
}) {
  const { activeConfigId, setActiveConfigId, toast } = useApp()
  const configs = useLiveQuery(() => db.aiConfigs.orderBy('createdAt').toArray(), [], [] as AIConfig[])
  const active = useMemo(
    () => configs.find((c) => c.id === activeConfigId) ?? null,
    [configs, activeConfigId]
  )

  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState('')
  const [refreshing, setRefreshing] = useState(false)
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

  const switchConfig = async (cfg: AIConfig) => {
    await setActiveConfigId(cfg.id)
    onSwitched?.(cfg)
    toast(`已切换到 ${cfg.providerName} · ${cfg.model}`, 'success')
  }

  const switchModel = async (model: string) => {
    if (!active || !model.trim() || model === active.model) return
    const next = { ...active, model: model.trim() }
    await saveConfig(next)
    onSwitched?.(next)
    toast(`模型已切换为 ${model.trim()}`, 'success')
  }

  const refresh = async () => {
    if (!active) return
    setRefreshing(true)
    try {
      const { models } = await fetchModels(active, resolveApiKey(active))
      if (!models.length) {
        toast('服务端未返回模型列表，可手动填写', 'info')
      } else {
        let next = withFetchedModels(active, models, manual)
        next = { ...next, model: active.model }
        await saveConfig(next)
        toast(`已获取 ${models.length} 个模型`, 'success')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '刷新失败', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  if (!active) return null

  const modelList = active.models.length
    ? active.models
    : [active.model].filter(Boolean)

  // NVIDIA 之类的服务商模型名是「命名空间/模型」的长字符串且数量多，
  // 分组 + 搜索后才好选；其余服务商保持平铺。
  const groupByNs = Boolean(getProvider(active.providerId)?.groupByNamespace)
  const q = query.trim().toLowerCase()
  const filtered = q ? modelList.filter((m) => m.toLowerCase().includes(q)) : modelList
  const groups: Array<{ key: string; items: string[] }> = []
  if (groupByNs) {
    const map = new Map<string, string[]>()
    for (const m of filtered) {
      const ns = m.includes('/') ? m.split('/')[0] : '其他'
      const arr = map.get(ns) ?? []
      arr.push(m)
      map.set(ns, arr)
    }
    for (const [ns, items] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      groups.push({ key: ns, items })
    }
  } else {
    groups.push({ key: '', items: filtered })
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="切换 API 与模型"
        className={cn(
          'flex max-w-[280px] items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition-colors',
          open
            ? 'border-primary bg-primary-soft text-primary'
            : 'border-border bg-surface-2 text-text hover:border-primary/50'
        )}
      >
        <Badge tone="primary" className="shrink-0">
          {active.providerName}
        </Badge>
        <span className="truncate font-mono">{active.model || '未选模型'}</span>
        <ChevronDown size={12} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[320px] overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-lg)] animate-pop">
          {/* 选择配置 */}
          <div className="border-b border-border px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-text">API 配置</span>
              <Link
                to="/ai"
                onClick={() => setOpen(false)}
                className="flex items-center gap-1 text-[11.5px] text-primary hover:underline"
              >
                <Settings2 size={11} /> 管理配置
              </Link>
            </div>
            <div className="max-h-44 space-y-1 overflow-y-auto">
              {configs.map((c) => {
                const isActive = c.id === active.id
                return (
                  <button
                    key={c.id}
                    onClick={() => void switchConfig(c)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                      isActive ? 'bg-primary-soft' : 'hover:bg-surface-2'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        isActive ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong'
                      )}
                    >
                      {isActive ? <Check size={10} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-[12.5px] font-medium',
                          isActive ? 'text-primary' : 'text-text'
                        )}
                      >
                        {c.name}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-faint">
                        {c.providerName} · {c.model || '未选模型'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 选择模型 */}
          <div className="px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-text">
                当前配置的模型
              </span>
              <button
                onClick={() => void refresh()}
                disabled={refreshing}
                className="flex items-center gap-1 text-[11.5px] text-primary hover:underline disabled:opacity-50"
              >
                {refreshing ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <RefreshCw size={11} />
                )}
                刷新列表
              </button>
            </div>

            {modelList.length > 6 ? (
              <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1">
                <Search size={11} className="shrink-0 text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索模型…"
                  className="h-5 flex-1 bg-transparent text-[11.5px] text-text outline-none placeholder:text-faint"
                />
                <span className="shrink-0 text-[10px] text-faint">{filtered.length}</span>
              </div>
            ) : null}

            <div className="max-h-40 space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-1 py-2 text-[11.5px] text-faint">
                  {modelList.length ? '没有匹配的模型' : '暂无模型，点右上角刷新'}
                </p>
              ) : (
                groups.map((g) => (
                  <div key={g.key || 'all'}>
                    {g.key ? (
                      <div className="px-1 pb-0.5 pt-1 text-[9.5px] font-semibold uppercase tracking-wide text-faint">
                        {g.key}
                      </div>
                    ) : null}
                    {g.items.map((m) => (
                      <button
                        key={m}
                        onClick={() => void switchModel(m)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                          m === active.model ? 'bg-primary-soft' : 'hover:bg-surface-2'
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                            m === active.model
                              ? 'border-primary bg-primary text-primary-fg'
                              : 'border-border-strong'
                          )}
                        >
                          {m === active.model ? <Check size={10} /> : null}
                        </span>
                        <span
                          className={cn(
                            'truncate font-mono text-[11.5px]',
                            m === active.model ? 'text-primary' : 'text-text'
                          )}
                        >
                          {groupByNs && m.includes('/') ? m.split('/').slice(1).join('/') : m}
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>

            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void switchModel(manual)
                    setManual('')
                  }
                }}
                placeholder="手动输入模型名后回车"
                className="h-7 flex-1 rounded-lg border border-border bg-surface-2 px-2 font-mono text-[11.5px] text-text outline-none focus:border-primary"
              />
              <button
                onClick={() => {
                  void switchModel(manual)
                  setManual('')
                }}
                disabled={!manual.trim()}
                className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-primary px-2 text-[11.5px] text-primary-fg disabled:opacity-40"
              >
                <Sparkles size={11} /> 切换
              </button>
            </div>
          </div>

          <div className="border-t border-border bg-surface-2 px-3 py-2 text-[10.5px] leading-relaxed text-faint">
            切换会写回该配置并立即对后续对话生效；新对话会记录当时使用的模型。
          </div>
        </div>
      ) : null}
    </div>
  )
}
