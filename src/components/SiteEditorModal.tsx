import { useEffect, useState } from 'react'
import { Globe, Sparkles } from 'lucide-react'
import type { Category, Site } from '../lib/types'
import { addSite, updateSite } from '../lib/navRepo'
import { normalizeUrl } from '../lib/utils'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'
import { SiteIcon } from './SiteIcon'
import { useApp } from '../store/ctx'

export function SiteEditorModal({
  open,
  onClose,
  site,
  categories,
  defaultCategoryId,
}: {
  open: boolean
  onClose: () => void
  site: Site | null
  categories: Category[]
  defaultCategoryId?: string | null
}) {
  const { toast } = useApp()
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [iconUrl, setIconUrl] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    if (site) {
      setTitle(site.title)
      setUrl(site.url)
      setIconUrl(site.iconUrl ?? '')
      setCategoryId(site.categoryId ?? '')
      setDescription(site.description ?? '')
    } else {
      setTitle('')
      setUrl('')
      setIconUrl('')
      setCategoryId(defaultCategoryId ?? '')
      setDescription('')
    }
  }, [open, site, defaultCategoryId])

  const submit = async () => {
    setError('')
    if (!title.trim()) return setError('请填写网站名称')
    if (!url.trim()) return setError('请填写网站地址')
    const normalized = normalizeUrl(url)
    try {
      new URL(normalized)
    } catch {
      return setError('网站地址格式不正确')
    }

    try {
      setSaving(true)
      if (site) {
        await updateSite(site.id, {
          title,
          url: normalized,
          iconUrl: iconUrl.trim() || undefined,
          categoryId: categoryId || null,
          description: description.trim() || undefined,
        })
        toast('网站已更新', 'success')
      } else {
        await addSite({
          title,
          url: normalized,
          iconUrl,
          categoryId: categoryId || null,
          description,
        })
        toast('网站已添加', 'success')
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={site ? '编辑网站' : '添加网站'}
      description="名称与网址为必填项，其余可留空。图标留空时会自动尝试获取网站图标。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            {site ? '保存修改' : '添加'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
          <SiteIcon url={url} iconUrl={iconUrl} title={title || '?'} size={40} radius={11} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text">{title || '未命名网站'}</div>
            <div className="flex items-center gap-1 truncate text-[12px] text-muted">
              <Globe size={12} />
              {url || '尚未填写网址'}
            </div>
          </div>
          <Sparkles size={15} className="text-faint" />
        </div>

        <Field label="网站名称" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：学校官网 / GitHub"
            autoFocus
          />
        </Field>

        <Field label="网站地址" required hint="可省略 https://，会自动补全">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="github.com" />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="分类">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="自定义图标地址" hint="留空则自动获取">
            <Input
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
              placeholder="https://…/favicon.ico"
            />
          </Field>
        </div>

        <Field label="简介 / 备注" hint="可选，便于搜索，也供 AI 整理时参考">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例如：专业课表与作业提交入口"
          />
        </Field>

        {error ? (
          <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
