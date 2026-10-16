/** AI 配置仓库：创建 / 保存 / 删除 / 切换 */
import { db, setSessionKey, stripKeyForStorage } from './db'
import { CUSTOM_PROVIDER_ID, filterModels, getProvider, mergeModels } from './providers'
import type { AIConfig } from './types'
import { uid } from './utils'

/** 以预设为模板生成一份新的配置草稿（未落库） */
export function draftFromProvider(providerId: string): AIConfig {
  const preset = getProvider(providerId)
  const isCustom = providerId === CUSTOM_PROVIDER_ID
  const presetModels = filterModels(providerId, preset?.models ?? [])
  return {
    id: uid('ai-'),
    name: preset?.name ?? '新配置',
    providerId,
    providerName: preset?.name ?? '自定义',
    baseUrl: preset?.baseUrl ?? '',
    chatPath: preset?.chatPath ?? '/chat/completions',
    modelsPath: preset?.modelsPath ?? '/models',
    authStyle: preset?.authStyle ?? 'bearer',
    authHeaderName: preset?.authHeaderName,
    apiKey: '',
    persistKey: true,
    model: presetModels[0] ?? '',
    models: presetModels,
    params: preset?.defaultParams
      ? { ...preset.defaultParams }
      : { temperature: 0.7, maxTokens: 2048, topP: 1 },
    stream: true,
    createdAt: Date.now(),
    lastTestResult: undefined,
  }
}

/** 保存（自动处理「不持久化密钥」的情形） */
export async function saveConfig(cfg: AIConfig): Promise<void> {
  await db.aiConfigs.put(stripKeyForStorage(cfg))
}

export async function deleteConfig(id: string): Promise<void> {
  await db.aiConfigs.delete(id)
  // 解除会话密钥
  setSessionKey(id, '')
}

export async function duplicateConfig(id: string): Promise<AIConfig | null> {
  const cur = await db.aiConfigs.get(id)
  if (!cur) return null
  const copy: AIConfig = {
    ...cur,
    id: uid('ai-'),
    name: `${cur.name} 副本`,
    apiKey: '', // 出于安全，不复制密钥
    createdAt: Date.now(),
    lastTestResult: undefined,
  }
  await db.aiConfigs.put(copy)
  return copy
}

export async function markTestResult(id: string, ok: boolean): Promise<void> {
  const cur = await db.aiConfigs.get(id)
  if (!cur) return
  await db.aiConfigs.put({ ...cur, lastTestedAt: Date.now(), lastTestResult: ok ? 'ok' : 'fail' })
}

/** 把动态拉取到的模型合并进配置（拉取结果已在 client 层按服务商过滤过） */
export function withFetchedModels(cfg: AIConfig, fetched: string[], manual = ''): AIConfig {
  const presetModels = filterModels(cfg.providerId, getProvider(cfg.providerId)?.models ?? [])
  const models = mergeModels(presetModels, fetched, manual)
  return { ...cfg, models, model: cfg.model || models[0] || '' }
}
