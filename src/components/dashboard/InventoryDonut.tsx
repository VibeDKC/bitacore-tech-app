import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { StockSummary } from '@/types'
import { formatNumber } from '@/lib/format'

export function InventoryDonut({ summary }: { summary: StockSummary }) {
  const navigate = useNavigate()
  const data = [
    { name: 'En stock', value: summary.in, color: '#12B76A' },
    { name: 'Stock bajo', value: summary.low, color: '#F79009' },
    { name: 'Agotado', value: summary.out, color: '#F04438' }
  ]
  const total = data.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className="card flex flex-col p-5 lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[16px] font-bold text-ink">Estado del inventario</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">Distribución actual del catálogo</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/inventario')}
          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white text-slate-400 shadow-sm transition hover:text-ink"
          aria-label="Ver inventario"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative mt-2 flex flex-1 items-center justify-center">
        <div className="h-[188px] w-full max-w-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={59}
                outerRadius={84}
                paddingAngle={2}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="tabular font-display text-[26px] font-bold leading-none tracking-[-0.03em] text-ink">{formatNumber(total)}</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-slate-400">referencias</p>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {data.map((item) => {
          const percent = total ? Math.round((item.value / total) * 100) : 0
          return (
            <div key={item.name} className="flex items-center gap-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="flex-1 text-[11px] font-medium text-slate-500">{item.name}</span>
              <span className="tabular text-[11px] font-semibold text-ink">{formatNumber(item.value)}</span>
              <span className="w-8 text-right text-[10px] text-slate-400">{percent}%</span>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning-100 bg-warning-50/70 p-2.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-600" />
        <p className="text-[10px] leading-snug text-warning-700">
          <span className="font-semibold">{formatNumber(summary.low + summary.out)} referencias críticas</span> requieren reposición esta semana.
        </p>
      </div>
    </div>
  )
}
