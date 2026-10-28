import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  ChevronRight,
  MessageCircle,
  ShieldCheck
} from 'lucide-react'
import { ProductCard } from '@/components/product-card'
import { ProductImage } from '@/components/product-image'
import {
  catalog,
  formatPrice,
  getProductBySlug,
  getRelatedProducts,
  productHref,
  productWhatsAppUrl,
  stockLabel,
  stockTone
} from '@/lib/catalog'

type ProductPageProps = {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return catalog.products.map((product) => ({ slug: product.slug }))
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params
  const product = getProductBySlug(slug)
  if (!product) return { title: 'Producto no encontrado' }
  return {
    title: product.name,
    description: `${product.name} · ${formatPrice(product.price)} · ${product.category}. Consulta disponibilidad por WhatsApp.`,
    alternates: {
      canonical: productHref(product)
    },
    openGraph: {
      title: product.name,
      description: `${product.category} · ${formatPrice(product.price)}. Consulta disponibilidad por WhatsApp.`,
      images: product.image ? [{ url: product.image }] : undefined
    }
  }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params
  const product = getProductBySlug(slug)
  if (!product) notFound()

  const related = getRelatedProducts(product, 4)
  const tone = stockTone(product.stock)

  return (
    <div className="container">
      <nav className="breadcrumbs" aria-label="Ruta de navegación">
        <Link href="/">Inicio</Link>
        <ChevronRight aria-hidden="true" />
        <Link href="/catalogo">Catálogo</Link>
        <ChevronRight aria-hidden="true" />
        <Link href={`/catalogo?categoria=${product.categorySlug}`}>
          {product.category}
        </Link>
        <ChevronRight aria-hidden="true" />
        <span>{product.name}</span>
      </nav>

      <article className="product-detail">
        <div className="detail-media">
          <span className="detail-media-badge">
            {product.condition ? (
              <span className="badge badge-condition">{product.condition}</span>
            ) : null}
          </span>
          <ProductImage product={product} eager />
        </div>

        <div className="detail-info">
          <Link
            className="detail-category"
            href={`/catalogo?categoria=${product.categorySlug}`}
          >
            {product.category}
          </Link>
          <h1 className="detail-title">{product.name}</h1>
          <p className="detail-sku">REF. {product.sku}</p>

          <div className="detail-price-row">
            {product.regularPrice ? (
              <span className="detail-price-old">{formatPrice(product.regularPrice)}</span>
            ) : null}
            <p className="detail-price">{formatPrice(product.price)}</p>
            <span className={`detail-stock ${tone}`}>
              <ShieldCheck aria-hidden="true" />
              {stockLabel(product.stock)}
            </span>
            {product.promotion ? (
              <span className="detail-promo">{product.promotion.badge}</span>
            ) : null}
          </div>
          <p className="detail-price-note">
            Precio en COP · Disponibilidad sujeta a confirmación
            {product.promotion ? ' · Promoción de demostración' : ''}
          </p>

          <p className="detail-copy">
            Consulta disponibilidad, precio final y entrega directamente por
            WhatsApp. Te confirmamos el stock y coordinamos la entrega en Medellín.
          </p>

          <div className="detail-facts">
            <div className="fact">
              <p className="fact-label">Categoría</p>
              <p className="fact-value">{product.category}</p>
            </div>
            <div className="fact">
              <p className="fact-label">Condición</p>
              <p className="fact-value">{product.condition || 'Nuevo'}</p>
            </div>
            <div className="fact">
              <p className="fact-label">Garantía</p>
              <p className="fact-value">
                {product.warrantyDays > 0 ? `${product.warrantyDays} días` : 'Por confirmar'}
              </p>
            </div>
            <div className="fact">
              <p className="fact-label">Referencia</p>
              <p className="fact-value">{product.sku}</p>
            </div>
          </div>

          <div className="detail-actions">
            <a
              className="btn btn-whatsapp"
              href={productWhatsAppUrl(product)}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle aria-hidden="true" />
              Solicitar cotización
            </a>
            <Link className="btn btn-outline" href="/catalogo">
              <ArrowLeft aria-hidden="true" />
              Seguir explorando
            </Link>
          </div>

          <p className="detail-note">
            <ShieldCheck aria-hidden="true" />
            Producto del catálogo de BitacoreTech. La disponibilidad y el valor
            final se confirman por WhatsApp antes de la compra.
          </p>
        </div>
      </article>

      {related.length >= 2 ? (
        <section className="related-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">También disponible</p>
              <h2 className="section-title">Más de {product.category}</h2>
            </div>
            <Link className="section-link" href={`/catalogo?categoria=${product.categorySlug}`}>
              Ver categoría
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>
          <div className="product-grid">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
