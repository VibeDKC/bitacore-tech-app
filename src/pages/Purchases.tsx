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
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  ScanLine,
  ShieldCheck,
  Trash2,
  Truck
} from 'lucide-react'
import { toast } from 'sonner'
import type { Purchase, Supplier } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { formatCurrency, formatDate } from '@/lib/format'
import { calculateNitDv } from '@/lib/nit'
import { downloadCsv } from '@/lib/download'
import { api, errorMessage } from '@/lib/backend'
import { activeDictionaryNodes, dictionaryValues } from '@/lib/dictionaries'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Select } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/Tabs'
import { PurchaseReceiptModal } from '@/components/purchases/PurchaseReceipt'
import { InvoiceScanReviewModal } from '@/components/purchases/InvoiceScanReview'
import { cn } from '@/lib/utils'

interface PurchaseLine {
  productId: string
  quantity: string
  unitPrice: string
  supplierSku: string
  serialText: string
}

interface PurchaseForm {
  supplierId: string
  number: string
  date: string
  status: Purchase['status']
  paymentCondition: 'contado' | 'credito'
  paymentMethod: string
  paymentAccountId: string
  initialPayment: string
  dueDate: string
  lines: PurchaseLine[]
}

const emptyLine: PurchaseLine = {
  productId: '',
  quantity: '1',
  unitPrice: '',
  supplierSku: '',
  serialText: ''
}

