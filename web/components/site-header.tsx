'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight, ChevronDown, Menu, X } from 'lucide-react'
import type { Category } from '@/lib/catalog'
import { CartLink } from '@/components/cart-link'

export function SiteHeader({ categories }: { categories: Category[] }) {
  const pathname = usePathname()
  const total = categories.reduce((sum, category) => sum + category.count, 0)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileCatalogOpen, setMobileCatalogOpen] = useState(false)

  useEffect(() => {
    setCatalogOpen(false)
    setMobileOpen(false)
    setMobileCatalogOpen(false)
  }, [pathname])

  function closeAll() {
    setCatalogOpen(false)
    setMobileOpen(false)
    setMobileCatalogOpen(false)
  }

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label="BitacoreTech inicio" onClick={closeAll}>
          <img src="/brand/logo.png" alt="BitacoreTech" />
        </Link>

        <nav className="main-nav" aria-label="Navegación principal">
          <Link
            href="/"
            className="nav-link"
            aria-current={pathname === '/' ? 'page' : undefined}
          >
            Inicio
          </Link>

          <div
            className="nav-dropdown"
            onMouseEnter={() => setCatalogOpen(true)}
            onMouseLeave={() => setCatalogOpen(false)}
          >
            <button
              type="button"
              className="nav-link nav-dropdown-toggle"
              aria-expanded={catalogOpen}
              aria-controls="catalog-menu"
              aria-current={pathname === '/catalogo' ? 'page' : undefined}
              onClick={() => setCatalogOpen(true)}
            >
              Catálogo
              <ChevronDown aria-hidden="true" />
            </button>
            {catalogOpen ? (
              <div className="nav-menu" id="catalog-menu" role="menu">
                <Link href="/catalogo" role="menuitem" onClick={closeAll}>
                  <span>Todo el catálogo</span>
                  <small>{total} referencias</small>
                </Link>
                {categories.map((category) => (
                  <Link
                    key={category.slug}
                    href={`/catalogo?categoria=${category.slug}`}
                    role="menuitem"
                    onClick={closeAll}
                  >
                    <span>{category.name}</span>
                    <small>{category.count}</small>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          <Link
            href="/servicios"
            className="nav-link"
            aria-current={pathname === '/servicios' ? 'page' : undefined}
          >
            Servicios
          </Link>
          <Link
            href="/buscar-orden"
            className="nav-link"
            aria-current={pathname === '/buscar-orden' ? 'page' : undefined}
          >
            Buscar orden
          </Link>
        </nav>

        <div className="header-actions">
          <CartLink />
          <button
            type="button"
            className="mobile-toggle"
            aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div id="mobile-navigation" className={`mobile-nav ${mobileOpen ? 'open' : ''}`}>
        <div className="container">
          <Link href="/" onClick={closeAll}>
            Inicio
            <ArrowRight aria-hidden="true" />
          </Link>

          <button
            type="button"
            className="mobile-nav-toggle"
            aria-expanded={mobileCatalogOpen}
            onClick={() => setMobileCatalogOpen((value) => !value)}
          >
            Catálogo
            <ChevronDown
              aria-hidden="true"
              className={mobileCatalogOpen ? 'is-open' : undefined}
            />
          </button>
          {mobileCatalogOpen ? (
            <div className="mobile-subnav">
              <Link href="/catalogo" onClick={closeAll}>
                Todo el catálogo
              </Link>
              {categories.map((category) => (
                <Link
                  key={category.slug}
                  href={`/catalogo?categoria=${category.slug}`}
                  onClick={closeAll}
                >
                  {category.name}
                </Link>
              ))}
            </div>
          ) : null}

          <Link href="/servicios" onClick={closeAll}>
            Servicios
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/buscar-orden" onClick={closeAll}>
            Buscar orden
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/carrito" onClick={closeAll}>
            Carrito
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  )
}
