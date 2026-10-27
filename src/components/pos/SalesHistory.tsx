import { useEffect, useMemo, useState } from 'react'
import {
  Ban,
  Download,
  Eye,
  History,
  Paperclip,
  Printer,
  ReceiptText,
  Search,
  Wallet,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type { Customer, Invoice, LegalConfig, PaymentMethod, SaleReceipt } from '@/types'
import { api, errorMessage } from '@/lib/backend'
import { downloadCsv } from '@/lib/download'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SearchInput, Select } from '@/components/ui/Input'
import { ReceiptPreviewModal } from '@/components/pos/ReceiptPreview'

const methodOptions: Array<'Todos' | PaymentMethod> = ['Todos', 'Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']

function receiptFromInvoice(invoice: Invoice): SaleReceipt {
  return {
    number: invoice.number,
    total: invoice.total,
    method: invoice.method,
    received: invoice.received ?? invoice.total,
    change: invoice.change ?? 0,
    customerName: invoice.customerName,
    lines: (invoice.lines ?? []).map((line) => ({
      productId: line.id,
      name: line.description,
      quantity: line.quantity,
      price: line.unitPrice,
      lineTotal: line.lineTotal,
      note: line.note ?? null
    }))
  }
}

export function SalesHistory({
  legal,
  canAnnul,
  onChanged
}: {
  legal: LegalConfig
  canAnnul: boolean
  onChanged?: () => void
}) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState<'Todos' | PaymentMethod>('Todos')
  const [status, setStatus] = useState<'Todos' | 'activa' | 'anulada'>('Todos')
  const [type, setType] = useState<'Todos' | 'venta' | 'ot'>('Todos')
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [reprint, setReprint] = useState<Invoice | null>(null)
  const [reprintCustomer, setReprintCustomer] = useState<Customer | null>(null)
  const [annulTarget, setAnnulTarget] = useState<Invoice | null>(null)
  const [annulReason, setAnnulReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const rows = await api.invoices.history()
      setInvoices(rows)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function openReprint(invoice: Invoice) {
    setReprint(invoice)
    setReprintCustomer(null)
    if (!invoice.customerId) return
    try {
      const detail = await api.customers.detail(invoice.customerId)
      setReprintCustomer(detail.customer)
    } catch {
      setReprintCustomer(null)
    }
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null
    const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : null
    return invoices.filter((invoice) => {
      const date = new Date(invoice.date).getTime()
      if (fromTime !== null && (Number.isNaN(date) || date < fromTime)) return false
      if (toTime !== null && (Number.isNaN(date) || date > toTime)) return false
      if (method !== 'Todos' && invoice.method !== method) return false
      if (status !== 'Todos' && invoice.status !== status) return false
      if (type !== 'Todos' && invoice.type !== type) return false
      if (!term) return true
      return (
        invoice.number.toLowerCase().includes(term) ||
        invoice.customerName.toLowerCase().includes(term) ||
        (invoice.lines ?? []).some((line) => line.description.toLowerCase().includes(term))
      )
    })
  }, [invoices, from, to, query, method, status, type])

  const summary = useMemo(() => {
    const active = filtered.filter((invoice) => invoice.status === 'activa')
    return {
      count: filtered.length,
      active: active.length,
      annulled: filtered.length - active.length,
      total: active.reduce((sum, invoice) => sum + invoice.total, 0)
    }
  }, [filtered])

  function exportCsv() {
    downloadCsv('bitacoretech-historial-ventas.csv', [
      ['Factura', 'Fecha', 'Cliente', 'Tipo', 'Método', 'Estado', 'Subtotal', 'Descuento', 'Total', 'Detalle servicios'],
      ...filtered.map((invoice) => [
        invoice.number,
        invoice.date,
        invoice.customerName,
        invoice.type === 'ot' ? 'OT' : 'Venta POS',
        invoice.method,
        invoice.status,
        invoice.subtotal ?? invoice.total,
        invoice.discount ?? 0,
        invoice.total,
        (invoice.lines ?? [])
          .filter((line) => line.note)
          .map((line) => `${line.description}: ${line.note}`)
          .join(' | ')
      ])
    ])
    toast.success('Historial exportado', { description: `${filtered.length} comprobantes en el CSV.` })
  }

  async function annulInvoice() {
    if (!annulTarget || saving) return
    if (annulReason.trim().length < 5) {
      toast.error('Escribe un motivo de al menos 5 caracteres')
      return
    }
    setSaving(true)
    try {
      const updated = await api.invoices.annul(annulTarget.id, annulReason.trim())
      setInvoices((current) => current.map((invoice) => (invoice.id === updated.id ? updated : invoice)))
      setSelected((current) => (current?.id === updated.id ? updated : current))
      setAnnulTarget(null)
      setAnnulReason('')
      onChanged?.()
      toast.success('Factura anulada', { description: `${updated.number} · ${updated.status}` })
    } catch (failure) {
      toast.error('No se pudo anular la factura', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  const statusVariant = (invoice: Invoice) => (invoice.status === 'activa' ? 'success' : 'danger')

  if (loading) {
    return (
      <div className="card flex items-center justify-center gap-3 p-10 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        Cargando historial de ventas…
      </div>
    )
  }

  if (error) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudo cargar el historial</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Comprobantes', value: summary.count.toLocaleString('es-CO'), icon: History },
          { label: 'Ventas activas', value: summary.active.toLocaleString('es-CO'), icon: ReceiptText },
          { label: 'Anuladas', value: summary.annulled.toLocaleString('es-CO'), icon: Ban },
          { label: 'Total vendido', value: formatCurrency(summary.total), icon: Wallet }
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card flex items-center gap-3.5 p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
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

      <div className="card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="font-display text-[16px] font-bold text-ink">Historial de ventas</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Ventas POS y facturas de OT de los últimos 500 comprobantes.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={exportCsv} leftIcon={<Download className="h-3.5 w-3.5" />}>
              Exportar CSV
            </Button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <label className="block">
              <span className="field-label">Desde</span>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="field h-10 text-[11px]" />
            </label>
            <label className="block">
              <span className="field-label">Hasta</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="field h-10 text-[11px]" />
            </label>
            <label className="block lg:col-span-2">
              <span className="field-label">Buscar</span>
              <SearchInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery('')}
                placeholder="Factura, cliente o servicio..."
                wrapClassName="h-10"
              />
            </label>
            <label className="block">
              <span className="field-label">Método</span>
              <Select value={method} onChange={(event) => setMethod(event.target.value as 'Todos' | PaymentMethod)} className="h-10 text-[11px]">
                {methodOptions.map((item) => (
                  <option key={item} value={item}>
                    {item === 'Todos' ? 'Todos' : item}
                  </option>
                ))}
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="field-label">Estado</span>
                <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-10 text-[11px]">
                  <option value="Todos">Todos</option>
                  <option value="activa">Activas</option>
                  <option value="anulada">Anuladas</option>
                </Select>
              </label>
              <label className="block">
                <span className="field-label">Tipo</span>
                <Select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="h-10 text-[11px]">
                  <option value="Todos">Todos</option>
                  <option value="venta">POS</option>
                  <option value="ot">OT</option>
                </Select>
              </label>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-line bg-slate-50/60">
                <th className="table-th pl-5 lg:pl-6">Factura</th>
                <th className="table-th">Fecha</th>
                <th className="table-th">Cliente</th>
                <th className="table-th">Tipo</th>
                <th className="table-th">Método</th>
                <th className="table-th">Vendedor</th>
                <th className="table-th">Estado</th>
                <th className="table-th text-right">Total</th>
                <th className="table-th pr-5 text-right lg:pr-6">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((invoice) => (
                <tr
                  key={invoice.id}
                  onClick={() => setSelected(invoice)}
                  className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-slate-50/60"
                >
                  <td className="table-td pl-5 lg:pl-6">
                    <p className="text-[12px] font-semibold text-ink">{invoice.number}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">
                      {invoice.items} {invoice.items === 1 ? 'ítem' : 'ítems'}
                    </p>
                  </td>
                  <td className="table-td text-[11px] text-slate-500">{formatDateTime(invoice.date)}</td>
                  <td className="table-td text-[11px] text-slate-600">{invoice.customerName}</td>
                  <td className="table-td">
                    <Badge variant={invoice.type === 'ot' ? 'sky' : 'brand'}>{invoice.type === 'ot' ? 'OT' : 'POS'}</Badge>
                  </td>
                  <td className="table-td text-[11px] text-slate-500">{invoice.method}</td>
                  <td className="table-td">
                    <span className="text-[10px] font-medium text-slate-600">
                      {invoice.createdByName ?? 'Sin usuario'}
                    </span>
                  </td>
                  <td className="table-td">
                    <Badge variant={statusVariant(invoice)}>{invoice.status === 'activa' ? 'Activa' : 'Anulada'}</Badge>
                  </td>
                  <td className="table-td text-right text-[12px] font-semibold tabular text-ink">{formatCurrency(invoice.total)}</td>
                  <td className="table-td pr-5 lg:pr-6">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelected(invoice)
                        }}
                        className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand-600 hover:shadow-sm"
                        aria-label={`Ver ${invoice.number}`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void openReprint(invoice)
                        }}
                        className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand-600 hover:shadow-sm"
                        aria-label={`Reimprimir ${invoice.number}`}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                      {canAnnul && invoice.status === 'activa' ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setAnnulTarget(invoice)
                            setAnnulReason('')
                          }}
                          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-danger-50 hover:text-danger-600"
                          aria-label={`Anular ${invoice.number}`}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
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
            <p className="mt-3 text-sm font-semibold text-ink">Sin ventas que coincidan</p>
            <p className="mt-1 text-xs text-slate-500">Cambia las fechas, el estado o la búsqueda.</p>
          </div>
        ) : null}

        <div className="flex flex-col items-start justify-between gap-2 border-t border-line px-5 py-3.5 text-[10px] text-slate-400 sm:flex-row sm:items-center lg:px-6">
          <span>{filtered.length} comprobantes · {summary.active} activos</span>
          <span>Los tickets 80/58 mm no imprimen detalles de servicio; el A4 sí.</span>
        </div>
      </div>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Factura ${selected.number}` : 'Factura'}
        description={selected ? `${selected.customerName} · ${formatDate(selected.date)}` : undefined}
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] text-slate-400">
              {selected?.status === 'anulada' ? 'Comprobante anulado. No debe usarse como soporte de cobro.' : 'Comprobante interno sin valor fiscal DIAN.'}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setSelected(null)}>
                Cerrar
              </Button>
              {selected ? (
                <Button onClick={() => void openReprint(selected)} leftIcon={<Printer className="h-4 w-4" />}>
                  Reimprimir
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {[
                ['Subtotal', formatCurrency(selected.subtotal ?? selected.total)],
                ['Descuento', `- ${formatCurrency(selected.discount ?? 0)}`],
                ['Total', formatCurrency(selected.total)],
                ['Método', selected.method],
                ['Vendedor', selected.createdByName ?? 'Sin usuario'],
                ['Cuenta digital', selected.incomeAccountName ?? '—']
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-line bg-slate-50/60 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
                  <p className="mt-1 text-[12px] font-semibold text-ink">{value}</p>
                </div>
              ))}
            </div>

            {selected.paymentReceipt && selected.paymentId ? (
              <button
                type="button"
                onClick={() => void api.payments.openReceipt(selected.paymentId!)}
                className="focus-ring flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 text-[10px] font-semibold text-brand-700"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Ver comprobante: {selected.paymentReceipt.filename}
              </button>
            ) : null}

            <div>
              <p className="field-label">Líneas</p>
              <div className="divide-y divide-line rounded-xl border border-line">
                {selected.lines?.length ? (
                  selected.lines.map((line) => (
                    <div key={line.id} className="flex items-start justify-between gap-3 px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-slate-700">{line.description}</p>
                        {line.note ? (
                          <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{line.note}</p>
                        ) : null}
                        <p className="mt-0.5 text-[9px] text-slate-400">
                          {line.quantity} × {formatCurrency(line.unitPrice)}
                          {line.itemType === 'servicio' ? ' · Servicio' : ''}
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

            {selected.notes ? (
              <div className="rounded-xl border border-warning-100 bg-warning-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-warning-800">
                {selected.notes}
              </div>
            ) : null}

            {selected.status === 'activa' && canAnnul ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAnnulTarget(selected)
                  setAnnulReason('')
                }}
                leftIcon={<Ban className="h-3.5 w-3.5" />}
              >
                Anular factura
              </Button>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(annulTarget)}
        onClose={() => setAnnulTarget(null)}
        title="Anular factura"
        description={annulTarget ? `${annulTarget.number} · ${formatCurrency(annulTarget.total)}` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAnnulTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void annulInvoice()} loading={saving} leftIcon={<Ban className="h-4 w-4" />}>
              Anular factura
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="field-label">Motivo</span>
            <textarea
              value={annulReason}
              onChange={(event) => setAnnulReason(event.target.value)}
              rows={3}
              className="field resize-none"
              placeholder="Describe el motivo de la anulación..."
            />
          </label>
          <div className="rounded-xl border border-danger-100 bg-danger-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-danger-700">
            La anulación queda registrada en auditoría y no elimina el comprobante. Si la venta descontó stock, el ajuste debe hacerse por separado.
          </div>
          <button
            type="button"
            onClick={() => setAnnulTarget(null)}
            className="focus-ring inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600"
          >
            <X className="h-3 w-3" /> Cerrar
          </button>
        </div>
      </Modal>

      <ReceiptPreviewModal
        receipt={reprint ? receiptFromInvoice(reprint) : null}
        invoice={reprint}
        customer={reprintCustomer}
        legal={legal}
        open={Boolean(reprint)}
        onClose={() => {
          setReprint(null)
          setReprintCustomer(null)
        }}
        initialFormat="80mm"
      />
    </div>
  )
}
