import { useMemo } from 'react'
import { code128Bars } from '@/lib/barcode'
import { cn } from '@/lib/utils'

export function Barcode({
  value,
  height = 48,
  showValue = true,
  className
}: {
  value: string
  height?: number
  showValue?: boolean
  className?: string
}) {
  const { bars, width } = useMemo(() => code128Bars(value), [value])

  return (
    <div className={cn('text-current', className)}>
      <svg
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full"
        role="img"
        aria-label={`Código de barras ${value}`}
      >
        {bars.map((bar, index) => (
          <rect key={`${bar.x}-${index}`} x={bar.x} y="0" width={bar.width} height="100" fill="currentColor" />
        ))}
      </svg>
      {showValue ? (
        <p className="mt-1 text-center font-mono text-[10px] font-semibold tracking-[0.16em] text-current">{value}</p>
      ) : null}
    </div>
  )
}
