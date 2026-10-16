import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BadgeCheck,
  CheckCircle2,
  Copy,
  KeyRound,
  Pencil,
  Plug,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { db, resolveApiKey } from '../lib/db'
import type { AIConfig } from '../lib/types'
import { deleteConfig, duplicateConfig, markTestResult } from '../lib/aiConfigRepo'
import { testConnection, type TestResult } from '../lib/ai/client'
import { classifyThrown, type AIError } from '../lib/ai/errors'
import { cn, timeAgo } from '../lib/utils'
import { useApp } from '../store/ctx'
import { AIConfigEditor, ErrorBanner } from '../components/AIConfigEditor'
import { Badge, Button, EmptyState, IconButton } from '../components/ui'

export default function AIConfigPage() {
  const { activeConfigId, setActiveConfigId, toast, confirm } = useApp()
  const configs = useLiveQuery(() => db.aiConfigs.orderBy('createdAt').toArray(), [], [] as AIConfig[])

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AIConfig | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, TestResult | AIError>>({})

  const openNew = () => {
    setEditing(null)
    setEditorOpen(true)
  }
  const openEdit = (cfg: AIConfig) => {
    setEditing(cfg)
    setEditorOpen(true)
  }

  const runTest = async (cfg: AIConfig) => {
    setTestingId(cfg.id)
    try {
      const res = await testConnection(cfg, resolveApiKey(cfg))
      setResults((r) => ({ ...r, [cfg.id]: res }))
      await markTestResult(cfg.id, res.ok)
      toast(res.ok ? `「${cfg.name}」连接正常` : `「${cfg.name}」连接失败`, res.ok ? 'success' : 'error')
    } catch (e) {
      const err = classifyThrown(e)
      setResults((r) => ({ ...r, [cfg.id]: err }))
      await markTestResult(cfg.id, false)
      toast(`「${cfg.name}」连接失败`, 'error')
    } finally {
      setTestingId(null)
    }
  }

  const remove = async (cfg: AIConfig) => {
    const ok = await confirm({
      title: `删除配置「${cfg.name}」？`,
      description: '仅删除这份 AI 配置及其已保存的密钥，不影响导航数据与聊天记录。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    await deleteConfig(cfg.id)
    if (activeConfigId === cfg.id) await setActiveConfigId(null)
    toast('配置已删除', 'success')
  }

  const clearAllConfigs = async () => {
    const ok = await confirm({
      title: '清除全部 AI 配置？',
      description: '这会删除所有服务商配置、模型选择与本机保存的 API Key。导航数据与聊天记录不受影响。',
      confirmText: '全部清除',
      danger: true,
    })
    if (!ok) return
    await db.aiConfigs.clear()
    await setActiveConfigId(null)
    toast('已清除全部 AI 配置', 'success')
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-7 md:py-7">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-text">
            <Sparkles size={20} className="text-primary" /> AI 配置
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-muted">
            采用 BYOK（自带密钥）模式：你自行选择服务商并承担其 API 费用，本应用不提供代付或额度。
            配置只保存在本机，密钥不会上传到任何第三方服务器。
          </p>
        </div>
        <Button variant="primary" onClick={openNew}>
          <Plus size={15} /> 添加配置
        </Button>
      </div>

      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-warning">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
        <div>
          <span className="font-medium text-text">关于密钥安全：</span>
          开启「持久保存」时，Key 存放于本机浏览器的 IndexedDB；关闭时仅存于本次会话内存。
          本机存储无法保证绝对安全（同机其他程序理论上可能读取），请勿在公共设备保存密钥。
          你可以随时在此删除单份配置或一键清除全部密钥。
        </div>
      </div>

      {configs.length === 0 ? (
        <EmptyState
          icon={<KeyRound size={30} />}
          title="还没有任何 AI 配置"
          description="添加一个服务商并填入你自己的 API Key，即可开始对话。工作台的导航功能不依赖 AI，可独立使用。"
          action={
            <Button variant="primary" onClick={openNew}>
              <Plus size={15} /> 添加第一个配置
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {configs.map((cfg) => {
            const isActive = cfg.id === activeConfigId
            const res = results[cfg.id]
            const okRes = res && 'ok' in res ? (res as TestResult) : null
            const errRes = res && 'type' in res ? (res as AIError) : null
            return (
              <div
                key={cfg.id}
                className={cn(
                  'rounded-2xl border bg-surface p-4 transition-all',
                  isActive ? 'border-primary shadow-[var(--shadow-md)]' : 'border-border'
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-text">{cfg.name}</span>
                      {isActive ? (
                        <Badge tone="primary">
                          <CheckCircle2 size={10} /> 当前使用
                        </Badge>
                      ) : null}
                      {cfg.source === 'bootstrap' ? <Badge tone="primary">由本地配置自动写入</Badge> : null}
                      {cfg.lastTestResult === 'ok' ? (
                        <Badge tone="success">
                          <BadgeCheck size={10} /> 上次测试通过
                        </Badge>
                      ) : cfg.lastTestResult === 'fail' ? (
                        <Badge tone="danger">
                          <TriangleAlert size={10} /> 上次测试失败
                        </Badge>
                      ) : (
                        <Badge>待验证</Badge>
                      )}
                      {cfg.persistKey ? null : <Badge tone="warning">密钥仅本次会话</Badge>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
                      <span>服务商：{cfg.providerName}</span>
                      <span className="font-mono">模型：{cfg.model || '未选择'}</span>
                      <span>密钥：{resolveApiKey(cfg) ? '已填写' : '未填写'}</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[11.5px] text-faint">{cfg.baseUrl}</div>
                    {cfg.lastTestedAt ? (
                      <div className="mt-1 text-[11.5px] text-faint">最近测试：{timeAgo(cfg.lastTestedAt)}</div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {!isActive ? (
                      <Button size="sm" variant="subtle" onClick={() => void setActiveConfigId(cfg.id)}>
                        设为当前
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      loading={testingId === cfg.id}
                      onClick={() => void runTest(cfg)}
                    >
                      <Plug size={13} /> 测试
                    </Button>
                    <IconButton title="编辑" onClick={() => openEdit(cfg)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton
                      title="复制配置"
                      onClick={async () => {
                        await duplicateConfig(cfg.id)
                        toast('已复制配置（出于安全未复制密钥）', 'success')
                      }}
                    >
                      <Copy size={15} />
                    </IconButton>
                    <IconButton title="删除" onClick={() => void remove(cfg)}>
                      <Trash2 size={15} className="text-danger" />
                    </IconButton>
                  </div>
                </div>

                {okRes?.ok ? (
                  <div className="mt-3 rounded-xl border border-success/40 bg-success-soft px-3 py-2 text-[12.5px] text-success">
                    连接成功{okRes.models?.length ? `，发现 ${okRes.models.length} 个模型` : ''}。可以到「AI 助手」开始对话了。
                  </div>
                ) : null}
                {errRes ? <ErrorBanner error={errRes} /> : null}
              </div>
            )
          })}

          <div className="pt-1">
            <button
              onClick={clearAllConfigs}
              className="text-[12.5px] text-danger hover:underline"
            >
              清除全部 AI 配置与密钥
            </button>
          </div>
        </div>
      )}

      <AIConfigEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        initial={editing}
        onSaved={async (cfg, isNew) => {
          if (isNew && !activeConfigId) await setActiveConfigId(cfg.id)
        }}
      />
    </div>
  )
}
