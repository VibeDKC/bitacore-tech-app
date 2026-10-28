import fs from 'node:fs'
import path from 'node:path'
import type { CatalogSyncStatus, ProductPromotion } from '@shared/index'
import type { Database } from './database'
import { DEFAULT_SETTINGS } from './defaults'
import { resolveProductImageFile } from './productImages'
import { activePromotionRows, resolvePromotionForProductRow } from './promotions'

const DEMO_ORDERS = [
  { number: 'OT-002332', code: 'DEMO-01' },
  { number: 'OT-002341', code: 'DEMO-02' },
  { number: 'OT-002336', code: 'DEMO-03' }
]

const BUSINESS = {
  name: 'BitacoreTech',
  descriptor: 'Taller & POS',
  phone: '+57 324 638 1768',
  whatsapp: '573246381768',
  city: 'Medellín',
  hours: '8:00 a. m. – 8:00 p. m.',
  currency: 'COP'
}

const CATEGORY_ORDER = ['Accesorios', 'Almacenamiento', 'Periféricos']

let publishTimer: NodeJS.Timeout | null = null

function money(cents: number) {
  return Math.round(Number(cents || 0)) / 100
}

function slugify(value: string) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function uniqueSlug(base: string, used: Set<string>) {
  let slug = base || 'producto'
  let index = 2
  while (used.has(slug)) {
    slug = `${base}-${index}`
    index += 1
  }
  used.add(slug)
  return slug
}

function defaultTargetPath(runtime: { userDataPath: string }) {
  const repoWeb = path.join(process.cwd(), 'web')
  if (fs.existsSync(path.join(repoWeb, 'package.json'))) return repoWeb
  return path.join(runtime.userDataPath, 'catalog-web')
}

function storedConfig(db: Database) {
  return db.getSetting<any>('catalog_config', DEFAULT_SETTINGS.catalog)
}

export function catalogStatus(db: Database, runtime: { userDataPath: string }): CatalogSyncStatus {
  const stored = storedConfig(db)
  return {
    targetPath: String(stored.targetPath || defaultTargetPath(runtime)),
    autoPublish: stored.autoPublish !== false,
    lastPublishedAt: stored.lastPublishedAt ?? null,
    lastStatus: stored.lastStatus ?? 'idle',
    lastMessage: String(stored.lastMessage ?? ''),
    lastProductCount: Number(stored.lastProductCount ?? 0),
    lastImageCount: Number(stored.lastImageCount ?? 0),
    lastPromotionCount: Number(stored.lastPromotionCount ?? 0)
  }
}

export function updateCatalogConfig(
  db: Database,
  runtime: { userDataPath: string },
  patch: { targetPath?: string; autoPublish?: boolean }
) {
  const current = storedConfig(db)
  const next = {
    ...current,
    ...(patch.targetPath !== undefined
      ? { targetPath: String(patch.targetPath).trim() || defaultTargetPath(runtime) }
      : {}),
    ...(patch.autoPublish !== undefined ? { autoPublish: Boolean(patch.autoPublish) } : {})
  }
  db.setSetting('catalog_config', next)
  return catalogStatus(db, runtime)
}

function writeStatus(
  db: Database,
  patch: Partial<CatalogSyncStatus> & { lastStatus: CatalogSyncStatus['lastStatus'] }
) {
  const current = storedConfig(db)
  db.setSetting('catalog_config', {
    ...current,
    ...patch,
    lastMessage: patch.lastMessage ?? current.lastMessage ?? '',
    lastPublishedAt: patch.lastPublishedAt ?? current.lastPublishedAt ?? null
  })
}

