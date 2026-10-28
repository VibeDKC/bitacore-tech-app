'use client'

import { useState } from 'react'
import type { Product } from '@/lib/catalog'
import { ProductPlaceholder } from '@/components/product-image'

export function ProductGallery({ product }: { product: Product }) {
  const images =
    product.images?.length && product.images.length > 0
      ? product.images
      : product.image
        ? [product.image]
        : []
  const [active, setActive] = useState(0)

  if (!images.length) return <ProductPlaceholder category={product.category} />
  const current = images[Math.min(active, images.length - 1)]

  return (
    <div className="product-gallery">
      <img
        className="product-gallery-main"
        src={current}
        alt={product.name}
        loading="eager"
        decoding="async"
      />
      {images.length > 1 ? (
        <div className="product-gallery-thumbs" role="list" aria-label="Imágenes del producto">
          {images.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              role="listitem"
              className={index === active ? 'active' : undefined}
              onClick={() => setActive(index)}
              aria-label={`Ver imagen ${index + 1} de ${images.length}`}
              aria-current={index === active ? 'true' : undefined}
            >
              <img src={image} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
