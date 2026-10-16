/** 本地数据层：Dexie(IndexedDB) + 会话内存密钥 + 首次示例数据 */
import Dexie, { type Table } from 'dexie'
import type {
  AIConfig,
  AppSettings,
  Category,
  ChatMessage,
  Conversation,
  MemoNote,
  Site,
  TimetableMeta,
  Todo,
} from './types'

export class AppDB extends Dexie {
  categories!: Table<Category, string>
  sites!: Table<Site, string>
  aiConfigs!: Table<AIConfig, string>
  conversations!: Table<Conversation, string>
  messages!: Table<ChatMessage, string>
  settings!: Table<{ key: string; value: unknown }, string>
  timetable!: Table<TimetableMeta, string>
  memos!: Table<MemoNote, string>
  todos!: Table<Todo, string>

  constructor() {
    super('zhixu-workbench')
    this.version(1).stores({
      categories: 'id, order',
      sites: 'id, categoryId, order, favorite, pinned',
      aiConfigs: 'id, providerId, createdAt',
      conversations: 'id, updatedAt, kind',
      messages: 'id, conversationId, createdAt',
      settings: 'key',
    })
    // v2：新增课表与日程备忘
    this.version(2).stores({
      categories: 'id, order',
      sites: 'id, categoryId, order, favorite, pinned',
      aiConfigs: 'id, providerId, createdAt',
      conversations: 'id, updatedAt, kind',
      messages: 'id, conversationId, createdAt',
      settings: 'key',
      timetable: 'id',
      memos: 'id, date, done, createdAt',
    })
    // v3：新增待办（有截止日期、跨天关注，区别于按天的日程）
    this.version(3).stores({
      categories: 'id, order',
      sites: 'id, categoryId, order, favorite, pinned',
      aiConfigs: 'id, providerId, createdAt',
      conversations: 'id, updatedAt, kind',
      messages: 'id, conversationId, createdAt',
      settings: 'key',
      timetable: 'id',
      memos: 'id, date, done, createdAt',
      todos: 'id, due, done, createdAt',
    })
  }
}

export const db = new AppDB()

/* ------------------------- 设置读写 ------------------------- */

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  layout: {
    showHero: true,
    showSearch: true,
    showQuickFilter: true,
    showStats: true,
    showDashboard: true,
    showTodayCourses: true,
    showTodos: true,
    showMemoCalendar: true,
    showWeather: true,
    cardSize: 'md',
    columns: 'auto',
    groupByCategory: true,
    compact: false,
  },
}

/**
 * 读取设置。
 * ⚠️ layout 必须深合并：旧版本存下的设置里没有新增的开关字段（如 showWeather），
 * 浅合并会得到 undefined，新加的模块就会被判为「隐藏」而永远不显示。
 */
export async function getSettings(): Promise<AppSettings> {
  const row = await db.settings.get('app')
  if (!row) return structuredClone(DEFAULT_SETTINGS)
  const stored = (row.value ?? {}) as Partial<AppSettings>
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    layout: { ...DEFAULT_SETTINGS.layout, ...(stored.layout ?? {}) },
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const cur = await getSettings()
  const next: AppSettings = {
    ...cur,
    ...patch,
    layout: { ...cur.layout, ...(patch.layout ?? {}) },
  }
  await db.settings.put({ key: 'app', value: next })
}

/* ----------------- 会话级密钥（persistKey=false） ----------------- */

const sessionKeys = new Map<string, string>()

export function setSessionKey(configId: string, key: string) {
  if (key) sessionKeys.set(configId, key)
  else sessionKeys.delete(configId)
}
export function getSessionKey(configId: string): string {
  return sessionKeys.get(configId) ?? ''
}
/** 取出配置的真实 Key（区分是否持久化） */
export function resolveApiKey(cfg: AIConfig): string {
  return cfg.persistKey ? cfg.apiKey : getSessionKey(cfg.id)
}
/** 写入前处理：不持久化时把 Key 剥离出落库对象 */
export function stripKeyForStorage(cfg: AIConfig): AIConfig {
  if (cfg.persistKey) return cfg
  setSessionKey(cfg.id, cfg.apiKey)
  return { ...cfg, apiKey: '' }
}

/* ------------------------- 示例数据 ------------------------- */

const SAMPLE: { categories: Category[]; sites: Site[] } = (() => {
  const now = Date.now()
  const cats: Category[] = [
    { id: 'cat-study', name: '学习', icon: 'GraduationCap', color: '#6366f1', order: 0, createdAt: now },
    { id: 'cat-dev', name: '开发', icon: 'Code2', color: '#10b981', order: 1, createdAt: now },
    { id: 'cat-life', name: '生活', icon: 'Coffee', color: '#f59e0b', order: 2, createdAt: now },
  ]
  const mk = (
    id: string,
    title: string,
    url: string,
    categoryId: string,
    order: number,
    pinned = false,
    favorite = false
  ): Site => ({
    id,
    title,
    url,
    categoryId,
    order,
    pinned,
    favorite,
    createdAt: now,
    opens: 0,
  })
  const sites: Site[] = [
    mk('s-github', 'GitHub', 'https://github.com', 'cat-dev', 0, true, true),
    mk('s-mdn', 'MDN 文档', 'https://developer.mozilla.org', 'cat-dev', 1),
    mk('s-stack', 'Stack Overflow', 'https://stackoverflow.com', 'cat-dev', 2),
    mk('s-vite', 'Vite', 'https://vitejs.dev', 'cat-dev', 3),
    mk('s-npm', 'npm', 'https://www.npmjs.com', 'cat-dev', 4),
    mk('s-mooc', '中国大学MOOC', 'https://www.icourse163.org', 'cat-study', 0, false, true),
    mk('s-arxiv', 'arXiv', 'https://arxiv.org', 'cat-study', 1),
    mk('s-wiki', '维基百科', 'https://zh.wikipedia.org', 'cat-study', 2),
    mk('s-news', '少数派', 'https://sspai.com', 'cat-life', 0),
    mk('s-weather', '中国天气网', 'https://www.weather.com.cn', 'cat-life', 1),
  ]
  return { categories: cats, sites }
})()

/** 首次运行写入示例数据（已有数据则跳过）。用单例 Promise 防止 StrictMode 下重复执行 */
let seedPromise: Promise<void> | null = null
export function seedIfEmpty(): Promise<void> {
  if (!seedPromise) seedPromise = doSeed()
  return seedPromise
}

async function doSeed(): Promise<void> {
  const seeded = await db.settings.get('seeded')
  const count = await db.sites.count()
  if (seeded || count > 0) return
  await db.transaction('rw', db.categories, db.sites, db.settings, async () => {
    const again = await db.settings.get('seeded')
    const rows = await db.sites.count()
    if (again || rows > 0) return
    await db.categories.bulkPut(SAMPLE.categories)
    await db.sites.bulkPut(SAMPLE.sites)
    await db.settings.put({ key: 'seeded', value: true })
  })
}

/** 清空全部本地数据（危险操作，调用方需二次确认） */
export async function wipeAll(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.categories,
      db.sites,
      db.aiConfigs,
      db.conversations,
      db.messages,
      db.settings,
      db.timetable,
      db.memos,
      db.todos,
    ],
    async () => {
      await Promise.all([
        db.categories.clear(),
        db.sites.clear(),
        db.aiConfigs.clear(),
        db.conversations.clear(),
        db.messages.clear(),
        db.settings.clear(),
        db.timetable.clear(),
        db.memos.clear(),
        db.todos.clear(),
      ])
    }
  )
  sessionKeys.clear()
}
