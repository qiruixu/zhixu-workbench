import { createContext, useContext } from 'react'
import type { AppSettings, LayoutSettings, ThemeMode } from '../lib/types'

export type ToastType = 'info' | 'success' | 'error'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
}

export interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export interface AppCtxValue {
  ready: boolean
  settings: AppSettings
  resolvedTheme: 'light' | 'dark'

  update: (patch: Partial<AppSettings>) => Promise<void>
  setTheme: (t: ThemeMode) => void
  updateLayout: (patch: Partial<LayoutSettings>) => void

  toasts: ToastItem[]
  toast: (message: string, type?: ToastType) => void

  confirm: (opts: ConfirmOptions) => Promise<boolean>

  confirmState: (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  closeConfirm: (v: boolean) => void

  activeConfigId: string | null
  setActiveConfigId: (id: string | null) => Promise<void>

  /**
   * 首页「聚焦日期」（YYYY-MM-DD）。课表与日历共用：
   * 点日历某天 → 课表跳到那天；课表按天切换 → 日历跟着选中。
   */
  focusDate: string
  setFocusDate: (dateKey: string) => void
}

export const AppCtx = createContext<AppCtxValue | null>(null)

export function useApp(): AppCtxValue {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用')
  return ctx
}
