import { NextResponse } from 'next/server'
import { getOrdersDemo } from '@/lib/orders-demo-server'
import { normalizeOrderNumber, normalizeTrackingCode } from '@/lib/order-format'
import { findPortalOrder } from '@/lib/orders-hash'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const number = normalizeOrderNumber(url.searchParams.get('numero') || '')
  const code = normalizeTrackingCode(url.searchParams.get('codigo') || '')
  if (!number || !code) {
    return NextResponse.json({ error: 'Número y clave requeridos.' }, { status: 400 })
  }
  const data = await getOrdersDemo()
  const order = findPortalOrder(data.orders, number, code)
  if (!order) {
    return NextResponse.json({ error: 'Orden no encontrada.' }, { status: 404 })
  }
  return NextResponse.json(
    {
      number: order.number,
      codeHash: order.codeHash,
      status: order.status,
      equipmentType: order.equipmentType,
      brand: order.brand,
      model: order.model,
      promisedAt: order.promisedAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow'
      }
    }
  )
}
