import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const toneStyles = {
  brand: {
    tile: 'bg-brand-50 text-brand-600',
    chip: 'bg-brand-50 text-brand-700'
  },
  success: {
    tile: 'bg-success-50 text-success-600',
    chip: 'bg-success-50 text-success-700'
  },
  warning: {
    tile: 'bg-warning-50 text-warning-600',
    chip: 'bg-warning-50 text-warning-700'
  },
  danger: {
    tile: 'bg-danger-50 text-danger-600',
    chip: 'bg-danger-50 text-danger-700'
  }
}

export function StatCard({
  label,
  value,
  change,
  hint,
  tone,
  icon: Icon
}: {
  label: string
  value: string
  change?: number
  hint: string
  tone: keyof typeof toneStyles
  icon: LucideIcon
}) {
  const hasChange = typeof change === 'number'
  const positive = (change ?? 0) >= 0
  const style = toneStyles[tone]
  const TrendIcon = positive ? ArrowUpRight : ArrowDownRight

  return (
    <div className="card group relative overflow-hidden p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-slate-500">{label}</p>
          <div className="mt-3 flex items-baseline gap-2.5">
            <p className="tabular font-display text-[28px] font-bold leading-none tracking-[-0.03em] text-ink lg:text-[32px]">
              {value}
            </p>
          </div>
        </div>
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', style.tile)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <div className="mt-4 flex items-center gap-2">
        {hasChange ? (
          <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold', style.chip)}>
            <TrendIcon className="h-3 w-3" />
            {positive ? '+' : ''}
            {(change as number).toFixed(1)}%
          </span>
        ) : null}
        <span className="text-[11px] text-slate-400">{hint}</span>
      </div>
    </div>
  )
}
