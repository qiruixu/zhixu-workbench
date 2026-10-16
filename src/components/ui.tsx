import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useEffect } from 'react'
import { AlertTriangle, Check, Info, Loader2, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { useApp } from '../store/ctx'

/* ------------------------------- Button ------------------------------- */

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm shadow-black/10',
  outline: 'border border-border-strong bg-surface hover:bg-surface-2 text-text',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
  subtle: 'bg-surface-2 text-text hover:bg-surface-3',
}

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9.5 px-3.5 text-sm gap-2 rounded-xl',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
}

export function Button({
  variant = 'outline',
  size = 'md',
  className,
  children,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap transition-all duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-45 disabled:pointer-events-none active:scale-[0.98]',
        VARIANT[variant],
        SIZE[size],
        className
      )}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : null}
      {children}
    </button>
  )
}

export function IconButton({
  className,
  title,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted',
        'hover:bg-surface-2 hover:text-text transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary/50',
        className
      )}
    >
      {children}
    </button>
  )
}

/* ------------------------------- Inputs ------------------------------- */

const fieldCls =
  'w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(fieldCls, 'h-9.5', className)} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(fieldCls, 'resize-none leading-relaxed', className)} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(fieldCls, 'h-9.5 cursor-pointer pr-8', className)}>
      {children}
    </select>
  )
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2.5 text-sm text-text outline-none"
    >
      <span
        className={cn(
          'relative h-5.5 w-10 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-primary' : 'bg-surface-3 border border-border-strong'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all duration-200',
            checked ? 'left-5' : 'left-0.5'
          )}
        />
      </span>
      {label ? <span className="select-none">{label}</span> : null}
    </button>
  )
}

/* ------------------------------- Badge ------------------------------- */

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'primary' | 'success' | 'danger' | 'warning'
  className?: string
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-2 text-muted border-border',
    primary: 'bg-primary-soft text-primary border-primary/30',
    success: 'bg-success-soft text-success border-success/30',
    danger: 'bg-danger-soft text-danger border-danger/30',
    warning: 'bg-warning-soft text-warning border-warning/30',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

/* ------------------------------- Modal ------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-pop"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative z-10 w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)] animate-in-up',
          width
        )}
        role="dialog"
        aria-modal="true"
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              {title ? <h2 className="text-[15px] font-semibold text-text">{title}</h2> : null}
              {description ? (
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
              ) : null}
            </div>
            <IconButton onClick={onClose} title="关闭">
              <X size={16} />
            </IconButton>
          </div>
        )}
        {children ? <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div> : null}
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/60 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------- Spinner / Empty ------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-muted', className)} size={18} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-faint">{icon}</div> : null}
      <p className="text-sm font-medium text-text">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-[13px] font-medium text-text">
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-[12px] leading-relaxed text-muted">{hint}</span> : null}
    </label>
  )
}

/* ------------------------------- Confirm + Toast hosts ------------------------------- */

export function ConfirmHost() {
  const { confirmState, closeConfirm } = useApp()
  if (!confirmState) return null
  const { title, description, confirmText, cancelText, danger } = confirmState
  return (
    <Modal
      open
      onClose={() => closeConfirm(false)}
      title={
        <span className="flex items-center gap-2">
          {danger ? <AlertTriangle size={16} className="text-danger" /> : null}
          {title}
        </span>
      }
      description={description}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => closeConfirm(false)}>
            {cancelText || '取消'}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => closeConfirm(true)}>
            {confirmText || '确认'}
          </Button>
        </>
      }
    />
  )
}

export function Toaster() {
  const { toasts } = useApp()
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] shadow-[var(--shadow-md)] animate-in-up',
            t.type === 'success' && 'border-success/40 bg-success-soft text-success',
            t.type === 'error' && 'border-danger/40 bg-danger-soft text-danger',
            t.type === 'info' && 'border-border bg-surface text-text'
          )}
        >
          {t.type === 'success' ? <Check size={14} /> : null}
          {t.type === 'error' ? <AlertTriangle size={14} /> : null}
          {t.type === 'info' ? <Info size={14} /> : null}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
