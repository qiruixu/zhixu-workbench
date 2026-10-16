/** 导航操作：把 AI 生成的「建议」翻译成预览文案，并在用户确认后执行 */
import { db } from './db'
import type { Category, NavSuggestion, Site } from './types'
import { uid } from './utils'

export interface NavSnapshot {
  categories: Category[]
  sites: Site[]
}

export interface PreviewLine {
  kind: 'add-category' | 'add-site' | 'assign' | 'merge' | 'update' | 'delete-category' | 'skip'
  text: string
}

const norm = (s: string) => s.trim().toLowerCase()

function findSite(snap: NavSnapshot, siteId?: string, title?: string): Site | undefined {
  if (siteId) {
    const byId = snap.sites.find((s) => s.id === siteId)
    if (byId) return byId
  }
  if (title) {
    const t = norm(title)
    return snap.sites.find((s) => norm(s.title) === t || norm(s.title).includes(t))
  }
  return undefined
}

function findCategory(snap: NavSnapshot, name: string): Category | undefined {
  const n = norm(name)
  return snap.categories.find((c) => norm(c.name) === n)
}

/** 生成人类可读的修改预览（不落库） */
export function describeSuggestion(s: NavSuggestion, snap: NavSnapshot): PreviewLine[] {
  const lines: PreviewLine[] = []
  for (const op of s.ops) {
    switch (op.op) {
      case 'createCategory': {
        const exists = findCategory(snap, op.name)
        lines.push({
          kind: exists ? 'skip' : 'add-category',
          text: exists ? `分类「${op.name}」已存在，跳过创建` : `新建分类「${op.name}」`,
        })
        break
      }
      case 'assignCategory': {
        const site = findSite(snap, op.siteId, op.siteTitle)
        const cat = findCategory(snap, op.categoryName)
        if (!site) {
          lines.push({ kind: 'skip', text: `未找到网站「${op.siteTitle}」，跳过归类` })
        } else {
          const from = site.categoryId
            ? snap.categories.find((c) => c.id === site.categoryId)?.name
            : '未分类'
          lines.push({
            kind: 'assign',
            text: `把「${site.title}」从「${from ?? '未分类'}」移动到「${op.categoryName}」${cat ? '' : '（该分类将同时被创建）'}`,
          })
        }
        break
      }
      case 'mergeCategories': {
        const froms = op.from.filter((n) => findCategory(snap, n))
        if (froms.length === 0) {
          lines.push({ kind: 'skip', text: `未找到待合并分类：${op.from.join('、')}` })
        } else {
          lines.push({
            kind: 'merge',
            text: `合并分类 ${froms.map((n) => `「${n}」`).join('、')} → 「${op.into}」${op.reason ? `（${op.reason}）` : ''}`,
          })
        }
        break
      }
      case 'updateSite': {
        const site = findSite(snap, op.siteId, op.siteTitle)
        if (!site) {
          lines.push({ kind: 'skip', text: `未找到网站「${op.siteTitle}」，跳过修改` })
        } else {
          const changes: string[] = []
          if (op.title && op.title !== site.title) changes.push(`名称 →「${op.title}」`)
          if (op.description !== undefined && op.description !== site.description)
            changes.push(`简介 →「${op.description}」`)
          lines.push({
            kind: changes.length ? 'update' : 'skip',
            text: changes.length
              ? `修改「${site.title}」：${changes.join('；')}`
              : `「${site.title}」无需修改`,
          })
        }
        break
      }
      case 'deleteCategory': {
        const cat = findCategory(snap, op.name)
        if (!cat) {
          lines.push({ kind: 'skip', text: `未找到分类「${op.name}」，跳过删除` })
        } else {
          const count = snap.sites.filter((s) => s.categoryId === cat.id).length
          lines.push({
            kind: 'delete-category',
            text: `删除分类「${op.name}」（其中 ${count} 个网站将变为未分类）`,
          })
        }
        break
      }
      case 'addSite': {
        const urlKey = norm(op.url.replace(/\/+$/, ''))
        const dup = snap.sites.find((s) => norm(s.url.replace(/\/+$/, '')) === urlKey)
        if (dup) {
          lines.push({
            kind: 'skip',
            text: `「${op.title}」的网址与已有站点「${dup.title}」相同，跳过`,
          })
        } else {
          lines.push({
            kind: 'add-site',
            text: `新增网站「${op.title}」${op.description ? `（${op.description}）` : ''} → ${
              op.categoryName ? `分类「${op.categoryName}」` : '未分类'
            }${op.pinned ? '，置顶' : ''}`,
          })
        }
        break
      }
    }
  }
  return lines
}

