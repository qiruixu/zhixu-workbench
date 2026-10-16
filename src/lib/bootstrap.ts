/**
 * 本地引导配置
 *
 * 用途：让「任何浏览器」首次打开本应用时，AI 配置就已经就绪，无需手动录入。
 *
 * 原理：配置由本机后端从 `.local/ai-config.json` 下发（服务只监听 127.0.0.1），
 * 前端在启动时拉取并写入本地库。
 *
 * 安全与边界：
 *  - 只有当本地库「一条 AI 配置都没有」时才自动写入，绝不覆盖用户已有的配置。
 *  - 用文件指纹记录已应用状态：用户手动删除后不会被反复恢复。
 *  - 该文件含明文密钥，已在 .gitignore 中排除，且不随导航/聊天导出。
 */
import { db } from './db'
import { getProvider, mergeModels } from './providers'
import type { AIConfig } from './types'
import { uid } from './utils'

export interface BootstrapConfigItem {
  name?: string
  providerId?: string
  baseUrl?: string
  chatPath?: string
  modelsPath?: string
  authStyle?: AIConfig['authStyle']
  authHeaderName?: string
  apiKey?: string
  model?: string
  models?: string[]
  params?: Partial<AIConfig['params']>
  persistKey?: boolean
  stream?: boolean
  extraHeaders?: Record<string, string>
}

export interface BootstrapFile {
  activeConfigName?: string
  configs?: BootstrapConfigItem[]
}

export interface BootstrapResult {
  applied: boolean
  created: number
  reason?: 'no-file' | 'already-applied' | 'has-existing-config' | 'network-error' | 'invalid'
}

const FINGERPRINT_KEY = 'bootstrapApplied'

function toAIConfig(item: BootstrapConfigItem, presetFallbackId: string): AIConfig | null {
  const providerId = item.providerId || presetFallbackId || 'custom'
  const preset = getProvider(providerId)
  if (!item.baseUrl && !preset?.baseUrl) return null
  if (!item.model) return null

  const models = mergeModels(preset?.models ?? [], item.models ?? [], '')
  return {
    id: uid('ai-'),
    name: item.name?.trim() || preset?.name || '本地配置',
    providerId,
    providerName: preset?.name ?? item.name ?? '自定义',
    baseUrl: item.baseUrl || preset?.baseUrl || '',
    chatPath: item.chatPath || preset?.chatPath || '/chat/completions',
    modelsPath: item.modelsPath ?? preset?.modelsPath,
    authStyle: item.authStyle ?? preset?.authStyle ?? 'bearer',
    authHeaderName: item.authHeaderName ?? preset?.authHeaderName,
    apiKey: item.apiKey ?? '',
    persistKey: item.persistKey ?? true,
    model: item.model,
    models: models.includes(item.model) ? models : [item.model, ...models],
    params: {
      temperature: item.params?.temperature ?? preset?.defaultParams.temperature ?? 0.7,
      maxTokens: item.params?.maxTokens ?? preset?.defaultParams.maxTokens ?? 4096,
      topP: item.params?.topP ?? preset?.defaultParams.topP ?? 1,
    },
    stream: item.stream ?? true,
    extraHeaders: item.extraHeaders,
    createdAt: Date.now(),
    source: 'bootstrap',
  }
}

/** 启动时尝试应用本地引导配置。任何异常都静默降级，不影响应用使用。 */
export async function applyBootstrap(): Promise<BootstrapResult> {
  let payload: { ok?: boolean; fingerprint?: string; config?: BootstrapFile }
  try {
    const res = await fetch('/api/bootstrap', { headers: { Accept: 'application/json' } })
    if (!res.ok) return { applied: false, created: 0, reason: 'network-error' }
    payload = await res.json()
  } catch {
    return { applied: false, created: 0, reason: 'network-error' }
  }

  if (!payload?.ok || !payload.config) return { applied: false, created: 0, reason: 'no-file' }

  const fingerprint = payload.fingerprint || 'v1'
  const row = await db.settings.get(FINGERPRINT_KEY)
  if (row?.value === fingerprint) return { applied: false, created: 0, reason: 'already-applied' }

  // 关键：绝不覆盖用户已有配置
  const existing = await db.aiConfigs.count()
  if (existing > 0) {
    await db.settings.put({ key: FINGERPRINT_KEY, value: fingerprint })
    return { applied: false, created: 0, reason: 'has-existing-config' }
  }

  const items = Array.isArray(payload.config.configs) ? payload.config.configs : []
  const built = items
    .map((it) => toAIConfig(it, 'custom'))
    .filter((c): c is AIConfig => c !== null)
  if (built.length === 0) {
    await db.settings.put({ key: FINGERPRINT_KEY, value: fingerprint })
    return { applied: false, created: 0, reason: 'invalid' }
  }

  await db.transaction('rw', db.aiConfigs, db.settings, async () => {
    await db.aiConfigs.bulkPut(built)
    await db.settings.put({ key: FINGERPRINT_KEY, value: fingerprint })
  })

  // 指定默认（当前使用）配置
  const wanted = payload.config.activeConfigName?.trim()
  const active = (wanted && built.find((c) => c.name === wanted)) || built[0]
  await db.settings.put({ key: 'activeAIConfigId', value: active.id })

  return { applied: true, created: built.length }
}
