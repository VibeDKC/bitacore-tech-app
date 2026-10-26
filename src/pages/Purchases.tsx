import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronDown,
  Download,
  FileText,
  MessageCircle,
  PackagePlus,
  Phone,
  Plus,
  ReceiptText,
  ShieldCheck,
  Trash2,
  Truck
} from 'lucide-react'
import { toast } from 'sonner'
import type { Purchase, Supplier } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { formatCurrency, formatDate } from '@/lib/format'
import { downloadCsv } from '@/lib/download'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Select } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/Tabs'
import { cn } from '@/lib/utils'

interface PurchaseLine {
  productId: string
  quantity: string
  unitPrice: string
}

interface PurchaseForm {
  supplierId: string
  number: string
  date: string
  status: Purchase['status']
  lines: PurchaseLine[]
}

const emptyLine: PurchaseLine = { productId: '', quantity: '1', unitPrice: '' }

function parseMoney(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

export function PurchasesPage() {
  const { role } = useAuth()
  const { data, loading, error, reload } = useApi(async () => {
    const [result, products] = await Promise.all([api.purchases.list(), api.inventory.list()])
    return { ...result, products }
  }, [])
  const purchases = useMemo(() => data?.purchases ?? [], [data?.purchases])
  const suppliers = useMemo(() => data?.suppliers ?? [], [data?.suppliers])
  const products = useMemo(() => data?.products ?? [], [data?.products])

  const [tab, setTab] = useState<'compras' | 'proveedores'>('compras')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<PurchaseForm>({
    supplierId: '',
    number: '',
    date: new Date().toISOString().slice(0, 10),
    status: 'recibida',
    lines: [{ ...emptyLine }]
  })

  const canCreate = can(role, 'createPurchase')
  const selected = purchases.find((purchase) => purchase.id === selectedId) ?? null
  const stockProducts = products.filter((product) => !product.service)

  useEffect(() => {
    if (!suppliers.length) return
    setForm((current) =>
      current.supplierId && suppliers.some((supplier) => supplier.id === current.supplierId)
        ? current
        : { ...current, supplierId: suppliers[0].id }
    )
  }, [suppliers])

  const stats = useMemo(() => {
    return {
      total: purchases.reduce((sum, purchase) => sum + purchase.total, 0),
      iva: purchases.reduce((sum, purchase) => sum + purchase.iva, 0),
      pending: purchases.filter((purchase) => purchase.status === 'pendiente').reduce((sum, purchase) => sum + purchase.total, 0),
      suppliers: suppliers.length
    }
  }, [purchases, suppliers])

  const subtotalPreview = form.lines.reduce(
    (sum, line) => sum + parseMoney(line.unitPrice) * (Number(line.quantity) || 0),
    0
  )
  const ivaPreview = Math.round(subtotalPreview * 0.19)
  const totalPreview = subtotalPreview + ivaPreview

  function updateLine(index: number, patch: Partial<PurchaseLine>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line))
    }))
  }

  function addLine() {
    setForm((current) => ({ ...current, lines: [...current.lines, { ...emptyLine }] }))
  }

  function removeLine(index: number) {
    setForm((current) => ({
      ...current,
      lines: current.lines.length > 1 ? current.lines.filter((_, lineIndex) => lineIndex !== index) : current.lines
    }))
  }

  async function createPurchase() {
    if (saving) return
    if (!form.supplierId) {
      toast.error('Selecciona un proveedor')
      return
    }
    if (!form.number.trim()) {
      toast.error('Ingresa el número de factura')
      return
    }
    const lines = form.lines
      .filter((line) => line.productId && Number(line.quantity) > 0 && parseMoney(line.unitPrice) > 0)
      .map((line) => ({
        productId: line.productId,
        quantity: Number(line.quantity) || 1,
        unitPrice: parseMoney(line.unitPrice)
      }))
    if (!lines.length) {
      toast.error('Agrega al menos una línea con producto, cantidad y valor')
      return
    }
    setSaving(true)
    try {
      const purchase = await api.purchases.create({
        supplierId: form.supplierId,
        number: form.number.trim(),
        date: new Date(`${form.date}T12:00:00`).toISOString(),
        status: form.status,
        items: lines
      })
      setCreateOpen(false)
      setForm({
        supplierId: suppliers[0]?.id ?? '',
        number: '',
        date: new Date().toISOString().slice(0, 10),
        status: 'recibida',
        lines: [{ ...emptyLine }]
      })
      toast.success('Compra registrada', {
        description: `${purchase.number} · ${formatCurrency(purchase.total)} · IVA ${formatCurrency(purchase.iva)}`
      })
      reload()
    } catch (failure) {
      toast.error('No se pudo registrar la compra', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  function exportPurchases() {
    downloadCsv('bitacoretech-compras.csv', [
      ['Factura', 'Proveedor', 'Fecha', 'Ítems', 'Subtotal', 'IVA', 'Total', 'Estado'],
      ...purchases.map((purchase) => [
        purchase.number,
        purchase.supplier,
        formatDate(purchase.date),
        purchase.items,
        purchase.subtotal,
        purchase.iva,
        purchase.total,
        purchase.status
      ])
    ])
    toast.success('Compras exportadas', { description: 'Archivo CSV con el IVA soportado del periodo.' })
  }

  function openWhatsApp(supplier: Supplier) {
    window.open(
      `https://wa.me/57${supplier.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Hola ${supplier.contact}, te escribimos de BitacoreTech para coordinar un pedido.`
      )}`,
      '_blank'
    )
  }

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando compras…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudieron cargar las compras</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>Reintentar</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Compras y proveedores"
        description="Ingresa mercancía, actualiza costos y controla el IVA soportado en cada compra."
        actions={
          <>
            <Button variant="secondary" onClick={exportPurchases} leftIcon={<Download className="h-4 w-4" />}>
              Exportar
            </Button>
            {canCreate ? (
              <Button onClick={() => setCreateOpen(true)} leftIcon={<PackagePlus className="h-4 w-4" />}>
                Registrar compra
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Compras del mes', value: formatCurrency(stats.total), icon: Truck, tone: 'bg-brand-50 text-brand-600' },
          { label: 'IVA soportado', value: formatCurrency(stats.iva), icon: ReceiptText, tone: 'bg-sky-50 text-sky-600' },
          { label: 'Pendiente por pagar', value: formatCurrency(stats.pending), icon: CalendarDays, tone: 'bg-warning-50 text-warning-600' },
          { label: 'Proveedores activos', value: String(stats.suppliers), icon: Building2, tone: 'bg-success-50 text-success-600' }
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card flex items-center gap-3.5 p-4">
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', stat.tone)}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-[20px] font-bold leading-none text-ink">{stat.value}</p>
                <p className="mt-1.5 text-[11px] text-slate-500">{stat.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'compras', label: 'Facturas de compra', count: purchases.length },
            { value: 'proveedores', label: 'Proveedores', count: suppliers.length }
          ]}
        />
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          IVA 19% solo en compras · ventas sin IVA por ahora
        </div>
      </div>

      {tab === 'compras' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px]">
              <thead>
                <tr className="border-b border-line bg-slate-50/60">
                  <th className="table-th pl-5 lg:pl-6">Factura / Proveedor</th>
                  <th className="table-th">Fecha</th>
                  <th className="table-th text-center">Ítems</th>
                  <th className="table-th text-right">Subtotal</th>
                  <th className="table-th text-right">IVA 19%</th>
                  <th className="table-th text-right">Total</th>
                  <th className="table-th">Estado</th>
                  <th className="table-th pr-5 text-right lg:pr-6"> </th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr
                    key={purchase.id}
                    onClick={() => setSelectedId(purchase.id)}
                    className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="table-td pl-5 lg:pl-6">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                          <FileText className="h-[17px] w-[17px]" />
                        </span>
                        <div>
                          <p className="text-[12px] font-bold text-ink">{purchase.number}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">{purchase.supplier}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-td text-[11px]">{formatDate(purchase.date)}</td>
                    <td className="table-td text-center text-[11px] tabular">{purchase.items}</td>
                    <td className="table-td text-right text-[11px] tabular">{formatCurrency(purchase.subtotal)}</td>
                    <td className="table-td text-right text-[11px] tabular text-slate-500">{formatCurrency(purchase.iva)}</td>
                    <td className="table-td text-right text-[12px] font-bold tabular text-ink">{formatCurrency(purchase.total)}</td>
                    <td className="table-td">
                      <Badge variant={purchase.status === 'recibida' ? 'success' : 'warning'} dot>
                        {purchase.status === 'recibida' ? 'Recibida' : 'Pendiente'}
                      </Badge>
                    </td>
                    <td className="table-td pr-5 lg:pr-6">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400">
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </td>
                  </tr>
                ))}
                {!purchases.length ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-10 text-center text-[11px] text-slate-400">
                      No hay compras registradas todavía.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col items-start justify-between gap-2 border-t border-line px-5 py-3.5 text-[10px] text-slate-400 sm:flex-row sm:items-center lg:px-6">
            <span>{purchases.length} facturas de compra registradas.</span>
            <span>El IVA se registra únicamente en las compras a proveedores.</span>
          </div>
        </div>
      ) : (
        <div className="grid gap-3.5 md:grid-cols-2">
          {suppliers.map((supplier) => (
            <div key={supplier.id} className="card p-4 transition hover:shadow-pop">
              <div className="flex items-start gap-3">
                <Avatar name={supplier.name} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-bold text-ink">{supplier.name}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">NIT {supplier.nit}</p>
                    </div>
                    <Badge variant="neutral">{supplier.purchases} compras</Badge>
                  </div>
                  <p className="mt-2 text-[10px] font-medium text-brand-600">{supplier.category}</p>
                  <div className="mt-3 space-y-1.5 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3 text-slate-300" /> {supplier.contact} · {supplier.phone}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openWhatsApp(supplier)} leftIcon={<MessageCircle className="h-3.5 w-3.5" />}>
                      WhatsApp
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTab('compras')
                        toast(`${supplier.name}`, {
                          description: `${supplier.purchases} compras registradas en el historial.`
                        })
                      }}
                    >
                      Ver historial
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div className="rounded-2xl border border-dashed border-line p-5 md:col-span-2">
            <div className="flex flex-col items-center justify-center text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
                <Truck className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-semibold text-ink">Proveedores activos</p>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Los proveedores existentes se administran desde la base local. Asócialos a cada compra para controlar el IVA.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => toast('Proveedores', { description: 'La creación de proveedores se habilitará en una próxima versión.' })}
              >
                Agregar proveedor
              </Button>
            </div>
          </div>
        </div>
      )}

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected ? `Compra ${selected.number}` : 'Compra'}
        description={selected?.supplier ?? ''}
        width="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setSelectedId(null)}>
              Cerrar
            </Button>
            <Button onClick={() => toast('Comprobante de compra', { description: 'El comprobante se genera con la factura del proveedor.' })}>
              Imprimir comprobante
            </Button>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <Truck className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[12px] font-semibold text-ink">{selected.supplier}</p>
                  <p className="text-[10px] text-slate-400">Factura de compra</p>
                </div>
              </div>
              <Badge variant={selected.status === 'recibida' ? 'success' : 'warning'} dot>
                {selected.status === 'recibida' ? 'Recibida' : 'Pendiente'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-line bg-slate-50/60 p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Fecha</p>
                <p className="mt-1 text-[12px] font-semibold text-ink">{formatDate(selected.date)}</p>
              </div>
              <div className="rounded-xl border border-line bg-slate-50/60 p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Ítems</p>
                <p className="tabular mt-1 text-[12px] font-semibold text-ink">{selected.items} productos</p>
              </div>
            </div>

            <div>
              <p className="field-label">Detalle</p>
              <div className="divide-y divide-line rounded-xl border border-line">
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="text-[11px] text-slate-600">Mercancía y repuestos según factura</span>
                  <span className="tabular text-[11px] font-semibold text-ink">{formatCurrency(selected.subtotal)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-slate-50/60 p-4">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Subtotal</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(selected.subtotal)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                <span>IVA 19%</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(selected.iva)}</span>
              </div>
              <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5">
                <span className="text-[12px] font-semibold text-slate-600">Total</span>
                <span className="tabular font-display text-xl font-bold text-ink">{formatCurrency(selected.total)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5">
              <p className="text-[10px] leading-relaxed text-brand-800">
                La compra actualiza el costo y el stock de los repuestos asociados. El IVA soportado queda disponible para reportes contables.
              </p>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Registrar compra"
        description="Ingresa una factura de proveedor y actualiza el inventario."
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[9px] uppercase tracking-[0.1em] text-slate-400">Total con IVA</p>
              <p className="tabular font-display text-base font-bold text-ink">{formatCurrency(totalPreview)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button onClick={() => void createPurchase()} loading={saving} leftIcon={<Plus className="h-4 w-4" />}>
                Registrar
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Proveedor</span>
            <div className="relative">
              <Select value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })} className="pr-9">
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name} · {supplier.nit}
                  </option>
                ))}
              </Select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          </label>
          <label className="block">
            <span className="field-label">N.º factura</span>
            <input value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} className="field" placeholder="FC-00000" />
          </label>
          <label className="block">
            <span className="field-label">Fecha</span>
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Estado</span>
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as Purchase['status'] })}
              className="field"
            >
              <option value="recibida">Recibida</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </label>
          <div className="hidden sm:block" />

          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="field-label mb-0">Productos comprados</span>
              <Button variant="ghost" size="sm" onClick={addLine} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Agregar línea
              </Button>
            </div>
            <div className="space-y-2">
              {form.lines.map((line, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,1fr)_64px_100px_28px] items-center gap-2">
                  <select
                    value={line.productId}
                    onChange={(event) => {
                      const product = stockProducts.find((item) => item.id === event.target.value)
                      updateLine(index, {
                        productId: event.target.value,
                        unitPrice: product ? String(product.cost ?? 0) : ''
                      })
                    }}
                    className="field h-9 text-[11px]"
                  >
                    <option value="">Selecciona producto</option>
                    {stockProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={line.quantity}
                    onChange={(event) => updateLine(index, { quantity: event.target.value })}
                    inputMode="numeric"
                    placeholder="Cant"
                    className="field h-9 text-right text-[11px] tabular"
                  />
                  <input
                    value={line.unitPrice}
                    onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                    inputMode="numeric"
                    placeholder="Costo unit."
                    className="field h-9 text-right text-[11px] tabular"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-danger-50 hover:text-danger-500"
                    aria-label="Quitar línea"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-slate-50/60 p-3 sm:col-span-2">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Subtotal</span>
              <span className="tabular font-semibold text-ink">{formatCurrency(subtotalPreview)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>IVA 19%</span>
              <span className="tabular font-semibold text-ink">{formatCurrency(ivaPreview)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[12px] font-semibold text-slate-600">
              <span>Total</span>
              <span className="tabular text-ink">{formatCurrency(totalPreview)}</span>
            </div>
          </div>
          <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-brand-800 sm:col-span-2">
            Las ventas no llevan IVA en esta etapa. El IVA se registra solo en compras a proveedores. Al marcar la compra como recibida se actualiza el stock y el costo unitario.
          </div>
        </div>
      </Modal>
    </div>
  )
}
