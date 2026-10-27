import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Printer, ReceiptText, Scissors, X } from 'lucide-react'
import type { Customer, Invoice, LegalConfig, SaleReceipt } from '@/types'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { customerDocumentLabel, customerPrimaryPhone } from '@/lib/customers'
import { defaultLegalConfig } from '@/lib/legalConfig'
import { cn } from '@/lib/utils'
import { Barcode } from '@/components/orders/Barcode'
import { Button } from '@/components/ui/Button'

export type ReceiptFormat = '80mm' | '58mm' | 'a4'

const formatOptions: Array<{ value: ReceiptFormat; label: string; icon: typeof ReceiptText }> = [
  { value: '80mm', label: 'Ticket 80 mm', icon: ReceiptText },
  { value: '58mm', label: 'Ticket 58 mm', icon: ReceiptText },
  { value: 'a4', label: 'A4 · dos copias', icon: FileText }
]

function ReceiptCopy({
  receipt,
  invoice,
  customer,
  legal,
  compact,
  copyLabel
}: {
  receipt: SaleReceipt
  invoice: Invoice
  customer: Customer | null
  legal: LegalConfig
  compact?: '80mm' | '58mm' | 'a4'
  copyLabel?: string
}) {
  const subtotal = invoice.subtotal ?? receipt.lines.reduce((sum, line) => sum + line.lineTotal, 0)
  const discount = invoice.discount ?? 0

  return (
    <div className={cn('text-black', compact === 'a4' ? 'text-[9px]' : compact === '58mm' ? 'text-[7px]' : 'text-[8px]')}>
      <div className="flex items-start gap-2 border-b border-black/25 pb-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/40">
          <ReceiptText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[11px] font-bold uppercase leading-tight">{legal.businessName}</p>
          <p className="leading-snug">NIT {legal.nit} · Tel. {legal.phone}</p>
          <p className="leading-snug">{legal.address} · {legal.city}</p>
        </div>
        {copyLabel ? <span className="border border-black/30 px-1 py-0.5 text-[6px] font-semibold uppercase">{copyLabel}</span> : null}
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-2 leading-snug">
        <div>
          <p className="font-semibold">Comprobante interno de venta</p>
          <p>{invoice.number} · {formatDateTime(invoice.date)}</p>
          <p>Cliente: {receipt.customerName}</p>
          {customer && !customer.isFinalConsumer ? <p>{customerDocumentLabel(customer)}</p> : null}
          {customer && customerPrimaryPhone(customer) !== '—' ? <p>Tel. {customerPrimaryPhone(customer)}</p> : null}
        </div>
        <div className="text-right">
          <p className="font-semibold">{receipt.method}</p>
          <p>Sin IVA</p>
        </div>
      </div>

      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="border-y border-black/30">
            <th className="py-0.5 text-left font-semibold">Descripción</th>
            <th className="py-0.5 text-right font-semibold">Cant</th>
            <th className="py-0.5 text-right font-semibold">V. unit</th>
            <th className="py-0.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line) => (
            <tr key={`${line.productId}-${line.note ?? ''}`} className="border-b border-black/10">
              <td className="py-0.5 pr-1">
                {line.name}
                {compact === 'a4' && line.note ? (
                  <span className="mt-0.5 block text-[0.85em] leading-snug text-black/65">{line.note}</span>
                ) : null}
              </td>
              <td className="py-0.5 text-right tabular">{line.quantity}</td>
              <td className="py-0.5 text-right tabular">{formatCurrency(line.price)}</td>
              <td className="py-0.5 text-right tabular font-semibold">{formatCurrency(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1.5 space-y-0.5">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="tabular">{formatCurrency(subtotal)}</span>
        </div>
        {discount > 0 ? (
          <div className="flex justify-between">
            <span>
              Descuento{' '}
              {invoice.discountType === 'amount'
                ? formatCurrency(discount)
                : `${invoice.discountPercent ?? 0}%`}
            </span>
            <span className="tabular">- {formatCurrency(discount)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-y border-black py-0.5 text-[1.15em] font-bold">
          <span>Total</span>
          <span className="tabular">{formatCurrency(receipt.total)}</span>
        </div>
        {receipt.method === 'Efectivo' ? (
          <>
            <div className="flex justify-between">
              <span>Recibido</span>
              <span className="tabular">{formatCurrency(receipt.received)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cambio</span>
              <span className="tabular">{formatCurrency(receipt.change)}</span>
            </div>
          </>
        ) : null}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="max-w-[65%] text-[6.5px] leading-snug">
          <p>Gracias por tu compra. Conserva este comprobante para cambios y garantía.</p>
          <p className="mt-0.5">Documento interno sin valor fiscal DIAN. Ventas sin IVA.</p>
        </div>
        <div className="w-[100px]">
          <Barcode value={receipt.number} height={compact === 'a4' ? 34 : 26} />
        </div>
      </div>
    </div>
  )
}

export function ReceiptPreviewModal({
  receipt,
  invoice,
  customer,
  legal = defaultLegalConfig,
  open,
  onClose,
  initialFormat = '80mm'
}: {
  receipt: SaleReceipt | null
  invoice: Invoice | null
  customer: Customer | null
  legal?: LegalConfig
  open: boolean
  onClose: () => void
  initialFormat?: ReceiptFormat
}) {
  const [format, setFormat] = useState<ReceiptFormat>(initialFormat)
  const [ticketHeightMm, setTicketHeightMm] = useState(0)

  useEffect(() => {
    if (open) setFormat(initialFormat)
  }, [open, initialFormat])

  useLayoutEffect(() => {
    if (!open || format === 'a4') return
    const sheet = document.querySelector<HTMLElement>('.pos-print-root .pos-print-ticket')
    if (!sheet) return
    const measure = () => {
      const height = sheet.getBoundingClientRect().height
      if (height <= 0) return
      const next = Math.ceil((height * 25.4) / 96 + 1)
      setTicketHeightMm((previous) => (previous === next ? previous : next))
    }
    measure()
    const raf = window.requestAnimationFrame(measure)
    return () => window.cancelAnimationFrame(raf)
  }, [open, format, receipt, invoice])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open || !receipt || !invoice) return null

  const sheetWidth = format === '80mm' ? '80mm' : '58mm'
  const pageSize =
    format === 'a4' ? 'A4 portrait' : `${format} ${ticketHeightMm || 160}mm`

  return createPortal(
    <>
      <div className="no-print fixed inset-0 z-[95] flex flex-col bg-slate-950/45 backdrop-blur-sm">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-5">
          <div>
            <p className="text-[13px] font-bold text-white">Comprobante de venta</p>
            <p className="mt-0.5 text-[10px] text-white/55">{receipt.number} · {receipt.customerName} · sin IVA</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden rounded-xl bg-white/10 p-1 sm:flex">
              {formatOptions.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFormat(option.value)}
                    className={cn(
                      'focus-ring flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold transition',
                      format === option.value ? 'bg-white text-ink shadow-sm' : 'text-white/70 hover:bg-white/10'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                  </button>
                )
              })}
            </div>
            <Button size="sm" onClick={() => window.print()} leftIcon={<Printer className="h-3.5 w-3.5" />}>
              Imprimir
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/80 transition hover:bg-white/20"
              aria-label="Cerrar vista previa"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 px-3 pb-1 pt-2 sm:hidden">
          <div className="flex w-full gap-1 rounded-xl bg-white/10 p-1">
            {formatOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFormat(option.value)}
                className={cn(
                  'focus-ring flex-1 rounded-lg px-2 py-2 text-[9px] font-semibold transition',
                  format === option.value ? 'bg-white text-ink' : 'text-white/70'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6">
          <div className="mx-auto w-fit bg-white shadow-pop">
            {format === 'a4' ? (
              <div className="order-print-a4 flex h-[296mm] w-[210mm] flex-col bg-white px-[10mm] py-[7mm] text-black">
                <ReceiptCopy

                  receipt={receipt}
                  invoice={invoice}
                  customer={customer}
                  legal={legal}
                  compact="a4"
                  copyLabel="Copia cliente"
                />
                <div className="my-[2mm] flex items-center gap-2 text-[6.5px] uppercase tracking-[0.12em] text-black/50">
                  <span className="flex-1 border-t border-dashed border-black/40" />
                  <Scissors className="h-3 w-3" />
                  Cortar aquí · copia cliente / copia taller
                  <span className="flex-1 border-t border-dashed border-black/40" />
                </div>
                <ReceiptCopy
                  receipt={receipt}
                  invoice={invoice}
                  customer={customer}
                  legal={legal}
                  compact="a4"
                  copyLabel="Copia taller"
                />
              </div>
            ) : (
              <div
                className="pos-print-ticket bg-white px-[4mm] py-[4mm] text-black"
                style={{ width: sheetWidth }}
              >
                <ReceiptCopy receipt={receipt} invoice={invoice} customer={customer} legal={legal} compact={format} />
              </div>
            )}
          </div>
          <p className="mx-auto mt-4 max-w-lg text-center text-[10px] leading-relaxed text-white/50">
            {format === 'a4'
              ? 'Dos copias en una hoja con línea de corte.'
              : 'El largo del ticket se calcula con el contenido real, sin espacio en blanco al final.'}
          </p>
        </div>
      </div>

      <style>{`@media print { @page { size: ${pageSize}; margin: 0; } .pos-print-root .pos-print-ticket { width: ${format === 'a4' ? '210mm' : sheetWidth} !important; } }`}</style>
      <div
        aria-hidden="true"
        className="pos-print-root order-print-root pointer-events-none invisible fixed -left-[1000px] top-0 -z-50 print:visible print:static print:z-auto"
      >
        {format === 'a4' ? (
          <div className="order-print-a4 flex h-[296mm] w-[210mm] flex-col bg-white px-[10mm] py-[7mm] text-black">
            <ReceiptCopy receipt={receipt} invoice={invoice} customer={customer} legal={legal} compact="a4" copyLabel="Copia cliente" />
            <div className="my-[2mm] flex items-center gap-2 text-[6.5px] uppercase tracking-[0.12em] text-black/50">
              <span className="flex-1 border-t border-dashed border-black/40" />
              <Scissors className="h-3 w-3" />
              Cortar aquí · copia cliente / copia taller
              <span className="flex-1 border-t border-dashed border-black/40" />
            </div>
            <ReceiptCopy receipt={receipt} invoice={invoice} customer={customer} legal={legal} compact="a4" copyLabel="Copia taller" />
          </div>
        ) : (
          <div className="pos-print-ticket bg-white px-[4mm] py-[4mm] text-black" style={{ width: sheetWidth }}>
            <ReceiptCopy receipt={receipt} invoice={invoice} customer={customer} legal={legal} compact={format} />
          </div>
        )}
      </div>
    </>,
    document.body
  )
}
