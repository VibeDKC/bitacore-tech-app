import { Hero } from '@/components/hero'
import { TrustBar } from '@/components/trust-bar'
import { CategoryCard } from '@/components/category-card'
import { ServiceBand } from '@/components/service-band'
import { SectionHeading } from '@/components/section-heading'
import { getHeroCarouselProducts } from '@/lib/catalog'
import { getCatalog } from '@/lib/catalog-server'

export const revalidate = 60

export default async function HomePage() {
  const catalog = await getCatalog()
  const heroProducts = getHeroCarouselProducts(catalog)

  return (
    <>
      {heroProducts.length ? <Hero products={heroProducts} /> : null}
      <TrustBar />

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="Categorías"
            title="Encuentra lo que buscas"
            subtitle="Periféricos, almacenamiento y accesorios disponibles en Medellín. Cada referencia se confirma por WhatsApp y se recoge en tienda."
            href="/catalogo"
            linkLabel="Ver todo el catálogo"
          />
          <div className="category-grid">
            {catalog.categories.map((category) => (
              <CategoryCard key={category.slug} category={category} />
            ))}
          </div>
        </div>
      </section>

      <section className="section section--compact">
        <div className="container">
          <ServiceBand />
        </div>
      </section>
    </>
  )
}
