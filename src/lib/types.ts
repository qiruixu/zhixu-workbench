/** 智序工作台 · 全局类型定义 */

export type ThemeMode = 'light' | 'dark' | 'system'

/** 分类 */
export interface Category {
  id: string
  name: string
  /** 预设图标名（lucide 图标 key） */
  icon?: string
  /** 强调色（十六进制） */
  color?: string
  order: number
  createdAt: number
}

/** 网站 */
export interface Site {
  id: string
  title: string
  url: string
  /** 自定义图标地址；为空时自动取 favicon */
  iconUrl?: string
  categoryId?: string | null
  order: number
  favorite: boolean
  pinned: boolean
  description?: string
  createdAt: number
  /** 打开次数（用于「常用」排序） */
  opens: number
}

/** 首页布局偏好 */
export interface LayoutSettings {
  showHero: boolean
  showSearch: boolean
  showQuickFilter: boolean
  showStats: boolean
  /** 面板带：今日课程 + 日历备忘 + 天气 */
  showDashboard: boolean
  showTodayCourses: boolean
  showMemoCalendar: boolean
  showWeather: boolean
  cardSize: 'sm' | 'md' | 'lg'
  columns: 'auto' | 2 | 3 | 4 | 5 | 6
  groupByCategory: boolean
  compact: boolean
}

/** 应用设置 */
export interface AppSettings {
  theme: ThemeMode
  layout: LayoutSettings
}

/** 鉴权风格 */
export type AuthStyle = 'bearer' | 'api-key-header' | 'x-api-key' | 'none'

/** 模型列表的过滤策略（用于从 /models 的全量返回里筛出「能用来对话」的模型） */
export type ModelFilterPolicy = 'none' | 'chat-only'

/** 服务商预设（集中管理，便于后续更新） */
export interface ProviderPreset {
  id: string
  name: string
  /** 品牌基调色，用于卡片点缀 */
  accent: string
  baseUrl: string
  /** 聊天补全路径（相对 baseUrl） */
  chatPath: string
  /** 模型列表路径；无则留空 */
  modelsPath?: string
  authStyle: AuthStyle
  /** api-key-header / x-api-key 时使用的头名 */
  authHeaderName?: string
  /** 推荐模型（兜底，可能过期；实际优先动态拉取） */
  models: string[]
  defaultParams: ModelParams
  docsUrl?: string
  /** 是否已在本机实测通过（未实测一律 false，UI 显示「待验证」） */
  verified: boolean
  note?: string
  /** 拉取模型列表时的过滤策略；缺省视为 'none' */
  modelFilter?: ModelFilterPolicy
  /** 模型列表是否自带「命名空间/模型」分组（如 NVIDIA 的 owned_by） */
  groupByNamespace?: boolean
}

export interface ModelParams {
  temperature: number
  maxTokens: number
  topP: number
}

/** 一条 AI 配置（多配置管理） */
export interface AIConfig {
  id: string
  /** 配置的显示名，如「DeepSeek · 主力」 */
  name: string
  providerId: string
  providerName: string
  baseUrl: string
  chatPath: string
  modelsPath?: string
  authStyle: AuthStyle
  authHeaderName?: string
  apiKey: string
  /** 是否把 Key 持久化到本地；false 时仅本次会话内存保存 */
  persistKey: boolean
  model: string
  /** 已知模型列表（动态拉取 + 预设合并） */
  models: string[]
  params: ModelParams
  /** 是否流式 */
  stream: boolean
  /** 自定义额外请求头（JSON 字符串或对象） */
  extraHeaders?: Record<string, string>
  createdAt: number
  lastTestedAt?: number
  lastTestResult?: 'ok' | 'fail'
  /** 来源：手动添加 / 由本地引导配置自动写入 */
  source?: 'manual' | 'bootstrap'
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  conversationId: string
  role: ChatRole
  content: string
  createdAt: number
  model?: string
  providerName?: string
  status?: 'streaming' | 'done' | 'error' | 'stopped'
  error?: string
}

export interface Conversation {
  id: string
  title: string
  aiConfigId: string | null
  providerName: string
  model: string
  createdAt: number
  updatedAt: number
  /** 是否为「导航助手」专用会话 */
  kind?: 'chat' | 'nav'
}

