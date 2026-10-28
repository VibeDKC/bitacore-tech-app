import { cache } from 'react'
import { localCatalog, normalizeCatalog, type Catalog } from '@/lib/catalog'

const CATALOG_URL = process.env.CATALOG_URL?.trim()
export const CATALOG_REVALIDATE_SECONDS = Math.max(
  30,
  Number(process.env.CATALOG_REVALIDATE_SECONDS || 60) || 60
)

async function fetchCatalog(url: string): Promise<Catalog | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: CATALOG_REVALIDATE_SECONDS }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as Catalog
    if (
      !data ||
      !Array.isArray(data.products) ||
      !Array.isArray(data.categories) ||
      !data.stats ||
      typeof data.stats.products !== 'number'
    ) {
      throw new Error('El catálogo remoto no tiene el formato esperado.')
    }
    return data
  } catch (error) {
    console.warn(
      `[catalog] No se pudo leer ${url}. Se usa el snapshot local.`,
      error instanceof Error ? error.message : error
    )
    return null
  }
}

export const getCatalog = cache(async (): Promise<Catalog> => {
  if (!CATALOG_URL) return localCatalog
  const remote = await fetchCatalog(CATALOG_URL)
  return remote ? normalizeCatalog(remote) : localCatalog
})
