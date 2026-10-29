import type { Product, StockStatus, WorkOrderStatus } from '@/types'

export const workOrderStatusOrder: WorkOrderStatus[] = [
  'recibido',
  'diagnostico',
  'aprobacion',
  'reparacion',
  'pruebas',
  'listo',
  'entregado',
  'no_reparado',
  'abandonado'
]

export const workOrderStatusConfig: Record<
  WorkOrderStatus,
  {
    label: string
    shortLabel: string
    tone: 'neutral' | 'brand' | 'warning' | 'sky' | 'success' | 'danger'
    dot: string
    description: string
  }
> = {
  recibido: {
    label: 'Recibido',
    shortLabel: 'Recibido',
    tone: 'neutral',
    dot: 'bg-slate-400',
    description: 'Equipo registrado y pendiente de diagnóstico.'
  },
  diagnostico: {
    label: 'En diagnóstico',
    shortLabel: 'Diagnóstico',
    tone: 'sky',
    dot: 'bg-sky-500',
    description: 'El técnico está evaluando la falla.'
  },
  aprobacion: {
    label: 'Esperando aprobación',
    shortLabel: 'Aprobación',
    tone: 'warning',
    dot: 'bg-warning-500',
    description: 'Cotización enviada al cliente.'
  },
  reparacion: {
    label: 'En reparación',
    shortLabel: 'Reparación',
    tone: 'brand',
    dot: 'bg-brand-500',
    description: 'Trabajo técnico en curso.'
  },
  pruebas: {
    label: 'Pruebas de control',
    shortLabel: 'Pruebas',
    tone: 'sky',
    dot: 'bg-sky-500',
    description: 'Verificación de funcionamiento y calidad.'
  },
  listo: {
    label: 'Listo para entrega',
    shortLabel: 'Listo',
    tone: 'success',
    dot: 'bg-success-500',
    description: 'Equipo reparado, pendiente de retiro y facturación.'
  },
  entregado: {
    label: 'Entregado',
    shortLabel: 'Entregado',
    tone: 'success',
    dot: 'bg-success-600',
    description: 'Equipo entregado y factura emitida.'
  },
  no_reparado: {
    label: 'No reparado',
    shortLabel: 'No reparado',
    tone: 'danger',
    dot: 'bg-danger-500',
    description: 'El equipo no pudo repararse o el cliente rechazó el trabajo.'
  },
  abandonado: {
    label: 'Abandonado',
    shortLabel: 'Abandonado',
    tone: 'danger',
    dot: 'bg-danger-600',
    description: 'Equipo no reclamado y trasladado a despiece.'
  }
}

export function getStockStatus(product: Pick<Product, 'stock' | 'minStock' | 'service'>): StockStatus {
  if (product.service) return 'in'
  if (product.stock <= 0) return 'out'
  if (product.stock <= product.minStock) return 'low'
  return 'in'
}

export function stockStatusLabel(status: StockStatus) {
  return status === 'in' ? 'En stock' : status === 'low' ? 'Stock bajo' : 'Agotado'
}

const progressOrder: WorkOrderStatus[] = [
  'recibido',
  'diagnostico',
  'aprobacion',
  'reparacion',
  'pruebas',
  'listo',
  'entregado'
]

export function getWorkOrderProgress(status: WorkOrderStatus) {
  if (status === 'entregado' || status === 'no_reparado' || status === 'abandonado') return 100
  const index = progressOrder.indexOf(status)
  return Math.round(((index + 1) / progressOrder.length) * 100)
}

export function nextWorkOrderStatus(status: WorkOrderStatus): WorkOrderStatus | null {
  if (status === 'no_reparado' || status === 'entregado' || status === 'abandonado') return null
  const index = progressOrder.indexOf(status)
  return progressOrder[index + 1] ?? null
}

export function canCancelWorkOrder(status: WorkOrderStatus) {
  return status !== 'entregado' && status !== 'no_reparado' && status !== 'abandonado'
}
