'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  ShoppingBag,
  Trash2
} from 'lucide-react'
import type { Catalog, Product } from '@/lib/catalog'
import {
  cartWhatsAppUrl,
  formatPrice,
  productHref
} from '@/lib/catalog'
import { ProductImage } from '@/components/product-image'
import { useCart } from '@/components/cart-provider'

type ResolvedLine = {
  id: string
  quantity: number
  product: Product | null
}

function CartRow({
  line,
  onChange,
  onRemove
}: {
  line: ResolvedLine
  onChange: (quantity: number) => void
  onRemove: () => void
}) {
  const { product } = line
  if (!product) {
    return (
      <div className="cart-row cart-row--missing">
        <div className="cart-row-info">
          <strong>Referencia no disponible</strong>
          <p>Esta referencia ya no forma parte del catálogo.</p>
        </div>
        <button type="button" className="cart-remove" onClick={onRemove}>
          <Trash2 aria-hidden="true" />
          Quitar
        </button>
      </div>
    )
  }

  const soldOut = product.stock <= 0
  const max = Math.max(0, product.stock)

  return (
    <article className={`cart-row ${soldOut ? 'is-sold-out' : ''}`}>
      <Link className="cart-row-media" href={productHref(product)} aria-label={product.name}>
        <ProductImage product={product} />
      </Link>
      <div className="cart-row-info">
        <Link className="cart-row-name" href={productHref(product)}>
          {product.name}
        </Link>
        <p className="cart-row-meta">
          Ref. {product.sku} · {product.category}
          {product.condition ? ` · ${product.condition}` : ''}
        </p>
        {soldOut ? (
          <p className="cart-row-alert">Agotado · no se incluirá en el mensaje</p>
        ) : (
          <p className="cart-row-price">
            {formatPrice(product.price)} <span>c/u</span>
            {product.promotion ? <em>{product.promotion.badge}</em> : null}
          </p>
        )}
        <div className="cart-quantity">
          <button
            type="button"
            onClick={() => onChange(line.quantity - 1)}
            disabled={soldOut}
            aria-label={`Quitar una unidad de ${product.name}`}
          >
            <Minus aria-hidden="true" />
          </button>
          <span aria-label={`Cantidad de ${product.name}`}>{line.quantity}</span>
          <button
            type="button"
            onClick={() => onChange(line.quantity + 1)}
            disabled={soldOut || line.quantity >= max}
            aria-label={`Añadir una unidad de ${product.name}`}
          >
            <Plus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cart-remove"
            onClick={onRemove}
            aria-label={`Quitar ${product.name} del carrito`}
          >
            <Trash2 aria-hidden="true" />
            <span>Quitar</span>
          </button>
        </div>
      </div>
      <div className="cart-row-total">
        {soldOut ? '—' : formatPrice(product.price * line.quantity)}
      </div>
    </article>
  )
}

export function CartView({ catalog }: { catalog: Catalog }) {
  const { lines, ready, setQuantity, remove, clear } = useCart()
  const products = new Map(catalog.products.map((product) => [product.id, product]))
  const resolved: ResolvedLine[] = lines.map((line) => ({
    ...line,
    product: products.get(line.id) ?? null
  }))
  const available = resolved.filter(
    (line): line is ResolvedLine & { product: Product } =>
      line.product !== null && line.product.stock > 0
  )
  const total = available.reduce(
    (sum, line) => sum + line.product.price * line.quantity,
    0
  )
  const units = available.reduce((sum, line) => sum + line.quantity, 0)
  const whatsappUrl = available.length
    ? cartWhatsAppUrl(
        available.map((line) => ({ product: line.product, quantity: line.quantity }))
      )
    : ''

  if (!ready) {
    return <p className="cart-loading">Cargando carrito…</p>
  }

  if (!resolved.length) {
    return (
      <div className="cart-empty">
        <span className="cart-empty-icon">
          <ShoppingBag aria-hidden="true" />
        </span>
        <h2>Tu carrito está vacío</h2>
        <p>
          Explora el catálogo y añade las referencias que quieras pedir. Coordinamos
          la recogida en tienda por WhatsApp.
        </p>
        <Link className="btn btn-primary" href="/catalogo">
          Explorar catálogo
        </Link>
      </div>
    )
  }

  return (
    <div className="cart-layout">
      <section className="cart-list" aria-label="Productos en el carrito">
        {resolved.map((line) => (
          <CartRow
            key={line.id}
            line={line}
            onChange={(quantity) => setQuantity(line.id, quantity, line.product?.stock ?? 0)}
            onRemove={() => remove(line.id)}
          />
        ))}
        <div className="cart-list-actions">
          <Link className="cart-continue" href="/catalogo">
            <ArrowLeft aria-hidden="true" />
            Seguir explorando
          </Link>
          <button type="button" className="cart-clear" onClick={clear}>
            Vaciar carrito
          </button>
        </div>
      </section>

      <aside className="cart-summary">
        <h2>Resumen del pedido</h2>
        <div className="cart-summary-row">
          <span>Referencias</span>
          <strong>{available.length}</strong>
        </div>
        <div className="cart-summary-row">
          <span>Unidades</span>
          <strong>{units}</strong>
        </div>
        <div className="cart-summary-row cart-summary-total">
          <span>Total</span>
          <strong>{formatPrice(total)}</strong>
        </div>
        <p className="cart-summary-note">
          {available.length < resolved.length
            ? 'Las referencias agotadas no se incluyen en el mensaje. Confirma disponibilidad por WhatsApp.'
            : 'Los precios se confirman por WhatsApp antes de la compra.'}
        </p>
        {whatsappUrl ? (
          <a
            className="btn btn-whatsapp cart-whatsapp"
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle aria-hidden="true" />
            Pedir por WhatsApp
          </a>
        ) : (
          <span className="btn btn-outline cart-whatsapp is-disabled">
            No hay referencias disponibles
          </span>
        )}
        <div className="cart-pickup">
          <MapPin aria-hidden="true" />
          <p>
            <strong>Recogida en tienda</strong>
            <span>Coordinamos la recogida presencial en Medellín por WhatsApp.</span>
          </p>
        </div>
      </aside>
    </div>
  )
}
