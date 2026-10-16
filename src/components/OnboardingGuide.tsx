/**
 * 新手指引：首次使用时的分步引导浮层。
 *
 * 设计取舍：
 *  - 用「聚光灯」高亮当前步骤对应的界面区域（box-shadow 遮罩，不需要额外 SVG），
 *    找不到目标元素（如模块被隐藏、移动端侧栏收起）时自动退化为居中卡片，不报错；
 *  - 步骤可以「先跳转到对应页面，再等布局稳定后测量」，因此能跨页引导；
 *  - 重点覆盖「课表」与「AI 助手」两个新用户最容易卡住的模块。
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BookOpenCheck,
  CalendarCheck,
  Check,
  GraduationCap,
  LayoutGrid,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui'

interface GuideStep {
  id: string
  icon: ReactNode
  /** 右上角的小标签，如「课表模块 · 1/2」 */
  badge?: string
  title: string
  body: string
  bullets?: string[]
  tip?: string
  /** 进入该步时先跳转到的路由 */
  route?: string
  /** 高亮目标（CSS 选择器） */
  target?: string
  /** 主按钮文案；点击后关闭引导 */
  cta?: string
}

const STEPS: GuideStep[] = [
  {
    id: 'welcome',
    icon: <Sparkles size={18} />,
    badge: '开始',
    title: '欢迎使用智序工作台',
    body: '它把你的导航、课表、日程、天气和一个「看得见你日程」的 AI 助手装进同一个页面。下面用 1 分钟带你过一遍，重点是课表和 AI 两块。',
    tip: '随时可以从左侧栏底部的「新手指引」重新打开。',
    cta: '开始了解',
  },
  {
    id: 'workbench',
    icon: <LayoutGrid size={18} />,
    badge: '工作台',
    title: '你的网站，一屏管好',
    route: '/',
    target: '[data-guide="site-grid"]',
    body: '这里是网站导航区，默认放了一些示例站点，可以随意增删改。',
    bullets: [
      '点右上角「添加网站」把自己常去的网址收进来',
      '拖动卡片右上角的手柄即可排序，拖到别的分类里可直接归类',
      '顶部搜索框支持按名称 / 网址 / 备注快速定位',
    ],
  },
  {
    id: 'timetable-1',
    icon: <GraduationCap size={18} />,
    badge: '课表模块 · 1/2',
    title: '课表：把教务文件拖进来就行',
    route: '/',
    target: '[data-dropzone="timetable"]',
    body: '这是课表面板。不用手抄、不用截图——把教务系统导出的课表文件直接拖到这里，它会自动解析。',
    bullets: [
      '支持 .xls / .xlsx / .csv / .rtf（含 .doc）/ .docx / .pdf / .ics 多种格式',
      '自动识别课程名、教室、教师、节次、周次与单双周',
      '解析失败会说明原因，且不会破坏你已导入的课表',
    ],
    tip: '有 .xls / .xlsx 时优先用它，PDF 属于实验性解析。',
  },
  {
    id: 'timetable-2',
    icon: <Wand2 size={18} />,
    badge: '课表模块 · 2/2',
    title: '课表：自动定位「现在是第几周」',
    route: '/',
    target: '[data-dropzone="timetable"]',
    body: '导入后系统会自动推算这是本学期的第几周，之后每过一个自然周自动 +1，你不需要每周手动改。',
    bullets: [
      '依据课表里的学期信息（如「2026-2027学年 第1学期」）或常见开学周推算',
      '日历课表（.ics）会按课程日期精确反推开学周',
      '按天切「前/后一天」、按周切「上一周/下一周」都能看',
      '点右侧日历里的任意日期，课表会跟着跳到那天',
      '如果推算不准，点课表右上角齿轮 →「根据课表自动判断」或直接手动设定',
    ],
    tip: '界面上会如实标注周次的来源（自动定位 / 手动设定），不会假装精确。',
  },
  {
    id: 'ai-1',
    icon: <Sparkles size={18} />,
    badge: 'AI 助手 · 1/2',
    title: 'AI 助手：自带 Key，四步配好',
    route: '/ai',
    target: '[data-guide="ai-add"]',
    body: '在「AI 配置」页点「添加配置」，四步即可开始对话。本项目采用 BYOK（自带 API Key）模式：用你自己的 Key，不代付、不经手你的数据。',
    bullets: [
      '选服务商 → 填 API Key → 选模型 → 测试连接',
      '内置 DeepSeek、NVIDIA、OpenAI、智谱、Kimi、Ollama 等 10+ 服务商预设',
      'Key 只保存在你自己的浏览器里，导出文件绝不包含 Key',
    ],
    tip: '不少服务商（如 NVIDIA NIM）注册即送免费额度，学生零成本就能用上旗舰模型。',
  },
  {
    id: 'ai-2',
    icon: <BookOpenCheck size={18} />,
    badge: 'AI 助手 · 2/2',
    title: 'AI 助手：它能看到你的课表',
    route: '/chat',
    target: '[data-guide="chat-context"]',
    body: '配好 AI 之后，聊天页顶部会出现「我的日程」开关（默认开启）。打开后，AI 能读到你的课表、待办和天气，回答会从「泛泛而谈」变成「按你的安排来」。',
    bullets: [
      '可以直接问「根据我的课表，帮我安排明天下午的学习计划」',
      '点击上方的服务商 / 模型胶囊，可以随时切换配置和模型，立即生效',
      '关掉开关，AI 就不再知道这些信息——不会假装知道',
    ],
    tip: '现在还没配置 AI，所以本页显示的是配置引导；配好之后回到聊天页，就能看到右上角的「我的日程」开关了。',
  },
  {
    id: 'done',
    icon: <Check size={18} />,
    badge: '完成',
    title: '就绪，开始用吧',
    body: '建议的顺序是：先拖入课表 → 确认周次 → 再去配置 AI。剩下的导航、日程、天气都是独立可用的，不配 AI 也不影响。',
    tip: '想再看一遍：左侧栏底部「新手指引」。',
    cta: '开始使用',
  },
]

