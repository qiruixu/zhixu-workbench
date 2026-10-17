import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bot,
  LayoutGrid,
  MessageSquare,
  Moon,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
} from 'lucide-react'
import logoUrl from '../assets/logo.png'
import { db } from '../lib/db'
import type { AIConfig } from '../lib/types'
import { cn } from '../lib/utils'
import { useApp } from '../store/ctx'
import { OnboardingGuide, GuideTrigger } from './OnboardingGuide'
import { ConfirmHost, Toaster } from './ui'
import { Badge } from './ui'

const NAV = [
  { to: '/', label: '工作台', icon: LayoutGrid, end: true },
  { to: '/chat', label: 'AI 助手', icon: MessageSquare, end: false },
  { to: '/ai', label: 'AI 配置', icon: Sparkles, end: false },
  { to: '/settings', label: '设置', icon: SettingsIcon, end: false },
]

function ThemeToggle() {
  const { settings, setTheme, resolvedTheme } = useApp()
  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      title={resolvedTheme === 'dark' ? '切换到浅色' : '切换到深色'}
      className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      <span>{resolvedTheme === 'dark' ? '浅色' : '深色'}</span>
      {settings.theme === 'system' ? <span className="text-faint">·跟随系统</span> : null}
    </button>
  )
}

function ActiveModelChip() {
  const { activeConfigId } = useApp()
  const cfg = useLiveQuery(
    () => db.aiConfigs.get(activeConfigId ?? ''),
    [activeConfigId],
    undefined as AIConfig | undefined
  )
  if (!cfg) {
    return (
      <NavLink
        to="/ai"
        className="flex items-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2.5 text-[12px] text-muted transition-colors hover:border-primary hover:text-text"
      >
        <Bot size={15} />
        尚未配置 AI · 点此设置
      </NavLink>
    )
  }
  return (
    <NavLink
      to="/ai"
      className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 transition-colors hover:border-primary/50"
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-text">{cfg.model}</span>
        <span className="block truncate text-[11px] text-muted">{cfg.providerName}</span>
      </span>
    </NavLink>
  )
}

export function Shell() {
  const { ready, guideOpen, openGuide, closeGuide } = useApp()
  const loc = useLocation()

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted">
          <img src={logoUrl} alt="" className="h-8 w-8 animate-pulse object-contain" />
          <span className="text-sm">正在加载本地数据…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* 桌面侧边栏 */}
      <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col border-r border-border bg-surface/70 px-3.5 py-4 backdrop-blur md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-1.5">
          <img
            src={logoUrl}
            alt="智序工作台"
            className="h-9 w-9 shrink-0 select-none object-contain"
            draggable={false}
          />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-text">智序工作台</div>
            <div className="text-[11px] text-faint">导航 · AI 助手</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-guide={to === '/chat' ? 'nav-chat' : to === '/ai' ? 'nav-ai' : undefined}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-primary-soft text-primary'
                    : 'text-muted hover:bg-surface-2 hover:text-text'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
                      isActive ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <Icon size={17} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 space-y-3">
          <ActiveModelChip />
          <ThemeToggle />
          <GuideTrigger onClick={openGuide} />
        </div>
      </aside>

      {/* 主区域 */}
      <main className="min-w-0 flex-1 pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* 移动端顶栏 */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/85 px-3 py-2.5 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <img
              src={logoUrl}
              alt=""
              className="h-7 w-7 shrink-0 select-none object-contain"
              draggable={false}
            />
            <span className="text-[14px] font-semibold text-text">
              {NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label ??
                '智序工作台'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>

        <Outlet />
      </main>

      {/* 移动端底部导航 */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] transition-colors',
                isActive ? 'text-primary' : 'text-muted'
              )
            }
          >
            <Icon size={19} />
            {label}
          </NavLink>
        ))}
      </nav>

      <Toaster />
      <ConfirmHost />
      {guideOpen ? <OnboardingGuide onClose={closeGuide} /> : null}
    </div>
  )
}

export { Badge }