/* ------------------ 导入 / 导出 ------------------ */

export interface NavExport {
  kind: 'zhixu-nav'
  version: 1
  exportedAt: number
  categories: Category[]
  sites: Site[]
  /** 注意：绝不包含任何 API Key 或 AI 配置 */
}

export interface ChatExport {
  kind: 'zhixu-chat'
  version: 1
  exportedAt: number
  conversations: Conversation[]
  messages: ChatMessage[]
  /** 注意：绝不包含任何 API Key */
}

/* ------------------ AI 导航联动 ------------------ */

export type NavSuggestionOp =
  | { op: 'createCategory'; name: string; color?: string; icon?: string }
  | { op: 'assignCategory'; siteId: string; siteTitle: string; categoryName: string }
  | { op: 'mergeCategories'; from: string[]; into: string; reason?: string }
  | { op: 'updateSite'; siteId: string; siteTitle: string; title?: string; description?: string }
  | { op: 'deleteCategory'; name: string; reason?: string }

export interface NavSuggestion {
  summary: string
  ops: NavSuggestionOp[]
}

/* ------------------ 课表 / 日程备忘 ------------------ */

/** 一节课 */
export interface Course {
  id: string
  name: string
  /** 课程编号（部分教务导出会带上，如 03001710） */
  code?: string
  /** 1=周一 … 7=周日 */
  weekday: number
  /** 所属大节标签，如「第一大节」 */
  section?: string
  /** 节次序号，如 [1,2,3] */
  periods: number[]
  /** 展示用节次文案，如「第1-3节」 */
  periodLabel: string
  /** 周次原文，如「1-7,10-11,14-16」 */
  weeks?: string
  /** 周次展开后的周序号，用于按周筛选（已按单双周过滤） */
  weekNumbers: number[]
  /** 单/双周标记 */
  parity?: 'odd' | 'even'
  location?: string
  teacher?: string
  /** 单元格内的附加说明，如「(匹克球)」 */
  note?: string
  /** 单元格原始文本，便于核对 */
  raw?: string
}

/** 周次锚点：记录「某天是第几周」，之后按自然周自动向后推进 */
export interface WeekAnchor {
  /** 锚定当天的周次 */
  week: number
  /** 锚定日期 YYYY-MM-DD */
  onDate: string
}

/** 一份导入的课表 */
export interface TimetableMeta {
  /** 单例记录，固定 key */
  id: 'current'
  fileName?: string
  importedAt: number
  /** 文件真实格式（用于界面上说明解析来源） */
  sourceFormat?: 'sheet' | 'rtf' | 'pdf' | 'docx' | 'ics'
  /** 表头解析出的标题（学校/姓名） */
  title?: string
  studentId?: string
  /** 学年学期，如 2026-2027学年 第1学期 */
  semester?: string
  /** 开学第一周周一（YYYY-MM-DD）。表格类由用户设定或自动推断；日历（.ics）类按课程日期自动推算 */
  semesterStart?: string
  /**
   * 「当前第几周」是怎么来的——用于界面上如实说明（自动定位？手动校准？日历推算？）
   * 没有该字段表示老数据/尚未定位。
   */
  weekAuto?: {
    source: 'calendar' | 'semester' | 'auto' | 'manual'
    confidence: 'high' | 'medium' | 'low'
    note: string
    at: number
  }
  /** 解析时的 sheet 名 */
  sheetName: string
  weekdays: string[]
  /** 节次 → 时间（课表文件未包含时为 空） */
  periodTimes: Record<string, string>
  courses: Course[]
  /** 表尾「备注」中的其他安排（如课程设计） */
  remarks: string[]
  /** 解析过程中的提示（未识别到的信息等） */
  warnings: string[]
  /** 原始表格（截断保存，便于核对） */
  rawRows: string[][]
}

/** 日程备忘 */
export interface MemoNote {
  id: string
  /** YYYY-MM-DD */
  date: string
  text: string
  done: boolean
  /** 可选标记色 */
  color?: string
  createdAt: number
  updatedAt: number
}
