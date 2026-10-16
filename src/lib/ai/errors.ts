/** 错误分类：把各种失败翻译成用户看得懂的中文提示 */

export type AIErrorType =
  | 'unauthorized'
  | 'forbidden'
  | 'model_not_found'
  | 'rate_limit'
  | 'insufficient_quota'
  | 'bad_url'
  | 'timeout'
  | 'aborted'
  | 'server_error'
  | 'bad_request'
  | 'network'
  | 'empty_config'
  | 'unknown'

export interface AIError {
  type: AIErrorType
  title: string
  message: string
  hint?: string
}

const TABLE: Record<AIErrorType, { title: string; hint?: string }> = {
  unauthorized: { title: 'API Key 无效或未授权', hint: '请检查 Key 是否复制完整、是否已过期或被禁用。' },
  forbidden: { title: '访问被拒绝', hint: 'Key 可能无该模型权限，或账号受限。' },
  model_not_found: { title: '模型不存在或不可用', hint: '请在模型列表中选择，或手动填写服务商当前有效的模型名。' },
  rate_limit: { title: '触发速率限制', hint: '请求过于频繁，稍后重试即可。' },
  insufficient_quota: { title: '余额不足 / 额度用尽', hint: '请到服务商控制台充值或更换 Key。' },
  bad_url: { title: 'API 地址错误', hint: '请核对 Base URL 是否正确（通常以 /v1 结尾）。' },
  timeout: { title: '请求超时', hint: '网络较慢或服务商无响应，可重试或更换服务商。' },
  aborted: { title: '已停止生成', hint: '' },
  server_error: { title: '服务商服务器错误', hint: '这是对方服务端问题，稍后重试。' },
  bad_request: { title: '请求参数错误', hint: '模型可能不支持某些参数，可尝试降低 max_tokens。' },
  network: { title: '网络连接失败', hint: '请检查网络、代理设置，或确认本地后端是否已启动。' },
  empty_config: { title: '尚未配置 AI', hint: '请先到「AI 配置」添加一个服务商并测试连接。' },
  unknown: { title: '未知错误', hint: '' },
}

export function makeError(type: AIErrorType, message: string): AIError {
  return { type, title: TABLE[type].title, message, hint: TABLE[type].hint }
}

/** 从 HTTP 状态码 + 响应文本推断错误类型 */
export function classifyError(status: number, bodyText: string): AIError {
  const text = (bodyText || '').slice(0, 600)
  const lower = text.toLowerCase()

  let type: AIErrorType = 'unknown'
  if (status === 401) type = 'unauthorized'
  else if (status === 403) type = 'forbidden'
  else if (status === 402) type = 'insufficient_quota'
  else if (status === 404) type = lower.includes('model') ? 'model_not_found' : 'bad_url'
  else if (status === 429) {
    type = /quota|balance|insufficient|exceeded your current quota/.test(lower)
      ? 'insufficient_quota'
      : 'rate_limit'
  } else if (status === 400) type = 'bad_request'
  else if (status === 408 || status === 504) type = 'timeout'
  else if (status >= 500) type = 'server_error'
  else if (status === 499) type = 'aborted'

  // 依据正文再兜底细化
  if (lower.includes('model') && /not exist|not found|invalid model|no such model|不存在/.test(lower)) {
    type = 'model_not_found'
  }
  if (/invalid_api_key|incorrect api key|api key not valid|invalid api key/.test(lower)) {
    type = 'unauthorized'
  }
  if (/insufficient|balance|quota|欠费|余额/.test(lower) && status !== 401) {
    if (status === 402 || status === 429) type = 'insufficient_quota'
  }

  return makeError(type, text || `HTTP ${status}`)
}

/** 网络层异常（fetch 抛错）统一处理 */
export function classifyThrown(err: unknown): AIError {
  const e = err as { name?: string; message?: string }
  if (e?.name === 'AbortError') return makeError('aborted', '请求已取消')
  const msg = e?.message || String(err)
  if (/failed to fetch|networkerror|load failed|err_connection|econnrefused/i.test(msg)) {
    return makeError('network', msg)
  }
  if (/timeout|timed out/i.test(msg)) return makeError('timeout', msg)
  return makeError('unknown', msg)
}
