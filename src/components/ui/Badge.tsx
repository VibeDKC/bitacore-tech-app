import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'sky' | 'outline'

const variants: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  sky: 'bg-sky-50 text-sky-700',
  outline: 'border border-slate-200 bg-white text-slate-600'
}

const dots: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-brand-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  sky: 'bg-sky-500',
  outline: 'bg-slate-400'
}

export function Badge({
  children,
  variant = 'neutral',
  dot,
  className
}: {
  children: ReactNode
  variant?: BadgeVariant
  dot?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none',
        variants[variant],
        className
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', dots[variant])} /> : null}
      {children}
    </span>
  )
}
