import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Search,
  ShoppingBag,
  UserPlus,
  UserRound,
  Users,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import type { Customer } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { api, errorMessage, type CustomerDetail } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { formatCurrency, formatDate } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { SearchInput, Select } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { WorkOrderStatusBadge } from '@/components/ui/StatusBadge'
import { cn } from '@/lib/utils'

const emptyForm = {
  name: '',
  documentType: 'CC' as Customer['documentType'],
  document: '',
  phone: '',
  email: '',
  address: ''
}

export function CustomersPage() {
  const { role } = useAuth()
  const { data, loading, error, reload, setData } = useApi(() => api.customers.list(), [])
  const items = data ?? []
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'todos' | 'recurrentes' | 'con-ot'>('todos')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const canManage = can(role, 'manageStaff') || can(role, 'createOrder')
  const selected = items.find((item) => item.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let active = true
    setDetailLoading(true)
    api.customers
      .detail(selectedId)
      .then((result) => {
        if (active) setDetail(result)
      })
      .catch((failure) => {
        if (active) {
          setDetail(null)
          toast.error('No se pudo cargar el historial', { description: errorMessage(failure) })
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedId])

  const stats = useMemo(() => {
    const real = items.filter((item) => !item.isFinalConsumer)
    return {
      total: real.length,
      recurring: real.filter((item) => item.purchases >= 5).length,
      openOrders: real.reduce((sum, item) => sum + (item.openOrders ?? 0), 0)
    }
  }, [items])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return items.filter((item) => {
      const matchesQuery =
        !term ||
        item.name.toLowerCase().includes(term) ||
        item.document.toLowerCase().includes(term) ||
        item.phone.includes(term) ||
        item.email.toLowerCase().includes(term)
      const matchesFilter =
        filter === 'todos' ||
        (filter === 'recurrentes' && item.purchases >= 5) ||
        (filter === 'con-ot' && item.orders > 0)
      return matchesQuery && matchesFilter
    })
  }, [items, query, filter])

  function openWhatsApp(customer: Customer) {
    if (!customer.phone || customer.phone === '—') {
      toast.error('Sin teléfono registrado')
      return
    }
    window.open(
      `https://wa.me/57${customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Hola ${customer.name}, te escribimos de BitacoreTech.`
      )}`,
      '_blank'
    )
  }

  async function createCustomer() {
    if (!form.name.trim() || !form.document.trim()) {
      toast.error('Nombre y documento son obligatorios')
      return
    }
    setSaving(true)
    try {
      const customer = await api.customers.create({
        name: form.name.trim(),
        documentType: form.documentType,
        document: form.document.trim(),
        phone: form.phone.trim() || '—',
        email: form.email.trim() || '—',
        address: form.address.trim() || 'Sin dirección'
      })
      setData((current) => (current ? [customer, ...current] : [customer]))
      setCreateOpen(false)
      setForm(emptyForm)
      toast.success('Cliente creado', { description: `${customer.name} · ${customer.document}` })
    } catch (failure) {
      toast.error('No se pudo crear el cliente', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  const selectedInvoices = detail?.invoices ?? []
  const selectedOrders = detail?.orders ?? []
  const highlighted = filtered
    .filter((item) => !item.isFinalConsumer)
    .sort((a, b) => b.purchases + b.orders - (a.purchases + a.orders))
    .slice(0, 6)

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando clientes…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudieron cargar los clientes</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>Reintentar</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clientes"
        description="Historial de compras, equipos y contacto directo por WhatsApp."
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)} leftIcon={<UserPlus className="h-4 w-4" />}>
              Nuevo cliente
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-3">
        {[
          { label: 'Clientes registrados', value: stats.total, icon: Users, tone: 'bg-brand-50 text-brand-600' },
          { label: 'Clientes recurrentes', value: stats.recurring, icon: ShoppingBag, tone: 'bg-success-50 text-success-600' },
          { label: 'OTs activas', value: stats.openOrders, icon: Wrench, tone: 'bg-warning-50 text-warning-600' }
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card flex items-center gap-3.5 p-4">
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', stat.tone)}>
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="font-display text-[24px] font-bold leading-none text-ink">{stat.value}</p>
                <p className="mt-1.5 text-[11px] text-slate-500">{stat.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,1fr)]">
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[16px] font-bold text-ink">Directorio</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">{filtered.length} clientes visibles</p>
              </div>
              <div className="relative">
                <Select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as typeof filter)}
                  className="h-9 w-[170px] pl-3 pr-8 text-[10px] font-semibold"
                >
                  <option value="todos">Todos los clientes</option>
                  <option value="recurrentes">Recurrentes</option>
                  <option value="con-ot">Con órdenes</option>
                </Select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              placeholder="Buscar por nombre, cédula, teléfono o correo..."
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] table-fixed">
              <thead>
                <tr className="border-b border-line bg-slate-50/60">
                  <th className="table-th w-[32%] pl-5">Cliente</th>
                  <th className="table-th w-[20%]">Contacto</th>
                  <th className="table-th w-[15%] text-center">Actividad</th>
                  <th className="table-th w-[16%]">Última visita</th>
                  <th className="table-th w-[17%] pr-5 text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((customer) => (
                  <tr
                    key={customer.id}
                    onClick={() => setSelectedId(customer.id)}
                    className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="table-td pl-5">
                      <div className="flex items-center gap-3">
                        {customer.isFinalConsumer ? (
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                            <UserRound className="h-4 w-4" />
                          </span>
                        ) : (
                          <Avatar name={customer.name} size="sm" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold text-ink">{customer.name}</p>
                          <p className="mt-0.5 truncate text-[9px] text-slate-400">
                            {customer.documentType} {customer.document}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="table-td">
                      <p className="truncate text-[11px] text-slate-600">{customer.phone}</p>
                      <p className="mt-0.5 truncate text-[9px] text-slate-400">{customer.email}</p>
                    </td>
                    <td className="table-td text-center">
                      <p className="tabular text-[10px] font-semibold text-slate-600">{customer.purchases} compras</p>
                      <p className="mt-0.5 tabular text-[9px] font-semibold text-brand-700">{customer.orders} OTs</p>
                    </td>
                    <td className="table-td text-[11px]">{formatDate(customer.lastVisit)}</td>
                    <td className="table-td pr-5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openWhatsApp(customer)
                          }}
                          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-success-600 hover:shadow-sm"
                          aria-label="Abrir WhatsApp"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!filtered.length ? (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <Search className="h-6 w-6 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-ink">Sin clientes encontrados</p>
              <p className="mt-1 text-xs text-slate-500">Prueba con otro nombre o documento.</p>
            </div>
          ) : null}
        </div>

        <div className="card h-fit p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-[16px] font-bold text-ink">Clientes frecuentes</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">Mayor actividad en el taller</p>
            </div>
            <Badge variant="brand">Top {highlighted.length}</Badge>
          </div>
          <div className="mt-4 space-y-2.5">
            {highlighted.map((customer, index) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => setSelectedId(customer.id)}
                className="focus-ring flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition hover:border-brand-200 hover:bg-brand-50/30"
              >
                <span className="tabular w-4 text-[10px] font-bold text-slate-300">{String(index + 1).padStart(2, '0')}</span>
                <Avatar name={customer.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-ink">{customer.name}</p>
                  <p className="mt-0.5 text-[9px] text-slate-400">{customer.purchases} compras · {customer.orders} OTs</p>
                </div>
                <MessageCircle
                  className="h-3.5 w-3.5 shrink-0 text-slate-300 transition hover:text-success-600"
                  onClick={(event) => {
                    event.stopPropagation()
                    openWhatsApp(customer)
                  }}
                />
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-line bg-slate-50/70 px-3.5 py-2.5">
            <p className="text-[10px] leading-relaxed text-slate-500">
              Los mensajes de WhatsApp usan enlaces <span className="font-semibold text-ink">wa.me</span> con plantillas precargadas. No requieren API externa.
            </p>
          </div>
        </div>
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? 'Cliente'}
        description={selected ? `${selected.documentType} ${selected.document}` : ''}
        width="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setSelectedId(null)}>
              Cerrar
            </Button>
            <Button
              onClick={() => selected && openWhatsApp(selected)}
              leftIcon={<MessageCircle className="h-4 w-4" />}
              disabled={!selected || selected.phone === '—'}
            >
              Escribir por WhatsApp
            </Button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            {detailLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-slate-50 px-3 py-2 text-[10px] text-slate-500">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                Cargando historial del cliente…
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <Avatar name={selected.name} size="lg" status="online" />
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={selected.purchases >= 5 ? 'success' : 'neutral'}>
                    {selected.purchases >= 5 ? 'Cliente frecuente' : 'Cliente'}
                  </Badge>
                  {selected.orders > 0 ? <Badge variant="brand">{selected.orders} OTs</Badge> : null}
                </div>
                <p className="mt-1.5 text-[10px] text-slate-400">
                  Última visita: {formatDate(selected.lastVisit)}
                </p>
              </div>
            </div>

            <div className="divide-y divide-line rounded-xl border border-line">
              {[
                [Phone, 'Teléfono', selected.phone],
                [Mail, 'Correo', selected.email],
                [MapPin, 'Dirección', selected.address],
                [CalendarDays, 'Última visita', formatDate(selected.lastVisit)]
              ].map(([Icon, label, value]) => {
                const FieldIcon = Icon as typeof Phone
                return (
                  <div key={String(label)} className="flex items-center gap-3 px-3.5 py-2.5">
                    <FieldIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="w-16 text-[9px] uppercase tracking-[0.08em] text-slate-400">{String(label)}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{String(value)}</span>
                  </div>
                )
              })}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                ['Compras', selected.purchases],
                ['Órdenes', selected.orders],
                ['Facturado', formatCurrency(selectedInvoices.reduce((sum, invoice) => sum + invoice.total, 0))]
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-line bg-slate-50/60 p-2.5 text-center">
                  <p className="tabular text-[14px] font-bold text-ink">{value}</p>
                  <p className="mt-0.5 text-[9px] text-slate-400">{String(label)}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="field-label">Últimas compras</p>
              {selectedInvoices.length ? (
                <div className="space-y-1.5">
                  {selectedInvoices.map((invoice) => (
                    <div key={invoice.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
                      <div>
                        <p className="text-[11px] font-semibold text-ink">{invoice.number}</p>
                        <p className="mt-0.5 text-[9px] text-slate-400">{formatDate(invoice.date)} · {invoice.method}</p>
                      </div>
                      <div className="text-right">
                        <p className="tabular text-[11px] font-semibold text-ink">{formatCurrency(invoice.total)}</p>
                        <Badge variant={invoice.status === 'activa' ? 'success' : 'danger'} className="mt-0.5">
                          {invoice.status === 'activa' ? 'Activa' : 'Anulada'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[10px] text-slate-400">
                  Aún no hay facturas registradas para este cliente.
                </p>
              )}
            </div>

            <div>
              <p className="field-label">Órdenes de trabajo</p>
              {selectedOrders.length ? (
                <div className="space-y-1.5">
                  {selectedOrders.map((order) => (
                    <div key={order.id} className="rounded-xl border border-line px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-ink">{order.number}</p>
                        <WorkOrderStatusBadge status={order.status} />
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {order.brand} {order.model} · {formatDate(order.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[10px] text-slate-400">
                  Este cliente no tiene órdenes registradas.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuevo cliente"
        description="Datos básicos para ventas y órdenes de trabajo."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={createCustomer} disabled={saving} leftIcon={<Plus className="h-4 w-4" />}>
              {saving ? 'Creando…' : 'Crear cliente'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre completo</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" placeholder="Nombre o razón social" />
          </label>
          <label className="block">
            <span className="field-label">Tipo de documento</span>
            <select
              value={form.documentType}
              onChange={(event) => setForm({ ...form, documentType: event.target.value as Customer['documentType'] })}
              className="field"
            >
              {['CC', 'NIT', 'Pasaporte'].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Documento</span>
            <input value={form.document} onChange={(event) => setForm({ ...form, document: event.target.value })} className="field" placeholder="Número" />
          </label>
          <label className="block">
            <span className="field-label">Teléfono / WhatsApp</span>
            <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="field" placeholder="310 000 0000" />
          </label>
          <label className="block">
            <span className="field-label">Correo</span>
            <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" placeholder="cliente@correo.com" type="email" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Dirección</span>
            <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="field" placeholder="Dirección de contacto" />
          </label>
        </div>
      </Modal>
    </div>
  )
}
