import type { WorkOrder } from '@/types'

export function lineTotal(quantity: number, unitPrice: number) {
  return quantity * unitPrice
}

export function workOrderTotal(order: WorkOrder) {
  if (typeof order.total === 'number') return order.total
  return order.items.reduce((total, item) => total + lineTotal(item.quantity, item.unitPrice), 0)
}

export function workOrderLaborTotal(order: WorkOrder) {
  return order.items
    .filter((item) => item.type === 'servicio')
    .reduce((total, item) => total + lineTotal(item.quantity, item.unitPrice), 0)
}

export function workOrderPartsTotal(order: WorkOrder) {
  return order.items
    .filter((item) => item.type === 'repuesto')
    .reduce((total, item) => total + lineTotal(item.quantity, item.unitPrice), 0)
}

export function workOrderItemCount(order: WorkOrder) {
  return order.items.reduce((total, item) => total + item.quantity, 0)
}
