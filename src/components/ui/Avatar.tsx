import { cn, initials } from '@/lib/utils'

const sizes = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-20 w-20 text-xl'
}

export function Avatar({
  name,
  size = 'md',
  status,
  className
}: {
  name: string
  size?: keyof typeof sizes
  status?: 'online' | 'offline'
  className?: string
}) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full bg-gradient-to-br from-brand-500 via-brand-600 to-indigo-800 font-semibold text-white shadow-[0_8px_20px_-10px_rgba(91,75,214,0.9)] ring-2 ring-white',
          sizes[size]
        )}
      >
        {initials(name)}
      </span>
      {status ? (
        <span
          className={cn(
            'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white',
            status === 'online' ? 'bg-success-500' : 'bg-slate-300'
          )}
        />
      ) : null}
    </span>
  )
}
