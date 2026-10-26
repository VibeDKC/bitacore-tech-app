import { Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Logo({
  compact = false,
  invert = false,
  subtitle = 'Taller & POS'
}: {
  compact?: boolean
  invert?: boolean
  subtitle?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 shadow-[0_12px_24px_-12px_rgba(108,92,231,0.9)]">
        <div className="absolute inset-[1px] rounded-[12px] bg-gradient-to-b from-white/20 to-transparent" />
        <Boxes className="relative h-5 w-5 text-white" strokeWidth={2.2} />
      </div>
      {compact ? null : (
        <div className="min-w-0">
          <p className={cn('font-display text-[17px] font-extrabold leading-none tracking-tight', invert ? 'text-white' : 'text-ink')}>
            BitacoreTech
          </p>
          <p className={cn('mt-1 text-[10px] font-medium uppercase tracking-[0.16em]', invert ? 'text-white/55' : 'text-slate-400')}>
            {subtitle}
          </p>
        </div>
      )}
    </div>
  )
}
