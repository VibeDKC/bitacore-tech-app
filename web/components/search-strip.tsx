import Link from 'next/link'
import { Search } from 'lucide-react'
import type { Category } from '@/lib/catalog'

export function SearchStrip({ categories }: { categories: Category[] }) {
  return (
    <div className="search-strip">
      <div className="container">
        <form className="search-form" action="/catalogo" method="get" role="search">
          <label className="sr-only" htmlFor="search-category">
            Categoría
          </label>
          <select
            id="search-category"
            name="categoria"
            className="search-select"
            defaultValue=""
          >
            <option value="">Todas las categorías</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="search-query">
            Buscar producto
          </label>
          <input
            id="search-query"
            name="q"
            type="search"
            className="search-input"
            placeholder="Busca por producto, referencia o categoría..."
            autoComplete="off"
          />
          <button className="search-button" type="submit">
            <Search aria-hidden="true" />
            Buscar
          </button>
        </form>
      </div>
    </div>
  )
}
