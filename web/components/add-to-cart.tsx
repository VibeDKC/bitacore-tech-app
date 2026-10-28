'use client'

import { useEffect, useState } from 'react'
import { Check, ShoppingCart } from 'lucide-react'
import type { Product } from '@/lib/catalog'
import { useCart } from '@/components/cart-provider'

export function AddToCart({
  product,
  compact = false
}: {
  product: Product
  compact?: boolean
}) {
  const { add } = useCart()
  const [added, setAdded] = useState(false)
  const soldOut = product.stock <= 0 || !product.slug

  useEffect(() => {
    if (!added) return
    const timer = window.setTimeout(() => setAdded(false), 1600)
    return () => window.clearTimeout(timer)
  }, [added])

  function handleAdd() {
    if (soldOut) return
    add(product.id, product.stock)
    setAdded(true)
  }

  if (compact) {
    return (
      <button
        type="button"
        className={`product-cart-button ${added ? 'is-added' : ''}`}
        onClick={handleAdd}
        disabled={soldOut}
        aria-label={
          soldOut
            ? `${product.name} está agotado`
            : added
              ? `${product.name} añadido al carrito`
              : `Añadir ${product.name} al carrito`
        }
        title={soldOut ? 'Agotado' : added ? 'Añadido al carrito' : 'Añadir al carrito'}
      >
        {added ? <Check aria-hidden="true" /> : <ShoppingCart aria-hidden="true" />}
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`btn btn-outline ${added ? 'is-added' : ''}`}
      onClick={handleAdd}
      disabled={soldOut}
    >
      {added ? <Check aria-hidden="true" /> : <ShoppingCart aria-hidden="true" />}
      {soldOut ? 'Agotado' : added ? 'Añadido al carrito' : 'Añadir al carrito'}
    </button>
  )
}
