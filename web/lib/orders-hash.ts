import { createHash } from 'node:crypto'
import type { DemoOrder } from '@/lib/orders-demo'
import { normalizeOrderNumber, normalizeTrackingCode } from '@/lib/order-format'

export function hashTrackingCode(code: string) {
  return createHash('sha256')
    .update(normalizeTrackingCode(code), 'utf8')
    .digest('hex')
}

export function findPortalOrder(
  orders: DemoOrder[],
  number: string,
  code: string
) {
  const codeHash = hashTrackingCode(code)
  const normalizedNumber = normalizeOrderNumber(number)
  if (!normalizedNumber) return undefined
  return orders.find(
    (order) =>
      order.number.toUpperCase() === normalizedNumber && order.codeHash === codeHash
  )
}

export function findPortalOrderByCode(orders: DemoOrder[], code: string) {
  const codeHash = hashTrackingCode(code)
  return orders.find((order) => order.codeHash === codeHash)
}
