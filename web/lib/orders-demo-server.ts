import { cache } from 'react'
import { ordersDemo, type OrdersDemo } from '@/lib/orders-demo'

const CATALOG_URL = process.env.CATALOG_URL?.trim()
const ORDERS_URL =
  process.env.ORDERS_URL?.trim() ||
  (CATALOG_URL ? new URL('orders-demo.json', CATALOG_URL).toString() : '')

const REVALIDATE = Math.max(
  30,
  Number(process.env.CATALOG_REVALIDATE_SECONDS || 60) || 60
)

async function fetchOrders(url: string): Promise<OrdersDemo | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: REVALIDATE }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as OrdersDemo
    if (!data || !Array.isArray(data.orders)) {
      throw new Error('Las órdenes demo no tienen el formato esperado.')
    }
    return data
  } catch (error) {
    console.warn(
      `[orders] No se pudo leer ${url}. Se usa el snapshot local.`,
      error instanceof Error ? error.message : error
    )
    return null
  }
}

export const getOrdersDemo = cache(async (): Promise<OrdersDemo> => {
  if (!ORDERS_URL) return ordersDemo
  const remote = await fetchOrders(ORDERS_URL)
  return remote ?? ordersDemo
})
