import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  MessageCircle,
  Plus,
  Search,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import type { Customer, WorkOrder } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { workOrderTotal } from '@/lib/orders'
import { formatCurrency, formatShortDate } from '@/lib/format'
import { downloadCsv } from '@/lib/download'
import { api } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { SearchInput, Select } from '@/components/ui/Input'
import { WorkOrderStatusBadge } from '@/components/ui/StatusBadge'
import { SegmentedTabs } from '@/components/ui/Tabs'
import { cn } from '@/lib/utils'

type OrderTab = 'todas' | 'abiertas' | 'diagnostico' | 'listas' | 'cerradas'

export function OrdersPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data, loading, error, reload } = useApi(
    async () => {
      const [orders, customers] = await Promise.all([api.orders.list(), api.customers.list()])
      return { orders, customers }
    },
    []
  )
  const orders = data?.orders ?? []
  const customers = data?.customers ?? []
  const [tab, setTab] = useState<OrderTab>('todas')
  const [query, setQuery] = useState('')
  const [technician, setTechnician] = useState('Todos')
  const technicians = useMemo(
    () => ['Todos', ...Array.from(new Set(orders.map((order) => order.technician))).sort()],
    [orders]
  )

  const canCreate = can(role, 'createOrder')

  useEffect(() => {
    if (searchParams.get('nueva') === '1') navigate('/ordenes/nueva', { replace: true })
  }, [searchParams, navigate])

  const now = Date.now()
  const counts = useMemo(
    () => ({
      open: orders.filter((order) => !['entregado', 'no_reparado'].includes(order.status)).length,
      diagnostic: orders.filter((order) => order.status === 'diagnostico').length,
      ready: orders.filter((order) => order.status === 'listo').length,
      delayed: orders.filter(
        (order) =>
          !['entregado', 'no_reparado'].includes(order.status) &&
          new Date(order.promisedAt).getTime() < now
      ).length
    }),
    [orders, now]
  )

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return orders.filter((order) => {
      const matchesTab =
        tab === 'todas' ||
        (tab === 'abiertas' && !['entregado', 'no_reparado'].includes(order.status)) ||
        (tab === 'diagnostico' && order.status === 'diagnostico') ||
        (tab === 'listas' && order.status === 'listo') ||
        (tab === 'cerradas' && ['entregado', 'no_reparado'].includes(order.status))
      const matchesTech = technician === 'Todos' || order.technician === technician
      const matchesQuery =
        !term ||
        order.number.toLowerCase().includes(term) ||
        order.customerName.toLowerCase().includes(term) ||
        order.brand.toLowerCase().includes(term) ||
        order.model.toLowerCase().includes(term) ||
        order.serial.toLowerCase().includes(term)
      return matchesTab && matchesTech && matchesQuery
    })
  }, [orders, tab, technician, query])

  function submitOrder() {
    navigate('/ordenes/nueva')
  }

  function exportOrders() {
    const rows = filtered.map((order) => [
      order.number,
      order.customerName,
      `${order.brand} ${order.model}`,
      order.serial,
      order.status,
      order.technician,
      formatShortDate(order.createdAt),
      formatCurrency(workOrderTotal(order))
    ])
    downloadCsv('bitacoretech-ordenes.csv', [
      ['OT', 'Cliente', 'Equipo', 'Serial', 'Estado', 'Técnico', 'Ingreso', 'Total'],
      ...rows
    ])
    toast.success('Órdenes exportadas', {
      description: `${filtered.length} OT en CSV con los filtros actuales.`
    })
  }

  const statCards = [
    { label: 'OTs abiertas', value: counts.open, icon: Wrench, tone: 'bg-brand-50 text-brand-600' },
    { label: 'En diagnóstico', value: counts.diagnostic, icon: ClipboardList, tone: 'bg-sky-50 text-sky-600' },
    { label: 'Listas para entrega', value: counts.ready, icon: CheckCircle2, tone: 'bg-success-50 text-success-600' },
    { label: 'Promesa vencida', value: counts.delayed, icon: AlertTriangle, tone: 'bg-warning-50 text-warning-600' }
  ]

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando órdenes…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudieron cargar las órdenes</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>Reintentar</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Órdenes de trabajo"
        description="Recepción, diagnóstico y entrega de cada equipo con trazabilidad completa."
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={exportOrders}
            >
              Exportar
            </Button>
            {canCreate ? (
              <Button
                onClick={submitOrder}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Nueva OT
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card flex items-center gap-3.5 p-4">
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', stat.tone)}>
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="tabular font-display text-[24px] font-bold leading-none text-ink">{stat.value}</p>
                <p className="mt-1.5 text-[11px] text-slate-500">{stat.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <SegmentedTabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'todas', label: 'Todas', count: orders.length },
              { value: 'abiertas', label: 'Abiertas', count: counts.open },
              { value: 'diagnostico', label: 'Diagnóstico', count: counts.diagnostic },
              { value: 'listas', label: 'Listas', count: counts.ready },
              { value: 'cerradas', label: 'Cerradas' }
            ]}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              placeholder="Buscar OT, cliente, equipo o serial..."
              wrapClassName="w-full sm:w-[300px]"
            />
            <div className="relative">
              <Select
                value={technician}
                onChange={(event) => setTechnician(event.target.value)}
                className="h-10 w-full pl-3 pr-8 text-[11px] font-semibold sm:w-[168px]"
              >
                {technicians.map((item) => (
                  <option key={item} value={item}>
                    {item === 'Todos' ? 'Todo el taller' : item}
                  </option>
                ))}
              </Select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed border-collapse">
            <thead>
              <tr className="border-b border-line bg-slate-50/60">
                <th className="table-th w-[24%] pl-5 lg:pl-6">OT / Equipo</th>
                <th className="table-th w-[17%]">Cliente</th>
                <th className="table-th w-[12%]">Técnico</th>
                <th className="table-th w-[16%]">Estado</th>
                <th className="table-th w-[12%]">Fechas</th>
                <th className="table-th w-[9%] text-right">Total</th>
                <th className="table-th w-[10%] pr-5 text-right lg:pr-6"> </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const delayed =
                  !['entregado', 'no_reparado'].includes(order.status) &&
                  new Date(order.promisedAt).getTime() < now
                const customer = customers.find((item) => item.id === order.customerId)
                return (
                  <tr
                    key={order.id}
                    onClick={() => navigate(`/ordenes/${order.id}`)}
                    className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="table-td pl-5 lg:pl-6">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                          <Wrench className="h-[17px] w-[17px]" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-bold text-ink">{order.number}</p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">
                            {order.brand} {order.model}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[9px] text-slate-400">{order.serial}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-td">
                      <p className="truncate text-[12px] font-semibold text-ink">{order.customerName}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{customer?.phone ?? '—'}</p>
                    </td>
                    <td className="table-td truncate text-[11px]">{order.technician}</td>
                    <td className="table-td">
                      <WorkOrderStatusBadge status={order.status} />
                    </td>
                    <td className="table-td">
                      <p className="text-[10px] text-slate-500">Ing. {formatShortDate(order.createdAt)}</p>
                      <p className={cn('mt-0.5 text-[10px]', delayed ? 'font-semibold text-danger-600' : 'text-slate-400')}>
                        Prom. {formatShortDate(order.promisedAt)}
                      </p>
                      {delayed ? <p className="mt-0.5 text-[9px] font-semibold text-danger-500">Vencida</p> : null}
                    </td>
                    <td className="table-td text-right text-[12px] font-semibold tabular text-ink">
                      {(order.total ?? workOrderTotal(order)) > 0 ? formatCurrency(order.total ?? workOrderTotal(order)) : '—'}
                    </td>
                    <td className="table-td pr-5 lg:pr-6">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            if (customer?.phone && customer.phone !== '—') {
                              const digits = customer.phone.replace(/\D/g, '')
                              window.open(
                                `https://wa.me/57${digits}?text=${encodeURIComponent(
                                  `Hola ${customer.name}, te escribimos de BitacoreTech por tu orden ${order.number}.`
                                )}`,
                                '_blank'
                              )
                            } else {
                              toast('Sin teléfono registrado', { description: 'Agrega un número al cliente para usar WhatsApp.' })
                            }
                          }}
                          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-success-600 hover:shadow-sm"
                          aria-label="Enviar WhatsApp"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!filtered.length ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <Search className="h-6 w-6 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-ink">No encontramos órdenes</p>
            <p className="mt-1 text-xs text-slate-500">Ajusta los filtros o crea una nueva OT.</p>
          </div>
        ) : null}

        <div className="flex flex-col items-start justify-between gap-2 border-t border-line px-5 py-3.5 text-[10px] text-slate-400 sm:flex-row sm:items-center lg:px-6">
          <span>Mostrando {filtered.length} de {orders.length} órdenes de trabajo.</span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
            Sincronizado con SQLite local
          </span>
        </div>
      </div>

    </div>
  )
}
