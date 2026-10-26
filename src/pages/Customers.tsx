import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Printer,
  QrCode,
  Search,
  ShoppingBag,
  UserPlus,
  UserRound,
  Users,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import type { Customer, Equipment, Invoice } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { api, errorMessage, type CustomerDetail } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { formatCurrency, formatDate } from '@/lib/format'
import { calculateNitDv, normalizeNit } from '@/lib/nit'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { SearchInput, Select } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { WorkOrderStatusBadge } from '@/components/ui/StatusBadge'
import { EquipmentQr } from '@/components/equipment/EquipmentQr'
import { cn } from '@/lib/utils'

const emptyForm = {
  name: '',
  documentType: 'CC' as Customer['documentType'],
  document: '',
  phone: '',
  email: '',
  address: '',
  isForeignDocument: false
}

export function CustomersPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const { data, loading, error, reload, setData } = useApi(() => api.customers.list(), [])
  const items = data ?? []
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'todos' | 'recurrentes' | 'con-ot'>('todos')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [invoiceDetail, setInvoiceDetail] = useState<Invoice | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    ...emptyForm,
    loyaltyActive: false,
    loyaltyDiscountType: 'percent' as 'percent' | 'amount',
    loyaltyDiscountValue: '0',
    loyaltyValidUntil: '',
    loyaltyNotes: ''
  })
  const [equipmentOpen, setEquipmentOpen] = useState(false)
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null)
  const [equipmentSaving, setEquipmentSaving] = useState(false)
  const [qrEnabled, setQrEnabled] = useState(false)
  const [qrEquipment, setQrEquipment] = useState<Equipment | null>(null)
  const [equipmentForm, setEquipmentForm] = useState({
    category: 'laptop',
    categoryLabel: 'Portátil',
    equipmentType: 'Portátil',
    brand: '',
    model: '',
    serial: '',
    accessories: '',
    notes: ''
  })

  const canManage = can(role, 'manageStaff') || can(role, 'createOrder')
  const canLoyalty = can(role, 'manageLoyalty')
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

  useEffect(() => {
    let active = true
    api.equipment
      .qrEnabled()
      .then((enabled) => {
        if (active) setQrEnabled(enabled)
      })
      .catch(() => {
        // Si el rol no puede consultar la configuración, el QR queda oculto.
      })
    return () => {
      active = false
    }
  }, [])

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
    const document = form.document.trim()
    if (form.documentType === 'NIT' && !form.isForeignDocument) {
      const digits = normalizeNit(document)
      if (digits !== document) {
        toast.error('El NIT debe contener solo números, sin puntos ni espacios')
        return
      }
    }
    setSaving(true)
    try {
      const customer = await api.customers.create({
        name: form.name.trim(),
        documentType: form.documentType,
        document,
        phone: form.phone.trim() || '—',
        email: form.email.trim() || '—',
        address: form.address.trim() || 'Sin dirección',
        isForeignDocument: form.isForeignDocument,
        documentDv:
          form.documentType === 'NIT' && !form.isForeignDocument ? calculateNitDv(document) : undefined
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

  async function refreshDetail() {
    if (!selectedId) return
    try {
      const updated = await api.customers.detail(selectedId)
      setDetail(updated)
    } catch {
      // El drawer conserva el detalle previo si falla la recarga.
    }
  }

  function openEditCustomer() {
    if (!selected) return
    setEditForm({
      name: selected.name,
      documentType: selected.documentType,
      document: selected.document,
      phone: selected.phone === '—' ? '' : selected.phone,
      email: selected.email === '—' ? '' : selected.email,
      address: selected.address === 'Sin dirección' ? '' : selected.address,
      isForeignDocument: Boolean(selected.isForeignDocument),
      loyaltyActive: Boolean(selected.loyaltyActive),
      loyaltyDiscountType: selected.loyaltyDiscountType ?? 'percent',
      loyaltyDiscountValue: String(selected.loyaltyDiscountValue ?? 0),
      loyaltyValidUntil: selected.loyaltyValidUntil?.slice(0, 10) ?? '',
      loyaltyNotes: selected.loyaltyNotes ?? ''
    })
    setEditOpen(true)
  }

  async function saveCustomerEdit() {
    if (!selected || editSaving) return
    if (!editForm.name.trim() || !editForm.document.trim()) {
      toast.error('Nombre y documento son obligatorios')
      return
    }
    const document = editForm.document.trim()
    if (editForm.documentType === 'NIT' && !editForm.isForeignDocument) {
      const digits = normalizeNit(document)
      if (digits !== document) {
        toast.error('El NIT debe contener solo números, sin puntos ni espacios')
        return
      }
    }
    setEditSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: editForm.name.trim(),
        documentType: editForm.documentType,
        document,
        isForeignDocument: editForm.isForeignDocument,
        documentDv:
          editForm.documentType === 'NIT' && !editForm.isForeignDocument ? calculateNitDv(document) : undefined,
        phone: editForm.phone.trim(),
        email: editForm.email.trim(),
        address: editForm.address.trim()
      }
      if (canLoyalty) {
        payload.loyaltyActive = editForm.loyaltyActive
        payload.loyaltyDiscountType = editForm.loyaltyDiscountType
        payload.loyaltyDiscountValue = Number(editForm.loyaltyDiscountValue) || 0
        payload.loyaltyValidUntil = editForm.loyaltyValidUntil || null
        payload.loyaltyNotes = editForm.loyaltyNotes.trim()
      }
      const updated = await api.customers.update(selected.id, payload)
      setData((current) =>
        current ? current.map((item) => (item.id === updated.id ? updated : item)) : current
      )
      setDetail((current) => (current ? { ...current, customer: updated } : current))
      setEditOpen(false)
      toast.success('Cliente actualizado')
    } catch (failure) {
      toast.error('No se pudo actualizar el cliente', { description: errorMessage(failure) })
    } finally {
      setEditSaving(false)
    }
  }

  function openNewEquipment() {
    setEditingEquipment(null)
    setEquipmentForm({
      category: 'laptop',
      categoryLabel: 'Portátil',
      equipmentType: 'Portátil',
      brand: '',
      model: '',
      serial: '',
      accessories: '',
      notes: ''
    })
    setEquipmentOpen(true)
  }

  function openEditEquipment(equipment: Equipment) {
    setEditingEquipment(equipment)
    setEquipmentForm({
      category: equipment.category,
      categoryLabel: equipment.categoryLabel,
      equipmentType: equipment.equipmentType,
      brand: equipment.brand,
      model: equipment.model,
      serial: equipment.serial,
      accessories: equipment.accessories === 'Sin accesorios' ? '' : equipment.accessories,
      notes: equipment.notes ?? ''
    })
    setEquipmentOpen(true)
  }

  async function saveEquipment() {
    if (!selected || equipmentSaving) return
    if (!equipmentForm.brand.trim() || !equipmentForm.model.trim()) {
      toast.error('Marca y modelo son obligatorios')
      return
    }
    setEquipmentSaving(true)
    try {
      if (editingEquipment) {
        await api.equipment.update(editingEquipment.id, equipmentForm)
        toast.success('Equipo actualizado')
      } else {
        await api.equipment.create({ customerId: selected.id, ...equipmentForm })
        toast.success('Equipo agregado al cliente')
      }
      setEquipmentOpen(false)
      setEditingEquipment(null)
      await refreshDetail()
    } catch (failure) {
      toast.error('No se pudo guardar el equipo', { description: errorMessage(failure) })
    } finally {
      setEquipmentSaving(false)
    }
  }

  const selectedInvoices = detail?.invoices ?? []
  const selectedOrders = detail?.orders ?? []
  const selectedEquipmentList = detail?.equipment ?? []
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
        description={selected ? `${selected.documentType} ${selected.document}${selected.documentDv ? `-${selected.documentDv}` : ''}` : ''}
        width="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setSelectedId(null)}>
                Cerrar
              </Button>
              {canManage ? (
                <Button variant="secondary" onClick={openEditCustomer} leftIcon={<Pencil className="h-4 w-4" />}>
                  Editar
                </Button>
              ) : null}
            </div>
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
                  {selected.loyaltyActive ? (
                    <Badge variant="warning">
                      Cliente fiel · {selected.loyaltyDiscountType === 'percent'
                        ? `${selected.loyaltyDiscountValue ?? 0}%`
                        : formatCurrency(selected.loyaltyDiscountValue ?? 0)}
                    </Badge>
                  ) : null}
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
              <div className="flex items-center justify-between gap-2">
                <p className="field-label mb-0">Equipos del cliente</p>
                {canManage ? (
                  <Button variant="ghost" size="sm" onClick={openNewEquipment} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                    Agregar equipo
                  </Button>
                ) : null}
              </div>
              {selectedEquipmentList.length ? (
                <div className="mt-1.5 space-y-1.5">
                  {selectedEquipmentList.map((equipment) => {
                    const history = selectedOrders.filter((order) => order.equipmentId === equipment.id).length
                    return (
                      <button
                        key={equipment.id}
                        type="button"
                        onClick={() => openEditEquipment(equipment)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition hover:border-brand-200 hover:bg-brand-50/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-ink">
                            {equipment.brand} {equipment.model}
                          </p>
                          <p className="mt-0.5 text-[9px] text-slate-400">
                            {equipment.serial} · {history} OT{history === 1 ? '' : 's'} · {formatDate(equipment.updatedAt)}
                          </p>
                        </div>
                        <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-1.5 rounded-xl border border-dashed border-line px-3 py-4 text-center text-[10px] text-slate-400">
                  Este cliente aún no tiene equipos registrados.
                </p>
              )}
            </div>

            <div>
              <p className="field-label">Últimas compras</p>
              {selectedInvoices.length ? (
                <div className="space-y-1.5">
                  {selectedInvoices.map((invoice) => (
                    <button
                      key={invoice.id}
                      type="button"
                      onClick={() => setInvoiceDetail(invoice)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition hover:border-brand-200 hover:bg-brand-50/40"
                    >
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
                    </button>
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
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(null)
                        navigate(`/ordenes/${order.id}`)
                      }}
                      className="w-full rounded-xl border border-line px-3 py-2.5 text-left transition hover:border-brand-200 hover:bg-brand-50/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-ink">{order.number}</p>
                        <WorkOrderStatusBadge status={order.status} />
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {order.brand} {order.model} · {formatDate(order.createdAt)}
                      </p>
                    </button>
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
            {form.documentType === 'NIT' && !form.isForeignDocument && /^\d+$/.test(form.document) ? (
              <span className="mt-1 block text-[9px] text-slate-400">DV calculado: {calculateNitDv(form.document)}</span>
            ) : null}
          </label>
          {form.documentType === 'NIT' ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.isForeignDocument}
                onChange={(event) => setForm({ ...form, isForeignDocument: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
              />
              <span className="text-[11px] text-slate-600">NIT extranjero (sin DV colombiano)</span>
            </label>
          ) : null}
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

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Editar cliente"
        description={selected ? `${selected.name} · ${selected.documentType} ${selected.document}` : ''}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Cancelar
            </Button>
            <Button onClick={() => void saveCustomerEdit()} loading={editSaving}>
              Guardar cambios
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre o razón social</span>
            <input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Tipo de documento</span>
            <select
              value={editForm.documentType}
              onChange={(event) => setEditForm({ ...editForm, documentType: event.target.value as Customer['documentType'] })}
              className="field"
            >
              {(['CC', 'NIT', 'Pasaporte'] as const).map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Documento</span>
            <input value={editForm.document} onChange={(event) => setEditForm({ ...editForm, document: event.target.value })} className="field" />
            {editForm.documentType === 'NIT' && !editForm.isForeignDocument && /^\d+$/.test(editForm.document) ? (
              <span className="mt-1 block text-[9px] text-slate-400">DV calculado: {calculateNitDv(editForm.document)}</span>
            ) : null}
          </label>
          {editForm.documentType === 'NIT' ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 sm:col-span-2">
              <input
                type="checkbox"
                checked={editForm.isForeignDocument}
                onChange={(event) => setEditForm({ ...editForm, isForeignDocument: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
              />
              <span className="text-[11px] text-slate-600">NIT extranjero (sin DV colombiano)</span>
            </label>
          ) : null}
          <label className="block">
            <span className="field-label">Teléfono</span>
            <input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Correo</span>
            <input value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} className="field" type="email" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Dirección</span>
            <input value={editForm.address} onChange={(event) => setEditForm({ ...editForm, address: event.target.value })} className="field" />
          </label>

          {canLoyalty ? (
            <div className="rounded-2xl border border-warning-100 bg-warning-50/50 p-4 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[12px] font-semibold text-ink">Fidelidad</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Se aplica automáticamente en POS y OT. El precio final nunca puede quedar por debajo del costo.
                  </p>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={editForm.loyaltyActive}
                    onChange={(event) => setEditForm({ ...editForm, loyaltyActive: event.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                  />
                  Cliente fiel
                </label>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Tipo de descuento</span>
                  <select
                    value={editForm.loyaltyDiscountType}
                    onChange={(event) =>
                      setEditForm({ ...editForm, loyaltyDiscountType: event.target.value as 'percent' | 'amount' })
                    }
                    className="field"
                  >
                    <option value="percent">Porcentaje</option>
                    <option value="amount">Valor fijo</option>
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">
                    {editForm.loyaltyDiscountType === 'percent' ? 'Porcentaje (%)' : 'Valor (COP)'}
                  </span>
                  <input
                    value={editForm.loyaltyDiscountValue}
                    onChange={(event) => setEditForm({ ...editForm, loyaltyDiscountValue: event.target.value })}
                    inputMode="decimal"
                    className="field text-right tabular"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Vigente hasta (opcional)</span>
                  <input
                    type="date"
                    value={editForm.loyaltyValidUntil}
                    onChange={(event) => setEditForm({ ...editForm, loyaltyValidUntil: event.target.value })}
                    className="field"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="field-label">Notas de fidelidad</span>
                  <input
                    value={editForm.loyaltyNotes}
                    onChange={(event) => setEditForm({ ...editForm, loyaltyNotes: event.target.value })}
                    className="field"
                    placeholder="Ej. cliente designado por el propietario"
                  />
                </label>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={equipmentOpen}
        onClose={() => setEquipmentOpen(false)}
        title={editingEquipment ? 'Editar equipo' : 'Nuevo equipo'}
        description={selected ? `${selected.name} · historial de equipos` : ''}
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <div>
              {qrEnabled && editingEquipment ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQrEquipment(editingEquipment)
                    setEquipmentOpen(false)
                  }}
                  leftIcon={<QrCode className="h-4 w-4" />}
                >
                  Etiqueta QR
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEquipmentOpen(false)} disabled={equipmentSaving}>
                Cancelar
              </Button>
              <Button onClick={() => void saveEquipment()} loading={equipmentSaving}>
                {editingEquipment ? 'Guardar cambios' : 'Agregar equipo'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Marca</span>
            <input value={equipmentForm.brand} onChange={(event) => setEquipmentForm({ ...equipmentForm, brand: event.target.value })} className="field" placeholder="Lenovo" />
          </label>
          <label className="block">
            <span className="field-label">Modelo</span>
            <input value={equipmentForm.model} onChange={(event) => setEquipmentForm({ ...equipmentForm, model: event.target.value })} className="field" placeholder="ThinkPad T14" />
          </label>
          <label className="block">
            <span className="field-label">Serial</span>
            <input value={equipmentForm.serial} onChange={(event) => setEquipmentForm({ ...equipmentForm, serial: event.target.value })} className="field" placeholder="Serial del equipo" />
          </label>
          <label className="block">
            <span className="field-label">Tipo</span>
            <input value={equipmentForm.categoryLabel} onChange={(event) => setEquipmentForm({ ...equipmentForm, categoryLabel: event.target.value, equipmentType: event.target.value })} className="field" placeholder="Portátil" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Accesorios</span>
            <input value={equipmentForm.accessories} onChange={(event) => setEquipmentForm({ ...equipmentForm, accessories: event.target.value })} className="field" placeholder="Cargador, mouse, maletín…" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Notas</span>
            <input value={equipmentForm.notes} onChange={(event) => setEquipmentForm({ ...equipmentForm, notes: event.target.value })} className="field" placeholder="Observaciones del equipo" />
          </label>
          <p className="text-[9px] leading-relaxed text-slate-400 sm:col-span-2">
            El equipo no cambia de dueño salvo una corrección autorizada por el propietario. El historial de OT y evidencias se conserva.
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(qrEquipment)}
        onClose={() => setQrEquipment(null)}
        title="Etiqueta QR del equipo"
        description={qrEquipment ? `${qrEquipment.brand} ${qrEquipment.model} · ${qrEquipment.serial}` : ''}
        size="sm"
        footer={
          <div className="flex justify-between gap-2">
            <Button variant="secondary" onClick={() => setQrEquipment(null)}>
              Cerrar
            </Button>
            <Button onClick={() => window.print()} leftIcon={<Printer className="h-4 w-4" />}>
              Imprimir etiqueta
            </Button>
          </div>
        }
      >
        {qrEquipment ? (
          <div className="flex flex-col items-center text-center">
            <EquipmentQr value={qrEquipment.serial || qrEquipment.id} size={200} />
            <p className="mt-3 text-[13px] font-bold text-ink">
              {qrEquipment.brand} {qrEquipment.model}
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">{qrEquipment.serial}</p>
            <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
              Etiqueta interna. El QR contiene el serial para búsqueda con lector USB o manual.
            </p>
          </div>
        ) : null}
      </Modal>

      {qrEquipment ? (
        <>
          <div className="order-print-root pointer-events-none invisible fixed -left-[1000px] top-0 -z-50 print:visible print:static print:z-auto">
            <div className="order-print-sheet flex h-[50mm] w-[80mm] flex-col items-center justify-center bg-white p-[4mm] text-black">
              <EquipmentQr value={qrEquipment.serial || qrEquipment.id} size={120} />
              <p className="mt-1.5 text-[9px] font-bold">
                {qrEquipment.brand} {qrEquipment.model}
              </p>
              <p className="font-mono text-[7px]">{qrEquipment.serial}</p>
              <p className="mt-1 text-[6px] uppercase tracking-[0.14em] text-black/50">BitacoreTech · Equipo</p>
            </div>
          </div>
          <style>{'@media print { @page { size: 80mm 50mm; margin: 0; } }'}</style>
        </>
      ) : null}

      <Modal
        open={Boolean(invoiceDetail)}
        onClose={() => setInvoiceDetail(null)}
        title={invoiceDetail ? `Factura ${invoiceDetail.number}` : 'Factura'}
        description={
          invoiceDetail
            ? `${invoiceDetail.customerName ?? selected?.name ?? 'Cliente'} · ${formatDate(invoiceDetail.date)}`
            : undefined
        }
        size="md"
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setInvoiceDetail(null)}>
              Cerrar
            </Button>
          </div>
        }
      >
        {invoiceDetail ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-slate-50/60 p-3.5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Total de la factura</p>
                <p className="tabular mt-1 font-display text-xl font-bold text-ink">{formatCurrency(invoiceDetail.total)}</p>
              </div>
              <Badge variant={invoiceDetail.status === 'activa' ? 'success' : 'danger'}>
                {invoiceDetail.status === 'activa' ? 'Activa' : 'Anulada'}
              </Badge>
            </div>

            <div>
              <p className="field-label">Detalle</p>
              <div className="divide-y divide-line rounded-xl border border-line">
                {invoiceDetail.lines?.length ? (
                  invoiceDetail.lines.map((line) => (
                    <div key={line.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <div>
                        <p className="text-[11px] text-slate-700">{line.description}</p>
                        <p className="text-[9px] text-slate-400">
                          {line.quantity} × {formatCurrency(line.unitPrice)}
                        </p>
                      </div>
                      <p className="tabular text-[11px] font-semibold text-ink">{formatCurrency(line.lineTotal)}</p>
                    </div>
                  ))
                ) : (
                  <p className="px-3.5 py-4 text-center text-[10px] text-slate-400">Sin detalle de líneas.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-slate-50/60 p-3.5 text-[11px]">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(invoiceDetail.subtotal ?? invoiceDetail.total)}</span>
              </div>
              <div className="mt-1.5 flex justify-between text-slate-500">
                <span>Descuento</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(invoiceDetail.discount ?? 0)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold text-ink">
                <span>Total</span>
                <span className="tabular">{formatCurrency(invoiceDetail.total)}</span>
              </div>
            </div>

            <p className="text-[10px] leading-relaxed text-slate-400">
              Comprobante interno de venta. El pago se registró con {invoiceDetail.method}. No reemplaza la factura
              electrónica DIAN.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
