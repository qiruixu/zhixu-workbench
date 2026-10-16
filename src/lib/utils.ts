/** 通用工具函数 */
import { nanoid } from 'nanoid'

export const uid = (prefix = ''): string => `${prefix}${nanoid(10)}`

/** 轻量 className 合并 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** 规范化 URL：补全协议、去空格 */
export function normalizeUrl(input: string): string {
  let s = (input || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    return new URL(s).toString()
  } catch {
    return s
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname
  } catch {
    return url
  }
}

/** 站点图标候选列表（按优先级；最后一个为本地字符头像，永不失败） */
export function iconCandidates(site: { url: string; iconUrl?: string }): string[] {
  const list: string[] = []
  if (site.iconUrl && site.iconUrl.trim()) list.push(site.iconUrl.trim())
  try {
    const u = new URL(normalizeUrl(site.url))
    list.push(`${u.origin}/favicon.ico`)
  } catch {
    /* ignore */
  }
  return list
}

/** 取名称首字（中文取第一个字，英文取首字母） */
export function initialOf(name: string): string {
  const s = (name || '').trim()
  if (!s) return '?'
  const ch = s[0]
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch
}

/** 依据字符串稳定生成一个好看的色相，用于没有图标时的头像底色 */
export function hueOf(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 下载文本为文件 */
export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.onerror = () => reject(new Error('文件读取失败'))
    fr.readAsText(file, 'utf-8')
  })
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 简易节流 */
export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 200) {
  let t: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), wait)
  }
}
