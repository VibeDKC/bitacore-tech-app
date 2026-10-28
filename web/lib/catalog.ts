import catalogJson from '@/data/catalog.json'

export type Promotion = {
  id: string
  name: string
  badge: string
  type: 'percent' | 'amount'
  value: number
  startsOn?: string | null
  endsOn?: string | null
}

export type BestSeller = {
  productId: string
  quantity: number
}

export type Product = {
  id: string
  sku: string
  slug: string
  name: string
  category: string
  categorySlug: string
  regularPrice: number | null
  price: number
  stock: number
  condition: string
  warrantyDays: number
  image: string | null
  bestSeller?: boolean
  promotion: Promotion | null
  createdAt: string
  updatedAt: string
}

export type Category = {
  name: string
  slug: string
  count: number
  image: string | null
}

export type Catalog = {
  generatedAt: string
  source: string
  business: {
    name: string
    descriptor: string
    phone: string
    whatsapp: string
    city: string
    hours: string
    currency: string
  }
  stats: {
    products: number
    withImage: number
    categories: number
  }
  bestSellers?: BestSeller[]
  heroProductId: string | null
  featured: string[]
  categories: Category[]
  products: Product[]
}

const categoryOrder = ['Periféricos', 'Almacenamiento', 'Accesorios']

export function normalizeCatalog(data: Catalog): Catalog {
  return {
    ...data,
    categories: [...data.categories].sort(
      (a, b) => categoryOrder.indexOf(a.name) - categoryOrder.indexOf(b.name)
    )
  }
}

export const localCatalog = normalizeCatalog(catalogJson as unknown as Catalog)

// Alias para desarrollos que aún no usan getCatalog(). La web pública usa
// getCatalog() para preferir el snapshot remoto de Supabase.
export const catalog = localCatalog
export const business = localCatalog.business

export function formatPrice(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(value)
}

export function whatsappUrl(message: string) {
  return `https://wa.me/${business.whatsapp}?text=${encodeURIComponent(message)}`
}

export function productWhatsAppUrl(product: Product) {
  const priceLine = product.promotion
    ? `• Precio promocional: ${formatPrice(product.price)} (antes ${formatPrice(
        product.regularPrice ?? product.price
      )})`
    : `• Precio: ${formatPrice(product.price)}`
  return whatsappUrl(
    [
      'Hola BitacoreTech, me interesa este producto:',
      '',
      `• ${product.name}`,
      `• Código: ${product.sku}`,
      priceLine,
      '',
      '¿Está disponible para entrega en Medellín?'
    ].join('\n')
  )
}

export const generalWhatsAppUrl = whatsappUrl(
  'Hola BitacoreTech, quiero asesoría sobre los productos del catálogo.'
)

export const serviceWhatsAppUrl = whatsappUrl(
  'Hola BitacoreTech, necesito servicio técnico para un equipo. ¿Me pueden ayudar?'
)

export function getHeroProduct(data: Catalog) {
  return (
    data.products.find((product) => product.id === data.heroProductId) ??
    data.products.find((product) => product.image) ??
    data.products[0]
  )
}

export function getHeroCarouselProducts(data: Catalog) {
  const hero = getHeroProduct(data)
  const byId = new Map(data.products.map((product) => [product.id, product]))
  const selected = data.featured
    .map((id) => byId.get(id))
    .filter((product): product is Product => Boolean(product))
  return [...selected].sort(
    (a, b) =>
      Number(b.id === hero?.id) - Number(a.id === hero?.id) ||
      Number(Boolean(b.promotion)) - Number(Boolean(a.promotion)) ||
      Number(Boolean(b.bestSeller)) - Number(Boolean(a.bestSeller))
  )
}

export function getProductBySlug(data: Catalog, slug: string) {
  return data.products.find((product) => product.slug === slug)
}

export function getCategoryBySlug(data: Catalog, slug: string) {
  return data.categories.find((category) => category.slug === slug)
}

export function getRelatedProducts(data: Catalog, product: Product, limit = 4) {
  return data.products
    .filter(
      (item) =>
        item.id !== product.id &&
        item.category === product.category &&
        item.stock > 0
    )
    .sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)))
    .slice(0, limit)
}

export function stockLabel(stock: number) {
  if (stock <= 0) return 'Agotado'
  if (stock === 1) return 'Última unidad'
  if (stock <= 3) return 'Pocas unidades'
  return 'Disponible'
}

export function stockTone(stock: number) {
  if (stock <= 0) return 'out'
  if (stock <= 3) return 'low'
  return 'in'
}

export function productHref(product: Product) {
  return `/producto/${product.slug}`
}

export function categoryHref(category: Category | string) {
  const slug = typeof category === 'string' ? category : category.slug
  return `/catalogo?categoria=${encodeURIComponent(slug)}`
}
