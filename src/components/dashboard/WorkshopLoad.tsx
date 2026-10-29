import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Wrench } from 'lucide-react'
import { workOrderStatusConfig } from '@/lib/status'
import { ProgressBar } from '@/components/ui/EmptyState'
import type { WorkOrder, WorkOrderStatus } from '@/types'

const openStatuses: WorkOrderStatus[] = ['recibido', 'diagnostico', 'aprobacion', 'reparacion', 'pruebas', 'listo']

const progressTone: Record<WorkOrderStatus, 'brand' | 'success' | 'warning' | 'danger'> = {
  recibido: 'brand',
  diagnostico: 'brand',
  aprobacion: 'warning',
  reparacion: 'brand',
  pruebas: 'brand',
  listo: 'success',
  entregado: 'success',
  no_reparado: 'danger',
  abandonado: 'danger'
}

export function WorkshopLoad({ orders: allOrders = [], technician = 'Julián Vélez' }: { orders?: WorkOrder[]; technician?: string }) {
  const navigate = useNavigate()
  const orders = allOrders.filter((order) => order.technician === technician && openStatuses.includes(order.status))
  const total = orders.length

  const counts = openStatuses.map((status) => ({
    status,
    count: orders.filter((order) => order.status === status).length
  }))

  return (
    <div className="card flex flex-col p-5 lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[16px] font-bold text-ink">Carga del taller</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">Órdenes abiertas de {technician}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/ordenes')}
          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white text-slate-400 shadow-sm transition hover:text-ink"
          aria-label="Ver órdenes"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Wrench className="h-5 w-5" />
        </span>
        <div>
          <p className="tabular font-display text-[30px] font-bold leading-none tracking-[-0.03em] text-ink">{total}</p>
          <p className="mt-1 text-[11px] text-slate-400">equipos en proceso</p>
        </div>
      </div>

      <div className="mt-6 flex-1 space-y-4">
        {counts.map(({ status, count }) => {
          const config = workOrderStatusConfig[status]
          return (
            <div key={status}>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
                  {config.shortLabel}
                </span>
                <span className="tabular text-[11px] font-semibold text-ink">{count}</span>
              </div>
              <ProgressBar value={total ? (count / total) * 100 : 0} tone={progressTone[status]} />
            </div>
          )
        })}
      </div>

      <div className="mt-5 rounded-xl border border-line bg-slate-50/70 p-3">
        <p className="text-[10px] leading-relaxed text-slate-500">
          <span className="font-semibold text-ink">2 equipos</span> tienen promesa de entrega hoy. Revisa el estado antes de cerrar el turno.
        </p>
      </div>

      <button
        type="button"
        onClick={() => navigate('/ordenes')}
        className="focus-ring mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-white text-[11px] font-semibold text-slate-600 shadow-sm transition hover:text-ink"
      >
        Ver todas las órdenes
      </button>
    </div>
  )
}
