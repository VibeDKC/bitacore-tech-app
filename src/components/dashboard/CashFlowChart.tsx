import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { ChartPoint } from '@/types'
import { formatCompactCurrency, formatCurrency } from '@/lib/format'

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-3 shadow-pop">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <div className="mt-2 space-y-1.5">
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="flex min-w-[150px] items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.dataKey === 'income' ? 'Ingresos' : 'Egresos'}
            </span>
            <span className="tabular text-[11px] font-semibold text-ink">{formatCurrency(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CashFlowChart({ data = [] }: { data?: ChartPoint[] }) {
  const chartData = data
  const lastIndex = chartData.length - 1

  return (
    <div className="card overflow-hidden p-5 lg:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="font-display text-[16px] font-bold text-ink">Flujo de caja</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">Ingresos y egresos de los últimos 12 meses</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
            <span className="h-2 w-2 rounded-full bg-brand-500" />
            Ingresos
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
            <span className="h-2 w-2 rounded-full bg-rose-400" />
            Egresos
          </span>
          <button
            type="button"
            className="focus-ring hidden items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-500 shadow-sm transition hover:text-ink sm:inline-flex"
          >
            Últimos 12 meses
          </button>
        </div>
      </div>

      <div className="mt-5 h-[272px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={3} barCategoryGap="26%">
            <defs>
              <linearGradient id="incomeBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8F84FF" />
                <stop offset="100%" stopColor="#6C5CE7" />
              </linearGradient>
              <linearGradient id="expenseBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FDA29B" />
                <stop offset="100%" stopColor="#F97066" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 7" vertical={false} stroke="#EEF0F4" />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#98A2B3', fontSize: 10, fontWeight: 500 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={54}
              tick={{ fill: '#98A2B3', fontSize: 9, fontWeight: 500 }}
              tickFormatter={(value: number) => formatCompactCurrency(value)}
            />
            <Tooltip cursor={{ fill: '#F7F8FC', radius: 8 }} content={<ChartTooltip />} />
            <Bar dataKey="income" radius={[6, 6, 0, 0]} maxBarSize={16}>
              {chartData.map((entry, index) => (
                <Cell key={entry.month} fill={index === lastIndex ? 'url(#incomeBar)' : '#CFC8FF'} />
              ))}
            </Bar>
            <Bar dataKey="expenses" radius={[6, 6, 0, 0]} maxBarSize={16}>
              {chartData.map((entry, index) => (
                <Cell key={entry.month} fill={index === lastIndex ? 'url(#expenseBar)' : '#FECDD3'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line/70 pt-4">
        <p className="text-[10px] text-slate-400">Octubre acumula un crecimiento del 6,6% frente a septiembre.</p>
        <span className="hidden items-center gap-1.5 rounded-full bg-success-50 px-2 py-1 text-[10px] font-semibold text-success-700 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
          Flujo positivo
        </span>
      </div>
    </div>
  )
}
