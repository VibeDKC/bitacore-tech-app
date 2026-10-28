import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import type {
  CatalogRemoteStatus,
  CatalogSyncState,
  CatalogSyncStatus,
  ProductPromotion
} from '@shared/index'
import type { Database } from './database'
import { DEFAULT_SETTINGS } from './defaults'
import { RpcError } from './permissions'
import { resolveProductImageFile } from './productImages'
import { activePromotionRows, resolvePromotionForProductRow } from './promotions'
import { sha256, sha256Bytes } from './security'
import { slugify, uniqueSlug } from './slug'

const DEMO_ORDERS = [
  {
    number: 'OT-002332',
    code: 'DEMO-01',
    status: 'listo',
    equipmentType: 'PC de escritorio',
    brand: 'HP',
    model: 'ProDesk 400 G6'
  },
  {
    number: 'OT-002341',
    code: 'DEMO-02',
    status: 'reparacion',
    equipmentType: 'Laptop',
    brand: 'Apple',
    model: 'MacBook Pro 13" 2020'
  },
  {
    number: 'OT-002336',
    code: 'DEMO-03',
    status: 'recibido',
    equipmentType: 'Consola',
    brand: 'Sony',
    model: 'PlayStation 5'
  }
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
const BEST_SELLER_DAYS = 30
const BEST_SELLER_MIN_UNITS = 2
const REQUEST_TIMEOUT_MS = 45_000

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif'
}

interface CatalogImage {
  filename: string
  bytes: Buffer
  contentType: string
}

interface CatalogBuildResult {
  catalog: Record<string, any>
  orders: Record<string, any>
  images: CatalogImage[]
}

let publishTimer: NodeJS.Timeout | null = null

function money(cents: number) {
  return Math.round(Number(cents || 0)) / 100
}

function promotionCount(catalog: { products?: any[] }) {
  return new Set(
    (catalog.products ?? [])
      .filter((product) => product?.promotion?.id)
      .map((product) => String(product.promotion.id))
  ).size
}

function defaultTargetPath(runtime: { userDataPath: string }) {
  const repoWeb = path.join(process.cwd(), 'web')
  if (fs.existsSync(path.join(repoWeb, 'package.json'))) return repoWeb
  return path.join(runtime.userDataPath, 'catalog-web')
}

function storedConfig(db: Database) {
  const stored = db.getSetting<Record<string, any>>('catalog_config', {})
  const defaults = DEFAULT_SETTINGS.catalog
  const remote =
    stored?.remote && typeof stored.remote === 'object' && !Array.isArray(stored.remote)
      ? stored.remote
      : {}
  return {
    ...defaults,
    ...(stored && typeof stored === 'object' ? stored : {}),
    remote: { ...defaults.remote, ...remote }
  }
}

function syncState(value: unknown): CatalogSyncState {
  return value === 'success' || value === 'error' || value === 'pending' ? value : 'idle'
}

function normalizeSupabaseUrl(value: string) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) throw new RpcError('Escribe la URL del proyecto Supabase.', 'BAD_REQUEST')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new RpcError('La URL de Supabase no es válida.', 'BAD_REQUEST')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new RpcError('La URL de Supabase debe usar HTTPS.', 'BAD_REQUEST')
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new RpcError('Usa solo la URL base del proyecto, sin rutas adicionales.', 'BAD_REQUEST')
  }
  return trimmed
}

function normalizeBucket(value: string) {
  const bucket = String(value ?? '').trim()
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(bucket)) {
    throw new RpcError(
      'El bucket debe tener entre 2 y 63 caracteres: minúsculas, números, punto, guion o guion bajo.',
      'BAD_REQUEST'
    )
  }
  return bucket
}

