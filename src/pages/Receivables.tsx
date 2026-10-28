import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  HandCoins,
  MessageCircle,
  ReceiptText,
  Search,
  Wallet
} from 'lucide-react'
import { toast } from 'sonner'
import type { PaymentMethod, ReceivableDetail, ReceivableRow } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { formatCurrency, formatDateTime, formatShortDate } from '@/lib/format'
import { downloadCsv } from '@/lib/download'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { SearchInput } from '@/components/ui/Input'
import { SegmentedTabs } from '@/components/ui/Tabs'
import {
  PaymentReceiptField,
  type ReceiptDraft
} from '@/components/payments/PaymentReceiptField'
import { cn } from '@/lib/utils'

type CarteraFilter = 'todas' | 'vencidas' | 'por_vencer' | 'al_dia'

const paymentMethods: PaymentMethod[] = ['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']

function statusLabel(status: ReceivableRow['status']) {
  if (status === 'vencida') return 'Vencida'
  if (status === 'por_vencer') return 'Por vencer'
  return 'Al día'
}

function statusVariant(status: ReceivableRow['status']) {
  if (status === 'vencida') return 'danger' as const
  if (status === 'por_vencer') return 'warning' as const
  return 'success' as const
}

function parseMoneyInput(value: string) {
  return Number(value.replace(/[^0-9]/g, '')) || 0
}

