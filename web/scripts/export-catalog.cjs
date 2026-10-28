/**
 * Genera el snapshot del catálogo web a partir de la base local de OCTESTR.
 * No modifica la base: solo lee productos, copia imágenes y escribe JSON.
 *
 * Uso:
 *   node scripts/export-catalog.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const webRoot = path.resolve(__dirname, '..')
const projectRoot = path.resolve(webRoot, '..')
const dataRoot = process.env.BITACORETECH_DATA_PATH || path.join(process.env.APPDATA || '', 'BitacoreTech')
const databasePath = process.env.BITACORETECH_DB || path.join(dataRoot, 'bitacoretech.db')
const outputData = path.join(webRoot, 'data', 'catalog.json')
const outputOrders = path.join(webRoot, 'data', 'orders-demo.json')
const outputImages = path.join(webRoot, 'public', 'products')

const demoPromotions = [
  {
    sku: 'KZ-CASB-35-MIC',
    name: 'Promo demo de audio',
    type: 'percent',
    value: 15
  },
  {
    sku: 'PB-ADAT-C100-10K',
    name: 'Promo demo de power bank',
    type: 'fixed',
    value: 10000
  },
  {
    sku: 'SSD-GEN-GREEN-512G',
    name: 'Promo demo de almacenamiento',
    type: 'percent',
    value: 10
  }
]

const demoOrders = [
  { number: 'OT-002332', code: 'DEMO-01' },
  { number: 'OT-002341', code: 'DEMO-02' },
  { number: 'OT-002336', code: 'DEMO-03' }
]

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

if (!fs.existsSync(databasePath)) {
  console.error(`No se encontró la base de OCTESTR: ${databasePath}`)
  process.exit(1)
}

fs.mkdirSync(path.dirname(outputData), { recursive: true })
fs.mkdirSync(outputImages, { recursive: true })

const db = new DatabaseSync(databasePath, { readOnly: true })
const rows = db
  .prepare(
    `SELECT id, name, sku, category, stock, price_cents, warranty_days, condition,
            image_path, created_at, updated_at
     FROM products
     WHERE active = 1
       AND is_service = 0
       AND category <> 'Insumos de taller'
       AND sku <> '00000000000'
     ORDER BY category ASC, price_cents DESC, name ASC`
  )
  .all()

const orderRows = db
  .prepare(
    `SELECT number, status, equipment_type, brand, model, promised_at, created_at, updated_at
     FROM work_orders
     WHERE number IN (${demoOrders.map(() => '?').join(', ')})
     ORDER BY created_at DESC`
  )
  .all(...demoOrders.map((order) => order.number))

db.close()

const usedSlugs = new Set()
const products = rows.map((row) => {
  let image = null
  if (row.image_path) {
    const source = path.join(dataRoot, row.image_path)
    if (fs.existsSync(source)) {
      const filename = `${row.id}.jpg`
      const target = path.join(outputImages, filename)
      fs.copyFileSync(source, target)
      image = `/products/${filename}`
    }
  }
  const slug = uniqueSlug(slugify(row.name) || slugify(row.sku), usedSlugs)
  const regularPrice = Math.round(Number(row.price_cents) / 100)
  const demoPromotion = demoPromotions.find((promotion) => promotion.sku === row.sku)
  let price = regularPrice
  let promotion = null
  if (demoPromotion) {
    const discount =
      demoPromotion.type === 'percent'
        ? Math.round((regularPrice * demoPromotion.value) / 100)
        : demoPromotion.value
    price = Math.max(0, regularPrice - discount)
    promotion = {
      name: demoPromotion.name,
      badge:
        demoPromotion.type === 'percent'
          ? `-${demoPromotion.value}%`
          : `-${new Intl.NumberFormat('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumFractionDigits: 0
            }).format(demoPromotion.value)}`,
      type: demoPromotion.type,
      value: demoPromotion.value,
      demo: true
    }
  }
  return {
    id: row.id,
    sku: row.sku,
    slug,
    name: row.name,
    category: row.category,
    categorySlug: slugify(row.category),
    regularPrice: promotion ? regularPrice : null,
    price,
    stock: Number(row.stock),
    condition: row.condition || '',
    warrantyDays: Number(row.warranty_days || 0),
    image,
    promotion,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
})

const categories = [...new Set(products.map((product) => product.category))].map((name) => {
  const items = products.filter((product) => product.category === name)
  return {
    name,
    slug: slugify(name),
    count: items.length,
    image: items.find((product) => product.image)?.image ?? null
  }
})

const usedFeatured = new Set()
const featured = []
for (const category of categories) {
  const candidates = products
    .filter((product) => product.category === category.name && product.image)
    .slice(0, 3)
  for (const product of candidates) {
    if (!usedFeatured.has(product.id)) {
      usedFeatured.add(product.id)
      featured.push(product.id)
    }
  }
}

const featuredById = new Map(products.map((product) => [product.id, product]))
featured.sort(
  (a, b) =>
    Number(Boolean(featuredById.get(b)?.promotion)) -
    Number(Boolean(featuredById.get(a)?.promotion))
)

const heroProduct =
  products.find((product) => product.sku === 'KZ-CASB-35-MIC' && product.image) ||
  featured.map((id) => featuredById.get(id)).find(Boolean) ||
  products.find((product) => product.image) ||
  products[0]

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'OCTESTR',
  business: {
    name: 'BitacoreTech',
    descriptor: 'Taller & POS',
    phone: '+57 324 638 1768',
    whatsapp: '573246381768',
    city: 'Medellín',
    hours: '8:00 a. m. – 8:00 p. m.',
    currency: 'COP'
  },
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

const ordersByNumber = new Map(orderRows.map((order) => [order.number, order]))
const ordersDemo = {
  generatedAt: new Date().toISOString(),
  demo: true,
  note: 'Datos de demostración sin nombre, teléfono ni datos privados del cliente.',
  orders: demoOrders
    .map((demo) => {
      const order = ordersByNumber.get(demo.number)
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
    })
    .filter(Boolean)
}

fs.writeFileSync(outputData, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
fs.writeFileSync(outputOrders, `${JSON.stringify(ordersDemo, null, 2)}\n`, 'utf8')

console.log(`Catálogo generado: ${products.length} productos, ${payload.stats.withImage} con imagen.`)
console.log(`Promociones demo: ${products.filter((product) => product.promotion).length}`)
console.log(`Órdenes demo: ${ordersDemo.orders.length}`)
console.log(`JSON: ${outputData}`)
console.log(`Órdenes: ${outputOrders}`)
console.log(`Imágenes: ${outputImages}`)
console.log(`Proyecto: ${projectRoot}`)
