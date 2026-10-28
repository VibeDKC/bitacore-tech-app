import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  Banknote,
  BarChart3,
  Download,
  LockKeyhole,
  Package,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { formatCompactCurrency, formatCurrency, formatDateTime, formatNumber, formatPercent } from '@/lib/format'
import { downloadCsv } from '@/lib/download'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/EmptyState'
import { SegmentedTabs } from '@/components/ui/Tabs'
import { cn } from '@/lib/utils'

type Period = 'hoy' | '7d' | '30d' | 'ano'

const periodLabels: Record<Period, string> = {
  hoy: 'Hoy',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  ano: 'Año en curso'
}

function ReportTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-3 shadow-pop">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <div className="mt-2 space-y-1.5">
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="flex min-w-[160px] items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.stroke ?? entry.color }} />
              {entry.dataKey === 'income' ? 'Ingresos' : 'Egresos'}
            </span>
            <span className="tabular text-[11px] font-semibold text-ink">{formatCurrency(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReportsPage() {
  const { role } = useAuth()
  const [period, setPeriod] = useState<Period>('30d')
  const { data, loading, error, reload } = useApi(() => api.reports.summary(period), [period])

  const canGross = can(role, 'viewGrossMargin')
  const canNet = can(role, 'viewNetProfit')

  const report = data
  const chartData = useMemo(() => report?.chartData ?? [], [report?.chartData])
  const paymentData = report?.paymentData ?? []
  const paymentTotal = paymentData.reduce((sum, item) => sum + item.value, 0)
  const categoryData = report?.categoryData ?? []
  const categoryTotal = categoryData.reduce((sum, item) => sum + item.value, 0)
  const bestMonth = useMemo(
    () => chartData.reduce<{ month: string; income: number } | null>((best, point) => (!best || point.income > best.income ? point : best), null),
    [chartData]
  )

  const kpis = useMemo(() => {
    if (!report) return []
    return [
      {
        label: 'Ventas del periodo',
        value: formatCurrency(report.salesTotal),
        hint: `${formatNumber(report.invoiceCount)} facturas activas`,
        icon: Wallet,
        tone: 'bg-brand-50 text-brand-600',
        locked: false
      },
      {
        label: 'Ventas POS',
        value: formatCurrency(report.salesPos),
        hint: `${formatNumber(report.invoiceCountPos)} facturas de mostrador`,
        icon: ShoppingBag,
        tone: 'bg-emerald-50 text-emerald-600',
        locked: false
      },
      {
        label: 'Ventas OT',
        value: formatCurrency(report.salesOt),
        hint: `${formatNumber(report.invoiceCountOt)} órdenes facturadas`,
        icon: Wrench,
        tone: 'bg-indigo-50 text-indigo-600',
        locked: false
      },
      {
        label: 'Ticket promedio',
        value: formatCurrency(report.avgTicket),
        hint: periodLabels[report.period],
        icon: ReceiptText,
        tone: 'bg-sky-50 text-sky-600',
        locked: false
      },
      {
        label: 'Margen bruto',
        value: report.grossMargin === null ? 'Privado' : formatCurrency(report.grossMargin),
        hint:
          report.grossMarginPercent === null
            ? 'Tu rol no ve márgenes'
            : `${formatPercent(report.grossMarginPercent)} del ingreso · después del costo de repuestos`,
        icon: TrendingUp,
        tone: 'bg-success-50 text-success-600',
        locked: report.grossMargin === null
      },
      {
        label: 'Utilidad neta',
        value: report.netProfit === null ? 'Privado' : formatCurrency(report.netProfit),
        hint: report.netProfit === null ? 'Exclusiva del propietario' : 'Margen bruto − egresos de caja',
        icon: Sparkles,
        tone: 'bg-warning-50 text-warning-600',
        locked: report.netProfit === null
      }
    ]
  }, [report])

  function exportReport() {
    if (!report) return
    downloadCsv('bitacoretech-reporte-ventas.csv', [
      ['Factura', 'Cliente', 'Fecha', 'Método', 'Estado', 'Total'],
      ...report.invoices.map((invoice) => [
        invoice.number,
        invoice.customerName ?? '',
        invoice.date,
        invoice.method,
        invoice.status,
        invoice.total
      ]),
      [],
      ['Resumen', 'Valor'],
      ['Periodo', periodLabels[report.period]],
      ['Ventas del periodo', report.salesTotal],
      ['Ventas POS', report.salesPos],
      ['Ventas OT', report.salesOt],
      ['Facturas activas', report.invoiceCount],
      ['Facturas POS', report.invoiceCountPos],
      ['Facturas OT', report.invoiceCountOt],
      ['Ticket promedio', report.avgTicket],
      ['Margen bruto', report.grossMargin ?? 'Restringido'],
      ['Utilidad neta', report.netProfit ?? 'Restringido'],
      ['Compras del periodo', report.purchasesTotal],
      ['IVA soportado', report.ivaSoportado],
      ['Egresos de caja', report.expenses]
    ])
    toast.success('Reporte exportado', { description: 'CSV con ventas, métodos de pago y resumen del periodo.' })
  }

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Generando reporte…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudo cargar el reporte</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    )
  }

  if (!report) return null

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reportes"
        description="Ventas, márgenes y rendimiento del taller. La utilidad neta es exclusiva del propietario."
        actions={
          <>
            <SegmentedTabs
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'hoy', label: 'Hoy' },
                { value: '7d', label: '7 días' },
                { value: '30d', label: '30 días' },
                { value: 'ano', label: 'Año' }
              ]}
            />
            <Button variant="secondary" onClick={exportReport} leftIcon={<Download className="h-4 w-4" />}>
              Exportar
            </Button>
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <div key={kpi.label} className={cn('card relative overflow-hidden p-5', kpi.locked && 'bg-slate-50/60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-slate-500">{kpi.label}</p>
                  <p
                    className={cn(
                      'mt-2.5 truncate font-display text-[24px] font-bold leading-none tracking-[-0.02em]',
                      kpi.locked ? 'text-slate-400' : 'text-ink'
                    )}
                  >
                    {kpi.value}
                  </p>
                </div>
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', kpi.tone)}>
                  {kpi.locked ? <LockKeyhole className="h-[18px] w-[18px]" /> : <Icon className="h-[18px] w-[18px]" />}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                {kpi.locked ? (
                  <Badge variant="warning">Restringido</Badge>
                ) : (
                  <Badge variant="success" dot>
                    {periodLabels[report.period]}
                  </Badge>
                )}
                <span className="truncate text-[10px] text-slate-400">{kpi.hint}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid gap-3.5 sm:grid-cols-3">
        {[
          { label: 'Compras del periodo', value: formatCurrency(report.purchasesTotal), icon: ShoppingBag, tone: 'bg-sky-50 text-sky-600' },
          { label: 'IVA soportado 19%', value: formatCurrency(report.ivaSoportado), icon: ReceiptText, tone: 'bg-warning-50 text-warning-600' },
          { label: 'Egresos de caja', value: formatCurrency(report.expenses), icon: Banknote, tone: 'bg-danger-50 text-danger-600' }
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card flex items-center gap-3.5 p-4">
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', stat.tone)}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-[18px] font-bold leading-none text-ink">{stat.value}</p>
                <p className="mt-1.5 text-[11px] text-slate-500">{stat.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="card p-5 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-[16px] font-bold text-ink">Ingresos y egresos</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">Últimos 12 meses · valores en COP</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="h-2 w-2 rounded-full bg-brand-500" /> Ingresos
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="h-2 w-2 rounded-full bg-rose-400" /> Egresos
              </span>
            </div>
          </div>
          {chartData.length ? (
            <div className="mt-5 h-[285px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="incomeArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6C5CE7" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#6C5CE7" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="expenseArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FB7185" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#FB7185" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 7" vertical={false} stroke="#EEF0F4" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#98A2B3', fontSize: 10 }} dy={10} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={54}
                    tick={{ fill: '#98A2B3', fontSize: 9 }}
                    tickFormatter={(value: number) => formatCompactCurrency(value)}
                  />
                  <Tooltip content={<ReportTooltip />} />
                  <Area type="monotone" dataKey="income" stroke="#6C5CE7" strokeWidth={2.4} fill="url(#incomeArea)" />
                  <Area type="monotone" dataKey="expenses" stroke="#FB7185" strokeWidth={2} fill="url(#expenseArea)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="mt-5 flex h-[285px] flex-col items-center justify-center rounded-xl border border-dashed border-line text-center">
              <BarChart3 className="h-6 w-6 text-slate-300" />
              <p className="mt-2 text-[12px] font-semibold text-ink">Sin histórico mensual</p>
              <p className="mt-1 max-w-xs text-[10px] text-slate-400">
                El historial se alimenta con los cierres de caja y las ventas registradas.
              </p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <p className="text-[10px] text-slate-400">
              {bestMonth ? `${bestMonth.month} registra el mejor ingreso del año.` : 'Aún no hay datos históricos.'}
            </p>
            <Badge variant="success" dot>
              {formatCurrency(report.salesTotal)} ventas del periodo
            </Badge>
          </div>
        </div>

        <div className="card flex flex-col p-5 lg:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-[16px] font-bold text-ink">Ventas por categoría</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">Distribución del periodo</p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
              <BarChart3 className="h-4 w-4" />
            </span>
          </div>

          {categoryData.length ? (
            <>
              <div className="relative mt-2 flex flex-1 items-center justify-center">
                <div className="h-[180px] w-full max-w-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={2}
                        startAngle={90}
                        endAngle={-270}
                        stroke="none"
                        isAnimationActive={false}
                      >
                        {categoryData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="tabular font-display text-[19px] font-bold leading-none text-ink">
                    {formatCompactCurrency(categoryTotal)}
                  </p>
                  <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.1em] text-slate-400">vendido</p>
                </div>
              </div>

              <div className="mt-2 space-y-2">
                {categoryData.map((item) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="flex-1 text-[10px] text-slate-500">{item.name}</span>
                    <span className="tabular text-[10px] font-semibold text-ink">{formatCompactCurrency(item.value)}</span>
                    <span className="w-8 text-right text-[9px] text-slate-400">
                      {Math.round((item.value / Math.max(categoryTotal, 1)) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
              <BarChart3 className="h-6 w-6 text-slate-300" />
              <p className="mt-2 text-[12px] font-semibold text-ink">Sin ventas en el periodo</p>
              <p className="mt-1 max-w-[220px] text-[10px] leading-relaxed text-slate-400">
                Registra ventas en el POS o factura órdenes para ver la distribución por categoría.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(330px,1fr)]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-display text-[16px] font-bold text-ink">Productos más vendidos</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">Unidades, ingresos y margen por referencia</p>
            </div>
            {!canGross ? <Badge variant="warning">Margen restringido</Badge> : <Badge variant="success" dot>Rentable</Badge>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed">
              <thead>
                <tr className="border-b border-line bg-slate-50/60">
                  <th className="table-th w-[46%] pl-5">Producto</th>
                  <th className="table-th w-[14%] text-center">Unidades</th>
                  <th className="table-th w-[20%] text-right">Ingresos</th>
                  <th className="table-th w-[20%] pr-5 text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {report.topProducts.map((item, index) => (
                  <tr key={item.name} className="border-b border-line/70 last:border-0 hover:bg-slate-50/50">
                    <td className="table-td pl-5">
                      <div className="flex items-center gap-2.5">
                        <span className="tabular w-3 text-[10px] font-bold text-slate-300">{index + 1}</span>
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                          <Package className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-ink">{item.name}</p>
                          <p className="truncate text-[9px] text-slate-400">Venta del periodo</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-td text-center text-[11px] tabular">{formatNumber(item.units)}</td>
                    <td className="table-td text-right text-[11px] font-semibold tabular text-ink">{formatCurrency(item.revenue)}</td>
                    <td className="table-td pr-5 text-right">
                      {canGross && item.margin !== null ? (
                        <div>
                          <p className="tabular text-[11px] font-semibold text-success-600">{formatCurrency(item.margin)}</p>
                          <p className="text-[9px] text-slate-400">{item.marginPercent ?? 0}%</p>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9px] text-slate-400">
                          <LockKeyhole className="h-3 w-3" /> Restringido
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!report.topProducts.length ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-[11px] text-slate-400">
                      No hay productos vendidos en el periodo seleccionado.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[15px] font-bold text-ink">Métodos de pago</h2>
                <p className="mt-0.5 text-[10px] text-slate-400">Facturas activas del periodo</p>
              </div>
              <CreditIcon />
            </div>
            <div className="mt-3 space-y-2.5">
              {paymentData.map((item) => (
                <div key={item.name}>
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                      {item.name}
                    </span>
                    <span className="tabular font-semibold text-ink">{formatCurrency(item.value)}</span>
                  </div>
                  <ProgressBar value={paymentTotal ? (item.value / paymentTotal) * 100 : 0} />
                </div>
              ))}
              {!paymentData.length ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-[10px] text-slate-400">
                  Sin facturas activas en el periodo.
                </p>
              ) : null}
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[15px] font-bold text-ink">Carga por técnico</h2>
                <p className="mt-0.5 text-[10px] text-slate-400">Órdenes abiertas vs. cerradas</p>
              </div>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                <Users className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-4 space-y-3.5">
              {report.technicianStats.map((tech) => (
                <div key={tech.name}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-600">{tech.name}</span>
                    <span className="text-[9px] text-slate-400">
                      {tech.open} abiertas · {tech.closed} cerradas
                    </span>
                  </div>
                  <ProgressBar value={tech.load} tone={tech.load > 60 ? 'warning' : 'brand'} />
                </div>
              ))}
              {!report.technicianStats.length ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-[10px] text-slate-400">
                  Aún no hay órdenes asignadas a técnicos.
                </p>
              ) : null}
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[9px] leading-relaxed text-slate-500">
              <ShoppingBag className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
              Los técnicos no ven costos, margen bruto ni utilidad neta. Solo el estado de sus órdenes.
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3.5 xl:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-[15px] font-bold text-ink">Ventas por usuario</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">Quién realizó la venta y cuánto generó.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="border-b border-line bg-slate-50/60">
                  <th className="table-th pl-5">Usuario</th>
                  <th className="table-th">Rol</th>
                  <th className="table-th text-right">Facturas</th>
                  <th className="table-th text-right">Ventas</th>
                  {canGross ? <th className="table-th pr-5 text-right">Margen</th> : null}
                </tr>
              </thead>
              <tbody>
                {report.salesByUser.map((row) => (
                  <tr key={row.userId} className="border-b border-line/70 last:border-0">
                    <td className="table-td pl-5 text-[11px] font-semibold text-ink">{row.name}</td>
                    <td className="table-td text-[10px] text-slate-500">{row.role}</td>
                    <td className="table-td text-right text-[10px] tabular">{formatNumber(row.invoices)}</td>
                    <td className="table-td text-right text-[10px] font-semibold tabular">{formatCurrency(row.sales)}</td>
                    {canGross ? (
                      <td className="table-td pr-5 text-right text-[10px] tabular">
                        {row.margin === null ? '—' : formatCurrency(row.margin)}
                      </td>
                    ) : null}
                  </tr>
                ))}
                {!report.salesByUser.length ? (
                  <tr>
                    <td colSpan={canGross ? 5 : 4} className="px-5 py-8 text-center text-[10px] text-slate-400">
                      Sin ventas en el periodo.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-display text-[15px] font-bold text-ink">Producción por técnico</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">OTs entregadas y facturadas por técnico responsable.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="border-b border-line bg-slate-50/60">
                  <th className="table-th pl-5">Técnico</th>
                  <th className="table-th text-right">OTs</th>
                  <th className="table-th text-right">Ventas</th>
                  {canGross ? <th className="table-th pr-5 text-right">Margen</th> : null}
                </tr>
              </thead>
              <tbody>
                {report.technicianRevenue.map((row) => (
                  <tr key={row.userId} className="border-b border-line/70 last:border-0">
                    <td className="table-td pl-5 text-[11px] font-semibold text-ink">{row.name}</td>
                    <td className="table-td text-right text-[10px] tabular">{formatNumber(row.orders)}</td>
                    <td className="table-td text-right text-[10px] font-semibold tabular">{formatCurrency(row.sales)}</td>
                    {canGross ? (
                      <td className="table-td pr-5 text-right text-[10px] tabular">
                        {row.margin === null ? '—' : formatCurrency(row.margin)}
                      </td>
                    ) : null}
                  </tr>
                ))}
                {!report.technicianRevenue.length ? (
                  <tr>
                    <td colSpan={canGross ? 4 : 3} className="px-5 py-8 text-center text-[10px] text-slate-400">
                      Sin OTs facturadas en el periodo.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {report.purchaseTrackingEnabled ? (
          <div className="card overflow-hidden xl:col-span-2">
            <div className="border-b border-line px-5 py-4">
              <h2 className="font-display text-[15px] font-bold text-ink">Compras por usuario</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">
                Quién compró, cuánto y el margen potencial estimado con el precio de venta actual.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead>
                  <tr className="border-b border-line bg-slate-50/60">
                    <th className="table-th pl-5">Comprador</th>
                    <th className="table-th">Rol</th>
                    <th className="table-th text-right">Compras</th>
                    <th className="table-th text-right">Ítems</th>
                    <th className="table-th text-right">Total</th>
                    <th className="table-th pr-5 text-right">Margen estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.purchasesByUser.map((row) => (
                    <tr key={row.userId} className="border-b border-line/70 last:border-0">
                      <td className="table-td pl-5 text-[11px] font-semibold text-ink">{row.name}</td>
                      <td className="table-td text-[10px] text-slate-500">{row.role}</td>
                      <td className="table-td text-right text-[10px] tabular">{formatNumber(row.purchases)}</td>
                      <td className="table-td text-right text-[10px] tabular">{formatNumber(row.items)}</td>
                      <td className="table-td text-right text-[10px] font-semibold tabular">{formatCurrency(row.total)}</td>
                      <td className="table-td pr-5 text-right text-[10px] tabular">
                        {row.estimatedMargin === null ? '—' : formatCurrency(row.estimatedMargin)}
                      </td>
                    </tr>
                  ))}
                  {!report.purchasesByUser.length ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-[10px] text-slate-400">
                        Sin compras en el periodo.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {report.accountSummary.length ? (
          <div className="card overflow-hidden xl:col-span-2">
            <div className="border-b border-line px-5 py-4">
              <h2 className="font-display text-[15px] font-bold text-ink">Cuenta de ingresos</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">Ingresos digitales, traslados de efectivo y egresos vinculados.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-line bg-slate-50/60">
                    <th className="table-th pl-5">Cuenta</th>
                    <th className="table-th text-right">Ingresos</th>
                    <th className="table-th text-right">Egresos</th>
                    <th className="table-th pr-5 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.accountSummary.map((row) => (
                    <tr key={row.accountName} className="border-b border-line/70 last:border-0">
                      <td className="table-td pl-5 text-[11px] font-semibold text-ink">{row.accountName}</td>
                      <td className="table-td text-right text-[10px] tabular text-success-600">{formatCurrency(row.income)}</td>
                      <td className="table-td text-right text-[10px] tabular text-danger-600">{formatCurrency(row.expenses)}</td>
                      <td className="table-td pr-5 text-right text-[10px] font-semibold tabular">{formatCurrency(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col items-start justify-between gap-2 rounded-2xl border border-line bg-white px-4 py-3 shadow-soft sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <BarChart3 className="h-3.5 w-3.5" />
          </span>
          <p className="text-[10px] text-slate-500">
            {periodLabels[report.period]} · {formatNumber(report.invoiceCount)} facturas activas. IVA no aplicado en ventas;
            IVA 19% solo en compras.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-slate-400">
          {loading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" /> : null}
          <span>Corte: {formatDateTime(new Date())}</span>
          {error ? <Badge variant="danger">Error al actualizar</Badge> : null}
        </div>
      </div>
    </div>
  )
}

function CreditIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
      <Banknote className="h-4 w-4" />
    </span>
  )
}
