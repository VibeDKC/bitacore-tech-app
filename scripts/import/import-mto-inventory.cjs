const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { app, nativeImage } = require('electron')
const { DatabaseSync } = require('node:sqlite')

const PROJECT_DIR = path.resolve(__dirname, '../..')
const USER_DATA = process.env.BITACORETECH_DATA_PATH
  ? path.resolve(process.env.BITACORETECH_DATA_PATH)
  : path.join(process.env.APPDATA || '', 'BitacoreTech')
const DATABASE_PATH = path.join(USER_DATA, 'bitacoretech.db')
const PRODUCT_IMAGE_ROOT = path.join(USER_DATA, 'product-images')
const BACKUP_ROOT = path.join(USER_DATA, 'backups')
const MTO_DB_PATH =
  process.env.MTO_DB_PATH || 'C:\\Users\\Dave\\Desktop\\MTO APP\\data\\bitacore.db'
const MTO_DATA_DIR = path.dirname(MTO_DB_PATH)
const REPORT_DIR = path.join(PROJECT_DIR, 'release', 'import-reports')
const APPLY = process.argv.includes('--apply')
const DRY_RUN = !APPLY

const TARGET_CATEGORY = 'Insumos de taller'
const MTO_CATEGORY_MAP = {
  'Periféricos': 'Periféricos',
  Almacenamiento: 'Almacenamiento',
  Accesorios: 'Accesorios',
  Servicio: 'Servicios',
  'Herramientas e Insumos': TARGET_CATEGORY,
  Repuestos: 'Repuestos',
  RAM: 'Memoria',
  Fuentes: 'Componentes',
  Pantallas: 'Repuestos',
  'Equipos Reacondicionados': 'Equipos reacondicionados'
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`
}

function nowIso() {
  return new Date().toISOString()
}

function mtoDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return nowIso()
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  const date = new Date(`${normalized}-05:00`)
  return Number.isNaN(date.getTime()) ? nowIso() : date.toISOString()
}

function categoryIdFor(name) {
  const normalized = String(name ?? '').trim().toLowerCase()
  return `dict_${sha256(`inventory_category||${normalized}`).slice(0, 20)}`
}

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) return
  fs.mkdirSync(target, { recursive: true })
  fs.cpSync(source, target, { recursive: true, force: true })
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) {
        files.push({
          absolute,
          relative: path.relative(root, absolute),
          size: fs.statSync(absolute).size
        })
      }
    }
  }
  walk(root)
  return files
}

function resolveProductImage(relativePath) {
  const root = path.resolve(PRODUCT_IMAGE_ROOT)
  const absolute = path.resolve(USER_DATA, relativePath)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Ruta de imagen fuera del directorio permitido: ${relativePath}`)
  }
  return absolute
}

function removeImageFiles(relativePaths) {
  for (const relativePath of relativePaths) {
    if (!relativePath) continue
    try {
      const absolute = resolveProductImage(relativePath)
      if (fs.existsSync(absolute)) fs.rmSync(absolute, { force: true })
      let directory = path.dirname(absolute)
      while (directory.startsWith(PRODUCT_IMAGE_ROOT) && directory !== PRODUCT_IMAGE_ROOT) {
        if (!fs.existsSync(directory) || fs.readdirSync(directory).length > 0) break
        fs.rmdirSync(directory)
        directory = path.dirname(directory)
      }
    } catch {
      // La limpieza no debe ocultar el resultado principal.
    }
  }
}