export function catalogStatus(db: Database, runtime: { userDataPath: string }): CatalogSyncStatus {
  const stored = storedConfig(db)
  const remote = stored.remote
  return {
    targetPath: String(stored.targetPath || defaultTargetPath(runtime)),
    autoPublish: stored.autoPublish === true,
    stockVisibility: stored.stockVisibility === 'always' ? 'always' : 'outOnly',
    lastPublishedAt: stored.lastPublishedAt ?? null,
    lastStatus: syncState(stored.lastStatus),
    lastMessage: String(stored.lastMessage ?? ''),
    lastProductCount: Number(stored.lastProductCount ?? 0),
    lastImageCount: Number(stored.lastImageCount ?? 0),
    lastPromotionCount: Number(stored.lastPromotionCount ?? 0),
    remote: {
      enabled: Boolean(remote.enabled),
      supabaseUrl: String(remote.supabaseUrl || DEFAULT_SETTINGS.catalog.remote.supabaseUrl),
      bucket: String(remote.bucket || DEFAULT_SETTINGS.catalog.remote.bucket),
      hasSecret: Boolean(remote.secretCipher),
      lastPublishedAt: remote.lastPublishedAt ?? null,
      lastStatus: syncState(remote.lastStatus),
      lastMessage: String(remote.lastMessage ?? ''),
      lastProductCount: Number(remote.lastProductCount ?? 0),
      lastImageCount: Number(remote.lastImageCount ?? 0),
      lastPromotionCount: Number(remote.lastPromotionCount ?? 0),
      lastBytes: Number(remote.lastBytes ?? 0)
    }
  }
}

export function updateCatalogConfig(
  db: Database,
  runtime: { userDataPath: string },
  patch: {
    targetPath?: string
    autoPublish?: boolean
    stockVisibility?: 'always' | 'outOnly'
    remote?: { enabled?: boolean; supabaseUrl?: string; bucket?: string }
  }
) {
  const current = storedConfig(db)
  const nextRemote = { ...current.remote }
  let endpointChanged = false
  if (patch.remote) {
    if (patch.remote.enabled !== undefined) {
      nextRemote.enabled = Boolean(patch.remote.enabled)
    }
    if (patch.remote.supabaseUrl !== undefined) {
      const url = normalizeSupabaseUrl(patch.remote.supabaseUrl)
      if (url !== nextRemote.supabaseUrl) endpointChanged = true
      nextRemote.supabaseUrl = url
    }
    if (patch.remote.bucket !== undefined) {
      const bucket = normalizeBucket(patch.remote.bucket)
      if (bucket !== nextRemote.bucket) endpointChanged = true
      nextRemote.bucket = bucket
    }
  }
  if (endpointChanged) {
    nextRemote.lastStatus = 'idle'
    nextRemote.lastMessage = ''
  }
  const next = {
    ...current,
    ...(patch.targetPath !== undefined
      ? { targetPath: String(patch.targetPath).trim() || defaultTargetPath(runtime) }
      : {}),
    ...(patch.autoPublish !== undefined ? { autoPublish: Boolean(patch.autoPublish) } : {}),
    ...(patch.stockVisibility !== undefined
      ? { stockVisibility: patch.stockVisibility === 'always' ? 'always' : 'outOnly' }
      : {}),
    remote: nextRemote
  }
  db.setSetting('catalog_config', next)
  return catalogStatus(db, runtime)
}

function writeLocalStatus(
  db: Database,
  patch: {
    lastStatus: CatalogSyncState
    lastPublishedAt?: string | null
    lastMessage?: string
    lastProductCount?: number
    lastImageCount?: number
    lastPromotionCount?: number
  }
) {
  const current = storedConfig(db)
  db.setSetting('catalog_config', {
    ...current,
    ...patch,
    lastMessage: patch.lastMessage ?? current.lastMessage ?? '',
    lastPublishedAt: patch.lastPublishedAt ?? current.lastPublishedAt ?? null
  })
}

