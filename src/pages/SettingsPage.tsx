import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Database,
  Download,
  FileJson,
  Info,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  Settings2,
  ShieldAlert,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'
import { db, wipeAll } from '../lib/db'
import type { NavExport, ThemeMode } from '../lib/types'
import { buildChatExport, buildNavExport, validateNavExport } from '../lib/io'
import { downloadText, readFileAsText } from '../lib/utils'
import { useApp } from '../store/ctx'
import { NavImportModal } from '../components/NavImportModal'
import { LayoutPanel } from '../components/LayoutPanel'
import { Badge, Button, Field, Modal, Select, Switch } from '../components/ui'

export default function SettingsPage() {
  const { settings, setTheme, updateLayout, toast, confirm, setActiveConfigId } = useApp()
  const counts = useLiveQuery(async () => {
    const [sites, cats, convs, msgs, cfgs] = await Promise.all([
      db.sites.count(),
      db.categories.count(),
      db.conversations.count(),
      db.messages.count(),
      db.aiConfigs.count(),
    ])
    return { sites, cats, convs, msgs, cfgs }
  }, [], { sites: 0, cats: 0, convs: 0, msgs: 0, cfgs: 0 })

  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<NavExport | null>(null)
  const [showLayout, setShowLayout] = useState(false)
  const [showAbout, setShowAbout] = useState(false)

  const exportNav = async () => {
    const data = await buildNavExport()
    const stamp = new Date().toISOString().slice(0, 10)
    downloadText(`zhixu-nav-${stamp}.json`, JSON.stringify(data, null, 2))
    toast('导航配置已导出（不含任何 API Key）', 'success')
  }

  const exportChat = async () => {
    const data = await buildChatExport()
    const stamp = new Date().toISOString().slice(0, 10)
    downloadText(`zhixu-chat-${stamp}.json`, JSON.stringify(data, null, 2))
    toast('聊天记录已导出（不含任何 API Key）', 'success')
  }

  const onPickFile = async (file: File) => {
    try {
      const text = await readFileAsText(file)
      const res = validateNavExport(text)
      if (!res.ok || !res.data) {
        toast(res.error || '文件校验失败', 'error')
        return
      }
      setPendingImport(res.data)
    } catch (e) {
      toast(e instanceof Error ? e.message : '读取文件失败', 'error')
    }
  }

  const dangerWipe = async () => {
    const ok = await confirm({
      title: '清除全部本地数据？',
      description:
        '将删除所有网站、分类、AI 配置、聊天记录与设置。此操作不可恢复，建议先导出备份。',
      confirmText: '全部清除',
      danger: true,
    })
    if (!ok) return
    const really = await confirm({
      title: '再次确认',
      description: '真的要清除全部数据吗？这是最后一步确认。',
      confirmText: '确认清除',
      danger: true,
    })
    if (!really) return
    await wipeAll()
    toast('已清除全部本地数据，可到「设置」重新导入备份', 'success')
  }

  const THEMES: { v: ThemeMode; label: string; icon: typeof Sun; desc: string }[] = [
    { v: 'light', label: '浅色', icon: Sun, desc: '明亮清爽' },
    { v: 'dark', label: '深色', icon: Moon, desc: '夜间护眼' },
    { v: 'system', label: '跟随系统', icon: Monitor, desc: '自动切换' },
  ]

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-7 md:py-7">
      <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-text">
        <Settings2 size={20} className="text-primary" /> 设置
      </h1>
      <p className="mt-1.5 text-[13.5px] text-muted">主题、布局与数据管理。所有设置与数据都保存在本机浏览器中。</p>

      <div className="mt-6 space-y-5">
        {/* 主题 */}
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-text">
            <Palette size={16} /> 主题外观
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {THEMES.map(({ v, label, icon: Icon, desc }) => (
              <button
                key={v}
                onClick={() => setTheme(v)}
                className={
                  'rounded-xl border p-3 text-left transition-colors ' +
                  (settings.theme === v
                    ? 'border-primary bg-primary-soft'
                    : 'border-border bg-surface hover:bg-surface-2')
                }
              >
                <Icon size={16} className={settings.theme === v ? 'text-primary' : 'text-muted'} />
                <div className="mt-1.5 text-[13px] font-medium text-text">{label}</div>
                <div className="text-[11.5px] text-muted">{desc}</div>
              </button>
            ))}
          </div>
        </section>

        {/* 布局 */}
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-text">
              <Settings2 size={16} /> 首页布局
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowLayout(true)}>
              调整布局
            </Button>
          </div>
          <div className="flex flex-wrap gap-3 text-[12.5px] text-muted">
            <span>卡片：{ { sm: '紧凑', md: '标准', lg: '宽松' }[settings.layout.cardSize] }</span>
            <span>列数：{settings.layout.columns === 'auto' ? '自动' : `${settings.layout.columns} 列`}</span>
            <span>分组建：{settings.layout.groupByCategory ? '开' : '关'}</span>
          </div>
        </section>

        {/* 数据 */}
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-text">
            <Database size={16} /> 数据管理与备份
          </div>
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
            当前：{counts.sites} 个网站 · {counts.cats} 个分类 · {counts.convs} 段对话 · {counts.msgs} 条消息 ·{' '}
            {counts.cfgs} 份 AI 配置。清除浏览器数据会导致本地数据丢失，建议定期导出备份。
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Button variant="outline" onClick={exportNav}>
              <Download size={15} /> 导出导航配置
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> 导入导航配置
            </Button>
            <Button variant="outline" onClick={exportChat}>
              <FileJson size={15} /> 导出聊天记录
            </Button>
            <Button variant="outline" onClick={() => setShowAbout(true)}>
              <Info size={15} /> 数据格式说明
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onPickFile(f)
              e.target.value = ''
            }}
          />
          <div className="mt-3 flex items-center gap-2 text-[12px] text-faint">
            <Badge tone="success">安全</Badge>
            导出的导航与聊天文件均不包含任何 API Key。
          </div>
        </section>

        {/* 密钥 */}
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-text">
            <KeyRound size={16} /> API Key 与 AI 配置
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warning">
            <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-text">密钥如何保存：</span>
              默认保存在本机浏览器 IndexedDB（可通过配置里的「持久保存」关闭，改为仅本次会话内存保存）。
              请求时密钥仅经本机后端转发到你配置的服务商，不会发送到其他服务器，也不会写入日志或导出文件。
              但请注意：任何本机存储都无法保证绝对安全，请勿在公共电脑上保存密钥。
            </div>
          </div>
          <div className="mt-3">
            <Button
              variant="outline"
              onClick={async () => {
                const ok = await confirm({
                  title: '清除全部 AI 配置与密钥？',
                  description: '将删除所有服务商配置、模型选择与本机保存的 API Key。导航与聊天数据不受影响。',
                  confirmText: '清除',
                  danger: true,
                })
                if (!ok) return
                await db.aiConfigs.clear()
                await setActiveConfigId(null)
                toast('已清除全部 AI 配置', 'success')
              }}
            >
              <KeyRound size={15} /> 清除全部 AI 配置与密钥
            </Button>
          </div>
        </section>

        {/* 危险区 */}
        <section className="rounded-2xl border border-danger/40 bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-danger">
            <Trash2 size={16} /> 危险操作
          </div>
          <p className="mb-3 text-[12.5px] text-muted">
            清除全部本地数据将删除所有网站、分类、AI 配置与聊天记录，且无法恢复。
          </p>
          <Button variant="danger" onClick={dangerWipe}>
            <Trash2 size={15} /> 清除全部本地数据
          </Button>
        </section>

        {/* 关于 */}
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-text">
              <Info size={16} /> 关于本应用
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={settings.layout.compact}
                onChange={(v) => updateLayout({ compact: v })}
                label="紧凑模式"
              />
            </div>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            智序工作台 · 个性化网站导航 + 多模型 AI 助手。纯本地运行，数据存于浏览器 IndexedDB；
            通过本机 Node 代理转发 AI 请求。本应用不提供任何统一的 AI 服务、代付或额度。
          </p>
        </section>
      </div>

      <LayoutPanel open={showLayout} onClose={() => setShowLayout(false)} />
      <NavImportModal
        open={!!pendingImport}
        data={pendingImport}
        onClose={() => setPendingImport(null)}
        onDone={() => setPendingImport(null)}
      />

      <Modal
        open={showAbout}
        onClose={() => setShowAbout(false)}
        title="数据格式说明"
        description="导入前请确认文件来自可信来源。"
        footer={
          <Button variant="primary" onClick={() => setShowAbout(false)}>
            知道了
          </Button>
        }
      >
        <div className="space-y-3 text-[13px] leading-relaxed text-muted">
          <p>
            <strong className="text-text">导航配置</strong>：JSON，顶层为{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]">
              { '{ kind: "zhixu-nav", version: 1, categories: [...], sites: [...] }' }
            </code>
            。
          </p>
          <p>
            <strong className="text-text">聊天记录</strong>：JSON，顶层为{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]">
              { '{ kind: "zhixu-chat", version: 1, conversations: [...], messages: [...] }' }
            </code>
            。
          </p>
          <p>导入时会先校验结构，并展示预览；默认「合并」模式按网址去重，不会静默覆盖现有数据。</p>
          <p className="text-danger">两类文件均不包含 API Key。</p>
        </div>
      </Modal>
    </div>
  )
}
