import type { Product } from '@/lib/catalog'
import { CategoryIcon } from '@/components/category-icon'

export function ProductPlaceholder({ category }: { category: string }) {
  return (
    <span className="product-placeholder">
      <span className="placeholder-icon">
        <CategoryIcon category={category} />
      </span>
      <span className="placeholder-text">Foto próximamente</span>
    </span>
  )
}

export function ProductImage({
  product,
  eager = false
}: {
  product: Product
  eager?: boolean
}) {
  if (!product.image) return <ProductPlaceholder category={product.category} />
  return (
    <img
      src={product.image}
      alt={product.name}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  )
}
