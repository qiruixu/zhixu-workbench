import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { cn } from '../lib/utils'

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in (node as never)) {
    const el = node as { props?: { children?: ReactNode } }
    return extractText(el.props?.children)
  }
  return ''
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="group/code relative my-2.5 overflow-hidden rounded-xl border border-border bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-white/45">
          {lang || 'text'}
        </span>
        <button
          onClick={copy}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
            copied ? 'text-emerald-400' : 'text-white/55 hover:bg-white/10 hover:text-white'
          )}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3">
        <code className="font-mono text-[12.5px] leading-relaxed text-[#e6edf3]">{code}</code>
      </pre>
    </div>
  )
}

/** Markdown 渲染：支持 GFM 表格/列表，代码块带语言标签与复制按钮 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            const codeEl = Array.isArray(children) ? children[0] : children
            const props = (codeEl as { props?: { className?: string; children?: ReactNode } })?.props
            const className = props?.className || ''
            const lang = /language-([\w-]+)/.exec(className)?.[1]
            const text = extractText(props?.children).replace(/\n$/, '')
            return <CodeBlock code={text} lang={lang} />
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
