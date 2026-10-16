/** 数据导入 / 导出 + 校验（导航数据与 AI 配置严格分离；导出绝不含 API Key） */
import { db } from './db'
import type { Category, ChatExport, Conversation, ChatMessage, NavExport, Site } from './types'
import { normalizeUrl, uid } from './utils'

/* ------------------------------ 导出 ------------------------------ */

/** 导出导航数据（只含分类与站点，不含任何 AI 配置与密钥） */
export async function buildNavExport(): Promise<NavExport> {
  const [categories, sites] = await Promise.all([
    db.categories.orderBy('order').toArray(),
    db.sites.orderBy('order').toArray(),
  ])
  return {
    kind: 'zhixu-nav',
    version: 1,
    exportedAt: Date.now(),
    categories,
    sites: sites.map((s) => ({ ...s })),
  }
}

/** 导出聊天记录（剥离一切可能与密钥相关的字段） */
export async function buildChatExport(): Promise<ChatExport> {
  const [conversations, messages] = await Promise.all([
    db.conversations.toArray(),
    db.messages.orderBy('createdAt').toArray(),
  ])
  return {
    kind: 'zhixu-chat',
    version: 1,
    exportedAt: Date.now(),
    conversations,
    messages: messages.map((m) => ({ ...m })),
  }
}

/* ------------------------------ 校验 ------------------------------ */

export interface ValidationResult<T> {
  ok: boolean
  error?: string
  data?: T
  stats?: { categories: number; sites: number }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function validateNavExport(input: unknown): ValidationResult<NavExport> {
  let obj: unknown = input
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input)
    } catch {
      return { ok: false, error: '文件不是合法 JSON，无法解析。' }
    }
  }
  if (!isObj(obj)) return { ok: false, error: '文件内容格式不正确（应为对象）。' }
  if (obj.kind !== 'zhixu-nav') {
    return { ok: false, error: '这不是「智序工作台」的导航配置文件（kind 不匹配）。' }
  }
  if (!Array.isArray(obj.categories) || !Array.isArray(obj.sites)) {
    return { ok: false, error: '缺少 categories 或 sites 字段。' }
  }
  if (obj.categories.length > 5000 || obj.sites.length > 20000) {
    return { ok: false, error: '数据量异常过大，已阻止导入。' }
  }

  const categories: Category[] = []
  for (const raw of obj.categories) {
    if (!isObj(raw) || typeof raw.name !== 'string' || !raw.name.trim()) continue
    categories.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('cat-'),
      name: raw.name.trim().slice(0, 40),
      icon: typeof raw.icon === 'string' ? raw.icon : undefined,
      color: typeof raw.color === 'string' ? raw.color : undefined,
      order: typeof raw.order === 'number' ? raw.order : categories.length,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    })
  }

  const catIds = new Set(categories.map((c) => c.id))
  const sites: Site[] = []
  for (const raw of obj.sites) {
    if (!isObj(raw) || typeof raw.url !== 'string' || !raw.url.trim()) continue
    const url = normalizeUrl(raw.url)
    const title =
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title.trim().slice(0, 60)
        : url
    const categoryId =
      typeof raw.categoryId === 'string' && catIds.has(raw.categoryId) ? raw.categoryId : null
    sites.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('site-'),
      title,
      url,
      iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : undefined,
      categoryId,
      order: typeof raw.order === 'number' ? raw.order : sites.length,
      favorite: Boolean(raw.favorite),
      pinned: Boolean(raw.pinned),
      description: typeof raw.description === 'string' ? raw.description : undefined,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      opens: typeof raw.opens === 'number' ? raw.opens : 0,
    })
  }

  if (categories.length === 0 && sites.length === 0) {
    return { ok: false, error: '文件中没有任何有效的分类或网站。' }
  }

  return {
    ok: true,
    data: { kind: 'zhixu-nav', version: 1, exportedAt: Date.now(), categories, sites },
    stats: { categories: categories.length, sites: sites.length },
  }
}

export function validateChatExport(input: unknown): ValidationResult<ChatExport> {
  let obj: unknown = input
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input)
    } catch {
      return { ok: false, error: '文件不是合法 JSON。' }
    }
  }
  if (!isObj(obj) || obj.kind !== 'zhixu-chat') {
    return { ok: false, error: '这不是智序工作台的聊天记录文件。' }
  }
  if (!Array.isArray(obj.conversations) || !Array.isArray(obj.messages)) {
    return { ok: false, error: '缺少 conversations 或 messages 字段。' }
  }
  return { ok: true, data: obj as unknown as ChatExport }
}

/* ------------------------------ 导入 ------------------------------ */

export interface ImportStats {
  addedCategories: number
  addedSites: number
  skippedSites: number
  mode: 'merge' | 'replace'
}

/**
 * 导入导航数据。
 * - merge（安全，默认）：按 URL 去重后追加，已存在的站点不覆盖；
 * - replace：清空后写入（调用方必须先二次确认）。
 * 无论哪种模式，都不会静默覆盖用户在合并模式下的数据。
 */
export async function applyNavImport(
  nav: NavExport,
  mode: 'merge' | 'replace'
): Promise<ImportStats> {
  const stats: ImportStats = { addedCategories: 0, addedSites: 0, skippedSites: 0, mode }

  await db.transaction('rw', db.categories, db.sites, async () => {
    if (mode === 'replace') {
      await db.categories.clear()
      await db.sites.clear()
    }

    const existingCats = await db.categories.toArray()
    const catByName = new Map(existingCats.map((c) => [c.name.toLowerCase(), c]))
    const idMap = new Map<string, string>() // 原分类 id -> 新库分类 id

    for (const c of nav.categories) {
      const hit = catByName.get(c.name.toLowerCase())
      if (hit) {
        idMap.set(c.id, hit.id)
        continue
      }
      const id = mode === 'replace' ? c.id : uid('cat-')
      await db.categories.put({ ...c, id, order: catByName.size })
      catByName.set(c.name.toLowerCase(), { ...c, id })
      idMap.set(c.id, id)
      stats.addedCategories++
    }

    let order = await db.sites.count()
    const existingUrls = new Set(
      (await db.sites.toArray()).map((s) => s.url.toLowerCase().replace(/\/+$/, ''))
    )

    for (const s of nav.sites) {
      const key = s.url.toLowerCase().replace(/\/+$/, '')
      if (mode === 'merge' && existingUrls.has(key)) {
        stats.skippedSites++
        continue
      }
      const id = mode === 'replace' ? s.id : uid('site-')
      const categoryId = s.categoryId ? (idMap.get(s.categoryId) ?? null) : null
      await db.sites.put({ ...s, id, categoryId, order: order++ })
      existingUrls.add(key)
      stats.addedSites++
    }
  })

  return stats
}