function writeRemoteStatus(
  db: Database,
  patch: {
    lastStatus: CatalogSyncState
    lastPublishedAt?: string | null
    lastMessage?: string
    lastProductCount?: number
    lastImageCount?: number
    lastPromotionCount?: number
    lastBytes?: number
  }
) {
  const current = storedConfig(db)
  db.setSetting('catalog_config', {
    ...current,
    remote: {
      ...current.remote,
      ...patch,
      lastMessage: patch.lastMessage ?? current.remote.lastMessage ?? '',
      lastPublishedAt:
        patch.lastPublishedAt !== undefined
          ? patch.lastPublishedAt
          : current.remote.lastPublishedAt ?? null
    }
  })
}

function decryptRemoteSecret(db: Database) {
  const config = storedConfig(db)
  const cipher = config.remote.secretCipher
  if (!cipher) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new RpcError(
      'El almacén seguro de Windows no está disponible; no se puede leer la clave de Supabase.',
      'BAD_REQUEST'
    )
  }
  try {
    return safeStorage.decryptString(Buffer.from(String(cipher), 'base64'))
  } catch {
    throw new RpcError(
      'No se pudo descifrar la clave de Supabase. Vuelve a guardarla en este equipo.',
      'BAD_REQUEST'
    )
  }
}

export function saveRemoteSecret(
  db: Database,
  runtime: { userDataPath: string },
  secretInput: string
) {
  const secret = String(secretInput ?? '').trim()
  if (secret.length < 20 || secret.length > 500) {
    throw new RpcError('La clave de Supabase no tiene un formato válido.', 'BAD_REQUEST')
  }
  if (secret.startsWith('sb_publishable_')) {
    throw new RpcError(
      'Esa es la clave pública. Usa la clave secreta del proyecto, que solo se guarda en la app.',
      'BAD_REQUEST'
    )
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new RpcError(
      'El almacén seguro de Windows no está disponible; no se puede guardar la clave de Supabase.',
      'BAD_REQUEST'
    )
  }
  const current = storedConfig(db)
  db.setSetting('catalog_config', {
    ...current,
    remote: {
      ...current.remote,
      secretCipher: safeStorage.encryptString(secret).toString('base64'),
      lastStatus: 'idle',
      lastMessage: ''
    }
  })
  return catalogStatus(db, runtime)
}

export function clearRemoteSecret(db: Database, runtime: { userDataPath: string }) {
  const current = storedConfig(db)
  db.setSetting('catalog_config', {
    ...current,
    remote: {
      ...current.remote,
      secretCipher: null,
      lastStatus: 'idle',
      lastMessage: ''
    }
  })
  return catalogStatus(db, runtime)
}

