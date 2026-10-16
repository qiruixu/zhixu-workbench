import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Wand2, TriangleAlert, Sparkles, CheckCircle2, XCircle, Globe } from 'lucide-react'
import { db, resolveApiKey } from '../lib/db'
import type { AIConfig, NavSuggestion } from '../lib/types'
import { streamChat } from '../lib/ai/client'
import { buildNavMessages, parseNavSuggestion } from '../lib/ai/navAssistant'
import { applySuggestion, describeSuggestion, type ApplyResult, type NavSnapshot } from '../lib/navOps'
import { cn } from '../lib/utils'
import { useApp } from '../store/ctx'
import { Badge, Button, Modal, Textarea } from './ui'

type Mode = 'organize' | 'recommend'

const ORGANIZE_PRESETS = [
  '按用途重新分类，让同类网站聚在一起',
  '检查有没有重复或该合并的分类',
  '为没有分类的网站推荐合适的分类',
  '看看分类是否过多，能否精简',
]

const RECOMMEND_PRESETS = [
  '帮我推荐几个写论文 / 查文献常用的网站，分好类、重要的置顶',
  '推荐几个程序员常用网站（文档、工具、社区），分好类',
  '推荐一些高效学习 / 记笔记 / 时间管理的网站',
  '推荐一些设计 / 素材 / 图库网站',
]