function parseMoney(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

export function PurchasesPage() {
  const { role } = useAuth()
  const { data, loading, error, reload } = useApi(async () => {
    const [result, products, dictionaries] = await Promise.all([
      api.purchases.list(),
      api.inventory.list(),
      api.dictionaries.list()
    ])
    return { ...result, products, dictionaries }
  }, [])
  const purchases = useMemo(() => data?.purchases ?? [], [data?.purchases])
  const suppliers = useMemo(() => data?.suppliers ?? [], [data?.suppliers])
  const products = useMemo(() => data?.products ?? [], [data?.products])
  const supplierCategoryOptions = useMemo(() => {
    const names = dictionaryValues(data?.dictionaries ?? [], 'supplier_category')
    return names.length ? names : ['Repuestos']
  }, [data?.dictionaries])
  const purchaseAccounts = useMemo(
    () => activeDictionaryNodes(data?.dictionaries ?? [], 'purchase_payment_account'),
    [data?.dictionaries]
  )

  const [tab, setTab] = useState<'compras' | 'proveedores'>('compras')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [supplierSaving, setSupplierSaving] = useState(false)
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null)
  const [receiptTarget, setReceiptTarget] = useState<Purchase | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<Purchase | null>(null)
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'Transferencia',
    paymentAccountId: '',
    date: new Date().toISOString().slice(0, 10),
    notes: ''
  })
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    nit: '',
    isForeignNit: false,
    contact: '',
    phone: '',
    category: 'Repuestos'
  })
  const [form, setForm] = useState<PurchaseForm>({
    supplierId: '',
    number: '',
    date: new Date().toISOString().slice(0, 10),
    status: 'recibida',
    paymentCondition: 'contado',
    paymentMethod: 'Transferencia',
    paymentAccountId: '',
    initialPayment: '',
    dueDate: '',
    lines: [{ ...emptyLine }]
  })

  useEffect(() => {
    if (!purchaseAccounts.length) return
    const preferred =
      purchaseAccounts.find((account) => account.channel === 'Transferencia') ?? purchaseAccounts[0]
    setForm((current) =>
      current.paymentAccountId
        ? current
        : {
            ...current,
            paymentAccountId: preferred.id,
            paymentMethod: preferred.channel ?? 'Transferencia'
          }
    )
    setPaymentForm((current) =>
      current.paymentAccountId ? current : { ...current, paymentAccountId: preferred.id }
    )
  }, [purchaseAccounts])

  const canCreate = can(role, 'createPurchase')
  const canScan = canCreate && can(role, 'useAI')
  const selected = purchases.find((purchase) => purchase.id === selectedId) ?? null
  const selectedPurchaseAccount = purchaseAccounts.find(
    (account) => account.id === form.paymentAccountId
  )
  const visiblePurchases = useMemo(
    () => (supplierFilter ? purchases.filter((purchase) => purchase.supplierId === supplierFilter) : purchases),
    [purchases, supplierFilter]
  )
  const filterSupplier = suppliers.find((supplier) => supplier.id === supplierFilter) ?? null
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
      pending: purchases.reduce((sum, purchase) => sum + (purchase.balance ?? 0), 0),
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

  function openNewSupplier() {
    setEditingSupplier(null)
    setSupplierForm({
      name: '',
      nit: '',
      isForeignNit: false,
      contact: '',
      phone: '',
      category: supplierCategoryOptions[0] ?? 'Repuestos'
    })
    setSupplierOpen(true)
  }

  function openEditSupplier(supplier: Supplier) {
    setEditingSupplier(supplier)
    setSupplierForm({
      name: supplier.name,
      nit: supplier.nit === '—' ? '' : supplier.nit,
      isForeignNit: Boolean(supplier.isForeignNit),
      contact: supplier.contact === '—' ? '' : supplier.contact,
      phone: supplier.phone === '—' ? '' : supplier.phone,
      category: supplier.category
    })
    setSupplierOpen(true)
  }

  async function saveSupplier() {
    if (supplierSaving) return
    if (supplierForm.name.trim().length < 2) {
      toast.error('Escribe el nombre del proveedor')
      return
    }
    setSupplierSaving(true)
    try {
      if (editingSupplier) {
        await api.suppliers.update(editingSupplier.id, supplierForm)
        toast.success('Proveedor actualizado')
      } else {
        await api.suppliers.create(supplierForm)
        toast.success('Proveedor creado')
      }
      setSupplierOpen(false)
      await reload()
    } catch (failure) {
      toast.error('No se pudo guardar el proveedor', { description: errorMessage(failure) })
    } finally {
      setSupplierSaving(false)
    }
  }

  function showSupplierHistory(supplier: Supplier) {
    setSupplierFilter(supplier.id)
    setTab('compras')
    setSelectedId(null)
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
        unitPrice: parseMoney(line.unitPrice),
        supplierSku: line.supplierSku.trim(),
        serialText: line.serialText.trim()
      }))
    if (!lines.length) {
      toast.error('Agrega al menos una línea con producto, cantidad y valor')
      return
    }
    if (
      form.paymentCondition === 'credito' &&
      parseMoney(form.initialPayment) > totalPreview
    ) {
      toast.error('El abono inicial no puede superar el total de la compra')
      return
    }
    setSaving(true)
    try {
      const purchase = await api.purchases.create({
        supplierId: form.supplierId,
        number: form.number.trim(),
        date: new Date(`${form.date}T12:00:00`).toISOString(),
        status: form.status,
        paymentCondition: form.paymentCondition,
        paymentMethod: selectedPurchaseAccount?.channel ?? form.paymentMethod,
        paymentAccountId: form.paymentAccountId || undefined,
        initialPayment:
          form.paymentCondition === 'credito' ? parseMoney(form.initialPayment) : 0,
        dueDate:
          form.paymentCondition === 'credito' && form.dueDate
            ? new Date(`${form.dueDate}T12:00:00`).toISOString()
            : null,
        items: lines
      })
      setCreateOpen(false)
      setForm({
        supplierId: suppliers[0]?.id ?? '',
        number: '',
        date: new Date().toISOString().slice(0, 10),
        status: 'recibida',
        paymentCondition: 'contado',
        paymentMethod: selectedPurchaseAccount?.channel ?? 'Transferencia',
        paymentAccountId: selectedPurchaseAccount?.id ?? '',
        initialPayment: '',
        dueDate: '',
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

  function openPayment(purchase: Purchase) {
    setPaymentTarget(purchase)
    setPaymentForm({
      amount: String(Math.round(purchase.balance ?? 0)),
      method: purchaseAccounts[0]?.channel ?? 'Transferencia',
      paymentAccountId: purchaseAccounts[0]?.id ?? '',
      date: new Date().toISOString().slice(0, 10),
      notes: ''
    })
  }

  async function savePayment() {
    if (!paymentTarget || paymentSaving) return
    const amount = parseMoney(paymentForm.amount)
    if (amount <= 0) {
      toast.error('Ingresa un valor de abono')
      return
    }
    setPaymentSaving(true)
    try {
      await api.purchases.addPayment({
        purchaseId: paymentTarget.id,
        amount,
        method: paymentForm.method,
        paymentAccountId: paymentForm.paymentAccountId || undefined,
        date: new Date(`${paymentForm.date}T12:00:00`).toISOString(),
        notes: paymentForm.notes.trim() || undefined
      })
      setPaymentTarget(null)
      toast.success('Abono registrado')
      await reload()
    } catch (failure) {
      toast.error('No se pudo registrar el abono', { description: errorMessage(failure) })
    } finally {
      setPaymentSaving(false)
    }
  }

  function exportPurchases() {
    downloadCsv('bitacoretech-compras.csv', [
      ['Factura', 'Proveedor', 'Fecha', 'Ítems', 'Subtotal', 'IVA', 'Total', 'Estado', 'Pago', 'Pagado', 'Saldo'],
      ...purchases.map((purchase) => [
        purchase.number,
        purchase.supplier,
        formatDate(purchase.date),
        purchase.items,
        purchase.subtotal,
        purchase.iva,
        purchase.total,
        purchase.status,
        purchase.paymentStatus,
        purchase.paid,
        purchase.balance
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
            {canScan ? (
              <Button variant="secondary" onClick={() => setScanOpen(true)} leftIcon={<ScanLine className="h-4 w-4" />}>
                Escanear factura
              </Button>
            ) : null}
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
            { value: 'compras', label: 'Facturas de compra', count: visiblePurchases.length },
            { value: 'proveedores', label: 'Proveedores', count: suppliers.length }
          ]}
        />
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          IVA por línea en compras · ventas sin IVA por ahora
        </div>
      </div>

      {filterSupplier ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5">
          <Badge variant="brand">Proveedor: {filterSupplier.name}</Badge>
          <span className="text-[10px] text-brand-800/70">
            {visiblePurchases.length} compra{visiblePurchases.length === 1 ? '' : 's'} en el historial.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setSupplierFilter(null)}>
            Quitar filtro
          </Button>
        </div>
      ) : null}

      {tab === 'compras' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px]">
              <thead>
                <tr className="border-b border-line bg-slate-50/60">
                  <th className="table-th pl-5 lg:pl-6">Factura / Proveedor</th>
                  <th className="table-th">Fecha</th>
                  <th className="table-th text-center">Ítems</th>
                  <th className="table-th text-right">Subtotal</th>
                  <th className="table-th text-right">IVA</th>
                  <th className="table-th text-right">Total</th>
                  <th className="table-th">Pago</th>
                  <th className="table-th">Recepción</th>
                  <th className="table-th pr-5 text-right lg:pr-6"> </th>
                </tr>
              </thead>
              <tbody>
                {visiblePurchases.map((purchase) => (
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
                      <div className="space-y-1">
                        <Badge variant={purchase.paymentStatus === 'pagada' ? 'success' : 'warning'} dot>
                          {purchase.paymentStatus === 'pagada'
                            ? 'Pagada'
                            : purchase.paymentStatus === 'parcial'
                              ? 'Abonada'
                              : 'Crédito'}
                        </Badge>
                        {purchase.balance > 0 ? (
                          <p className="text-[9px] tabular text-slate-400">
                            Saldo {formatCurrency(purchase.balance)}
                          </p>
                        ) : null}
                      </div>
                    </td>
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
                {!visiblePurchases.length ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-10 text-center text-[11px] text-slate-400">
                      {filterSupplier
                        ? `No hay compras registradas para ${filterSupplier.name}.`
                        : 'No hay compras registradas todavía.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col items-start justify-between gap-2 border-t border-line px-5 py-3.5 text-[10px] text-slate-400 sm:flex-row sm:items-center lg:px-6">
            <span>
              {visiblePurchases.length} factura{visiblePurchases.length === 1 ? '' : 's'} de compra
              {filterSupplier ? ` de ${filterSupplier.name}` : ' registradas'}.
            </span>
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
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        NIT {supplier.nit}{supplier.nitDv ? `-${supplier.nitDv}` : ''}
                      </p>
                    </div>
                    <Badge variant="neutral">{supplier.purchases} compras</Badge>
                  </div>
                  <p className="mt-2 text-[10px] font-medium text-brand-600">{supplier.category}</p>
                  <div className="mt-3 space-y-1.5 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3 text-slate-300" /> {supplier.contact} · {supplier.phone}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openWhatsApp(supplier)} leftIcon={<MessageCircle className="h-3.5 w-3.5" />}>
                      WhatsApp
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => showSupplierHistory(supplier)}
                    >
                      Ver historial
                    </Button>
                    {canCreate ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditSupplier(supplier)}
                        leftIcon={<Pencil className="h-3.5 w-3.5" />}
                      >
                        Editar
                      </Button>
                    ) : null}
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
                Crea y edita proveedores para asociarlos a cada compra y controlar el IVA soportado.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={openNewSupplier}
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
            <div className="flex gap-2">
              {selected && selected.balance > 0 ? (
                <Button variant="secondary" onClick={() => openPayment(selected)}>
                  Registrar abono
                </Button>
              ) : null}
              <Button onClick={() => selected && setReceiptTarget(selected)}>
                Imprimir comprobante
              </Button>
            </div>
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
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {selected.ai ? <Badge variant="brand">Procesada con IA</Badge> : null}
                <Badge variant={selected.status === 'recibida' ? 'success' : 'warning'} dot>
                  {selected.status === 'recibida' ? 'Recibida' : 'Pendiente'}
                </Badge>
              </div>
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
                {selected.lines?.length ? (
                  selected.lines.map((line) => (
                    <div key={line.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-ink">{line.description}</p>
                        <p className="mt-0.5 text-[9px] text-slate-400">
                          {line.quantity} × {formatCurrency(line.unitPrice)} · IVA {line.ivaRate}% ·{' '}
                          {formatCurrency(line.iva)}
                          {line.supplierSku ? ` · Ref. ${line.supplierSku}` : ''}
                        </p>
                        {line.serialText ? (
                          <p className="mt-0.5 break-words text-[9px] text-slate-400">
                            Seriales: {line.serialText}
                          </p>
                        ) : null}
                      </div>
                      <span className="tabular shrink-0 text-[11px] font-semibold text-ink">
                        {formatCurrency(line.lineTotal)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-[11px] text-slate-600">Mercancía y repuestos según factura</span>
                    <span className="tabular text-[11px] font-semibold text-ink">{formatCurrency(selected.subtotal)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-slate-50/60 p-4">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Subtotal</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(selected.subtotal)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                <span>IVA</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(selected.iva)}</span>
              </div>
              {selected.discount > 0 ? (
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Descuento</span>
                  <span className="tabular font-semibold text-success-700">- {formatCurrency(selected.discount)}</span>
                </div>
              ) : null}
              {selected.adjustment !== 0 ? (
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Ajuste</span>
                  <span className="tabular font-semibold text-warning-700">{formatCurrency(selected.adjustment)}</span>
                </div>
              ) : null}
              <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5">
                <span className="text-[12px] font-semibold text-slate-600">Total</span>
                <span className="tabular font-display text-xl font-bold text-ink">{formatCurrency(selected.total)}</span>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-slate-50/60 p-4">
              <div className="flex items-center justify-between">
                <p className="field-label mb-0">Pago al proveedor</p>
                <Badge variant={selected.paymentStatus === 'pagada' ? 'success' : 'warning'}>
                  {selected.paymentStatus === 'pagada'
                    ? 'Pagada'
                    : selected.paymentStatus === 'parcial'
                      ? 'Abonada'
                      : 'Crédito'}
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-500">
                <span>Pagado</span>
                <span className="tabular text-right font-semibold text-ink">
                  {formatCurrency(selected.paid)}
                </span>
                <span>Saldo</span>
                <span className="tabular text-right font-semibold text-ink">
                  {formatCurrency(selected.balance)}
                </span>
                <span>Medio</span>
                <span className="text-right font-semibold text-ink">
                  {selected.paymentAccount ?? selected.paymentMethod}
                </span>
                <span>Comprador</span>
                <span className="text-right font-semibold text-ink">
                  {selected.createdByName ?? 'Sin usuario'}
                </span>
                {selected.dueDate ? (
                  <>
                    <span>Vence</span>
                    <span className="text-right font-semibold text-ink">{formatDate(selected.dueDate)}</span>
                  </>
                ) : null}
              </div>
              {selected.payments.length ? (
                <div className="mt-3 divide-y divide-line border-t border-line pt-2">
                  {selected.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between gap-2 py-1.5 text-[10px]">
                      <div>
                        <p className="font-medium text-ink">{formatCurrency(payment.amount)}</p>
                        <p className="text-[9px] text-slate-400">
                          {formatDate(payment.date)} · {payment.paymentAccount ?? payment.method}
                        </p>
                      </div>
                      <span className="text-[9px] text-slate-400">{payment.createdByName ?? ''}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 border-t border-line pt-2 text-[9px] text-slate-400">
                  Sin abonos registrados.
                </p>
              )}
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
            <span className="field-label">Recepción</span>
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as Purchase['status'] })}
              className="field"
            >
              <option value="recibida">Recibida</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </label>
          <label className="block">
            <span className="field-label">Forma de pago</span>
            <select
              value={form.paymentCondition}
              onChange={(event) =>
                setForm({ ...form, paymentCondition: event.target.value as 'contado' | 'credito' })
              }
              className="field"
            >
              <option value="contado">Contado</option>
              <option value="credito">Crédito</option>
            </select>
          </label>
          <label className="block">
            <span className="field-label">Cuenta de pago</span>
            <select
              value={form.paymentAccountId}
              onChange={(event) => {
                const account = purchaseAccounts.find((item) => item.id === event.target.value)
                setForm({
                  ...form,
                  paymentAccountId: event.target.value,
                  paymentMethod: account?.channel ?? 'Transferencia'
                })
              }}
              className="field"
            >
              {purchaseAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.channel ?? 'Transferencia'}
                </option>
              ))}
            </select>
          </label>
          {form.paymentCondition === 'credito' ? (
            <>
              <label className="block">
                <span className="field-label">Abono inicial (opcional)</span>
                <input
                  value={form.initialPayment}
                  onChange={(event) => setForm({ ...form, initialPayment: event.target.value })}
                  inputMode="numeric"
                  className="field text-right tabular"
                  placeholder="0"
                />
              </label>
              <label className="block">
                <span className="field-label">Vencimiento (opcional)</span>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                  className="field"
                />
              </label>
            </>
          ) : (
            <div className="hidden sm:block" />
          )}

          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="field-label mb-0">Productos comprados</span>
              <Button variant="ghost" size="sm" onClick={addLine} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Agregar línea
              </Button>
            </div>
            <div className="space-y-2">
              {form.lines.map((line, index) => (
                <div key={index} className="rounded-xl border border-line p-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_64px_100px_28px] items-center gap-2">
                    <select
                      value={line.productId}
                      onChange={(event) => {
                        const product = stockProducts.find((item) => item.id === event.target.value)
                        updateLine(index, {
                          productId: event.target.value,
                          unitPrice: product ? String(product.cost ?? 0) : '',
                          supplierSku: product?.supplierSku ?? line.supplierSku
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
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    <input
                      value={line.supplierSku}
                      onChange={(event) => updateLine(index, { supplierSku: event.target.value })}
                      placeholder="SKU / Ref. proveedor (opcional)"
                      className="field h-8 text-[10px]"
                    />
                    <input
                      value={line.serialText}
                      onChange={(event) => updateLine(index, { serialText: event.target.value })}
                      placeholder="Seriales (opcional, separados por coma)"
                      className="field h-8 text-[10px]"
                    />
                  </div>
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
            Las ventas no llevan IVA en esta etapa. El IVA se registra solo en compras a proveedores. Al marcar la compra como recibida se actualiza el stock y el costo unitario. Si la forma de pago es crédito, el saldo queda pendiente con el proveedor y se puede abonar desde el detalle.
          </div>
        </div>
      </Modal>
      <Modal
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        title={editingSupplier ? 'Editar proveedor' : 'Nuevo proveedor'}
        description="Datos de contacto y NIT para asociar compras y controlar el IVA."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSupplierOpen(false)} disabled={supplierSaving}>
              Cancelar
            </Button>
            <Button onClick={() => void saveSupplier()} loading={supplierSaving}>
              {editingSupplier ? 'Guardar cambios' : 'Crear proveedor'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre o razón social</span>
            <input
              value={supplierForm.name}
              onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })}
              className="field"
              placeholder="Distribuidora Andina S.A.S."
              autoFocus
            />
          </label>
          <label className="block">
            <span className="field-label">NIT</span>
            <input
              value={supplierForm.nit}
              onChange={(event) => setSupplierForm({ ...supplierForm, nit: event.target.value })}
              className="field"
              placeholder="900123456"
            />
            {!supplierForm.isForeignNit && /^\d+$/.test(supplierForm.nit) && supplierForm.nit ? (
              <span className="mt-1 block text-[9px] text-slate-400">DV calculado: {calculateNitDv(supplierForm.nit)}</span>
            ) : null}
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5">
            <input
              type="checkbox"
              checked={supplierForm.isForeignNit}
              onChange={(event) => setSupplierForm({ ...supplierForm, isForeignNit: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
            />
            <span className="text-[11px] text-slate-600">NIT extranjero</span>
          </label>
          <label className="block">
            <span className="field-label">Categoría</span>
            <select
              value={supplierForm.category}
              onChange={(event) => setSupplierForm({ ...supplierForm, category: event.target.value })}
              className="field"
            >
              {[...new Set([...supplierCategoryOptions, supplierForm.category].filter(Boolean))].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Contacto</span>
            <input
              value={supplierForm.contact}
              onChange={(event) => setSupplierForm({ ...supplierForm, contact: event.target.value })}
              className="field"
              placeholder="Nombre del vendedor"
            />
          </label>
          <label className="block">
            <span className="field-label">Teléfono</span>
            <input
              value={supplierForm.phone}
              onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })}
              className="field"
              placeholder="310 000 0000"
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(paymentTarget)}
        onClose={() => setPaymentTarget(null)}
        title="Registrar abono"
        description={
          paymentTarget
            ? `${paymentTarget.number} · saldo ${formatCurrency(paymentTarget.balance)}`
            : ''
        }
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPaymentTarget(null)} disabled={paymentSaving}>
              Cancelar
            </Button>
            <Button onClick={() => void savePayment()} loading={paymentSaving}>
              Registrar abono
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-slate-50/60 p-3.5">
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Total compra</span>
              <span className="tabular font-semibold text-ink">
                {formatCurrency(paymentTarget?.total ?? 0)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
              <span>Saldo pendiente</span>
              <span className="tabular font-semibold text-warning-700">
                {formatCurrency(paymentTarget?.balance ?? 0)}
              </span>
            </div>
          </div>
          <label className="block">
            <span className="field-label">Valor del abono</span>
            <input
              value={paymentForm.amount}
              onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })}
              inputMode="numeric"
              className="field text-right tabular"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">Fecha</span>
              <input
                type="date"
                value={paymentForm.date}
                onChange={(event) => setPaymentForm({ ...paymentForm, date: event.target.value })}
                className="field"
              />
            </label>
            <label className="block">
              <span className="field-label">Cuenta de pago</span>
              <select
                value={paymentForm.paymentAccountId}
                onChange={(event) => {
                  const account = purchaseAccounts.find((item) => item.id === event.target.value)
                  setPaymentForm({
                    ...paymentForm,
                    paymentAccountId: event.target.value,
                    method: account?.channel ?? 'Transferencia'
                  })
                }}
                className="field"
              >
                {purchaseAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.channel ?? 'Transferencia'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="field-label">Notas (opcional)</span>
            <input
              value={paymentForm.notes}
              onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })}
              className="field"
              placeholder="Ej. abono acordado con el proveedor"
            />
          </label>
          <p className="text-[9px] leading-relaxed text-slate-400">
            Si el medio es efectivo, se requiere un turno de caja abierto y se registra el egreso.
          </p>
        </div>
      </Modal>

      <InvoiceScanReviewModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        suppliers={suppliers}
        products={products}
        dictionaries={data?.dictionaries ?? []}
        onRefresh={reload}
        onCreated={(purchase) => {
          reload()
          setSelectedId(purchase.id)
        }}
      />

      <PurchaseReceiptModal
        purchase={receiptTarget}
        open={Boolean(receiptTarget)}
        onClose={() => setReceiptTarget(null)}
      />
    </div>
  )
}