function authHeaders(secret: string) {
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`
  }
}

async function responseError(response: Response) {
  const text = await response.text().catch(() => '')
  try {
    const data = JSON.parse(text)
    const message = data?.message ?? data?.error ?? data?.statusCode
    if (message) return String(message).slice(0, 400)
  } catch {
    // La respuesta no era JSON.
  }
  return text.trim().slice(0, 400) || `HTTP ${response.status}`
}

function networkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/timeout|aborted/i.test(message)) {
    return 'La conexión con Supabase agotó el tiempo de espera. Revisa internet e inténtalo de nuevo.'
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(message)) {
    return 'No se pudo conectar con Supabase. Revisa internet y la URL del proyecto.'
  }
  return message.slice(0, 400)
}

function buildCatalogData(
  db: Database,
  runtime: { userDataPath: string },
  imageUrlFor: (filename: string, bytes: Buffer) => string
): CatalogBuildResult {
  const promos = activePromotionRows(db, true)
  const rows = db.all<any>(
    `SELECT * FROM products
     WHERE active = 1 AND is_service = 0 AND publish_web = 1
       AND condition IN ('Nuevo', 'Reacondicionado')
       AND category <> 'Insumos de taller'
       AND sku <> '00000000000'
     ORDER BY category ASC, price_cents DESC, name ASC`
  )

  const since = new Date(Date.now() - BEST_SELLER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const bestSellerRows = db.all<{ product_id: string; quantity: number }>(
    `SELECT ii.product_id AS product_id, SUM(ii.quantity) AS quantity
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     WHERE i.type = 'venta'
       AND i.status = 'activa'
       AND ii.product_id IS NOT NULL
       AND ii.product_id <> ''
       AND i.created_at >= ?
     GROUP BY ii.product_id
     HAVING SUM(ii.quantity) >= ?
     ORDER BY SUM(ii.quantity) DESC, ii.product_id ASC`,
    since,
    BEST_SELLER_MIN_UNITS
  )
  const bestSellerIds = new Set(bestSellerRows.map((row) => String(row.product_id)))
  const bestSellers = bestSellerRows.map((row) => ({
    productId: String(row.product_id),
    quantity: Number(row.quantity || 0)
  }))

  const usedSlugs = new Set<string>()
  const images: CatalogImage[] = []
  const products: any[] = []
  const galleryRows = db.all<any>(
    `SELECT * FROM product_images
     ORDER BY product_id ASC, is_cover DESC, sort_order ASC, created_at ASC`
  )
  const galleryByProduct = new Map<string, any[]>()
  for (const image of galleryRows) {
    const key = String(image.product_id)
    const list = galleryByProduct.get(key) ?? []
    list.push(image)
    galleryByProduct.set(key, list)
  }

  for (const row of rows) {
    const regularCents = Number(row.price_cents || 0)
    const promotion = resolvePromotionForProductRow(db, row, promos)
    const productImages: string[] = []
    for (const image of galleryByProduct.get(String(row.id)) ?? []) {
      try {
        const source = resolveProductImageFile(runtime.userDataPath, String(image.image_path))
        if (!fs.existsSync(source)) continue
        const extension = path.extname(source).toLowerCase() || '.jpg'
        const filename = `${row.id}-${image.id}${extension}`
        const bytes = fs.readFileSync(source)
        images.push({
          filename,
          bytes,
          contentType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
        })
        productImages.push(imageUrlFor(filename, bytes))
      } catch {
        // Una imagen ilegible no debe impedir publicar el resto del catálogo.
      }
    }
    let image: string | null = productImages[0] ?? null
    if (!image && row.image_path) {
      try {
        const source = resolveProductImageFile(runtime.userDataPath, String(row.image_path))
        if (fs.existsSync(source)) {
          const extension = path.extname(source).toLowerCase() || '.jpg'
          const filename = `${row.id}-legacy${extension}`
          const bytes = fs.readFileSync(source)
          images.push({
            filename,
            bytes,
            contentType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
          })
          image = imageUrlFor(filename, bytes)
          productImages.push(image)
        }
      } catch {
        image = null
      }
    }
    const slug = uniqueSlug(
      String(row.slug ?? '').trim() || slugify(row.name) || slugify(row.sku),
      usedSlugs
    )
    products.push({
      id: row.id,
      sku: row.sku,
      slug,
      name: row.name,
      description: row.description ?? '',
      category: row.category,
      categorySlug: slugify(row.category),
      regularPrice: promotion ? money(regularCents) : null,
      price: promotion ? Number(promotion.price) : money(regularCents),
      stock: Number(row.stock || 0),
      condition: row.condition || '',
      warrantyDays: Number(row.warranty_days || 0),
      image,
      images: productImages,
      bestSeller: bestSellerIds.has(String(row.id)),
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
  const best = products.filter((product) => product.bestSeller)
  const featured: string[] = []
  const addFeatured = (product: { id: string }) => {
    if (featured.length < 9 && !featured.includes(product.id)) featured.push(product.id)
  }
  promoted.forEach(addFeatured)
  best.forEach(addFeatured)
  for (const category of categories) {
    products
      .filter((product) => product.category === category.name && product.image)
      .slice(0, 3)
      .forEach(addFeatured)
  }
  products.filter((product) => product.image).forEach(addFeatured)

  const heroProduct =
    promoted.find((product) => product.image) ??
    best.find((product) => product.image) ??
    products.find((product) => product.image && featured.includes(product.id)) ??
    products[0]

  const orderRows = db.all<any>(
    `SELECT number, tracking_code, status, equipment_type, brand, model, promised_at, created_at, updated_at
     FROM work_orders
     WHERE tracking_code IS NOT NULL AND tracking_code <> ''
     ORDER BY created_at DESC
     LIMIT 500`
  )
  const byNumber = new Map(orderRows.map((order) => [String(order.number), order]))
  const portalOrders = orderRows.map((order) => ({
    number: order.number,
    codeHash: sha256(String(order.tracking_code)),
    status: order.status,
    equipmentType: order.equipment_type,
    brand: order.brand,
    model: order.model,
    promisedAt: order.promised_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at
  }))
  // Las OT de demostración siguen disponibles para las pruebas de humo.
  for (const demo of DEMO_ORDERS) {
    if (portalOrders.some((order) => order.number === demo.number && order.codeHash === sha256(demo.code))) {
      continue
    }
    const order = byNumber.get(demo.number)
    portalOrders.push({
      number: demo.number,
      codeHash: sha256(demo.code),
      status: order?.status ?? demo.status,
      equipmentType: order?.equipment_type ?? demo.equipmentType,
      brand: order?.brand ?? demo.brand,
      model: order?.model ?? demo.model,
      promisedAt: order?.promised_at ?? new Date().toISOString(),
      createdAt: order?.created_at ?? new Date().toISOString(),
      updatedAt: order?.updated_at ?? new Date().toISOString()
    })
  }

  return {
    catalog: {
      generatedAt: new Date().toISOString(),
      source: 'OCTESTR',
      stockVisibility: storedConfig(db).stockVisibility === 'always' ? 'always' : 'outOnly',
      business: BUSINESS,
      stats: {
        products: products.length,
        withImage: products.filter((product) => product.image).length,
        images: images.length,
        categories: categories.length
      },
      bestSellers,
      heroProductId: heroProduct?.id ?? null,
      featured,
      categories,
      products
    },
    orders: {
      generatedAt: new Date().toISOString(),
      demo: false,
      note: 'Estados de OT sin nombre, teléfono, serial, credenciales ni notas internas. El código se valida por hash.',
      orders: portalOrders
    },
    images
  }
}

function publishCatalogLocal(db: Database, runtime: { userDataPath: string }) {
  const config = catalogStatus(db, runtime)
  writeLocalStatus(db, { lastStatus: 'pending', lastMessage: 'Publicando catálogo local…' })
  try {
    const built = buildCatalogData(
      db,
      runtime,
      (filename) => `/products/${filename}`
    )
    const productsRoot = path.join(config.targetPath, 'public', 'products')
    fs.mkdirSync(productsRoot, { recursive: true })
    for (const image of built.images) {
      fs.writeFileSync(path.join(productsRoot, image.filename), image.bytes)
    }
    const imageFiles = new Set(built.images.map((image) => image.filename))
    for (const entry of fs.readdirSync(productsRoot)) {
      if (!imageFiles.has(entry)) {
        try {
          fs.rmSync(path.join(productsRoot, entry), { force: true })
        } catch {
          // La limpieza no debe impedir la publicación.
        }
      }
    }
    const dataDir = path.join(config.targetPath, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(
      path.join(dataDir, 'catalog.json'),
      `${JSON.stringify(built.catalog, null, 2)}\n`,
      'utf8'
    )
    fs.writeFileSync(
      path.join(dataDir, 'orders-demo.json'),
      `${JSON.stringify(built.orders, null, 2)}\n`,
      'utf8'
    )
    writeLocalStatus(db, {
      lastStatus: 'success',
      lastPublishedAt: built.catalog.generatedAt,
      lastMessage: `Catálogo local publicado: ${built.catalog.stats.products} productos y ${built.images.length} imágenes.`,
      lastProductCount: built.catalog.stats.products,
      lastImageCount: built.images.length,
      lastPromotionCount: promotionCount(built.catalog)
    })
    return { ok: true as const, error: undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeLocalStatus(db, { lastStatus: 'error', lastMessage: message.slice(0, 500) })
    return { ok: false as const, error: message }
  }
}

async function uploadObject(
  config: { supabaseUrl: string; bucket: string },
  secret: string,
  objectPath: string,
  body: Buffer,
  contentType: string,
  cacheControl: string
) {
  const encodedPath = objectPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodedPath}`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(secret),
        'Content-Type': contentType,
        'cache-control': cacheControl,
        'x-upsert': 'true'
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }
  )
  if (!response.ok) {
    throw new Error(`Supabase rechazó ${objectPath}: ${await responseError(response)}`)
  }
}