export function ReceivablesPage() {
  const { role } = useAuth()
  const { data, loading, error, reload } = useApi(async () => {
    const [receivables, requirements] = await Promise.all([
      api.receivables.list(),
      api.payments.requirements().catch(() => ({ requireReceiptForDigital: false }))
    ])
    return { receivables, requirements }
  }, [])

  const receivables = data?.receivables
  const receiptRequired = Boolean(data?.requirements?.requireReceiptForDigital)
  const canCollect = can(role, 'collectReceivables')

  const [filter, setFilter] = useState<CarteraFilter>('todas')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReceivableDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Efectivo')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentReceipt, setPaymentReceipt] = useState<ReceiptDraft | null>(null)
  const [savingPayment, setSavingPayment] = useState(false)

  const rows = receivables?.rows ?? []
  const summary = receivables?.summary

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return rows.filter((row) => {
      const matchesFilter =
        filter === 'todas' ||
        (filter === 'vencidas' && row.status === 'vencida') ||
        (filter === 'por_vencer' && row.status === 'por_vencer') ||
        (filter === 'al_dia' && row.status === 'al_dia')
      const matchesQuery =
        !term ||
        row.customerName.toLowerCase().includes(term) ||
        row.invoiceNumber.toLowerCase().includes(term) ||
        row.orderNumber.toLowerCase().includes(term) ||
        row.customerPhone.replace(/\D/g, '').includes(term.replace(/\D/g, ''))
      return matchesFilter && matchesQuery
    })
  }, [rows, filter, query])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let active = true
    setDetailLoading(true)
    api.receivables
      .detail(selectedId)
      .then((result) => {
        if (active) setDetail(result)
      })
      .catch((failure) => {
        if (active) {
          toast.error('No se pudo abrir la factura', {
            description: errorMessage(failure)
          })
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedId])

  function openDetail(row: ReceivableRow) {
    setSelectedId(row.invoiceId)
    setDetail(null)
    setPaymentAmount(String(row.balance))
    setPaymentMethod('Efectivo')
    setPaymentReference('')
    setPaymentReceipt(null)
  }

  function closeDetail() {
    setSelectedId(null)
    setDetail(null)
    setPaymentReceipt(null)
  }

  async function reloadDetail() {
    if (!selectedId) return
    try {
      const updated = await api.receivables.detail(selectedId)
      setDetail(updated)
    } catch {
      // La lista ya se recarga; el detalle se puede volver a abrir.
    }
  }

  async function registerPayment() {
    if (!detail || savingPayment) return
    const amount = parseMoneyInput(paymentAmount)
    if (amount <= 0) {
      toast.error('Ingresa un valor de abono válido')
      return
    }
    if (amount > detail.balance) {
      toast.error('El abono supera el saldo pendiente', {
        description: `Saldo actual: ${formatCurrency(detail.balance)}`
      })
      return
    }
    if (
      receiptRequired &&
      (paymentMethod === 'Transferencia' || paymentMethod === 'Tarjeta') &&
      !paymentReceipt
    ) {
      toast.error('Adjunta el comprobante del pago digital para continuar')
      return
    }
    setSavingPayment(true)
    try {
      const result = await api.receivables.addPayment({
        invoiceId: detail.invoiceId,
        amount,
        method: paymentMethod,
        reference: paymentReference.trim() || undefined,
        receipt: paymentReceipt
          ? {
              dataUrl: paymentReceipt.dataUrl,
              name: paymentReceipt.name,
              mimeType: paymentReceipt.mimeType
            }
          : undefined
      })
      toast.success(`Abono ${result.number} registrado`, {
        description: `${formatCurrency(amount)} · ${paymentMethod} · ${detail.customerName}`
      })
      setPaymentAmount('')
      setPaymentReference('')
      setPaymentReceipt(null)
      reload()
      await reloadDetail()
    } catch (failure) {
      toast.error('No se pudo registrar el abono', { description: errorMessage(failure) })
    } finally {
      setSavingPayment(false)
    }
  }

  function remindByWhatsApp(row: ReceivableRow) {
    const digits = row.customerPhone.replace(/\D/g, '')
    if (!digits || digits.length < 7) {
      toast.error('Sin teléfono registrado', {
        description: 'Agrega un número al cliente para enviar el recordatorio.'
      })
      return
    }
    const message = `Hola ${row.customerName}, te recordamos el saldo pendiente de la factura ${row.invoiceNumber} (OT ${row.orderNumber}) por ${formatCurrency(row.balance)}, con vencimiento ${formatShortDate(row.dueDate)}. Estamos atentos para ayudarte.`
    window.open(`https://wa.me/57${digits}?text=${encodeURIComponent(message)}`, '_blank')
  }

  function exportCartera() {
    downloadCsv('bitacoretech-cartera.csv', [
      [
        'Factura',
        'OT',
        'Cliente',
        'Teléfono',
        'Entrega',
        'Vencimiento',
        'Total',
        'Abonado',
        'Saldo',
        'Días vencida',
        'Estado'
      ],
      ...filtered.map((row) => [
        row.invoiceNumber,
        row.orderNumber,
        row.customerName,
        row.customerPhone,
        row.deliveredAt ? formatShortDate(row.deliveredAt) : '',
        formatShortDate(row.dueDate),
        formatCurrency(row.total),
        formatCurrency(row.paid),
        formatCurrency(row.balance),
        String(row.daysOverdue),
        statusLabel(row.status)
      ])
    ])
    toast.success('Cartera exportada', {
      description: `${filtered.length} factura${filtered.length === 1 ? '' : 's'} con los filtros actuales.`
    })
  }

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando cartera…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudo cargar la cartera</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cartera"
        description="Créditos otorgados, vencimientos, abonos y saldos pendientes por cliente."
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={exportCartera}
              leftIcon={<Download className="h-4 w-4" />}
            >
              Exportar
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={reload}
              leftIcon={<CalendarClock className="h-4 w-4" />}
            >
              Actualizar
            </Button>
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Saldo total
            </p>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <HandCoins className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 tabular font-display text-[26px] font-bold leading-none text-ink">
            {formatCurrency(summary?.total ?? 0)}
          </p>
          <p className="mt-1.5 text-[10px] text-slate-400">
            {summary?.count ?? 0} factura{summary?.count === 1 ? '' : 's'} con saldo
          </p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Vencido
            </p>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-danger-50 text-danger-600">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 tabular font-display text-[26px] font-bold leading-none text-danger-600">
            {formatCurrency(summary?.overdue ?? 0)}
          </p>
          <p className="mt-1.5 text-[10px] text-slate-400">
            {summary?.overdueCount ?? 0} factura{summary?.overdueCount === 1 ? '' : 's'} vencida
            {summary?.overdueCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Por vencer
            </p>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning-50 text-warning-600">
              <CalendarClock className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 tabular font-display text-[26px] font-bold leading-none text-warning-600">
            {formatCurrency(summary?.dueSoon ?? 0)}
          </p>
          <p className="mt-1.5 text-[10px] text-slate-400">
            {summary?.dueSoonCount ?? 0} factura{summary?.dueSoonCount === 1 ? '' : 's'} en los
            próximos 7 días
          </p>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Al día
            </p>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success-50 text-success-600">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 tabular font-display text-[26px] font-bold leading-none text-success-600">
            {formatCurrency(summary?.current ?? 0)}
          </p>
          <p className="mt-1.5 text-[10px] text-slate-400">Saldo con vencimiento futuro</p>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold text-ink">Antigüedad de la deuda vencida</p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              Distribución del saldo vencido por rango de días.
            </p>
          </div>
          <p className="text-[10px] text-slate-400">
            Actualizado {formatDateTime(receivables?.generatedAt ?? new Date().toISOString())}
          </p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {[
            { label: '1–30 días', value: summary?.aging.d1_30 ?? 0, tone: 'bg-warning-50 text-warning-700' },
            { label: '31–60 días', value: summary?.aging.d31_60 ?? 0, tone: 'bg-orange-50 text-orange-700' },
            { label: '61–90 días', value: summary?.aging.d61_90 ?? 0, tone: 'bg-danger-50 text-danger-700' },
            { label: '+90 días', value: summary?.aging.d90 ?? 0, tone: 'bg-slate-100 text-slate-700' }
          ].map((item) => (
            <div key={item.label} className={cn('rounded-xl px-3 py-2.5', item.tone)}>
              <p className="text-[9px] font-semibold uppercase tracking-[0.08em] opacity-70">
                {item.label}
              </p>
              <p className="mt-1 tabular text-[16px] font-bold">{formatCurrency(item.value)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <SegmentedTabs
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todas', label: 'Todas', count: rows.length },
              { value: 'vencidas', label: 'Vencidas', count: summary?.overdueCount ?? 0 },
              { value: 'por_vencer', label: 'Por vencer', count: summary?.dueSoonCount ?? 0 },
              { value: 'al_dia', label: 'Al día' }
            ]}
          />
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            placeholder="Buscar cliente, factura, OT o teléfono..."
            wrapClassName="w-full sm:w-[330px]"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] table-fixed border-collapse">
            <thead>
              <tr className="border-b border-line bg-slate-50/60">
                <th className="table-th w-[23%] pl-5 lg:pl-6">Cliente</th>
                <th className="table-th w-[17%]">Factura / OT</th>
                <th className="table-th w-[14%]">Vencimiento</th>
                <th className="table-th w-[10%] text-right">Total</th>
                <th className="table-th w-[11%] text-right">Abonado</th>
                <th className="table-th w-[11%] text-right">Saldo</th>
                <th className="table-th w-[9%]">Estado</th>
                <th className="table-th w-[5%] pr-5 text-right lg:pr-6"> </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.invoiceId}
                  className="cursor-pointer border-b border-line/70 transition hover:bg-slate-50/70"
                  onClick={() => openDetail(row)}
                >
                  <td className="table-td pl-5 lg:pl-6">
                    <p className="truncate text-[12px] font-semibold text-ink">{row.customerName}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{row.customerPhone}</p>
                  </td>
                  <td className="table-td">
                    <p className="text-[11px] font-semibold text-ink">{row.invoiceNumber}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">OT {row.orderNumber}</p>
                  </td>
                  <td className="table-td">
                    <p className="text-[11px] text-ink">{formatShortDate(row.dueDate)}</p>
                    <p
                      className={cn(
                        'mt-0.5 text-[9px] font-semibold',
                        row.status === 'vencida'
                          ? 'text-danger-600'
                          : row.status === 'por_vencer'
                            ? 'text-warning-600'
                            : 'text-slate-400'
                      )}
                    >
                      {row.status === 'vencida'
                        ? `${row.daysOverdue} día${row.daysOverdue === 1 ? '' : 's'} vencida`
                        : row.status === 'por_vencer'
                          ? 'Vence en 7 días o menos'
                          : 'Vigente'}
                    </p>
                  </td>
                  <td className="table-td text-right text-[11px] tabular text-slate-500">
                    {formatCurrency(row.total)}
                  </td>
                  <td className="table-td text-right text-[11px] tabular text-slate-500">
                    {formatCurrency(row.paid)}
                  </td>
                  <td className="table-td text-right text-[12px] font-bold tabular text-ink">
                    {formatCurrency(row.balance)}
                  </td>
                  <td className="table-td">
                    <Badge variant={statusVariant(row.status)} dot>
                      {statusLabel(row.status)}
                    </Badge>
                  </td>
                  <td className="table-td pr-5 lg:pr-6">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          remindByWhatsApp(row)
                        }}
                        className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-success-600 hover:shadow-sm"
                        aria-label="Recordar por WhatsApp"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          openDetail(row)
                        }}
                        className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand-600 hover:shadow-sm"
                        aria-label="Gestionar cartera"
                      >
                        <ReceiptText className="h-3.5 w-3.5" />
                      </button>
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
            <p className="mt-3 text-sm font-semibold text-ink">No hay facturas en cartera</p>
            <p className="mt-1 max-w-sm text-[11px] text-slate-400">
              Las entregas a crédito aparecen aquí con su vencimiento y saldo pendiente.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[10px] text-slate-400">
            <span>
              Mostrando {filtered.length} de {rows.length} facturas.
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
              Saldos conciliados con pagos y caja
            </span>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(selectedId)}
        onClose={closeDetail}
        title={detail ? `Cartera · ${detail.invoiceNumber}` : 'Cartera'}
        description={
          detail
            ? `${detail.customerName} · OT ${detail.orderNumber} · vence ${formatShortDate(detail.dueDate)}`
            : 'Cargando factura…'
        }
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={closeDetail}>
              Cerrar
            </Button>
          </div>
        }
      >
        {detailLoading && !detail ? (
          <div className="flex items-center justify-center py-10 text-[12px] text-slate-400">
            Cargando cartera…
          </div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-slate-50/60 px-3.5 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Total
                </p>
                <p className="mt-1 tabular text-[18px] font-bold text-ink">
                  {formatCurrency(detail.total)}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-slate-50/60 px-3.5 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Abonado
                </p>
                <p className="mt-1 tabular text-[18px] font-bold text-success-600">
                  {formatCurrency(detail.paid)}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-brand-50/60 px-3.5 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-brand-700">
                  Saldo
                </p>
                <p className="mt-1 tabular text-[18px] font-bold text-brand-800">
                  {formatCurrency(detail.balance)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(detail.status)} dot>
                  {statusLabel(detail.status)}
                </Badge>
                <span className="text-[10px] text-slate-500">
                  {detail.daysOverdue > 0
                    ? `${detail.daysOverdue} día${detail.daysOverdue === 1 ? '' : 's'} de atraso`
                    : `${detail.creditDays} días de crédito`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => remindByWhatsApp(detail)}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-[10px] font-semibold text-success-600 transition hover:text-success-700"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Recordar por WhatsApp
              </button>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-ink">Historial de pagos</p>
              <div className="mt-2 divide-y divide-line rounded-xl border border-line">
                {detail.payments.length ? (
                  detail.payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5"
                    >
                      <div>
                        <p className="text-[10px] font-semibold text-ink">
                          {payment.number} · {payment.method}
                        </p>
                        <p className="mt-0.5 text-[9px] text-slate-400">
                          {formatDateTime(payment.createdAt)}
                          {payment.createdByName ? ` · ${payment.createdByName}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tabular text-[11px] font-bold text-ink">
                          {formatCurrency(payment.amount)}
                        </span>
                        {payment.receipt ? (
                          <button
                            type="button"
                            onClick={() => void api.payments.openReceipt(payment.id)}
                            className="focus-ring rounded-md text-[9px] font-semibold text-brand-600 hover:text-brand-700"
                          >
                            Ver comprobante
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="px-3.5 py-4 text-center text-[10px] text-slate-400">
                    Aún no hay abonos registrados.
                  </p>
                )}
              </div>
            </div>

            {detail.balance > 0 && canCollect ? (
              <div className="rounded-2xl border border-brand-100 bg-brand-50/40 p-4">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-brand-600" />
                  <p className="text-[11px] font-semibold text-brand-900">Registrar abono</p>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Valor del abono</span>
                    <input
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                      inputMode="numeric"
                      className="field text-right tabular"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Referencia (opcional)</span>
                    <input
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      placeholder="Nro. de transferencia, voucher…"
                      className="field"
                    />
                  </label>
                </div>
                <div className="mt-3">
                  <span className="field-label">Método de pago</span>
                  <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {paymentMethods.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setPaymentMethod(item)}
                        className={cn(
                          'focus-ring rounded-xl border px-2.5 py-2 text-[10px] font-semibold transition',
                          paymentMethod === item
                            ? 'border-brand-300 bg-white text-brand-700'
                            : 'border-line bg-white/60 text-slate-500 hover:border-slate-300'
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-3">
                  <PaymentReceiptField
                    value={paymentReceipt}
                    onChange={setPaymentReceipt}
                    disabled={savingPayment}
                    required={
                      receiptRequired &&
                      (paymentMethod === 'Transferencia' || paymentMethod === 'Tarjeta')
                    }
                  />
                </div>
                <div className="mt-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                  <p className="text-[9px] leading-relaxed text-brand-800/70">
                    El abono entra a caja y queda vinculado a la factura. No modifica el total de
                    la OT.
                  </p>
                  <Button
                    onClick={() => void registerPayment()}
                    loading={savingPayment}
                    leftIcon={<HandCoins className="h-4 w-4" />}
                  >
                    Registrar abono
                  </Button>
                </div>
              </div>
            ) : null}

            {detail.balance <= 0 ? (
              <div className="rounded-xl border border-success-200 bg-success-50/60 px-4 py-3 text-[11px] font-semibold text-success-700">
                Esta factura ya está pagada en su totalidad.
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