function appendAudit(db, input) {
  const createdAt = input.createdAt || nowIso()
  const previous =
    db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').get()?.hash || 'GENESIS'
  const id = newId('aud')
  const payload = [
    id,
    createdAt,
    input.userId || '',
    input.userName,
    input.role,
    input.action,
    input.entity,
    input.entityId || '',
    input.detail,
    previous
  ].join('|')
  const hash = sha256(payload)
  db.prepare(
    `INSERT INTO audit_log
      (id, created_at, user_id, user_name, role, action, entity, entity_id, detail, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    createdAt,
    input.userId || null,
    input.userName,
    input.role,
    input.action,
    input.entity,
    input.entityId || null,
    input.detail,
    previous,
    hash
  )
  return { id, hash, previous }
}

function verifyAuditChain(db) {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all()
  let previous = 'GENESIS'
  for (const row of rows) {
    const payload = [
      row.id,
      row.created_at,
      row.user_id || '',
      row.user_name,
      row.role,
      row.action,
      row.entity,
      row.entity_id || '',
      row.detail,
      previous
    ].join('|')
    if (row.prev_hash !== previous || row.hash !== sha256(payload)) {
      return { valid: false, brokenAt: row.id, checked: rows.length }
    }
    previous = row.hash
  }
  return { valid: true, brokenAt: null, checked: rows.length }
}

function ensureCategory(db, name) {
  const existing = db
    .prepare(
      "SELECT id FROM dictionary_nodes WHERE type = 'inventory_category' AND name = ? COLLATE NOCASE"
    )
    .get(name)
  if (existing?.id) return existing.id
  const maxSort =
    Number(
      db
        .prepare("SELECT MAX(sort_order) AS max FROM dictionary_nodes WHERE type = 'inventory_category'")
        .get()?.max ?? 0
    ) || 0
  const id = categoryIdFor(name)
  const timestamp = nowIso()
  db.prepare(
    `INSERT INTO dictionary_nodes
      (id, parent_id, type, code, name, sort_order, active, system, created_at, updated_at)
     VALUES (?, NULL, 'inventory_category', NULL, ?, ?, 1, 0, ?, ?)`
  ).run(id, name, maxSort + 1, timestamp, timestamp)
  return id
}

function parseSerials(details) {
  const text = String(details ?? '')
  const match = text.match(/Seriales:\s*([^|]+)/i)
  if (!match) return []
  return [...new Set(match[1].split(',').map((value) => value.trim()).filter(Boolean))]
}

function createSafetyBackup(db, plan) {
  const stamp = nowIso().replace(/[:.]/g, '-')
  const folder = path.join(BACKUP_ROOT, `pre-import-mto-${stamp}`)
  fs.mkdirSync(folder, { recursive: true })
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const databaseTarget = path.join(folder, 'database.db')
  db.exec(`VACUUM INTO '${databaseTarget.replace(/'/g, "''")}'`)
  copyDirectory(path.join(USER_DATA, 'evidence'), path.join(folder, 'evidence'))
  copyDirectory(PRODUCT_IMAGE_ROOT, path.join(folder, 'product-images'))
  const databaseBytes = fs.readFileSync(databaseTarget)
  const manifest = {
    app: 'BitacoreTech Taller & POS',
    formatVersion: 1,
    createdAt: nowIso(),
    note: 'Respaldo previo a la importación del inventario de MTO APP.',
    database: {
      filename: 'database.db',
      size: databaseBytes.length,
      sha256: sha256Bytes(databaseBytes)
    },
    currentProducts: plan.currentProducts.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      stock: product.stock
    })),
    mtoSource: MTO_DB_PATH,
    mtoItems: plan.imports.length,
    productImages: walkFiles(path.join(folder, 'product-images')).length
  }
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return { folder, manifest }
}

