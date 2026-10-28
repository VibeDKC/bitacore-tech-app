'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, SearchX } from 'lucide-react'
import type { Category, Product } from '@/lib/catalog'
import { ProductCard } from '@/components/product-card'

type SortMode = 'featured' | 'price-asc' | 'price-desc' | 'name-asc'

function sortProducts(products: Product[], mode: SortMode) {
  const copy = [...products]
  if (mode === 'price-asc') return copy.sort((a, b) => a.price - b.price)
  if (mode === 'price-desc') return copy.sort((a, b) => b.price - a.price)
  if (mode === 'name-asc') return copy.sort((a, b) => a.name.localeCompare(b.name))
  return copy.sort(
    (a, b) =>
      Number(Boolean(b.promotion)) - Number(Boolean(a.promotion)) ||
      Number(Boolean(b.image)) - Number(Boolean(a.image)) ||
      a.category.localeCompare(b.category) ||
      b.price - a.price
  )
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function CatalogExplorer({
  products,
  categories,
  initialQuery = '',
  initialCategory = ''
}: {
  products: Product[]
  categories: Category[]
  initialQuery?: string
  initialCategory?: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [category, setCategory] = useState(initialCategory || 'todos')
  const [sort, setSort] = useState<SortMode>('featured')

  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  useEffect(() => {
    setCategory(initialCategory || 'todos')
  }, [initialCategory])

  const filtered = useMemo(() => {
    const normalizedQuery = normalize(query.trim())
    const list = products.filter((product) => {
      const matchesCategory =
        category === 'todos' || product.categorySlug === category
      const matchesQuery =
        !normalizedQuery ||
        [product.name, product.sku, product.category].some((value) =>
          normalize(value).includes(normalizedQuery)
        )
      return matchesCategory && matchesQuery
    })
    return sortProducts(list, sort)
  }, [category, products, query, sort])

  return (
    <>
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Buscar en el catálogo</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por producto, referencia o categoría..."
            autoComplete="off"
          />
        </label>
        <label>
          <span className="sr-only">Filtrar por tipo de producto</span>
          <select
            className="catalog-sort"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="todos">Todas las categorías ({products.length})</option>
            {categories.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name} ({item.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Ordenar catálogo</span>
          <select
            className="catalog-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortMode)}
          >
            <option value="featured">Destacados y promociones</option>
            <option value="price-asc">Precio: menor a mayor</option>
            <option value="price-desc">Precio: mayor a menor</option>
            <option value="name-asc">Nombre: A – Z</option>
          </select>
        </label>
      </div>

      <div className="catalog-meta">
        <p className="catalog-count">
          Mostrando <strong>{filtered.length}</strong> de {products.length} referencias
        </p>
        <p className="catalog-note">
          Precios en COP · Disponibilidad sujeta a confirmación
        </p>
      </div>

      {filtered.length ? (
        <div className="product-grid">
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-state-icon">
            <SearchX aria-hidden="true" />
          </span>
          <h2>No encontramos esa referencia</h2>
          <p>Prueba con otro nombre, una categoría distinta o revisa la ortografía.</p>
        </div>
      )}
    </>
  )
}
