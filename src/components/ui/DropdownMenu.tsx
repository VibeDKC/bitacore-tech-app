import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function DropdownMenu({
  trigger,
  children,
  align = 'right',
  side = 'bottom',
  className,
  panelClassName
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  side?: 'bottom' | 'top'
  className?: string
  panelClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div onClick={() => setOpen((value) => !value)}>{trigger}</div>
      {open ? (
        <div
          className={cn(
            'absolute z-50 min-w-[230px] overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-pop animate-scale-in',
            align === 'right' ? 'right-0' : 'left-0',
            side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
            panelClassName
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function DropdownItem({
  icon,
  label,
  description,
  onClick,
  active,
  danger
}: {
  icon?: ReactNode
  label: string
  description?: string
  onClick?: () => void
  active?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition',
        danger ? 'text-danger-600 hover:bg-danger-50' : 'text-slate-600 hover:bg-slate-50 hover:text-ink',
        active && 'bg-brand-50 text-brand-700'
      )}
    >
      {icon ? <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', active ? 'bg-white text-brand-600' : 'bg-slate-100 text-slate-500')}>{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{label}</span>
        {description ? <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{description}</span> : null}
      </span>
      {active ? <span className="mt-1 h-1.5 w-1.5 rounded-full bg-brand-500" /> : null}
    </button>
  )
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{children}</p>
}

export function DropdownDivider() {
  return <div className="my-1.5 h-px bg-line" />
}
