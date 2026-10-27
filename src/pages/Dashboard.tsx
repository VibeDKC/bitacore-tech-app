import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Eye,
  Filter,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  ShoppingCart,
  Wallet,
  Wrench
} from 'lucide-react'
import type { DashboardData, Role, StockStatus } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can, canAccessModule } from '@/lib/permissions'
import { getStockStatus } from '@/lib/status'
import { formatCurrency, formatNumber } from '@/lib/format'
import { api } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DropdownItem, DropdownMenu } from '@/components/ui/DropdownMenu'
import { StatCard } from '@/components/ui/StatCard'
import { StockStatusBadge } from '@/components/ui/StatusBadge'
import { CashFlowChart } from '@/components/dashboard/CashFlowChart'
import { InventoryDonut } from '@/components/dashboard/InventoryDonut'
import { WorkshopLoad } from '@/components/dashboard/WorkshopLoad'
import { CashSummary } from '@/components/dashboard/CashSummary'
import { toast } from 'sonner'

type StockFilter = 'todos' | 'bajo' | 'agotado'

const statsByRole: Record<
  Role,
  Array<{
    label: string
    hint: string
    tone: 'brand' | 'success' | 'warning' | 'danger'
    icon: any
    value: (data: DashboardData) => string
  }>
> = {
  superadmin: [
    { label: 'Ventas hoy', hint: 'facturado hoy', tone: 'brand', icon: Wallet, value: (data) => formatCurrency(data.stats.salesToday) },
    { label: 'OTs abiertas', hint: 'en el taller', tone: 'warning', icon: Wrench, value: (data) => formatNumber(data.stats.openOrders) },
    { label: 'Equipos listos', hint: 'para entrega', tone: 'success', icon: CheckCircle2, value: (data) => formatNumber(data.stats.readyOrders) },
    { label: 'Stock bajo', hint: 'referencias críticas', tone: 'danger', icon: AlertTriangle, value: (data) => formatNumber(data.stats.lowStock) }
  ],
  admin: [
    { label: 'Ventas hoy', hint: 'facturado hoy', tone: 'brand', icon: Wallet, value: (data) => formatCurrency(data.stats.salesToday) },
    { label: 'OTs abiertas', hint: 'en el taller', tone: 'warning', icon: Wrench, value: (data) => formatNumber(data.stats.openOrders) },
    { label: 'Equipos listos', hint: 'para entrega', tone: 'success', icon: CheckCircle2, value: (data) => formatNumber(data.stats.readyOrders) },
    { label: 'Stock bajo', hint: 'referencias críticas', tone: 'danger', icon: AlertTriangle, value: (data) => formatNumber(data.stats.lowStock) }
  ],
  tecnico: [
    { label: 'OTs en taller', hint: 'en el taller', tone: 'brand', icon: Wrench, value: (data) => formatNumber(data.stats.openOrders) },
    { label: 'En diagnóstico', hint: 'por evaluar', tone: 'warning', icon: ClipboardList, value: (data) => formatNumber(data.stats.diagnosticOrders) },
    { label: 'Listas para entrega', hint: 'para avisar al cliente', tone: 'success', icon: CheckCircle2, value: (data) => formatNumber(data.stats.readyOrders) },
    { label: 'Stock bajo', hint: 'referencias críticas', tone: 'danger', icon: AlertTriangle, value: (data) => formatNumber(data.stats.lowStock) }
  ],
  cajero: [
    { label: 'Ventas hoy', hint: 'facturado hoy', tone: 'brand', icon: Banknote, value: (data) => formatCurrency(data.stats.salesToday) },
    { label: 'Facturas del turno', hint: 'emitidas hoy', tone: 'success', icon: ReceiptText, value: (data) => formatNumber(data.stats.invoicesToday) },
    { label: 'Efectivo esperado', hint: 'en caja', tone: 'warning', icon: Wallet, value: (data) => formatCurrency(data.stats.cashExpected) },
    { label: 'Stock bajo', hint: 'referencias críticas', tone: 'danger', icon: AlertTriangle, value: (data) => formatNumber(data.stats.lowStock) }
  ]
}

const filterLabels: Record<StockFilter, string> = {
  todos: 'Todos los productos',
  bajo: 'Solo stock bajo',
  agotado: 'Solo agotados'
}