export function OnboardingGuide({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(
    null
  )
  const scrolledFor = useRef('')

  const step = STEPS[idx]
  const isLast = idx === STEPS.length - 1

  useEffect(() => {
    // 需要跨页引导时先跳转，等路由与布局稳定后再测量
    const needNav = step.route && location.pathname !== step.route
    if (needNav && step.route) navigate(step.route)

    let raf = 0
    const measure = (allowScroll: boolean) => {
      if (!step.target) {
        setRect(null)
        return
      }
      const el = document.querySelector(step.target) as HTMLElement | null
      if (!el) {
        setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      if ((r.width === 0 && r.height === 0) || r.top < -2000 || r.top > window.innerHeight + 2000) {
        setRect(null)
        return
      }
      if (allowScroll && scrolledFor.current !== step.id) {
        scrolledFor.current = step.id
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }

    const timer = window.setTimeout(() => measure(true), needNav ? 420 : 80)
    const onMove = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => measure(false))
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [idx, step, location.pathname, navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(STEPS.length - 1, i + 1))
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const next = () => {
    if (isLast) onClose()
    else setIdx((i) => i + 1)
  }

  /**
   * 定位层样式 + 卡片自身样式。
   * 注意：不能靠 transform 做居中——卡片的入场动画 `animate-in-up` 会写入
   * `transform: translateY(0)`（animation-fill-mode: both），把 inline 的 translateX 覆盖掉。
   * 所以水平居中一律用 left/right + auto margin，垂直居中交给 flex 容器。
   */
  const { posStyle, cardStyle } = (() => {
    const width = Math.min(400, window.innerWidth - 24)
    const MARGIN = 12
    if (!rect) {
      return {
        posStyle: {
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: MARGIN,
        } as CSSProperties,
        cardStyle: { width, maxHeight: window.innerHeight - MARGIN * 2 } as CSSProperties,
      }
    }
    const GAP = 16
    const IDEAL = 360
    const left = Math.min(
      Math.max(MARGIN, rect.left + rect.width / 2 - width / 2),
      Math.max(MARGIN, window.innerWidth - width - MARGIN)
    )
    const spaceBelow = window.innerHeight - (rect.top + rect.height) - GAP - MARGIN
    const spaceAbove = rect.top - GAP - MARGIN
    // 优先放目标下方；下方不够放上方；上下都放不下（目标太高）时贴底水平居中
    if (spaceBelow >= IDEAL) {
      return {
        posStyle: { top: rect.top + rect.height + GAP, left, width } as CSSProperties,
        cardStyle: { maxHeight: spaceBelow } as CSSProperties,
      }
    }
    if (spaceAbove >= IDEAL) {
      return {
        posStyle: {
          bottom: Math.max(MARGIN, window.innerHeight - rect.top + GAP),
          left,
          width,
        } as CSSProperties,
        cardStyle: { maxHeight: spaceAbove } as CSSProperties,
      }
    }
    return {
      posStyle: {
        left: 0,
        right: 0,
        marginLeft: 'auto',
        marginRight: 'auto',
        bottom: MARGIN,
        width,
      } as CSSProperties,
      cardStyle: { maxHeight: window.innerHeight - MARGIN * 2 } as CSSProperties,
    }
  })()

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      {/* 遮罩 / 聚光灯 */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl transition-[top,left,width,height] duration-[450ms] ease-out"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 2px var(--primary), 0 0 0 9999px rgba(0,0,0,0.62)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      {/* 步骤卡片
          位置过渡必须与聚光灯用同一时长/缓动：否则聚光灯平滑移动、卡片瞬移，
          视觉上会「对不上、很生硬」。 */}
      <div className="absolute z-10" style={posStyle}>
        <div
          className="overflow-y-auto rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)] animate-in-up transition-[top,left,bottom] duration-[450ms] ease-out"
          style={cardStyle}
        >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              {step.icon}
            </span>
            <span className="truncate text-[12px] font-medium text-muted">{step.badge}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] tabular-nums text-faint">
              {idx + 1} / {STEPS.length}
            </span>
          </div>
        </div>

        <div className="px-4 py-4">
          <h3 className="text-[15.5px] font-semibold text-text">{step.title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{step.body}</p>

          {step.bullets?.length ? (
            <ul className="mt-3 space-y-1.5">
              {step.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-text">
                  <Check size={13} className="mt-[3px] shrink-0 text-primary" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {step.tip ? (
            <p className="mt-3 rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-[11.5px] leading-relaxed text-faint">
              {step.tip}
            </p>
          ) : null}
        </div>

        {/* 进度点 */}
        <div className="flex items-center gap-1.5 px-4">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setIdx(i)}
              title={s.title}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === idx ? 'w-5 bg-primary' : 'w-1.5 bg-border-strong hover:bg-muted'
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3.5">
          <button onClick={onClose} className="text-[12.5px] text-faint transition-colors hover:text-muted">
            跳过引导
          </button>
          <div className="flex items-center gap-2">
            {idx > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setIdx((i) => i - 1)}>
                上一步
              </Button>
            ) : null}
            <Button variant="primary" size="sm" onClick={next}>
              {isLast ? step.cta ?? '完成' : step.cta ?? '下一步'}
              {isLast ? <Check size={14} /> : <ArrowRight size={14} />}
            </Button>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

/** 侧栏 / 设置页里触发引导的小入口按钮 */
export function GuideTrigger({
  onClick,
  className,
}: {
  onClick: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title="重新查看新手指引"
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text',
        className
      )}
    >
      <CalendarCheck size={16} />
      <span>新手指引</span>
    </button>
  )
}