function prepareImages(imports) {
  const createdDirectories = []
  for (const item of imports) {
    if (!item.imageSource) continue
    assert(fs.existsSync(item.imageSource), `No existe la imagen ${item.imageSource}`)
    const image = nativeImage.createFromPath(item.imageSource)
    assert(!image.isEmpty(), `No se pudo leer la imagen ${item.imageSource}`)
    const size = image.getSize()
    assert(size.width > 0 && size.height > 0, `Dimensiones inválidas en ${item.imageSource}`)

    const mainScale = Math.min(1, 1200 / Math.max(size.width, size.height))
    const mainImage =
      mainScale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * mainScale)),
            height: Math.max(1, Math.round(size.height * mainScale)),
            quality: 'good'
          })
        : image
    const mainBuffer = mainImage.toJPEG(86)
    assert(mainBuffer.length > 0, `La imagen ${item.imageSource} quedó vacía al convertirla`)

    const hash = sha256Bytes(mainBuffer).slice(0, 16)
    const directory = path.join(PRODUCT_IMAGE_ROOT, item.productId)
    fs.mkdirSync(directory, { recursive: true })
    createdDirectories.push(directory)
    const mainRelative = `product-images/${item.productId}/${hash}.jpg`
    const thumbRelative = `product-images/${item.productId}/${hash}-thumb.jpg`
    fs.writeFileSync(resolveProductImage(mainRelative), mainBuffer)

    const thumbScale = Math.min(1, 300 / Math.max(size.width, size.height))
    const thumbImage =
      thumbScale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * thumbScale)),
            height: Math.max(1, Math.round(size.height * thumbScale)),
            quality: 'good'
          })
        : image
    fs.writeFileSync(resolveProductImage(thumbRelative), thumbImage.toJPEG(78))
    item.imagePath = mainRelative
    item.imageThumbPath = thumbRelative
    item.imageUpdatedAt = nowIso()
  }
  return createdDirectories
}

