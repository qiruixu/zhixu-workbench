import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, FolderPlus, Pencil, Trash2, X } from 'lucide-react'
import { db } from '../lib/db'
import { addCategory, deleteCategory, updateCategory } from '../lib/navRepo'
import { cn } from '../lib/utils'
import { useApp } from '../store/ctx'
import { Button, IconButton, Input, Modal } from './ui'

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
  '#10b981', '#06b6d4', '#3b82f6', '#64748b', '#0ea5e9',
]

export function CategoryManagerModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { toast, confirm } = useApp()
  const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), [], [])
  const sites = useLiveQuery(() => db.sites.toArray(), [], [])

  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLORS[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(COLORS[0])

  useEffect(() => {
    if (!open) {
      setEditingId(null)
      setNewName('')
    }
  }, [open])

  const countOf = (id: string) => sites.filter((s) => s.categoryId === id).length

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast('该分类已存在', 'error')
      return
    }
    await addCategory(name, newColor)
    setNewName('')
    setNewColor(COLORS[(categories.length + 1) % COLORS.length])
    toast('分类已创建', 'success')
  }

  const startEdit = (id: string, name: string, color?: string) => {
    setEditingId(id)
    setEditName(name)
    setEditColor(color || COLORS[0])
  }

  const commitEdit = async () => {
    if (!editingId) return
    const name = editName.trim()
    if (!name) return
    await updateCategory(editingId, { name, color: editColor })
    setEditingId(null)
    toast('分类已更新', 'success')
  }

  const remove = async (id: string, name: string) => {
    const n = countOf(id)
    const ok = await confirm({
      title: `删除分类「${name}」？`,
      description:
        n > 0
          ? `该分类下有 ${n} 个网站，删除后它们会变为「未分类」，网站本身不会被删除。`
          : '该分类下暂无网站。',
      confirmText: '删除分类',
      danger: true,
    })
    if (!ok) return
    await deleteCategory(id)
    toast('分类已删除', 'success')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="分类管理"
      description="分类用于组织网站。删除分类不会删除其中的网站。"
      footer={
        <Button variant="primary" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-medium text-text">
            <FolderPlus size={14} /> 新建分类
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="分类名称"
              className="min-w-[160px] flex-1"
            />
            <Button variant="primary" onClick={create} disabled={!newName.trim()}>
              创建
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={cn(
                  'h-6 w-6 rounded-full ring-offset-2 ring-offset-surface-2 transition-all',
                  newColor === c ? 'ring-2 ring-text scale-110' : 'hover:scale-110'
                )}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {categories.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted">还没有分类，先创建一个吧。</p>
          ) : null}
          {categories.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2"
            >
              {editingId === c.id ? (
                <>
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="h-7 w-8 cursor-pointer rounded-md border border-border bg-transparent"
                  />
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="h-8 flex-1"
                    autoFocus
                  />
                  <IconButton title="保存" onClick={commitEdit}>
                    <Check size={15} className="text-success" />
                  </IconButton>
                  <IconButton title="取消" onClick={() => setEditingId(null)}>
                    <X size={15} />
                  </IconButton>
                </>
              ) : (
                <>
                  <span
                    className="h-7 w-1.5 shrink-0 rounded-full"
                    style={{ background: c.color || '#6366f1' }}
                  />
                  <span className="flex-1 truncate text-sm text-text">{c.name}</span>
                  <span className="text-[12px] text-faint">{countOf(c.id)} 个网站</span>
                  <IconButton title="编辑" onClick={() => startEdit(c.id, c.name, c.color)}>
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton title="删除" onClick={() => remove(c.id, c.name)}>
                    <Trash2 size={14} className="text-danger" />
                  </IconButton>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