export function DashboardPage() {
  const { role, displayUser } = useAuth()
  const navigate = useNavigate()
  const [stockFilter, setStockFilter] = useState<StockFilter>('todos')
  const { data, loading, error, reload } = useApi(() => api.dashboard.get(), [role])

  const products = data?.products ?? []
  const stats = statsByRole[role].map((stat) => ({
    ...stat,
    value: data ? stat.value(data) : '—'
  }))
  const canEdit = can(role, 'editInventory')
  const canSell = canAccessModule(role, 'pos')
  const canCreateOrder = can(role, 'createOrder')

  const tableProducts = useMemo(() => {
    const activeProducts = products.filter((product) => !product.service)
    if (stockFilter === 'bajo') {
      return activeProducts.filter((product) => getStockStatus(product) === 'low').slice(0, 6)
    }
    if (stockFilter === 'agotado') {
      return activeProducts.filter((product) => getStockStatus(product) === 'out').slice(0, 6)
    }
    return activeProducts.slice(0, 6)
  }, [stockFilter, products])

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando tablero…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <AlertTriangle className="h-6 w-6 text-danger-500" />
        <p className="text-sm font-semibold text-ink">No se pudo cargar el dashboard</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>Reintentar</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            {new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}
          </span>
          <span className="hidden h-3 w-px bg-slate-200 sm:block" />
          {data?.cashSession ? (
            <Badge variant="success" dot>
              Caja abierta · Turno #{data.cashSession.id}
            </Badge>
          ) : (
            <Badge variant="neutral" dot>
              Caja cerrada
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateOrder ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => navigate('/ordenes?nueva=1')}
            >
              Nueva OT
            </Button>
          ) : null}
          {canSell ? (
            <Button size="sm" leftIcon={<ShoppingCart className="h-3.5 w-3.5" />} onClick={() => navigate('/pos')}>
              Nueva venta
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {data?.personalPerformance ? (
        <div className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-[14px] font-bold text-ink">Mi rendimiento</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">Últimos 30 días · sin costos ni márgenes</p>
            </div>
            <Badge variant="outline">{displayUser.name}</Badge>
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-line bg-slate-50/60 p-3">
              <p className="text-[9px] uppercase tracking-[0.1em] text-slate-400">Ventas realizadas</p>
              <p className="mt-1 text-[14px] font-bold text-ink">{formatNumber(data.personalPerformance.sellerInvoices)}</p>
              <p className="text-[9px] text-slate-500">{formatCurrency(data.personalPerformance.sellerSales)}</p>
            </div>
            <div className="rounded-xl border border-line bg-slate-50/60 p-3">
              <p className="text-[9px] uppercase tracking-[0.1em] text-slate-400">OTs facturadas</p>
              <p className="mt-1 text-[14px] font-bold text-ink">{formatNumber(data.personalPerformance.technicianOrders)}</p>
              <p className="text-[9px] text-slate-500">{formatCurrency(data.personalPerformance.technicianSales)}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(330px,1fr)]">
        {role === 'tecnico' ? (
          <WorkshopLoad orders={data?.orders ?? []} technician={displayUser.name} />
        ) : role === 'cajero' ? (
          <CashSummary session={data?.cashSession ?? null} />
        ) : (
          <CashFlowChart data={data?.chartData ?? []} />
        )}
        <InventoryDonut summary={data?.stockSummary ?? { in: 0, low: 0, out: 0 }} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col justify-between gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center lg:px-6">
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink">Inventario de productos</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">Existencias, ubicación y alertas de reposición.</p>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu
              align="right"
              panelClassName="w-[210px]"
              trigger={
                <button
                  type="button"
                  className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:text-ink"
                >
                  <Filter className="h-3.5 w-3.5" />
                  {filterLabels[stockFilter]}
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                </button>
              }
            >
              {(Object.keys(filterLabels) as StockFilter[]).map((key) => (
                <DropdownItem
                  key={key}
                  label={filterLabels[key]}
                  active={stockFilter === key}
                  onClick={() => setStockFilter(key)}
                />
              ))}
            </DropdownMenu>
            <button
              type="button"
              onClick={() => navigate('/inventario')}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-[11px] font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Ver todo
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="border-b border-line bg-slate-50/60">
                <th className="table-th pl-5 lg:pl-6">Producto</th>
                <th className="table-th">SKU</th>
                <th className="table-th">Categoría</th>
                <th className="table-th">Ubicación</th>
                <th className="table-th text-right">Unidades</th>
                <th className="table-th">Estado</th>
                <th className="table-th pr-5 text-right lg:pr-6">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tableProducts.map((product) => {
                const Icon = product.icon
                const status: StockStatus = getStockStatus(product)
                return (
                  <tr key={product.id} className="border-b border-line/70 last:border-0 hover:bg-slate-50/50">
                    <td className="table-td pl-5 lg:pl-6">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${product.tone}`}>
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <div className="min-w-0">
                          <p className="max-w-[230px] truncate text-[13px] font-semibold text-ink">{product.name}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">{product.barcode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-td font-mono text-[11px] text-slate-500">{product.sku}</td>
                    <td className="table-td text-[12px]">{product.category}</td>
                    <td className="table-td text-[12px]">{product.location}</td>
                    <td className={`table-td text-right font-semibold tabular ${status === 'out' ? 'text-danger-600' : 'text-ink'}`}>
                      {formatNumber(product.stock)}
                    </td>
                    <td className="table-td">
                      <StockStatusBadge product={product} />
                    </td>
                    <td className="table-td pr-5 lg:pr-6">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/inventario?q=${encodeURIComponent(product.sku)}`)}
                            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand-600 hover:shadow-sm"
                            aria-label={`Editar ${product.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => navigate(`/inventario?q=${encodeURIComponent(product.sku)}`)}
                            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand-600 hover:shadow-sm"
                            aria-label={`Ver ${product.name}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate(`/inventario?q=${encodeURIComponent(product.sku)}`)}
                          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-600 hover:shadow-sm"
                          aria-label={`Más acciones para ${product.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-start justify-between gap-2 border-t border-line px-5 py-3.5 text-[10px] text-slate-400 sm:flex-row sm:items-center lg:px-6">
          <span>Mostrando {tableProducts.length} de {formatNumber(products.filter((product) => !product.service).length)} productos registrados.</span>
          <button
            type="button"
            onClick={() => navigate('/inventario')}
            className="inline-flex items-center gap-1 font-semibold text-brand-600 transition hover:text-brand-700"
          >
            Abrir inventario completo
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-line bg-white px-4 py-3 shadow-soft">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Eye className="h-3.5 w-3.5" />
          </span>
          <p className="text-[11px] text-slate-500">
            Estás viendo BitacoreTech como <span className="font-semibold text-ink">{displayUser.name}</span> ({role === 'superadmin' ? 'Propietario' : role === 'admin' ? 'Administrador' : role === 'tecnico' ? 'Técnico' : 'Cajero'}).
          </p>
        </div>
        <span className="hidden text-[10px] text-slate-400 sm:block">Datos locales · SQLite</span>
      </div>
    </div>
  )
}