export interface ApplyResult {
  changed: number
  createdCategories: string[]
}

/** 用户确认后执行；整个过程在一个事务里，尽量原子 */
export async function applySuggestion(
  s: NavSuggestion,
  snap: NavSnapshot
): Promise<ApplyResult> {
  const result: ApplyResult = { changed: 0, createdCategories: [] }

  await db.transaction('rw', db.categories, db.sites, async () => {
    // 实时快照，保证与预览一致
    const categories = await db.categories.toArray()
    const sites = await db.sites.toArray()
    const live: NavSnapshot = { categories, sites }
    let catOrder = categories.length
    let siteOrder = sites.length

    const ensureCategory = async (name: string, color?: string, icon?: string): Promise<Category> => {
      const found = findCategory(live, name)
      if (found) return found
      const cat: Category = {
        id: uid('cat-'),
        name: name.trim().slice(0, 40),
        color,
        icon,
        order: catOrder++,
        createdAt: Date.now(),
      }
      await db.categories.put(cat)
      live.categories.push(cat)
      result.createdCategories.push(cat.name)
      return cat
    }

    for (const op of s.ops) {
      switch (op.op) {
        case 'createCategory': {
          const before = live.categories.length
          await ensureCategory(op.name, op.color, op.icon)
          if (live.categories.length > before) result.changed++
          break
        }
        case 'assignCategory': {
          const site = findSite(live, op.siteId, op.siteTitle)
          if (!site) break
          const cat = await ensureCategory(op.categoryName)
          if (site.categoryId !== cat.id) {
            const next = { ...site, categoryId: cat.id, order: siteOrder++ }
            await db.sites.put(next)
            const idx = live.sites.findIndex((x) => x.id === site.id)
            if (idx >= 0) live.sites[idx] = next
            result.changed++
          }
          break
        }
        case 'mergeCategories': {
          const target = await ensureCategory(op.into)
          for (const fromName of op.from) {
            const from = findCategory(live, fromName)
            if (!from || from.id === target.id) continue
            const affected = live.sites.filter((x) => x.categoryId === from.id)
            for (const site of affected) {
              const next = { ...site, categoryId: target.id, order: siteOrder++ }
              await db.sites.put(next)
              const idx = live.sites.findIndex((x) => x.id === site.id)
              if (idx >= 0) live.sites[idx] = next
            }
            await db.categories.delete(from.id)
            live.categories = live.categories.filter((c) => c.id !== from.id)
            result.changed += 1 + affected.length
          }
          break
        }
        case 'updateSite': {
          const site = findSite(live, op.siteId, op.siteTitle)
          if (!site) break
          const next = { ...site }
          if (op.title && op.title.trim()) next.title = op.title.trim().slice(0, 60)
          if (op.description !== undefined) next.description = op.description
          if (next.title !== site.title || next.description !== site.description) {
            await db.sites.put(next)
            const idx = live.sites.findIndex((x) => x.id === site.id)
            if (idx >= 0) live.sites[idx] = next
            result.changed++
          }
          break
        }
        case 'deleteCategory': {
          const cat = findCategory(live, op.name)
          if (!cat) break
          const affected = live.sites.filter((x) => x.categoryId === cat.id)
          for (const site of affected) {
            const next = { ...site, categoryId: null }
            await db.sites.put(next)
            const idx = live.sites.findIndex((x) => x.id === site.id)
            if (idx >= 0) live.sites[idx] = next
          }
          await db.categories.delete(cat.id)
          live.categories = live.categories.filter((c) => c.id !== cat.id)
          result.changed += 1 + affected.length
          break
        }
        case 'addSite': {
          const urlKey = norm(op.url.replace(/\/+$/, ''))
          const dup = live.sites.find((s) => norm(s.url.replace(/\/+$/, '')) === urlKey)
          if (dup) break
          const cat = op.categoryName ? await ensureCategory(op.categoryName) : undefined
          const site: Site = {
            id: uid('s-'),
            title: op.title,
            url: op.url,
            categoryId: cat?.id ?? null,
            description: op.description,
            order: siteOrder++,
            favorite: false,
            pinned: op.pinned === true,
            createdAt: Date.now(),
            opens: 0,
          }
          await db.sites.put(site)
          live.sites.push(site)
          result.changed++
          break
        }
      }
    }
  })

  return result
}
