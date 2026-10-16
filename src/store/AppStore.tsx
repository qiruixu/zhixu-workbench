import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { applyBootstrap } from '../lib/bootstrap'
import { db, DEFAULT_SETTINGS, getSettings, saveSettings, seedIfEmpty } from '../lib/db'
import type { AppSettings, LayoutSettings, ThemeMode } from '../lib/types'
import { uid } from '../lib/utils'
import { AppCtx, type ConfirmOptions, type ToastItem, type ToastType } from './ctx'

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(structuredClone(DEFAULT_SETTINGS))
  const [activeConfigId, setActiveId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  )
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [focusDate, setFocusDate] = useState<string>(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })
  const [confirmState, setConfirmState] = useState<
    | (ConfirmOptions & { resolve: (v: boolean) => void })
    | null
  >(null)
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // 先准备本地数据：示例网站 → 本地引导 AI 配置（若存在且尚无配置）
      try {
        await seedIfEmpty()
      } catch {
        /* 不影响主流程 */
      }
      try {
        await applyBootstrap()
      } catch {
        /* 不影响主流程 */
      }
      const s = await getSettings()
      const row = await db.settings.get('activeAIConfigId')
      const guideRow = await db.settings.get('onboardingDone')
      if (!alive) return
      setSettings(s)
      setActiveId((row?.value as string) ?? null)
      // 首次使用（未看过引导）自动弹出新手指引
      setGuideOpen(!guideRow?.value)
      setReady(true)
    })()
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq?.addEventListener?.('change', onChange)
    return () => {
      alive = false
      mq?.removeEventListener?.('change', onChange)
    }
  }, [])

  const resolvedTheme: 'light' | 'dark' =
    settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolvedTheme === 'dark')
    root.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await (async () => {
      setSettings((prev) => {
        const merged: AppSettings = {
          ...prev,
          ...patch,
          layout: { ...prev.layout, ...(patch.layout ?? {}) },
        }
        return merged
      })
      await saveSettings(patch)
      return true
    })()
    void next
  }, [])

  const setTheme = useCallback((theme: ThemeMode) => void update({ theme }), [update])

  const updateLayout = useCallback(
    (patch: Partial<LayoutSettings>) => {
      setSettings((prev) => {
        const merged = { ...prev, layout: { ...prev.layout, ...patch } }
        void saveSettings({ layout: merged.layout })
        return merged
      })
    },
    []
  )

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = uid('t-')
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200)
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve }))
  }, [])

  const setActiveConfigId = useCallback(async (id: string | null) => {
    setActiveId(id)
    await db.settings.put({ key: 'activeAIConfigId', value: id })
  }, [])

  const openGuide = useCallback(() => setGuideOpen(true), [])
  const closeGuide = useCallback(() => {
    setGuideOpen(false)
    // 看过就不再自动弹出（仍可从侧栏/设置重新打开）
    void db.settings.put({ key: 'onboardingDone', value: true })
  }, [])

  const value = useMemo(
    () => ({
      ready,
      settings,
      resolvedTheme,
      update,
      setTheme,
      updateLayout,
      toasts,
      toast,
      confirm,
      confirmState,
      closeConfirm: (v: boolean) => {
        confirmState?.resolve(v)
        setConfirmState(null)
      },
      activeConfigId,
      setActiveConfigId,
      focusDate,
      setFocusDate,
      guideOpen,
      openGuide,
      closeGuide,
    }),
    [
      ready,
      settings,
      resolvedTheme,
      update,
      setTheme,
      updateLayout,
      toasts,
      toast,
      confirm,
      confirmState,
      activeConfigId,
      setActiveConfigId,
      focusDate,
      guideOpen,
      openGuide,
      closeGuide,
    ]
  )

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
