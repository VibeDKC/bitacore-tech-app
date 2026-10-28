import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { OrderStatusCard } from '@/components/order-status-card'
import { findDemoOrderByCode } from '@/lib/orders-demo'

type TrackingPageProps = {
  params: Promise<{ code: string }>
}

export const metadata: Metadata = {
  title: 'Estado de la orden',
  robots: {
    index: false,
    follow: false
  }
}

export default async function TrackingPage({ params }: TrackingPageProps) {
  const { code } = await params
  const order = findDemoOrderByCode(code)
  if (!order) notFound()

  return (
    <div className="container order-page">
      <nav className="breadcrumbs" aria-label="Ruta de navegación">
        <Link href="/">Inicio</Link>
        <span>/</span>
        <Link href="/buscar-orden">Buscar orden</Link>
        <span>/</span>
        <span>{order.number}</span>
      </nav>
      <div className="tracking-wrap">
        <OrderStatusCard order={order} />
        <Link className="btn btn-outline" href="/buscar-orden">
          <ArrowLeft aria-hidden="true" />
          Volver a la búsqueda
        </Link>
      </div>
    </div>
  )
}
