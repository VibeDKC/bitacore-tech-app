import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { CartView } from '@/components/cart-view'
import { getCatalog } from '@/lib/catalog-server'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Carrito',
  description:
    'Revisa las referencias que quieres pedir y envía el pedido por WhatsApp para recoger en tienda.',
  robots: {
    index: false,
    follow: false
  }
}

export default async function CartPage() {
  const catalog = await getCatalog()
  return (
    <section className="cart-page">
      <div className="container">
        <nav className="breadcrumbs" aria-label="Ruta de navegación">
          <Link href="/">Inicio</Link>
          <ChevronRight aria-hidden="true" />
          <Link href="/catalogo">Catálogo</Link>
          <ChevronRight aria-hidden="true" />
          <span>Carrito</span>
        </nav>
        <div className="cart-head">
          <p className="eyebrow">Pedido</p>
          <h1 className="cart-title">Tu carrito</h1>
          <p className="cart-subtitle">
            Ajusta cantidades y envía el pedido por WhatsApp. La disponibilidad y el
            valor final se confirman antes de la recogida en tienda.
          </p>
        </div>
        <CartView catalog={catalog} />
      </div>
    </section>
  )
}
