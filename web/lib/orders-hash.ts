import { createHash } from 'node:crypto'
import type { DemoOrder } from '@/lib/orders-demo'

export function hashTrackingCode(code: string) {
  return createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest('hex')
}

export function findPortalOrder(
  orders: DemoOrder[],
  number: string,
  code: string
) {
  const codeHash = hashTrackingCode(code)
  const normalizedNumber = number.trim().toUpperCase()
  return orders.find(
    (order) =>
      order.number.toUpperCase() === normalizedNumber && order.codeHash === codeHash
  )
}

export function findPortalOrderByCode(orders: DemoOrder[], code: string) {
  const codeHash = hashTrackingCode(code)
  return orders.find((order) => order.codeHash === codeHash)
}