function loadPlan(db, mto) {
  const versions = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => Number(row.version))
  assert(versions.includes(12), 'La base de OCTESTR no tiene la migración 12. Abre BitacoreTech 1.10.3 una vez.')
  const productColumns = db.prepare('PRAGMA table_info(products)').all().map((row) => row.name)
  for (const column of ['supplier_sku', 'image_path', 'image_thumb_path', 'image_updated_at']) {
    assert(productColumns.includes(column), `Falta la columna products.${column}`)
  }

  const currentProducts = db
    .prepare(
      `SELECT id, name, sku, stock, active, image_path, image_thumb_path
       FROM products ORDER BY id`
    )
    .all()
  const currentImages = currentProducts
    .flatMap((product) => [product.image_path, product.image_thumb_path])
    .filter(Boolean)

  const dictionary = mto
    .prepare("SELECT id, tipo, nombre FROM diccionario_nodos WHERE activo = 1")
    .all()
  const categoryById = new Map(
    dictionary
      .filter((row) => row.tipo === 'categoria_inventario')
      .map((row) => [Number(row.id), String(row.nombre)])
  )
  const targetCategories = new Set(
    db
      .prepare("SELECT name FROM dictionary_nodes WHERE type = 'inventory_category' AND active = 1")
      .all()
      .map((row) => String(row.name).toLowerCase())
  )
  const mtoRows = mto.prepare('SELECT * FROM inventario ORDER BY id').all()
  const currentSkus = new Set(currentProducts.map((product) => String(product.sku).toLowerCase()))
  const mtoSkus = new Set()
  const imports = []

  for (const row of mtoRows) {
    const sku = String(row.sku ?? '').trim()
    const name = String(row.nombre ?? '').trim()
    assert(sku, `El artículo MTO ${row.id} no tiene SKU`)
    assert(name, `El artículo MTO ${row.id} no tiene nombre`)
    assert(!mtoSkus.has(sku.toLowerCase()), `SKU duplicado en MTO: ${sku}`)
    mtoSkus.add(sku.toLowerCase())
    assert(
      !currentSkus.has(sku.toLowerCase()),
      `El SKU ${sku} ya existe en el inventario actual. La importación se detuvo.`
    )
    const mtoCategory = row.categoria_id ? categoryById.get(Number(row.categoria_id)) : ''
    const category =
      MTO_CATEGORY_MAP[mtoCategory] ||
      (mtoCategory && targetCategories.has(mtoCategory.toLowerCase()) ? mtoCategory : 'Accesorios')
    assert(
      category === TARGET_CATEGORY || targetCategories.has(category.toLowerCase()),
      `La categoría destino ${category} no existe en OCTESTR`
    )
    const isService = Number(row.id) === 12
    const stock = Number(row.stock) || 0
    const minStock = Number(row.stock_minimo) || 0
    const costCents = Math.round(Number(row.precio_compra || 0) * 100)
    const priceCents = Math.round(Number(row.precio_venta || 0) * 100)
    assert(stock >= 0, `Stock negativo en ${sku}`)
    assert(minStock >= 0, `Stock mínimo negativo en ${sku}`)
    assert(costCents >= 0, `Costo negativo en ${sku}`)
    assert(priceCents >= 0, `Precio negativo en ${sku}`)
    const imageSource =
      typeof row.imagen_path === 'string' && row.imagen_path.trim() ? row.imagen_path.trim() : ''
    if (imageSource) assert(fs.existsSync(imageSource), `No existe la imagen de ${sku}: ${imageSource}`)
    const rotation = isService || Number(row.rotativo) === 0 ? 'no_rotativo' : 'rotativo'
    imports.push({
      mtoId: Number(row.id),
      productId: `prod_mto_${row.id}`,
      name,
      sku,
      barcode: sku,
      supplierSku: String(row.codigo_proveedor ?? '').trim().slice(0, 60),
      category,
      location: '',
      condition: 'Nuevo',
      origin: '',
      stock,
      minStock,
      costCents,
      priceCents,
      warrantyDays: Number(row.dias_garantia) || 0,
      isService,
      serviceType: isService ? 'Otro' : null,
      rotation,
      alertEnabled: isService ? 0 : Number(row.rotativo) === 0 ? 0 : 1,
      createdAt: mtoDate(row.created_at),
      imageSource,
      serials: parseSerials(row.detalles)
    })
  }

  const seenIds = new Set()
  for (const item of imports) {
    assert(!seenIds.has(item.productId), `ID de producto duplicado: ${item.productId}`)
    seenIds.add(item.productId)
  }
  const importedImages = imports.filter((item) => item.imageSource)
  const serialCount = imports.reduce((sum, item) => sum + item.serials.length, 0)
  const serviceCount = imports.filter((item) => item.isService).length
  const physicalUnits = imports
    .filter((item) => !item.isService)
    .reduce((sum, item) => sum + item.stock, 0)
  const costValue = imports.reduce((sum, item) => sum + item.costCents * item.stock, 0)
  const saleValue = imports.reduce((sum, item) => sum + item.priceCents * item.stock, 0)

  assert(imports.length === 44, `Se esperaban 44 artículos MTO y se encontraron ${imports.length}`)
  assert(serviceCount === 1, `Se esperaba 1 servicio y se encontraron ${serviceCount}`)
  assert(importedImages.length === 24, `Se esperaban 24 imágenes y se encontraron ${importedImages.length}`)
  assert(serialCount === 14, `Se esperaban 14 seriales y se encontraron ${serialCount}`)
  assert(physicalUnits === 51, `Se esperaban 51 unidades físicas y se encontraron ${physicalUnits}`)

  return {
    currentProducts,
    currentImages,
    imports,
    serviceCount,
    importedImages,
    serialCount,
    physicalUnits,
    costValue,
    saleValue,
    currentSkus: currentSkus.size,
    mtoSkus: mtoSkus.size
  }
}

function printPlan(plan, mode) {
  console.log(`\nMODO ${mode}`)
  console.log(`OCTESTR: ${plan.currentProducts.length} productos actuales, ${plan.currentSkus} SKU`)
  console.log(`MTO APP: ${plan.imports.length} artículos, ${plan.serviceCount} servicio, ${plan.mtoSkus} SKU`)
  console.log(`Imágenes: ${plan.importedImages.length}`)
  console.log(`Seriales: ${plan.serialCount}`)
  console.log(`Unidades físicas: ${plan.physicalUnits}`)
  console.log(`Costo importado: ${(plan.costValue / 100).toFixed(2)} COP`)
  console.log(`Venta importada: ${(plan.saleValue / 100).toFixed(2)} COP`)
  console.log('\nMapeo de categorías:')
  const categories = new Map()
  for (const item of plan.imports) {
    categories.set(item.category, (categories.get(item.category) ?? 0) + 1)
  }
  for (const [category, count] of [...categories.entries()].sort()) {
    console.log(`  ${category}: ${count}`)
  }
  console.log('\nPrimeros artículos:')
  for (const item of plan.imports.slice(0, 8)) {
    console.log(
      `  ${item.productId} | ${item.sku} | ${item.category} | stock ${item.stock} | ${
        item.isService ? 'SERVICIO' : 'producto'
      } | imagen ${item.imageSource ? 'sí' : 'no'} | seriales ${item.serials.length}`
    )
  }
}

