'use client'

import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { useCart } from '@/components/cart-provider'

export function CartLink() {
  const { count } = useCart()
  return (
    <Link
      className="cart-link"
      href="/carrito"
      aria-label={count ? `Carrito, ${count} unidad${count === 1 ? '' : 'es'}` : 'Carrito'}
      title="Ver carrito"
    >
      <ShoppingCart aria-hidden="true" />
      <span>Carrito</span>
      {count > 0 ? <strong className="cart-count">{count}</strong> : null}
    </Link>
  )
}
