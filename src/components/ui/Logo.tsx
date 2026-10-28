import logoFull from '@/assets/brand/bitacoretech-logo.png'
import logoMark from '@/assets/brand/bitacoretech-mark.png'
import { cn } from '@/lib/utils'

export function Logo({
  compact = false,
  invert = false,
  full = false,
  subtitle = 'Taller & POS',
  className
}: {
  compact?: boolean
  invert?: boolean
  full?: boolean
  subtitle?: string
  className?: string
}) {
  if (full) {
    return (
      <img
        src={logoFull}
        alt="BitacoreTech"
        className={cn('h-9 w-auto select-none', className)}
        draggable={false}
      />
    )
  }

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img
        src={logoMark}
        alt={compact ? 'BitacoreTech' : ''}
        aria-hidden={compact ? undefined : true}
        className="h-10 w-10 shrink-0 select-none object-contain"
        draggable={false}
      />
      {compact ? null : (
        <div className="min-w-0">
          <p
            className={cn(
              'font-display text-[17px] font-extrabold leading-none tracking-tight',
              invert ? 'text-white' : 'text-ink'
            )}
          >
            Bitacore<span className={invert ? 'text-brand-300' : 'text-brand-500'}>Tech</span>
          </p>
          <p
            className={cn(
              'mt-1 text-[10px] font-medium uppercase tracking-[0.16em]',
              invert ? 'text-white/55' : 'text-slate-400'
            )}
          >
            {subtitle}
          </p>
        </div>
      )}
    </div>
  )
}
