/** AI 请求适配层：把「配置」翻译成具体的 URL / 请求头 / 请求体 */
import type { AIConfig, ChatMessage } from '../types'

/** 拼接 baseUrl 与相对路径，避免出现双斜杠或漏斜杠 */
export function joinUrl(baseUrl: string, path: string): string {
  const b = (baseUrl || '').replace(/\/+$/, '')
  const p = (path || '').replace(/^\/+/, '')
  return p ? `${b}/${p}` : b
}

export function buildHeaders(cfg: AIConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
  }
  const key = apiKey.trim()
  if (cfg.authStyle === 'bearer' && key) {
    headers['Authorization'] = `Bearer ${key}`
  } else if (cfg.authStyle === 'api-key-header' && key) {
    headers[cfg.authHeaderName || 'api-key'] = key
  } else if (cfg.authStyle === 'x-api-key' && key) {
    headers['x-api-key'] = key
  }
  // 额外自定义头（如 OpenRouter 的 HTTP-Referer / X-Title）
  if (cfg.extraHeaders) {
    for (const [k, v] of Object.entries(cfg.extraHeaders)) {
      if (k && typeof v === 'string') headers[k] = v
    }
  }
  return headers
}

export function chatUrl(cfg: AIConfig): string {
  return joinUrl(cfg.baseUrl, cfg.chatPath || '/chat/completions')
}

export function modelsUrl(cfg: AIConfig): string {
  const path = cfg.modelsPath ?? '/models'
  return joinUrl(cfg.baseUrl, path)
}

/** 构造 OpenAI 兼容的聊天请求体 */
export function buildChatBody(cfg: AIConfig, messages: ChatMessage[], stream: boolean) {
  return {
    model: cfg.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: cfg.params.temperature,
    top_p: cfg.params.topP,
    max_tokens: cfg.params.maxTokens,
    stream,
  }
}

/** 经本地代理发送（解决跨域 + 隔离密钥） */
export const PROXY_ENDPOINT = '/api/ai/request'

/**
 * 直连模式（部署版专用）。
 * 用 `VITE_DIRECT=1` 构建时启用：跳过本地代理，由浏览器直接请求用户自己配置的服务商地址。
 * 适用前提：服务商支持浏览器跨域（CORS），例如 NVIDIA NIM、OpenAI、OpenRouter、Together 等。
 * BYOK 的 Key 本就只存在于用户浏览器，直连不会使密钥流向任何第三方。
 */
export const IS_DIRECT = import.meta.env.VITE_DIRECT === true || import.meta.env.VITE_DIRECT === '1'

export interface ProxyRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

export function proxyFetch(payload: ProxyRequest, signal?: AbortSignal): Promise<Response> {
  // 直连模式：直接打服务商地址（与本地代理行为一致，上层已负责解析 SSE/JSON）
  if (IS_DIRECT) {
    const headers: Record<string, string> = { ...(payload.headers || {}) }
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
    const method = (payload.method ?? 'POST').toUpperCase()
    const body =
      payload.body === undefined || payload.body === null || method === 'GET' || method === 'HEAD'
        ? undefined
        : typeof payload.body === 'string'
          ? payload.body
          : JSON.stringify(payload.body)
    return fetch(payload.url, { method, headers, body, signal })
  }

  return fetch(PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
}
