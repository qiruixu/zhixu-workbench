import { useMemo, useState } from 'react'
import type { LayoutSettings } from '../lib/types'
import { useApp } from '../store/ctx'
import { Modal, Switch, Field, Select } from './ui'
import { cn } from '../lib/utils'

export function LayoutPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { settings, updateLayout } = useApp()
  const L = settings.layout

  const set = (patch: Partial<LayoutSettings>) => updateLayout(patch)
  const Toggle = ({ k, label, desc }: { k: keyof LayoutSettings; label: string; desc?: string }) => (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <div className="text-[13px] font-medium text-text">{label}</div>
        {desc ? <div className="mt-0.5 text-[12px] text-muted">{desc}</div> : null}
      </div>
      <Switch checked={Boolean(L[k])} onChange={(v) => set({ [k]: v } as Partial<LayoutSettings>)} />
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="自定义首页布局"
      description="按需隐藏/显示模块，并调整卡片密度。设置会自动保存。"
      footer={
        <button
          onClick={onClose}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover"
        >
          完成
        </button>
      }
    >
      <div className="space-y-1 divide-y divide-border">
        <Toggle k="showHero" label="顶部问候区" desc="显示欢迎语与统计信息" />
        <Toggle k="showStats" label="统计卡片" desc="网站数 / 分类数 / 收藏数" />
        <Toggle k="showSearch" label="搜索框" />
        <Toggle k="showQuickFilter" label="快捷筛选" desc="全部 / 收藏 / 置顶" />
        <Toggle k="groupByCategory" label="按分类分组" desc="关闭则以平铺网格展示" />

        <Toggle
          k="showDashboard"
          label="面板带"
          desc="在首页顶部显示下面勾选的快捷面板，可按需增减"
        />
        <Toggle k="showTodayCourses" label="今日课程" desc="拖入教务系统导出的课表文件即可启用" />
        <Toggle
          k="showTodos"
          label="待办"
          desc="有截止日期、需要提前留意的事（如作业）——会一直挂着直到完成"
        />
        <Toggle k="showMemoCalendar" label="日程日历" desc="绑定在某一天、只有那天重要的事" />
        <Toggle k="showWeather" label="天气" desc="可选模块；需授权定位或手动选择城市" />

        <div className="grid grid-cols-2 gap-3 py-3">
          <Field label="卡片大小">
            <Select value={L.cardSize} onChange={(e) => set({ cardSize: e.target.value as LayoutSettings['cardSize'] })}>
              <option value="sm">紧凑</option>
              <option value="md">标准</option>
              <option value="lg">宽松</option>
            </Select>
          </Field>
          <Field label="每行列数">
            <Select
              value={String(L.columns)}
              onChange={(e) =>
                set({
                  columns: (e.target.value === 'auto'
                    ? 'auto'
                    : (Number(e.target.value) as LayoutSettings['columns'])),
                })
              }
            >
              <option value="auto">自动</option>
              <option value="2">2 列</option>
              <option value="3">3 列</option>
              <option value="4">4 列</option>
              <option value="5">5 列</option>
              <option value="6">6 列</option>
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  )
}

/** 依据卡片大小与列数返回网格类名 */
export function gridClass(L: LayoutSettings): string {
  const cols =
    L.columns === 'auto'
      ? { sm: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8',
          md: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
          lg: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' }[L.cardSize]
      : {
          2: 'grid-cols-2',
          3: 'grid-cols-2 sm:grid-cols-3',
          4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
          5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
          6: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6',
        }[L.columns as 2 | 3 | 4 | 5 | 6]
  return cn('grid gap-3', cols)
}