function applyPlan(db, plan) {
  assert(
    !db.prepare("SELECT id FROM products WHERE id LIKE 'prod_mto_%' LIMIT 1").get(),
    'Ya existen productos importados de MTO. La importación se detuvo para no duplicar datos.'
  )
  const backup = createSafetyBackup(db, plan)
  console.log(`\nRespaldo previo: ${backup.folder}`)

  const stagedDirectories = prepareImages(plan.imports)
  const oldIds = plan.currentProducts.map((product) => product.id)
  const placeholders = oldIds.map(() => '?').join(',')
  const stockTriggers = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'stock_movements' AND name IN ('stock_movements_no_delete','stock_movements_no_update')"
    )
    .all()
  const importRef = `mto_import_${nowIso().replace(/[:.]/g, '-')}`

  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const categoryId = ensureCategory(db, TARGET_CATEGORY)
      db.exec(
        'DROP TRIGGER IF EXISTS stock_movements_no_delete; DROP TRIGGER IF EXISTS stock_movements_no_update;'
      )
      db.prepare(`DELETE FROM stock_movements WHERE product_id IN (${placeholders})`).run(...oldIds)
      db.prepare(
        `UPDATE invoice_items SET product_id = NULL WHERE product_id IN (${placeholders})`
      ).run(...oldIds)
      db.prepare(
        `UPDATE work_order_items SET product_id = NULL WHERE product_id IN (${placeholders})`
      ).run(...oldIds)
      db.prepare(
        `UPDATE purchase_items SET product_id = NULL WHERE product_id IN (${placeholders})`
      ).run(...oldIds)
      db.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).run(...oldIds)

      const insertProduct = db.prepare(
        `INSERT INTO products
          (id, name, sku, barcode, supplier_sku, category, location, condition, origin,
           stock, min_stock, cost_cents, price_cents, image_path, image_thumb_path, image_updated_at,
           warranty_days, is_service, service_type, alert_enabled, rotation, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      const insertSerial = db.prepare(
        `INSERT INTO product_serials (id, product_id, serial, status, created_at)
         VALUES (?, ?, ?, 'disponible', ?)`
      )
      const insertMovement = db.prepare(
        `INSERT INTO stock_movements
          (id, product_id, type, quantity, unit_cost_cents, reason, reference_type, reference_id,
           user_id, user_name, created_at)
         VALUES (?, ?, 'carga_inicial', ?, ?, 'Importación MTO APP', 'import', ?, NULL, 'Sistema', ?)`
      )
      const importedAt = nowIso()
      for (const item of plan.imports) {
        insertProduct.run(
          item.productId,
          item.name,
          item.sku,
          item.barcode,
          item.supplierSku,
          item.category,
          item.location,
          item.condition,
          item.origin,
          item.stock,
          item.minStock,
          item.costCents,
          item.priceCents,
          item.imagePath || null,
          item.imageThumbPath || null,
          item.imageUpdatedAt || null,
          item.warrantyDays,
          item.isService ? 1 : 0,
          item.serviceType,
          item.alertEnabled,
          item.rotation,
          item.createdAt,
          importedAt
        )
        item.serials.forEach((serial, index) => {
          insertSerial.run(
            `ser_mto_${item.mtoId}_${index + 1}`,
            item.productId,
            serial,
            importedAt
          )
        })
        if (!item.isService && item.stock > 0) {
          insertMovement.run(
            `sm_mto_${item.mtoId}`,
            item.productId,
            item.stock,
            item.costCents,
            importRef,
            importedAt
          )
        }
      }

      db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('mto_import', ?)"
      ).run(
        JSON.stringify({
          source: MTO_DB_PATH,
          importedAt,
          items: plan.imports.length,
          images: plan.importedImages.length,
          serials: plan.serialCount,
          reference: importRef
        })
      )
      appendAudit(db, {
        userName: 'Sistema',
        role: 'Sistema',
        action: 'Eliminación de inventario de prueba',
        entity: 'Producto',
        entityId: null,
        detail: `${plan.currentProducts.length} productos de prueba eliminados para importar el inventario de MTO APP. Imágenes asociadas: ${plan.currentImages.length}.`
      })
      appendAudit(db, {
        userName: 'Sistema',
        role: 'Sistema',
        action: 'Importación de inventario MTO APP',
        entity: 'Producto',
        entityId: null,
        detail: `${plan.imports.length} artículos importados desde ${MTO_DB_PATH}. Servicios: ${plan.serviceCount}. Imágenes: ${plan.importedImages.length}. Seriales: ${plan.serialCount}. Unidades físicas: ${plan.physicalUnits}. Referencia: ${importRef}.`
      })
      for (const trigger of stockTriggers) {
        assert(trigger.sql, `No se pudo recuperar el trigger ${trigger.name}`)
        db.exec(trigger.sql)
      }
      db.exec('COMMIT')
      console.log(`Categoría asegurada: ${TARGET_CATEGORY} (${categoryId})`)
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // La transacción pudo haber sido revertida por SQLite.
      }
      throw error
    }
  } catch (error) {
    for (const directory of stagedDirectories) {
      try {
        if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true })
      } catch {
        // La limpieza no oculta el error original.
      }
    }
    throw error
  }

  removeImageFiles(plan.currentImages)
  return { backup, importRef }
}

function verifyResult(db, plan) {
  const products = db
    .prepare(
      `SELECT id, name, sku, stock, is_service, image_path, image_thumb_path, category
       FROM products ORDER BY id`
    )
    .all()
  const active = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n
  const services = db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_service = 1').get().n
  const images = db
    .prepare("SELECT COUNT(*) AS n FROM products WHERE image_path IS NOT NULL AND image_path <> ''")
    .get().n
  const serials = db.prepare('SELECT COUNT(*) AS n FROM product_serials').get().n
  const movements = db
    .prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE reference_type = 'import'")
    .get().n
  const oldProducts = db
    .prepare(`SELECT COUNT(*) AS n FROM products WHERE id IN (${plan.currentProducts.map(() => '?').join(',')})`)
    .get(...plan.currentProducts.map((product) => product.id)).n
  const invoiceItems = db.prepare('SELECT COUNT(*) AS n FROM invoice_items').get().n
  const orphanInvoiceItems = db
    .prepare(
      `SELECT COUNT(*) AS n FROM invoice_items WHERE product_id IS NOT NULL AND product_id NOT IN (SELECT id FROM products)`
    )
    .get().n
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
  const audit = verifyAuditChain(db)
  const missingImages = []
  for (const product of products) {
    for (const relative of [product.image_path, product.image_thumb_path].filter(Boolean)) {
      if (!fs.existsSync(resolveProductImage(relative))) missingImages.push(relative)
    }
  }
  const stockMismatch = db
    .prepare(
      `SELECT p.id, p.stock, COALESCE(SUM(m.quantity), 0) AS moved
       FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
       WHERE p.is_service = 0
       GROUP BY p.id HAVING p.stock <> moved`
    )
    .all()
  const serialCountByProduct = db
    .prepare('SELECT product_id, COUNT(*) AS n FROM product_serials GROUP BY product_id')
    .all()
  return {
    products: products.length,
    active: Number(active),
    services: Number(services),
    images: Number(images),
    serials: Number(serials),
    movements: Number(movements),
    oldProducts: Number(oldProducts),
    invoiceItems: Number(invoiceItems),
    orphanInvoiceItems: Number(orphanInvoiceItems),
    integrity,
    foreignKeys: foreignKeys.length,
    audit,
    missingImages,
    stockMismatch,
    serialCountByProduct,
    productsList: products
  }
}

async function main() {
  console.log(`Datos de OCTESTR: ${USER_DATA}`)
  console.log(`Base OCTESTR: ${DATABASE_PATH}`)
  console.log(`Base MTO APP: ${MTO_DB_PATH}`)
  assert(fs.existsSync(DATABASE_PATH), `No existe la base de OCTESTR: ${DATABASE_PATH}`)
  assert(fs.existsSync(MTO_DB_PATH), `No existe la base de MTO APP: ${MTO_DB_PATH}`)
  assert(fs.existsSync(MTO_DATA_DIR), `No existe la carpeta de datos de MTO APP: ${MTO_DATA_DIR}`)

  const db = new DatabaseSync(DATABASE_PATH)
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  const mto = new DatabaseSync(MTO_DB_PATH, { readOnly: true })
  try {
    const plan = loadPlan(db, mto)
    printPlan(plan, DRY_RUN ? 'DRY-RUN (sin cambios)' : 'APLICAR')
    if (DRY_RUN) {
      console.log('\nNo se modificó ningún dato. Ejecuta con --apply para aplicar.')
      return
    }
    const applied = applyPlan(db, plan)
    const result = verifyResult(db, plan)
    const report = {
      appliedAt: nowIso(),
      source: MTO_DB_PATH,
      target: DATABASE_PATH,
      backup: applied.backup.folder,
      importReference: applied.importRef,
      plan: {
        currentProducts: plan.currentProducts.length,
        importedItems: plan.imports.length,
        services: plan.serviceCount,
        images: plan.importedImages.length,
        serials: plan.serialCount,
        physicalUnits: plan.physicalUnits,
        costValueCents: plan.costValue,
        saleValueCents: plan.saleValue
      },
      verification: result
    }
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    const reportPath = path.join(
      REPORT_DIR,
      `mto-import-${nowIso().replace(/[:.]/g, '-')}.json`
    )
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log('\nVERIFICACIÓN')
    console.log(JSON.stringify({ ...result, productsList: undefined }, null, 2))
    console.log(`\nReporte: ${reportPath}`)
    assert(result.products === 44, `Se esperaban 44 productos y hay ${result.products}`)
    assert(result.active === 44, `Se esperaban 44 productos activos y hay ${result.active}`)
    assert(result.services === 1, `Se esperaba 1 servicio y hay ${result.services}`)
    assert(result.images === 24, `Se esperaban 24 imágenes y hay ${result.images}`)
    assert(result.serials === 14, `Se esperaban 14 seriales y hay ${result.serials}`)
    assert(result.movements === 43, `Se esperaban 43 movimientos iniciales y hay ${result.movements}`)
    assert(result.oldProducts === 0, 'Quedaron productos del inventario anterior')
    assert(result.orphanInvoiceItems === 0, 'Hay líneas de factura apuntando a productos inexistentes')
    assert(result.integrity === 'ok', `integrity_check: ${result.integrity}`)
    assert(result.foreignKeys === 0, `foreign_key_check devolvió ${result.foreignKeys} errores`)
    assert(result.audit.valid, `La cadena de auditoría se rompió en ${result.audit.brokenAt}`)
    assert(result.missingImages.length === 0, `Faltan imágenes: ${result.missingImages.join(', ')}`)
    assert(result.stockMismatch.length === 0, `Stock inconsistente: ${JSON.stringify(result.stockMismatch)}`)
    console.log('\nIMPORTACIÓN COMPLETADA')
  } finally {
    mto.close()
    db.close()
  }
}

app
  .whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    console.error('\nERROR:', error?.stack || error)
    app.exit(1)
  })
