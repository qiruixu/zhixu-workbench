/** AI 导航助手：构造提示词 + 解析结构化建议（受控，AI 只能提建议不能直接改数据） */
import type { ChatMessage, NavSuggestion } from '../types'
import { uid } from '../utils'
import type { NavSnapshot } from '../navOps'

const SYSTEM = `你是「智序工作台」的导航助手。用户持有一个个人网站导航（含分类与网站）。
你的任务：根据用户诉求，给出对导航的整理建议，或推荐新的网站。

严格要求：
1. 只输出一个 JSON 对象，不要输出任何解释文字、不要用 Markdown 代码块。
2. JSON 结构：
{
  "summary": "一句话概述你的建议",
  "ops": [ ...操作... ]
}
3. ops 数组中每个元素是以下之一（字段必须严格匹配）：
   - {"op":"createCategory","name":"分类名","color":"#6366f1","icon":"lucide图标名"}
   - {"op":"assignCategory","siteId":"站点id","siteTitle":"站点名称","categoryName":"目标分类名"}
   - {"op":"mergeCategories","from":["分类A","分类B"],"into":"合并后分类名","reason":"理由"}
   - {"op":"updateSite","siteId":"站点id","siteTitle":"站点名称","title":"新名称（可选）","description":"新简介（可选）"}
   - {"op":"deleteCategory","name":"分类名","reason":"理由"}
   - {"op":"addSite","title":"网站名称","url":"https://...","categoryName":"建议分类（可选）","description":"一句话简介（可选）","pinned":true}
4. 只能依据下面提供的数据做判断。你并没有访问这些网站的真实内容，禁止声称已访问或已知其真实用途；对不确定的网站，请基于名称/域名做保守推断，或干脆不改。
5. 若数据已足够合理，ops 可为空数组。
6. 不要编造数据中不存在的站点 id。
7. 当用户想「找 / 推荐 / 添加网站」时使用 addSite：url 必须是真实存在、广为人知的站点（用你训练数据里确信的官网域名），禁止编造或猜测不确定的网址；给出 categoryName 归类与 description，把最推荐、最常用的设为 pinned:true。`

export function buildNavContext(snap: NavSnapshot): string {
  const cats = snap.categories
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => `- ${c.name} (id=${c.id})`)
    .join('\n')

  const sites = snap.sites
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const cat = snap.categories.find((c) => c.id === s.categoryId)?.name ?? '未分类'
      return `- ${s.title} | id=${s.id} | url=${s.url} | 分类=${cat}`
    })
    .join('\n')

  return `【当前分类】\n${cats || '（无）'}\n\n【当前网站】\n${sites || '（无）'}`
}

export function buildNavMessages(snap: NavSnapshot, userRequest: string): ChatMessage[] {
  const now = Date.now()
  return [
    { id: uid('m-'), conversationId: '', role: 'system', content: SYSTEM, createdAt: now },
    {
      id: uid('m-'),
      conversationId: '',
      role: 'user',
      content: `${buildNavContext(snap)}\n\n【用户诉求】\n${userRequest}\n\n请输出 JSON 建议。`,
      createdAt: now + 1,
    },
  ]
}

/** 从模型输出中稳健地抽取 JSON（容忍代码块、前后废话） */
export function parseNavSuggestion(text: string): NavSuggestion | null {
  if (!text) return null
  let s = text.trim()

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()

  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const jsonText = s.slice(start, end + 1)

  let obj: unknown
  try {
    obj = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null) return null

  const raw = obj as { summary?: unknown; ops?: unknown }
  const opsRaw = Array.isArray(raw.ops) ? raw.ops : []
  const ops: NavSuggestion['ops'] = []

  for (const o of opsRaw) {
    if (typeof o !== 'object' || o === null) continue
    const op = o as Record<string, unknown>
    switch (op.op) {
      case 'createCategory':
        if (typeof op.name === 'string' && op.name.trim())
          ops.push({
            op: 'createCategory',
            name: op.name.trim(),
            color: typeof op.color === 'string' ? op.color : undefined,
            icon: typeof op.icon === 'string' ? op.icon : undefined,
          })
        break
      case 'assignCategory':
        if (typeof op.siteTitle === 'string' && typeof op.categoryName === 'string')
          ops.push({
            op: 'assignCategory',
            siteId: typeof op.siteId === 'string' ? op.siteId : '',
            siteTitle: op.siteTitle,
            categoryName: op.categoryName,
          })
        break
      case 'mergeCategories':
        if (Array.isArray(op.from) && typeof op.into === 'string')
          ops.push({
            op: 'mergeCategories',
            from: op.from.filter((x): x is string => typeof x === 'string'),
            into: op.into,
            reason: typeof op.reason === 'string' ? op.reason : undefined,
          })
        break
      case 'updateSite':
        if (typeof op.siteTitle === 'string')
          ops.push({
            op: 'updateSite',
            siteId: typeof op.siteId === 'string' ? op.siteId : '',
            siteTitle: op.siteTitle,
            title: typeof op.title === 'string' ? op.title : undefined,
            description: typeof op.description === 'string' ? op.description : undefined,
          })
        break
      case 'deleteCategory':
        if (typeof op.name === 'string')
          ops.push({
            op: 'deleteCategory',
            name: op.name,
            reason: typeof op.reason === 'string' ? op.reason : undefined,
          })
        break
      case 'addSite': {
        const title = typeof op.title === 'string' ? op.title.trim() : ''
        const url = typeof op.url === 'string' ? op.url.trim() : ''
        if (!title || !url || !/^https?:\/\//i.test(url)) break
        ops.push({
          op: 'addSite',
          title: title.slice(0, 60),
          url,
          categoryName:
            typeof op.categoryName === 'string' && op.categoryName.trim()
              ? op.categoryName.trim().slice(0, 40)
              : undefined,
          description:
            typeof op.description === 'string' && op.description.trim()
              ? op.description.trim()
              : undefined,
          pinned: op.pinned === true,
        })
        break
      }
    }
  }

  const summary =
    typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : ops.length
        ? '已生成整理建议'
        : '未发现需要调整的地方'

  return { summary, ops }
}
