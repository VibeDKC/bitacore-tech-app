import catalogJson from '@/data/catalog.json'

export type Promotion = {
  name: string
  badge: string
  type: 'percent' | 'fixed'
  value: number
  demo: boolean
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
  heroProductId: string | null
  featured: string[]
  categories: Category[]
  products: Product[]
}

const data = catalogJson as unknown as Catalog

const categoryOrder = ['Periféricos', 'Almacenamiento', 'Accesorios']

export const catalog = {
  ...data,
  categories: [...data.categories].sort(
    (a, b) => categoryOrder.indexOf(a.name) - categoryOrder.indexOf(b.name)
  )
}

export const business = catalog.business

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

export function getHeroProduct() {
  return (
    catalog.products.find((product) => product.id === catalog.heroProductId) ??
    catalog.products.find((product) => product.image) ??
    catalog.products[0]
  )
}

export function getHeroCarouselProducts() {
  const hero = getHeroProduct()
  const byId = new Map(catalog.products.map((product) => [product.id, product]))
  const selected = catalog.featured
    .map((id) => byId.get(id))
    .filter((product): product is Product => Boolean(product))
  return [...selected].sort(
    (a, b) =>
      Number(b.id === hero?.id) - Number(a.id === hero?.id) ||
      Number(Boolean(b.promotion)) - Number(Boolean(a.promotion))
  )
}

export function getProductBySlug(slug: string) {
  return catalog.products.find((product) => product.slug === slug)
}

export function getCategoryBySlug(slug: string) {
  return catalog.categories.find((category) => category.slug === slug)
}

export function getRelatedProducts(product: Product, limit = 4) {
  return catalog.products
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
