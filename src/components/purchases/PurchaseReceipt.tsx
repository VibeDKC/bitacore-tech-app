import { Printer } from 'lucide-react'
import type { Purchase } from '@/types'
import { formatCurrency, formatDate } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'

function receiptLines(purchase: Purchase) {
  if (purchase.lines?.length) return purchase.lines
  return [
    {
      id: 'resumen',
      productId: null,
      description: 'Compra registrada según factura de proveedor',
      quantity: purchase.items || 1,
      unitPrice: purchase.subtotal,
      lineTotal: purchase.subtotal
    }
  ]
}

function ReceiptBody({ purchase }: { purchase: Purchase }) {
  const lines = receiptLines(purchase)
  return (
    <div className="flex h-full flex-col text-black">
      <div className="flex items-start justify-between border-b border-black/20 pb-3">
        <div>
          <p className="text-[15px] font-bold tracking-tight">BitacoreTech Taller & POS</p>
          <p className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-black/50">Comprobante interno de compra</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-bold">{purchase.number}</p>
          <p className="mt-0.5 text-[9px] text-black/60">{formatDate(purchase.date)}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
        <div>
          <p className="text-[7px] font-semibold uppercase tracking-[0.12em] text-black/45">Proveedor</p>
          <p className="mt-0.5 font-semibold">{purchase.supplier}</p>
          <p className="text-black/60">NIT {purchase.supplierNit ?? '—'}{purchase.supplierNitDv ? `-${purchase.supplierNitDv}` : ''}</p>
        </div>
        <div className="text-right">
          <p className="text-[7px] font-semibold uppercase tracking-[0.12em] text-black/45">Estado</p>
          <p className="mt-0.5 font-semibold">{purchase.status === 'recibida' ? 'Recibida' : 'Pendiente'}</p>
          <p className="text-black/60">{purchase.items} ítem{purchase.items === 1 ? '' : 's'}</p>
        </div>
      </div>

      <table className="mt-4 w-full border-collapse text-[9px]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="py-1.5 pr-2 font-semibold">Descripción</th>
            <th className="py-1.5 px-2 text-right font-semibold">Cant.</th>
            <th className="py-1.5 px-2 text-right font-semibold">Costo unit.</th>
            <th className="py-1.5 pl-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-black/10">
              <td className="py-1.5 pr-2">{line.description}</td>
              <td className="py-1.5 px-2 text-right tabular">{line.quantity}</td>
              <td className="py-1.5 px-2 text-right tabular">{formatCurrency(line.unitPrice)}</td>
              <td className="py-1.5 pl-2 text-right tabular">{formatCurrency(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 ml-auto w-56 space-y-1 border-t border-black/20 pt-2 text-[10px]">
        <div className="flex justify-between">
          <span className="text-black/60">Subtotal</span>
          <span className="font-semibold tabular">{formatCurrency(purchase.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-black/60">IVA 19%</span>
          <span className="font-semibold tabular">{formatCurrency(purchase.iva)}</span>
        </div>
        <div className="flex justify-between border-t border-black/30 pt-1 text-[12px]">
          <span className="font-bold">Total</span>
          <span className="font-bold tabular">{formatCurrency(purchase.total)}</span>
        </div>
      </div>

      {purchase.notes ? (
        <div className="mt-4 border-t border-black/10 pt-2 text-[9px] text-black/60">
          <span className="font-semibold">Notas: </span>
          {purchase.notes}
        </div>
      ) : null}

      <p className="mt-auto pt-4 text-[8px] leading-relaxed text-black/45">
        Documento interno de compra. El IVA soportado se registra para control contable. No reemplaza la factura
        electrónica del proveedor.
      </p>
    </div>
  )
}

export function PurchaseReceiptModal({
  purchase,
  open,
  onClose
}: {
  purchase: Purchase | null
  open: boolean
  onClose: () => void
}) {
  if (!purchase) return null
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Comprobante de compra"
        description={`${purchase.number} · ${purchase.supplier}`}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-2">
            <Badge variant={purchase.status === 'recibida' ? 'success' : 'warning'}>
              {purchase.status === 'recibida' ? 'Recibida' : 'Pendiente'}
            </Badge>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cerrar
              </Button>
              <Button onClick={() => window.print()} leftIcon={<Printer className="h-4 w-4" />}>
                Imprimir
              </Button>
            </div>
          </div>
        }
      >
        <div className="rounded-2xl border border-line bg-white p-5 shadow-soft">
          <ReceiptBody purchase={purchase} />
        </div>
      </Modal>

      <div className="order-print-root pointer-events-none invisible fixed -left-[1000px] top-0 -z-50 print:visible print:static print:z-auto">
        <div className="order-print-sheet order-print-a4 flex flex-col bg-white px-[12mm] py-[10mm] text-black">
          <ReceiptBody purchase={purchase} />
        </div>
      </div>
      <style>{'@media print { @page { size: A4 portrait; margin: 0; } }'}</style>
    </>
  )
}