async function listObjects(
  config: { supabaseUrl: string; bucket: string },
  secret: string,
  prefix: string
) {
  const names: string[] = []
  const limit = 100
  let offset = 0
  for (;;) {
    const response = await fetch(
      `${config.supabaseUrl}/storage/v1/object/list/${encodeURIComponent(config.bucket)}`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(secret),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefix, limit, offset }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      }
    )
    if (!response.ok) {
      throw new Error(`No se pudo listar el bucket: ${await responseError(response)}`)
    }
    const data = await response.json().catch(() => [])
    if (!Array.isArray(data) || !data.length) break
    for (const item of data) {
      if (!item || typeof item.name !== 'string') continue
      if (item.name === '.emptyFolderPlaceholder') continue
      if (item.id === null && item.metadata === null) continue
      names.push(item.name.startsWith(`${prefix}/`) ? item.name : `${prefix}/${item.name}`)
    }
    if (data.length < limit) break
    offset += limit
  }
  return names
}

async function deleteObjects(
  config: { supabaseUrl: string; bucket: string },
  secret: string,
  prefixes: string[]
) {
  if (!prefixes.length) return
  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}`,
    {
      method: 'DELETE',
      headers: {
        ...authHeaders(secret),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prefixes }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }
  )
  if (!response.ok) {
    throw new Error(`No se pudieron limpiar imágenes antiguas: ${await responseError(response)}`)
  }
}

export async function testSupabaseConnection(
  db: Database,
  runtime: { userDataPath: string }
): Promise<{ ok: boolean; message: string; publicBucket?: boolean }> {
  const config = catalogStatus(db, runtime).remote
  let secret: string | null
  try {
    secret = decryptRemoteSecret(db)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (!secret) {
    return { ok: false, message: 'Falta guardar la clave secreta de Supabase.' }
  }
  try {
    const response = await fetch(
      `${config.supabaseUrl}/storage/v1/bucket/${encodeURIComponent(config.bucket)}`,
      {
        headers: authHeaders(secret),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      }
    )
    if (!response.ok) {
      return {
        ok: false,
        message: `Supabase respondió: ${await responseError(response)}`
      }
    }
    const data = (await response.json().catch(() => null)) as { public?: boolean } | null
    const isPublic = data && typeof data.public === 'boolean' ? data.public : undefined
    return {
      ok: true,
      publicBucket: isPublic,
      message:
        isPublic === false
          ? `Conexión correcta con el bucket ${config.bucket}, pero el bucket no es público. La web no podrá leer el catálogo ni las imágenes.`
          : `Conexión correcta con el bucket ${config.bucket}.`
    }
  } catch (error) {
    return { ok: false, message: networkError(error) }
  }
}

export async function publishCatalogRemote(
  db: Database,
  runtime: { userDataPath: string }
): Promise<{ ok: boolean; status: CatalogSyncStatus; error?: string }> {
  const config = catalogStatus(db, runtime).remote
  let secret: string | null
  try {
    secret = decryptRemoteSecret(db)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeRemoteStatus(db, { lastStatus: 'error', lastMessage: message })
    return { ok: false, status: catalogStatus(db, runtime), error: message }
  }
  if (!secret) {
    const message = 'Falta guardar la clave secreta de Supabase.'
    writeRemoteStatus(db, { lastStatus: 'error', lastMessage: message })
    return { ok: false, status: catalogStatus(db, runtime), error: message }
  }

  writeRemoteStatus(db, { lastStatus: 'pending', lastMessage: 'Publicando en Supabase…' })
  try {
    const publicBase = `${config.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(
      config.bucket
    )}`
    const built = buildCatalogData(
      db,
      runtime,
      (filename, bytes) => `${publicBase}/products/${encodeURIComponent(filename)}?v=${sha256Bytes(bytes).slice(0, 12)}`
    )

    for (const image of built.images) {
      await uploadObject(
        config,
        secret,
        `products/${image.filename}`,
        image.bytes,
        image.contentType,
        'max-age=31536000'
      )
    }

    const catalogJson = Buffer.from(`${JSON.stringify(built.catalog, null, 2)}\n`, 'utf8')
    const ordersJson = Buffer.from(`${JSON.stringify(built.orders, null, 2)}\n`, 'utf8')
    await uploadObject(
      config,
      secret,
      'catalog.json',
      catalogJson,
      'application/json; charset=utf-8',
      'max-age=0'
    )
    await uploadObject(
      config,
      secret,
      'orders-demo.json',
      ordersJson,
      'application/json; charset=utf-8',
      'max-age=0'
    )

    const keep = new Set(built.images.map((image) => `products/${image.filename}`))
    const existing = await listObjects(config, secret, 'products')
    const orphans = existing.filter((name) => !keep.has(name))
    await deleteObjects(config, secret, orphans)

    const bytes =
      built.images.reduce((sum, image) => sum + image.bytes.length, 0) +
      catalogJson.length +
      ordersJson.length
    writeRemoteStatus(db, {
      lastStatus: 'success',
      lastPublishedAt: built.catalog.generatedAt,
      lastMessage: `Supabase actualizado: ${built.catalog.stats.products} productos, ${built.images.length} imágenes y ${promotionCount(built.catalog)} promociones.`,
      lastProductCount: built.catalog.stats.products,
      lastImageCount: built.images.length,
      lastPromotionCount: promotionCount(built.catalog),
      lastBytes: bytes
    })
    return { ok: true, status: catalogStatus(db, runtime) }
  } catch (error) {
    const message = networkError(error)
    writeRemoteStatus(db, { lastStatus: 'error', lastMessage: message.slice(0, 500) })
    return { ok: false, status: catalogStatus(db, runtime), error: message }
  }
}

export async function publishCatalog(
  db: Database,
  runtime: { userDataPath: string }
): Promise<{
  ok: boolean
  status: CatalogSyncStatus
  error?: string
  local?: { ok: boolean; error?: string }
  remote?: { ok: boolean; error?: string } | null
}> {
  const local = publishCatalogLocal(db, runtime)
  const config = catalogStatus(db, runtime)
  if (!config.remote.enabled) {
    return {
      ok: local.ok,
      status: catalogStatus(db, runtime),
      error: local.error,
      local: { ok: local.ok, error: local.error },
      remote: null
    }
  }
  const remote = await publishCatalogRemote(db, runtime)
  const error = [local.error, remote.error].filter(Boolean).join(' · ') || undefined
  return {
    ok: local.ok && remote.ok,
    status: catalogStatus(db, runtime),
    error,
    local: { ok: local.ok, error: local.error },
    remote: { ok: remote.ok, error: remote.error }
  }
}

export function scheduleCatalogPublish(db: Database, runtime: { userDataPath: string }) {
  const config = catalogStatus(db, runtime)
  if (!config.autoPublish) return
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = setTimeout(() => {
    publishTimer = null
    void publishCatalog(db, runtime)
  }, 1200)
  publishTimer.unref?.()
}

export function promotionCountForProduct(product: any): ProductPromotion | null {
  return (product.promotion as ProductPromotion | null | undefined) ?? null
}
