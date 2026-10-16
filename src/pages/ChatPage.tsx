import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import {
  BookOpenCheck,
  Bot,
  Check,
  Copy,
  Eraser,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  User as UserIcon,
  Wand2,
} from 'lucide-react'
import { db, resolveApiKey } from '../lib/db'
import type { AIConfig, ChatMessage, Conversation } from '../lib/types'
import { streamChat } from '../lib/ai/client'
import { makeError, type AIError } from '../lib/ai/errors'
import {
  addMessage,
  autoTitle,
  clearConversationMessages,
  createConversation,
  deleteConversation,
  deleteMessage,
  listMessages,
  setConversationModel,
} from '../lib/chatRepo'
import { buildAIContext } from '../lib/ai/context'
import { cn, formatTime } from '../lib/utils'
import { useApp } from '../store/ctx'
import { Markdown } from '../components/Markdown'
import { ModelSwitcher } from '../components/ModelSwitcher'
import { NavAssistantModal } from '../components/NavAssistantModal'
import { Badge, Button, IconButton, Spinner } from '../components/ui'

export default function ChatPage() {
  const { activeConfigId, setActiveConfigId, toast, confirm } = useApp()

  const configs = useLiveQuery(() => db.aiConfigs.orderBy('createdAt').toArray(), [], [] as AIConfig[])
  const activeCfg = useMemo(
    () => configs.find((c) => c.id === activeConfigId) ?? null,
    [configs, activeConfigId]
  )

  const conversations = useLiveQuery(
    () => db.conversations.orderBy('updatedAt').reverse().toArray(),
    [],
    [] as Conversation[]
  )

  const [currentId, setCurrentId] = useState<string | null>(null)
  const messages = useLiveQuery(
    () => (currentId ? listMessages(currentId) : Promise.resolve([] as ChatMessage[])),
    [currentId],
    [] as ChatMessage[]
  )

  const [input, setInput] = useState('')
  const [streamText, setStreamText] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastError, setLastError] = useState<AIError | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showNavAssistant, setShowNavAssistant] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /** 是否把课表 / 日程 / 天气作为上下文一并发给 AI */
  const [contextOn, setContextOn] = useState(true)
  const [contextSections, setContextSections] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    db.settings.get('chatContext').then((row) => {
      if (alive && typeof row?.value === 'boolean') setContextOn(row.value as boolean)
    })
    return () => {
      alive = false
    }
  }, [])

  const toggleContext = async () => {
    const next = !contextOn
    setContextOn(next)
    await db.settings.put({ key: 'chatContext', value: next })
    toast(next ? '已开启：AI 会读到你的课表与日程' : '已关闭个人上下文', 'info')
  }

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 自动选中最近一次对话
  useEffect(() => {
    if (!currentId && conversations.length) setCurrentId(conversations[0].id)
  }, [conversations, currentId])

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamText])

  const newConversation = async () => {
    const c = await createConversation(activeCfg)
    setCurrentId(c.id)
    setLastError(null)
    setSidebarOpen(false)
  }

  const removeConversation = async (c: Conversation) => {
    const ok = await confirm({
      title: `删除对话「${c.title}」？`,
      description: '该对话的全部消息将被删除，不可恢复。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    await deleteConversation(c.id)
    if (currentId === c.id) setCurrentId(null)
    toast('对话已删除', 'success')
  }

  const clearCurrent = async () => {
    if (!currentId) return
    const ok = await confirm({
      title: '清空当前对话？',
      description: '将删除本对话中的全部消息，但保留对话本身。',
      confirmText: '清空',
      danger: true,
    })
    if (!ok) return
    await clearConversationMessages(currentId)
    toast('已清空当前对话', 'success')
  }

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || busy) return

    if (!activeCfg) {
      toast('尚未配置 AI，请先到「AI 配置」添加', 'error')
      return
    }
    const apiKey = resolveApiKey(activeCfg)
    if (activeCfg.authStyle !== 'none' && !apiKey.trim()) {
      setLastError(makeError('unauthorized', '当前配置未填写 API Key（或仅会话保存的 Key 已失效）'))
      return
    }

    setLastError(null)
    setInput('')

    let convId = currentId
    if (!convId) {
      const c = await createConversation(activeCfg)
      convId = c.id
      setCurrentId(c.id)
    }
    await setConversationModel(convId, activeCfg)

    await addMessage({ conversationId: convId, role: 'user', content })
    await autoTitle(convId)

    const history = await listMessages(convId)
    let payload = history.filter((m) => m.status !== 'error')

    // 注入个人上下文（课表 / 日程 / 位置天气），让 AI 能据此制定计划
    if (contextOn) {
      try {
        const ctx = await buildAIContext({
          includeTimetable: true,
          includeMemos: true,
          includeWeather: true,
        })
        setContextSections(ctx.sections)
        if (ctx.text) {
          payload = [
            {
              id: 'ctx',
              conversationId: convId,
              role: 'system' as const,
              content: ctx.text,
              createdAt: Date.now() - 1,
            },
            ...payload,
          ]
        }
      } catch {
        /* 上下文构建失败不应阻断对话 */
      }
    } else {
      setContextSections([])
    }

    setBusy(true)
    setStreamText('')
    const ac = new AbortController()
    abortRef.current = ac

    let acc = ''
    await streamChat(
      activeCfg,
      apiKey,
      payload,
      {
        onDelta: (chunk) => {
          acc += chunk
          setStreamText(acc)
        },
        onDone: async (full) => {
          const finalText = (full || acc).trim()
          if (finalText) {
            await addMessage({
              conversationId: convId!,
              role: 'assistant',
              content: finalText,
              model: activeCfg.model,
              providerName: activeCfg.providerName,
              status: ac.signal.aborted ? 'stopped' : 'done',
            })
          }
          setStreamText('')
          setBusy(false)
          abortRef.current = null
        },
        onError: async (err) => {
          setLastError(err)
          setStreamText('')
          setBusy(false)
          abortRef.current = null
        },
      },
      ac.signal
    )
  }

  const stop = () => {
    abortRef.current?.abort()
  }

  const retry = async () => {
    // 移除最后一条用户消息后重发，避免对话里出现重复提问
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    await deleteMessage(lastUser.id)
    await send(lastUser.content)
  }

  const copy = async (m: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(m.content)
      setCopiedId(m.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      toast('复制失败，请手动选择文本', 'error')
    }
  }

  /* ------------------------- 未配置 AI 的引导 ------------------------- */
  if (!activeCfg) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-7">
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Sparkles size={26} />
          </div>
          <h2 className="text-[19px] font-semibold text-text">还没有可用的 AI 配置</h2>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-muted">
            智序工作台采用 BYOK 模式，需要你填入自己的 API Key 才能对话。
            这里不会伪造任何 AI 回复。配置好后回到本页即可聊天。
          </p>
          <div className="mt-5">
            <Link to="/ai">
              <Button variant="primary" size="lg">
                <Sparkles size={16} /> 去配置 AI
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-[12px] text-faint">
            提示：导航功能不需要 AI，可正常使用。
          </p>
        </div>
      </div>
    )
  }

  const current = conversations.find((c) => c.id === currentId) ?? null

  return (
    <div className="flex h-[calc(100vh-0px)] md:h-screen">
      {/* 会话侧栏 */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[270px] flex-col border-r border-border bg-surface transition-transform md:static md:z-0 md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Button variant="primary" className="flex-1" onClick={newConversation}>
            <MessageSquarePlus size={15} /> 新建对话
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-muted">
              还没有对话，点击上方新建。
            </p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setCurrentId(c.id)
                  setSidebarOpen(false)
                }}
                className={cn(
                  'group mb-1 flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors',
                  c.id === currentId ? 'bg-primary-soft' : 'hover:bg-surface-2'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'truncate text-[13px] font-medium',
                      c.id === currentId ? 'text-primary' : 'text-text'
                    )}
                  >
                    {c.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
                    <span className="truncate font-mono">{c.model || '未指定模型'}</span>
                    <span>·</span>
                    <span className="shrink-0">{formatTime(c.updatedAt)}</span>
                  </div>
                </div>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    void removeConversation(c)
                  }}
                  className="shrink-0 rounded-md p-1 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </span>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border p-3">
          <Button variant="outline" className="w-full" onClick={() => setShowNavAssistant(true)}>
            <Wand2 size={15} /> 整理我的导航
          </Button>
        </div>
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      ) : null}

      {/* 主对话区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-surface/80 px-4 py-2.5 backdrop-blur md:px-5">
          <button
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <MessageSquarePlus size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-medium text-text">
                {current?.title ?? '新对话'}
              </span>
              {contextOn ? (
                <span className="hidden shrink-0 text-[10.5px] text-faint sm:inline">
                  · 已附带
                  {contextSections.length ? ` ${contextSections.join(' / ')}` : '个人上下文'}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <ModelSwitcher
                onSwitched={(cfg) => {
                  if (currentId) void setConversationModel(currentId, cfg)
                }}
              />
            </div>
          </div>

          <button
            onClick={() => void toggleContext()}
            data-guide="chat-context"
            title={
              contextOn
                ? '已开启：AI 会读取你的课表、日程与位置天气'
                : '已关闭：AI 不知道你的课表与日程'
            }
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11.5px] transition-colors',
              contextOn
                ? 'border-primary/40 bg-primary-soft text-primary'
                : 'border-border text-muted hover:text-text'
            )}
          >
            <BookOpenCheck size={14} />
            <span className="hidden md:inline">我的日程</span>
          </button>

          {currentId ? (
            <IconButton title="清空当前对话" onClick={clearCurrent}>
              <Eraser size={16} />
            </IconButton>
          ) : null}
        </header>

        {/* 消息区 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
          {messages.length === 0 && !streamText ? (
            <div className="mx-auto max-w-2xl">
              <div className="rounded-2xl border border-border bg-surface p-6 text-center">
                <Bot size={26} className="mx-auto mb-3 text-primary" />
                <h3 className="text-[15px] font-semibold text-text">开始一段新对话</h3>
                <p className="mt-1.5 text-[13px] text-muted">
                  当前模型：<span className="font-mono">{activeCfg.model}</span>（{activeCfg.providerName}）
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {['帮我解释一下这段报错', '写一个 Python 读取 CSV 的例子', '整理我的导航分类'].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-primary hover:text-text"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                copied={copiedId === m.id}
                onCopy={() => copy(m)}
              />
            ))}

            {streamText ? (
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg">
                  <Bot size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <Markdown content={streamText} />
                  <div className="mt-1 flex items-center gap-2 text-[11.5px] text-faint">
                    <Spinner className="h-3 w-3" /> 正在生成…
                  </div>
                </div>
              </div>
            ) : null}

            {lastError ? (
              <div className="rounded-xl border border-danger/40 bg-danger-soft px-3.5 py-3 text-[13px] text-danger">
                <div className="flex items-center gap-1.5 font-medium">
                  <TriangleAlert size={15} /> {lastError.title}
                </div>
                <div className="mt-1 break-words opacity-90">{lastError.message}</div>
                {lastError.hint ? <div className="mt-1 opacity-80">建议：{lastError.hint}</div> : null}
                <div className="mt-2.5 flex gap-2">
                  <Button size="sm" variant="outline" onClick={retry}>
                    <RefreshCw size={13} /> 重试
                  </Button>
                  <Link to="/ai">
                    <Button size="sm" variant="ghost">
                      检查配置
                    </Button>
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* 输入区 */}
        <div className="border-t border-border bg-surface/80 px-4 py-3 backdrop-blur md:px-6">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send(input)
                  }
                }}
                rows={1}
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-text placeholder:text-faint outline-none"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const t = e.currentTarget
                  t.style.height = 'auto'
                  t.style.height = `${Math.min(t.scrollHeight, 160)}px`
                }}
              />
              {busy ? (
                <Button variant="danger" onClick={stop} className="shrink-0">
                  <Square size={14} /> 停止
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => void send(input)}
                  disabled={!input.trim()}
                  className="shrink-0"
                >
                  <Send size={15} /> 发送
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-faint">
              回答由你配置的模型生成，可能存在错误，请自行核实。当前使用：{activeCfg.providerName} · {activeCfg.model}
            </p>
          </div>
        </div>
      </div>

      <NavAssistantModal open={showNavAssistant} onClose={() => setShowNavAssistant(false)} />
    </div>
  )
}

/* ------------------------------- 消息气泡 ------------------------------- */

function MessageBubble({
  message,
  copied,
  onCopy,
}: {
  message: ChatMessage
  copied: boolean
  onCopy: () => void
}) {
  const isUser = message.role === 'user'
  const isError = message.status === 'error'

  if (isUser) {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-[14px] leading-relaxed text-primary-fg whitespace-pre-wrap break-words">
          {message.content}
        </div>
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
          <UserIcon size={15} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg">
        <Bot size={15} />
      </div>
      <div className="group min-w-0 flex-1">
        <Markdown content={message.content} />
        <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-faint">
          {message.model ? <span className="font-mono">{message.model}</span> : null}
          {message.status === 'stopped' ? <Badge tone="warning">已停止</Badge> : null}
          {isError ? <Badge tone="danger">出错</Badge> : null}
          <button
            onClick={onCopy}
            className="flex items-center gap-1 opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  )
}