export function buildCatalogSnapshot(
  db: Database,
  runtime: { userDataPath: string },
  targetPath: string
) {
  const productsRoot = path.join(targetPath, 'public', 'products')
  fs.mkdirSync(productsRoot, { recursive: true })

  const promos = activePromotionRows(db, true)
  const rows = db.all<any>(
    `SELECT * FROM products
     WHERE active = 1 AND is_service = 0 AND publish_web = 1
       AND category <> 'Insumos de taller'
       AND sku <> '00000000000'
     ORDER BY category ASC, price_cents DESC, name ASC`
  )
  const usedSlugs = new Set<string>()
  const imageFiles = new Set<string>()
  const products: any[] = []

  for (const row of rows) {
    const regularCents = Number(row.price_cents || 0)
    const promotion = resolvePromotionForProductRow(db, row, promos)
    let image: string | null = null
    if (row.image_path) {
      try {
        const source = resolveProductImageFile(runtime.userDataPath, String(row.image_path))
        if (fs.existsSync(source)) {
          const extension = path.extname(source).toLowerCase() || '.jpg'
          const filename = `${row.id}${extension}`
          fs.copyFileSync(source, path.join(productsRoot, filename))
          image = `/products/${filename}`
          imageFiles.add(filename)
        }
      } catch {
        image = null
      }
    }
    const slug = uniqueSlug(slugify(row.name) || slugify(row.sku), usedSlugs)
    products.push({
      id: row.id,
      sku: row.sku,
      slug,
      name: row.name,
      category: row.category,
      categorySlug: slugify(row.category),
      regularPrice: promotion ? money(regularCents) : null,
      price: promotion ? Number(promotion.price) : money(regularCents),
      stock: Number(row.stock || 0),
      condition: row.condition || '',
      warrantyDays: Number(row.warranty_days || 0),
      image,
      promotion: promotion
        ? {
            id: promotion.id,
            name: promotion.name,
            badge: promotion.badge,
            type: promotion.discountType,
            value:
              promotion.discountType === 'percent'
                ? promotion.discountPercent
                : promotion.discountAmount,
            startsOn: promotion.startsOn,
            endsOn: promotion.endsOn
          }
        : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  }

  for (const entry of fs.readdirSync(productsRoot)) {
    if (!imageFiles.has(entry)) {
      try {
        fs.rmSync(path.join(productsRoot, entry), { force: true })
      } catch {
        // La limpieza no debe impedir la publicación.
      }
    }
  }

  const categories = [...new Set(products.map((product) => product.category))]
    .sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a)
      const bi = CATEGORY_ORDER.indexOf(b)
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b)
    })
    .map((name) => {
      const items = products.filter((product) => product.category === name)
      return {
        name,
        slug: slugify(name),
        count: items.length,
        image: items.find((product) => product.image)?.image ?? null
      }
    })

  const promoted = products.filter((product) => product.promotion)
  const featured: string[] = []
  const addFeatured = (product: { id: string }) => {
    if (featured.length < 9 && !featured.includes(product.id)) featured.push(product.id)
  }
  promoted.forEach(addFeatured)
  for (const category of categories) {
    products
      .filter((product) => product.category === category.name && product.image)
      .slice(0, 3)
      .forEach(addFeatured)
  }
  products.filter((product) => product.image).forEach(addFeatured)

  const heroProduct =
    promoted.find((product) => product.image) ??
    products.find((product) => product.image && featured.includes(product.id)) ??
    products[0]

  const orderRows = db.all<any>(
    `SELECT number, status, equipment_type, brand, model, promised_at, created_at, updated_at
     FROM work_orders WHERE number IN (${DEMO_ORDERS.map(() => '?').join(', ')})
     ORDER BY created_at DESC`,
    ...DEMO_ORDERS.map((order) => order.number)
  )
  const byNumber = new Map(orderRows.map((order) => [String(order.number), order]))

  return {
    generatedAt: new Date().toISOString(),
    source: 'OCTESTR',
    business: BUSINESS,
    stats: {
      products: products.length,
      withImage: products.filter((product) => product.image).length,
      categories: categories.length
    },
    heroProductId: heroProduct?.id ?? null,
    featured,
    categories,
    products,
    orders: {
      generatedAt: new Date().toISOString(),
      demo: true,
      note: 'Datos de demostración sin nombre, teléfono ni datos privados del cliente.',
      orders: DEMO_ORDERS.map((demo) => {
        const order = byNumber.get(demo.number)
        if (!order) return null
        return {
          number: order.number,
          code: demo.code,
          status: order.status,
          equipmentType: order.equipment_type,
          brand: order.brand,
          model: order.model,
          promisedAt: order.promised_at,
          createdAt: order.created_at,
          updatedAt: order.updated_at
        }
      }).filter(Boolean)
    }
  }
}

export function publishCatalog(
  db: Database,
  runtime: { userDataPath: string }
): { ok: boolean; status: CatalogSyncStatus; error?: string } {
  const config = catalogStatus(db, runtime)
  writeStatus(db, { lastStatus: 'pending', lastMessage: 'Publicando catálogo…' })
  try {
    const snapshot = buildCatalogSnapshot(db, runtime, config.targetPath)
    const dataDir = path.join(config.targetPath, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(
      path.join(dataDir, 'catalog.json'),
      `${JSON.stringify({ ...snapshot, orders: undefined }, null, 2)}\n`,
      'utf8'
    )
    fs.writeFileSync(
      path.join(dataDir, 'orders-demo.json'),
      `${JSON.stringify(snapshot.orders, null, 2)}\n`,
      'utf8'
    )
    const status = catalogStatus(db, runtime)
    writeStatus(db, {
      lastStatus: 'success',
      lastPublishedAt: snapshot.generatedAt,
      lastMessage: `Catálogo publicado: ${snapshot.stats.products} productos y ${snapshot.stats.withImage} imágenes.`,
      lastProductCount: snapshot.stats.products,
      lastImageCount: snapshot.stats.withImage,
      lastPromotionCount: snapshot.products.filter((product: any) => product.promotion).length
    })
    return { ok: true, status: catalogStatus(db, runtime) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeStatus(db, {
      lastStatus: 'error',
      lastMessage: message.slice(0, 500)
    })
    return { ok: false, status: catalogStatus(db, runtime), error: message }
  }
}

export function scheduleCatalogPublish(
  db: Database,
  runtime: { userDataPath: string }
) {
  const config = catalogStatus(db, runtime)
  if (!config.autoPublish) return
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = setTimeout(() => {
    publishTimer = null
    publishCatalog(db, runtime)
  }, 1200)
  publishTimer.unref?.()
}

export function promotionCountForProduct(product: any): ProductPromotion | null {
  return (product.promotion as ProductPromotion | null | undefined) ?? null
}
