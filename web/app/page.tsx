import { Hero } from '@/components/hero'
import { TrustBar } from '@/components/trust-bar'
import { CategoryCard } from '@/components/category-card'
import { ServiceBand } from '@/components/service-band'
import { SectionHeading } from '@/components/section-heading'
import { catalog, getHeroCarouselProducts } from '@/lib/catalog'

export default function HomePage() {
  const heroProducts = getHeroCarouselProducts()

  return (
    <>
      {heroProducts.length ? <Hero products={heroProducts} /> : null}
      <TrustBar />

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="Categorías"
            title="Encuentra lo que buscas"
            subtitle="Periféricos, almacenamiento y accesorios disponibles en Medellín. Cada referencia se confirma por WhatsApp antes de la compra."
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