export function NavAssistantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeConfigId, toast } = useApp()
  const configs = useLiveQuery(() => db.aiConfigs.toArray(), [], [] as AIConfig[])
  const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), [], [])
  const sites = useLiveQuery(() => db.sites.toArray(), [], [])

  const cfg = configs.find((c) => c.id === activeConfigId) ?? null

  const [mode, setMode] = useState<Mode>('organize')
  const [request, setRequest] = useState(ORGANIZE_PRESETS[0])
  const [loading, setLoading] = useState(false)
  const [raw, setRaw] = useState('')
  const [suggestion, setSuggestion] = useState<NavSuggestion | null>(null)
  const [applied, setApplied] = useState<ApplyResult | null>(null)
  const [error, setError] = useState('')

  const presets = mode === 'organize' ? ORGANIZE_PRESETS : RECOMMEND_PRESETS

  const switchMode = (m: Mode) => {
    if (m === mode) return
    setMode(m)
    setRequest(m === 'organize' ? ORGANIZE_PRESETS[0] : RECOMMEND_PRESETS[0])
    setSuggestion(null)
    setRaw('')
    setError('')
    setApplied(null)
    setLoading(false)
  }

  useEffect(() => {
    if (!open) {
      setSuggestion(null)
      setRaw('')
      setError('')
      setApplied(null)
      setLoading(false)
    }
  }, [open])

  const snap: NavSnapshot = { categories, sites }
  const preview = suggestion ? describeSuggestion(suggestion, snap) : []

  const generate = async () => {
    setError('')
    setApplied(null)
    if (!cfg) {
      setError('尚未配置 AI，请先到「AI 配置」添加并测试连接。')
      return
    }
    const key = resolveApiKey(cfg)
    if (cfg.authStyle !== 'none' && !key.trim()) {
      setError('当前 AI 配置没有可用的 API Key。')
      return
    }
    if (mode === 'organize' && sites.length === 0) {
      setError('当前没有任何网站可供分析，可以先在「找网站」里让 AI 帮你添加。')
      return
    }

    setLoading(true)
    setSuggestion(null)
    setRaw('')
    try {
      const msgs = buildNavMessages(snap, request)
      const ac = new AbortController()
      let acc = ''
      await new Promise<void>((resolve) => {
        void streamChat(
          cfg,
          key,
          msgs,
          {
            onDelta: (c) => {
              acc += c
              setRaw(acc)
            },
            onDone: () => resolve(),
            onError: (e) => {
              setError(`${e.title}：${e.message}`)
              resolve()
            },
          },
          ac.signal
        )
      })
      const parsed = parseNavSuggestion(acc)
      if (parsed) setSuggestion(parsed)
      else setError('模型没有返回可解析的结构化建议，你可以查看下方原始输出，或换个说法再试。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (!suggestion) return
    try {
      const res = await applySuggestion(suggestion, snap)
      setApplied(res)
      toast(`已应用修改：影响 ${res.changed} 项`, 'success')
      setSuggestion(null)
    } catch (e) {
      toast(e instanceof Error ? e.message : '应用失败', 'error')
    }
  }

  const KIND_STYLE: Record<string, string> = {
    'add-category': 'text-success',
    'add-site': 'text-success',
    assign: 'text-primary',
    merge: 'text-primary',
    update: 'text-warning',
    'delete-category': 'text-danger',
    skip: 'text-faint',
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'organize' ? '整理我的导航' : '让 AI 帮你找网站'}
      description={
        mode === 'organize'
          ? 'AI 只负责提建议；所有改动都会先展示预览，需你确认后才会执行。'
          : '描述你想要的网站类型，AI 会推荐并自动分类、置顶；确认后一键加入导航栏。'
      }
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          {suggestion ? (
            <>
              <Button variant="outline" onClick={() => void generate()} loading={loading}>
                重新生成
              </Button>
              <Button variant="primary" onClick={apply} disabled={suggestion.ops.length === 0}>
                <CheckCircle2 size={15} /> 确认应用（{suggestion.ops.length} 项）
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => void generate()} loading={loading}>
              <Wand2 size={15} /> 生成建议
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {!cfg ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5 text-[12.5px] text-warning">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            尚未配置 AI。导航功能不受影响，但「整理导航」需要先配置一个可用的模型。
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <Sparkles size={14} className="text-primary" />
            将使用：<Badge tone="primary">{cfg.providerName}</Badge>
            <span className="font-mono">{cfg.model}</span>
          </div>
        )}

        <div className="flex gap-1 rounded-xl border border-border bg-surface-2 p-1">
          <button
            onClick={() => switchMode('organize')}
            className={cn(
              'flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              mode === 'organize' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
            )}
          >
            <Wand2 size={13} className="mr-1 inline-block" />
            整理现有导航
          </button>
          <button
            onClick={() => switchMode('recommend')}
            className={cn(
              'flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              mode === 'recommend' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
            )}
          >
            <Globe size={13} className="mr-1 inline-block" />
            找网站
          </button>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-text">
            {mode === 'organize' ? '你想怎么整理？' : '你想要哪类网站？'}
          </div>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                onClick={() => setRequest(p)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                  request === p
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-border bg-surface text-muted hover:text-text'
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <Textarea rows={2} value={request} onChange={(e) => setRequest(e.target.value)} />
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger">
            <XCircle size={15} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : null}

        {applied ? (
          <div className="rounded-xl border border-success/40 bg-success-soft px-3 py-2.5 text-[12.5px] text-success">
            <div className="font-medium">已应用修改，共影响 {applied.changed} 项。</div>
            {applied.createdCategories.length ? (
              <div className="mt-1 opacity-90">新建分类：{applied.createdCategories.join('、')}</div>
            ) : null}
          </div>
        ) : null}

        {suggestion ? (
          <div className="rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-3.5 py-2.5">
              <div className="text-[13px] font-semibold text-text">变更预览</div>
              <div className="mt-0.5 text-[12.5px] text-muted">{suggestion.summary}</div>
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto p-2.5">
              {preview.length === 0 ? (
                <p className="px-2 py-3 text-center text-[12.5px] text-muted">
                  AI 认为没有需要调整的地方。
                </p>
              ) : (
                preview.map((line, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-[12.5px]"
                  >
                    <span className={cn('mt-0.5 shrink-0 font-mono text-[11px]', KIND_STYLE[line.kind])}>
                      {line.kind === 'skip' ? '跳过' : '变更'}
                    </span>
                    <span className="text-text">{line.text}</span>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-border px-3.5 py-2 text-[11.5px] text-faint">
              未点击「确认应用」前，你的导航数据不会发生任何变化。
            </div>
          </div>
        ) : null}

        {raw && !suggestion ? (
          <details className="rounded-xl border border-border bg-surface-2 p-3">
            <summary className="cursor-pointer text-[12.5px] text-muted">查看模型原始输出</summary>
            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-muted">
              {raw}
            </pre>
          </details>
        ) : null}
      </div>
    </Modal>
  )
}
