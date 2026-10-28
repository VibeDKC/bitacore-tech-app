/**
 * Genera el snapshot del catálogo web a partir de la base local de OCTESTR.
 * No modifica la base: solo lee productos, promociones, copia imágenes y escribe JSON.
 *
 * Uso:
 *   node scripts/export-catalog.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const webRoot = path.resolve(__dirname, '..')
const dataRoot = process.env.BITACORETECH_DATA_PATH || path.join(process.env.APPDATA || '', 'BitacoreTech')
const databasePath = process.env.BITACORETECH_DB || path.join(dataRoot, 'bitacoretech.db')
const outputData = path.join(webRoot, 'data', 'catalog.json')
const outputOrders = path.join(webRoot, 'data', 'orders-demo.json')
const outputImages = path.join(webRoot, 'public', 'products')

const demoOrders = [
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
const business = {
  name: 'BitacoreTech',
  descriptor: 'Taller & POS',
  phone: '+57 324 638 1768',
  whatsapp: '573246381768',
  city: 'Medellín',
  hours: '8:00 a. m. – 8:00 p. m.',
  currency: 'COP'
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function uniqueSlug(base, used) {
  let slug = base || 'producto'
  let index = 2
  while (used.has(slug)) {
    slug = `${base}-${index}`
    index += 1
  }
  used.add(slug)
  return slug
}

function todayInBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function formatBadge(type, percent, cents) {
  if (type === 'percent') return `-${Math.round(percent)}%`
  return `-${new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(cents / 100)}`
}

if (!fs.existsSync(databasePath)) {
  console.error(`No se encontró la base de OCTESTR: ${databasePath}`)
  process.exit(1)
}

fs.mkdirSync(path.dirname(outputData), { recursive: true })
fs.mkdirSync(outputImages, { recursive: true })

const db = new DatabaseSync(databasePath, { readOnly: true })
let stockVisibility = 'outOnly'
try {
  const catalogConfigRow = db
    .prepare("SELECT value FROM app_settings WHERE key = 'catalog_config'")
    .get()
  const catalogConfig = catalogConfigRow ? JSON.parse(catalogConfigRow.value) : null
  stockVisibility = catalogConfig?.stockVisibility === 'always' ? 'always' : 'outOnly'
} catch {
  stockVisibility = 'outOnly'
}
const today = todayInBogota()
const rows = db
  .prepare(
    `SELECT id, name, sku, category, stock, price_cents, cost_cents, warranty_days, condition,
            image_path, created_at, updated_at
     FROM products
     WHERE active = 1
       AND is_service = 0
       AND publish_web = 1
       AND condition IN ('Nuevo', 'Reacondicionado')
       AND category <> 'Insumos de taller'
       AND sku <> '00000000000'
     ORDER BY category ASC, price_cents DESC, name ASC`
  )
  .all()

const promotionRows = db
  .prepare(
    `SELECT * FROM promotions
     WHERE active = 1 AND publish_web = 1
       AND (starts_on IS NULL OR starts_on <= ?)
       AND (ends_on IS NULL OR ends_on >= ?)
     ORDER BY priority DESC, updated_at DESC`
  )
  .all(today, today)
const targetRows = db.prepare('SELECT * FROM promotion_targets').all()
const targetsByPromotion = new Map()
for (const target of targetRows) {
  const list = targetsByPromotion.get(target.promotion_id) || []
  list.push(target)
  targetsByPromotion.set(target.promotion_id, list)
}
const promotions = promotionRows.map((promotion) => ({
  row: promotion,
  targets: targetsByPromotion.get(promotion.id) || []
}))

function specificity(promotion, product) {
  if (promotion.row.scope === 'all') return 1
  if (!promotion.targets.length) return 0
  let best = 0
  for (const target of promotion.targets) {
    if (target.target_type === 'sku' && String(target.product_id) === String(product.id)) {
      best = Math.max(best, 3)
    }
    if (target.target_type === 'category' && String(target.category) === String(product.category)) {
      best = Math.max(best, 2)
    }
  }
  return best
}

function promotionFor(product) {
  let best = null
  for (const promotion of promotions) {
    const score = specificity(promotion, product)
    if (!score) continue
    if (
      !best ||
      Number(promotion.row.priority || 0) > Number(best.promotion.row.priority || 0) ||
      (Number(promotion.row.priority || 0) === Number(best.promotion.row.priority || 0) &&
        score > best.score) ||
      (Number(promotion.row.priority || 0) === Number(best.promotion.row.priority || 0) &&
        score === best.score &&
        String(promotion.row.updated_at || '') > String(best.promotion.row.updated_at || ''))
    ) {
      best = { promotion, score }
    }
  }
  if (!best) return null
  const row = best.promotion.row
  const regularCents = Number(product.price_cents || 0)
  const discountCents =
    row.discount_type === 'percent'
      ? Math.min(regularCents, Math.round((regularCents * Number(row.discount_percent || 0)) / 100))
      : Math.min(regularCents, Number(row.discount_cents || 0))
  const priceCents = Math.max(0, regularCents - discountCents)
  return {
    id: row.id,
    name: row.name,
    badge: formatBadge(
      row.discount_type === 'percent' ? 'percent' : 'amount',
      Number(row.discount_percent || 0),
      discountCents
    ),
    type: row.discount_type === 'amount' ? 'amount' : 'percent',
    value: row.discount_type === 'percent' ? Number(row.discount_percent || 0) : discountCents / 100,
    startsOn: row.starts_on ?? null,
    endsOn: row.ends_on ?? null,
    priceCents,
    discountCents
  }
}

const usedSlugs = new Set()
const imageFiles = new Set()
const products = rows.map((row) => {
  let image = null
  if (row.image_path) {
    const source = path.join(dataRoot, row.image_path)
    if (fs.existsSync(source)) {
      const extension = path.extname(source).toLowerCase() || '.jpg'
      const filename = `${row.id}${extension}`
      fs.copyFileSync(source, path.join(outputImages, filename))
      image = `/products/${filename}`
      imageFiles.add(filename)
    }
  }
  const regularPrice = Math.round(Number(row.price_cents) / 100)
  const promotion = promotionFor(row)
  const slug = uniqueSlug(slugify(row.name) || slugify(row.sku), usedSlugs)
  return {
    id: row.id,
    sku: row.sku,
    slug,
    name: row.name,
    category: row.category,
    categorySlug: slugify(row.category),
    regularPrice: promotion ? regularPrice : null,
    price: promotion ? Math.round(promotion.priceCents / 100) : regularPrice,
    stock: Number(row.stock),
    condition: row.condition || '',
    warrantyDays: Number(row.warranty_days || 0),
    image,
    promotion: promotion
      ? {
          id: promotion.id,
          name: promotion.name,
          badge: promotion.badge,
          type: promotion.type,
          value: promotion.value,
          startsOn: promotion.startsOn,
          endsOn: promotion.endsOn
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
})

for (const entry of fs.readdirSync(outputImages)) {
  if (!imageFiles.has(entry)) fs.rmSync(path.join(outputImages, entry), { force: true })
}

const categoryOrder = ['Accesorios', 'Almacenamiento', 'Periféricos']
const categories = [...new Set(products.map((product) => product.category))]
  .sort((a, b) => {
    const ai = categoryOrder.indexOf(a)
    const bi = categoryOrder.indexOf(b)
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

const featured = []
const addFeatured = (product) => {
  if (featured.length < 9 && !featured.includes(product.id)) featured.push(product.id)
}
products.filter((product) => product.promotion).forEach(addFeatured)
for (const category of categories) {
  products
    .filter((product) => product.category === category.name && product.image)
    .slice(0, 3)
    .forEach(addFeatured)
}
products.filter((product) => product.image).forEach(addFeatured)

const heroProduct =
  products.find((product) => product.promotion && product.image) ||
  products.find((product) => product.image && featured.includes(product.id)) ||
  products[0]

const workOrderColumns = db.prepare('PRAGMA table_info(work_orders)').all()
const hasTrackingCode = workOrderColumns.some((column) => column.name === 'tracking_code')
const orderRows = hasTrackingCode
  ? db
      .prepare(
        `SELECT number, tracking_code, status, equipment_type, brand, model, promised_at, created_at, updated_at
         FROM work_orders
         WHERE tracking_code IS NOT NULL AND tracking_code <> ''
         ORDER BY created_at DESC
         LIMIT 500`
      )
      .all()
  : []
const ordersByNumber = new Map(orderRows.map((order) => [order.number, order]))
const portalOrders = orderRows.map((order) => ({
  number: order.number,
  codeHash: sha256(order.tracking_code),
  status: order.status,
  equipmentType: order.equipment_type,
  brand: order.brand,
  model: order.model,
  promisedAt: order.promised_at,
  createdAt: order.created_at,
  updatedAt: order.updated_at
}))
for (const demo of demoOrders) {
  if (portalOrders.some((order) => order.number === demo.number && order.codeHash === sha256(demo.code))) {
    continue
  }
  const order = ordersByNumber.get(demo.number)
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

const ordersDemo = {
  generatedAt: new Date().toISOString(),
  demo: false,
  note: 'Estados de OT sin nombre, teléfono, serial, credenciales ni notas internas. El código se valida por hash.',
  orders: portalOrders
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'OCTESTR',
  stockVisibility,
  business,
  stats: {
    products: products.length,
    withImage: products.filter((product) => product.image).length,
    categories: categories.length
  },
  heroProductId: heroProduct?.id ?? null,
  featured,
  categories,
  products
}

db.close()

fs.writeFileSync(outputData, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
fs.writeFileSync(outputOrders, `${JSON.stringify(ordersDemo, null, 2)}\n`, 'utf8')

console.log(`Catálogo generado: ${products.length} productos, ${payload.stats.withImage} con imagen.`)
console.log(`Promociones publicadas: ${products.filter((product) => product.promotion).length}`)
console.log(`Órdenes demo: ${ordersDemo.orders.length}`)
console.log(`JSON: ${outputData}`)
console.log(`Órdenes: ${outputOrders}`)
console.log(`Imágenes: ${outputImages}`)
