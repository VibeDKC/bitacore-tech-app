import Link from 'next/link'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import type { Product } from '@/lib/catalog'
import {
  formatPrice,
  productHref,
  stockLabel,
  stockTone
} from '@/lib/catalog'
import { ProductImage } from '@/components/product-image'

export function ProductCard({ product }: { product: Product }) {
  const tone = stockTone(product.stock)

  return (
    <article className="product-card">
      <Link
        className="product-media"
        href={productHref(product)}
        aria-label={`Ver ${product.name}`}
      >
        <div className="product-badges">
          <div className="product-badge-stack">
            {product.condition ? (
              <span className="badge badge-condition">{product.condition}</span>
            ) : null}
            {product.promotion ? (
              <span className="badge badge-promo" title="Promoción vigente">
                {product.promotion.badge}
              </span>
            ) : null}
          </div>
          <span className={`badge badge-stock ${tone}`}>{stockLabel(product.stock)}</span>
        </div>
        <ProductImage product={product} />
      </Link>

      <div className="product-body">
        <span className="product-category">{product.category}</span>
        <Link className="product-name" href={productHref(product)}>
          {product.name}
        </Link>
        <div className="product-meta">
          {product.warrantyDays > 0 ? (
            <span>
              <ShieldCheck aria-hidden="true" />
              Garantía {product.warrantyDays} días
            </span>
          ) : null}
          <span>Ref. {product.sku}</span>
        </div>
        <div className="product-footer">
          <div>
            {product.regularPrice ? (
              <div className="product-price-old">{formatPrice(product.regularPrice)}</div>
            ) : null}
            <div className="product-price">{formatPrice(product.price)}</div>
            <div className="product-price-note">COP · Precio publicado</div>
          </div>
          <Link
            className="product-view"
            href={productHref(product)}
            aria-label={`Ver ${product.name}`}
            title="Ver producto"
          >
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  )
}
