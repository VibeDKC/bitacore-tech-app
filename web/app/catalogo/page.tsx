import type { Metadata } from 'next'
import { CatalogExplorer } from '@/components/catalog-explorer'
import { getCatalog } from '@/lib/catalog-server'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Catálogo',
  description:
    'Catálogo de periféricos, almacenamiento y accesorios disponibles en Medellín. Consulta por WhatsApp.'
}

export default async function CatalogPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; categoria?: string }>
}) {
  const params = await searchParams
  const catalog = await getCatalog()
  const initialQuery = typeof params.q === 'string' ? params.q : ''
  const initialCategory = typeof params.categoria === 'string' ? params.categoria : ''

  return (
    <section>
      <div className="catalog-head">
        <div className="container">
          <p className="eyebrow">Catálogo</p>
          <h1 className="catalog-title">Tecnología disponible en Medellín</h1>
          <p className="catalog-subtitle">
            {catalog.stats.products} referencias de periféricos, almacenamiento y
            accesorios. Consulta disponibilidad, precio final y entrega por WhatsApp.
          </p>
          <CatalogExplorer
            products={catalog.products}
            categories={catalog.categories}
            initialQuery={initialQuery}
            initialCategory={initialCategory}
          />
        </div>
      </div>
    </section>
  )
}
