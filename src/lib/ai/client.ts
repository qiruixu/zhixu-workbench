/** AI 调用客户端：模型列表 / 连接测试 / 流式对话（全部经本地代理转发） */
import type { AIConfig, ChatMessage } from '../types'
import { buildChatBody, buildHeaders, chatUrl, modelsUrl, proxyFetch } from './adapter'
import { filterModels } from '../providers'
import { classifyError, classifyThrown, makeError, type AIError } from './errors'

export interface FetchModelsResult {
  models: string[]
  raw: unknown
}

/** 拉取模型列表（GET /models）；返回值已经按服务商策略过滤过（例如 NVIDIA 只留对话模型） */
export async function fetchModels(cfg: AIConfig, apiKey: string): Promise<FetchModelsResult> {
  const res = await proxyFetch(
    { url: modelsUrl(cfg), method: 'GET', headers: buildHeaders(cfg, apiKey) },
    undefined
  )
  const text = await res.text()
  if (!res.ok) throw classifyError(res.status, text)
  let raw: unknown = null
  try {
    raw = JSON.parse(text)
  } catch {
    throw makeError('bad_request', '模型列表返回的不是合法 JSON')
  }
  const arr = (raw as { data?: unknown })?.data
  const all: string[] = Array.isArray(arr)
    ? arr
        .map((m) => (typeof m === 'string' ? m : (m as { id?: string })?.id))
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
    : []
  return { models: filterModels(cfg.providerId, all), raw }
}

export interface TestResult {
  ok: boolean
  models?: string[]
  error?: AIError
  /** 通过哪种方式验证成功 */
  via?: 'models' | 'chat'
}

/**
 * 连接测试：
 *  1) 优先 GET /models（最省额度、最能暴露地址/鉴权问题）
 *  2) 若服务商不提供 /models（404/405），退化为一次极小的 chat 请求
 */
export async function testConnection(
  cfg: AIConfig,
  apiKey: string,
  signal?: AbortSignal
): Promise<TestResult> {
  if (!cfg.baseUrl) {
    return { ok: false, error: makeError('bad_url', 'Base URL 为空') }
  }
  if (cfg.authStyle !== 'none' && !apiKey.trim()) {
    return { ok: false, error: makeError('unauthorized', '未填写 API Key') }
  }

  try {
    const { models } = await fetchModels(cfg, apiKey)
    return { ok: true, models, via: 'models' }
  } catch (err) {
    const e = err as AIError
    // 地址/鉴权类错误直接返回；仅在「接口不支持」时退化
    const retriable = e?.type === 'bad_url' || e?.type === 'server_error' || e?.type === 'unknown'
    if (!retriable) return { ok: false, error: e }
  }

  try {
    const res = await proxyFetch(
      {
        url: chatUrl(cfg),
        method: 'POST',
        headers: buildHeaders(cfg, apiKey),
        body: {
          model: cfg.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 8,
          stream: false,
        },
      },
      signal
    )
    const text = await res.text()
    if (!res.ok) return { ok: false, error: classifyError(res.status, text) }
    return { ok: true, via: 'chat' }
  } catch (err) {
    return { ok: false, error: classifyThrown(err) }
  }
}

export interface StreamHandlers {
  onDelta: (chunk: string) => void
  onDone: (fullText: string) => void
  onError: (err: AIError) => void
}

/**
 * 流式对话。解析 OpenAI 兼容的 SSE。
 * 若服务端忽略 stream 返回普通 JSON，也做兼容处理。
 */
export async function streamChat(
  cfg: AIConfig,
  apiKey: string,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<void> {
  if (!cfg.baseUrl) {
    handlers.onError(makeError('bad_url', 'Base URL 为空'))
    return
  }
  if (cfg.authStyle !== 'none' && !apiKey.trim()) {
    handlers.onError(makeError('unauthorized', '未填写 API Key'))
    return
  }
  if (!cfg.model) {
    handlers.onError(makeError('model_not_found', '未选择模型'))
    return
  }

  let res: Response
  try {
    res = await proxyFetch(
      {
        url: chatUrl(cfg),
        method: 'POST',
        headers: buildHeaders(cfg, apiKey),
        body: buildChatBody(cfg, messages, true),
      },
      signal
    )
  } catch (err) {
    handlers.onError(classifyThrown(err))
    return
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    handlers.onError(classifyError(res.status, text))
    return
  }

  const contentType = res.headers.get('content-type') || ''

  // 服务端忽略了 stream，直接返回普通 JSON —— 这里必须兼容，否则会拿到空内容
  if (!contentType.includes('event-stream')) {
    const text = await res.text()
    const whole = extractWholeContent(text)
    if (whole !== null) {
      handlers.onDelta(whole)
      handlers.onDone(whole)
      return
    }
    // 某些网关会以非标准 content-type 返回 SSE，退化为一次性解析
    const buffered = extractSseBuffer(text)
    if (buffered) {
      handlers.onDelta(buffered)
      handlers.onDone(buffered)
      return
    }
    handlers.onError(makeError('bad_request', '无法解析服务端返回内容'))
    return
  }

  if (!res.body) {
    handlers.onError(makeError('bad_request', '服务端未返回响应体'))
    return
  }

  let acc = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json?.choices?.[0]?.delta
          const piece = delta?.content
          if (typeof piece === 'string' && piece) {
            acc += piece
            handlers.onDelta(piece)
          }
          // 非流式风格的整体返回
          const whole = json?.choices?.[0]?.message?.content
          if (typeof whole === 'string' && whole && whole !== acc) {
            acc = whole
            handlers.onDelta(whole)
          }
        } catch {
          /* 单条解析失败忽略 */
        }
      }
    }
    handlers.onDone(acc)
  } catch (err) {
    const e = err as { name?: string }
    if (e?.name === 'AbortError') {
      handlers.onDone(acc) // 停止生成：保留已收到的内容
    } else {
      handlers.onError(classifyThrown(err))
    }
  }
}

/** 从「非流式」JSON 响应中取出正文；无法解析时返回 null */
function extractWholeContent(text: string): string | null {
  try {
    const json = JSON.parse(text)
    if (json?.error) return null
    const c = json?.choices?.[0]?.message?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) {
      return c.map((p: { text?: string }) => p?.text ?? '').join('')
    }
    return null
  } catch {
    return null
  }
}

/** 兜底：把整段文本按 SSE 逐行解析出正文 */
function extractSseBuffer(text: string): string {
  let acc = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const j = JSON.parse(data)
      const piece = j?.choices?.[0]?.delta?.content
      if (typeof piece === 'string') acc += piece
    } catch {
      /* 忽略无法解析的行 */
    }
  }
  return acc
}
