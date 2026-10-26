import { cn } from '@/lib/utils'

export interface TabOption<T extends string> {
  value: T
  label: string
  count?: number
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  className
}: {
  options: Array<TabOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={cn('no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
              active ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {option.label}
            {typeof option.count === 'number' ? (
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular',
                  active ? 'bg-brand-50 text-brand-700' : 'bg-white/70 text-slate-400'
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
