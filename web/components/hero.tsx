'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react'
import type { Product } from '@/lib/catalog'
import { formatPrice, productHref, stockLabel } from '@/lib/catalog'

const AUTOPLAY_MS = 4000

export function Hero({ products }: { products: Product[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(media.matches)
    const onChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (paused || reduceMotion || products.length < 2) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % products.length)
    }, AUTOPLAY_MS)
    return () => window.clearInterval(timer)
  }, [paused, products.length, reduceMotion])

  if (!products.length) return null

  const total = products.length
  const product = products[index] ?? products[0]
  const stock = stockLabel(product.stock, product.stockVisibility)
  const goTo = (next: number) => setIndex((next + total) % total)

  return (
    <section className="hero">
      <div className="container hero-inner">
        <div className="hero-copy">
          <h1 className="hero-title">
            Servicio de <span>mantenimiento y reparación</span>, venta de
            tecnología y accesorios para tu día a día.
          </h1>
          <p className="hero-text">
            Reparamos y mantenemos tus equipos, y te asesoramos en la compra de
            tecnología y accesorios. Coordinamos la atención presencial por
            WhatsApp.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" href="/catalogo">
              Explorar catálogo
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link className="btn btn-outline" href="/servicios">
              Ver servicios
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="hero-visual">
          <div
            className="hero-panel"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <div className="hero-panel-top">
              <span className="hero-kicker">
                <ShieldCheck aria-hidden="true" />
                {product.promotion
                  ? 'Promoción'
                  : product.bestSeller
                    ? 'Más vendido'
                    : 'Destacado'}
              </span>
              <span className="hero-guarantee">
                <ShieldCheck aria-hidden="true" />
                Garantía {product.warrantyDays} días
              </span>
            </div>

            <div className="hero-image">
              {product.image ? (
                <img
                  key={product.id}
                  src={product.image}
                  alt={product.name}
                  loading={index === 0 ? 'eager' : 'lazy'}
                />
              ) : (
                <span className="hero-image-placeholder">Foto próximamente</span>
              )}
            </div>

            <div className="hero-product">
              <div className="hero-product-info">
                <p className="hero-product-label">
                  {product.category}
                  {stock ? ` · ${stock}` : ''}
                </p>
                <p className="hero-product-name">{product.name}</p>
                <div className="hero-product-price-row">
                  {product.regularPrice ? (
                    <span className="hero-product-old">
                      {formatPrice(product.regularPrice)}
                    </span>
                  ) : null}
                  <p className="hero-product-price">{formatPrice(product.price)}</p>
                  {product.promotion ? (
                    <span className="hero-promo-badge">{product.promotion.badge}</span>
                  ) : null}
                </div>
              </div>
              <Link className="hero-product-link" href={productHref(product)}>
                Ver producto
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>

            <div className="hero-carousel-footer">
              <span className="hero-carousel-count">
                {index + 1} / {total}
              </span>
              <div className="hero-carousel-controls">
                <button
                  type="button"
                  aria-label="Producto anterior"
                  onClick={() => goTo(index - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <div
                  className="hero-carousel-dots"
                  role="tablist"
                  aria-label="Productos destacados"
                >
                  {products.map((item, itemIndex) => (
                    <button
                      key={item.id}
                      type="button"
                      className={itemIndex === index ? 'active' : ''}
                      aria-label={`Ver ${item.name}`}
                      aria-selected={itemIndex === index}
                      role="tab"
                      onClick={() => goTo(itemIndex)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  aria-label="Producto siguiente"
                  onClick={() => goTo(index + 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
