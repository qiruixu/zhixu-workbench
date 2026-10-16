import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, FileJson, Layers, Replace } from 'lucide-react'
import { db } from '../lib/db'
import type { NavExport } from '../lib/types'
import { applyNavImport, type ImportStats } from '../lib/io'
import { cn } from '../lib/utils'
import { useApp } from '../store/ctx'
import { Badge, Button, Modal } from './ui'

export function NavImportModal({
  open,
  onClose,
  data,
  onDone,
}: {
  open: boolean
  onClose: () => void
  data: NavExport | null
  onDone: (stats: ImportStats) => void
}) {
  const { toast, confirm } = useApp()
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [busy, setBusy] = useState(false)
  const existingSites = useLiveQuery(() => db.sites.toArray(), [], [])

  const dupCount = useMemo(() => {
    if (!data) return 0
    const existing = new Set(existingSites.map((s) => s.url.toLowerCase().replace(/\/+$/, '')))
    return data.sites.filter((s) => existing.has(s.url.toLowerCase().replace(/\/+$/, ''))).length
  }, [data, existingSites])

  if (!data) return null

  const run = async () => {
    if (mode === 'replace') {
      const ok = await confirm({
        title: '确认覆盖导入？',
        description:
          '此操作会先清空当前所有网站与分类，再写入文件内容。原有数据将无法恢复，建议先导出备份。',
        confirmText: '清空并导入',
        danger: true,
      })
      if (!ok) return
    }
    try {
      setBusy(true)
      const stats = await applyNavImport(data, mode)
      toast(`导入完成：新增 ${stats.addedSites} 个网站、${stats.addedCategories} 个分类`, 'success')
      onDone(stats)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : '导入失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导入预览"
      description="请先核对内容再确认。默认采用「合并」模式，不会覆盖你已有的数据。"
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant={mode === 'replace' ? 'danger' : 'primary'} onClick={run} loading={busy}>
            {mode === 'replace' ? '清空并导入' : '合并导入'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
          <FileJson size={26} className="text-primary" />
          <div className="text-[13px]">
            <div className="font-medium text-text">
              共 {data.categories.length} 个分类 · {data.sites.length} 个网站
            </div>
            <div className="mt-0.5 text-muted">
              导出时间：{new Date(data.exportedAt).toLocaleString('zh-CN')}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            onClick={() => setMode('merge')}
            className={cn(
              'rounded-xl border p-3 text-left transition-colors',
              mode === 'merge' ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-border-strong'
            )}
          >
            <div className="flex items-center gap-2 text-[13px] font-medium text-text">
              <Layers size={15} /> 合并导入（推荐）
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              按网址去重后追加；已存在的网站不会被覆盖。检测到重复 {dupCount} 个，将跳过。
            </p>
          </button>
          <button
            onClick={() => setMode('replace')}
            className={cn(
              'rounded-xl border p-3 text-left transition-colors',
              mode === 'replace' ? 'border-danger bg-danger-soft' : 'border-border bg-surface hover:border-border-strong'
            )}
          >
            <div className="flex items-center gap-2 text-[13px] font-medium text-text">
              <Replace size={15} /> 覆盖导入
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              先清空当前全部导航数据，再写入文件。会二次确认，请谨慎使用。
            </p>
          </button>
        </div>

        {dupCount > 0 && mode === 'merge' ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5 text-[12.5px] text-warning">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            检测到 {dupCount} 个与现有网站网址重复的条目，合并模式下会被跳过，不会重复添加。
          </div>
        ) : null}

        <div>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-text">
            内容预览 <Badge>仅展示前 8 条</Badge>
          </div>
          <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-surface p-2">
            {data.sites.slice(0, 8).map((s) => {
              const cat = data.categories.find((c) => c.id === s.categoryId)?.name
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12.5px]"
                >
                  <span className="truncate font-medium text-text">{s.title}</span>
                  <span className="flex-1 truncate text-faint">{s.url}</span>
                  {cat ? <Badge tone="primary">{cat}</Badge> : null}
                </div>
              )
            })}
            {data.sites.length > 8 ? (
              <div className="px-2.5 py-1 text-[12px] text-faint">
                … 其余 {data.sites.length - 8} 个网站
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  )
}
