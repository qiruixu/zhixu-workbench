/** 导航数据仓库：所有对分类/站点的写操作集中在此，保证一致性 */
import { db } from './db'
import type { Category, Site } from './types'
import { normalizeUrl, uid } from './utils'

/* ------------------------------- 站点 ------------------------------- */

export interface SiteDraft {
  title: string
  url: string
  iconUrl?: string
  categoryId?: string | null
  description?: string
}

export async function addSite(draft: SiteDraft): Promise<Site> {
  const order = await db.sites.count()
  const site: Site = {
    id: uid('site-'),
    title: draft.title.trim(),
    url: normalizeUrl(draft.url),
    iconUrl: draft.iconUrl?.trim() || undefined,
    categoryId: draft.categoryId ?? null,
    description: draft.description?.trim() || undefined,
    order,
    favorite: false,
    pinned: false,
    createdAt: Date.now(),
    opens: 0,
  }
  await db.sites.put(site)
  return site
}

export async function updateSite(id: string, patch: Partial<Site>): Promise<void> {
  const cur = await db.sites.get(id)
  if (!cur) return
  const next: Site = { ...cur, ...patch }
  if (patch.url) next.url = normalizeUrl(patch.url)
  if (patch.title !== undefined) next.title = patch.title.trim()
  await db.sites.put(next)
}

export async function deleteSite(id: string): Promise<void> {
  await db.sites.delete(id)
}

export async function toggleFavorite(id: string): Promise<void> {
  const s = await db.sites.get(id)
  if (s) await db.sites.put({ ...s, favorite: !s.favorite })
}

export async function togglePinned(id: string): Promise<void> {
  const s = await db.sites.get(id)
  if (s) await db.sites.put({ ...s, pinned: !s.pinned })
}

export async function bumpOpen(id: string): Promise<void> {
  const s = await db.sites.get(id)
  if (s) await db.sites.put({ ...s, opens: (s.opens || 0) + 1 })
}

/** 批量写入排序（ids 的顺序即最终顺序） */
export async function reorderSites(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.sites, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      const s = await db.sites.get(orderedIds[i])
      if (s && s.order !== i) await db.sites.put({ ...s, order: i })
    }
  })
}

/** 跨分类拖拽：把站点移动到目标分类，并落在指定顺序 */
export async function moveSiteToCategory(
  siteId: string,
  categoryId: string | null,
  orderedIdsInTarget: string[]
): Promise<void> {
  await db.transaction('rw', db.sites, async () => {
    const s = await db.sites.get(siteId)
    if (!s) return
    await db.sites.put({ ...s, categoryId })
    for (let i = 0; i < orderedIdsInTarget.length; i++) {
      const t = await db.sites.get(orderedIdsInTarget[i])
      if (t && t.order !== i) await db.sites.put({ ...t, order: i })
    }
  })
}

/* ------------------------------- 分类 ------------------------------- */

export async function addCategory(name: string, color?: string, icon?: string): Promise<Category> {
  const order = await db.categories.count()
  const cat: Category = {
    id: uid('cat-'),
    name: name.trim().slice(0, 40),
    color,
    icon,
    order,
    createdAt: Date.now(),
  }
  await db.categories.put(cat)
  return cat
}

export async function updateCategory(id: string, patch: Partial<Category>): Promise<void> {
  const cur = await db.categories.get(id)
  if (!cur) return
  await db.categories.put({ ...cur, ...patch, name: (patch.name ?? cur.name).trim() })
}

/** 删除分类：其下站点变为「未分类」，不会连带删除站点 */
export async function deleteCategory(id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.sites, async () => {
    const sites = await db.sites.where('categoryId').equals(id).toArray()
    for (const s of sites) await db.sites.put({ ...s, categoryId: null })
    await db.categories.delete(id)
  })
}

export async function reorderCategories(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      const c = await db.categories.get(orderedIds[i])
      if (c && c.order !== i) await db.categories.put({ ...c, order: i })
    }
  })
}
