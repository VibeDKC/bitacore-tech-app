const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root =
  process.env.BITACORETECH_MIGRATION_ROOT ||
  path.join(os.tmpdir(), 'bitacoretech-migration', '1.10.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const source =
  process.env.BITACORETECH_SOURCE_DB ||
  path.join(process.env.APPDATA || '', 'BitacoreTech', 'bitacoretech.db')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function tableCount(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
}

async function launch() {
  const packagedExe = process.env.BITACORETECH_PACKAGED_EXE
  return electron.launch({
    executablePath: packagedExe || path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: packagedExe ? [] : ['.'],
    cwd: packagedExe ? path.dirname(packagedExe) : project,
    env: {
      ...process.env,
      BITACORETECH_DATA_PATH: data,
      BITACORETECH_LEGACY_DATA_PATH: legacy,
      BITACORETECH_TEST_PATHS: '1',
      BITACORETECH_DISABLE_EXTERNAL: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 90000
  })
}

;(async () => {
  assert(fs.existsSync(source), `No existe la base de origen: ${source}`)
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(data, { recursive: true })
  fs.mkdirSync(legacy, { recursive: true })

  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${source}${suffix}`
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(data, `bitacoretech.db${suffix}`))
  }

  const before = new DatabaseSync(path.join(data, 'bitacoretech.db'))
  const tables = [
    'users',
    'customers',
    'work_orders',
    'work_order_items',
    'products',
    'invoices',
    'invoice_items',
    'purchases',
    'purchase_items',
    'suppliers'
  ]
  const countsBefore = Object.fromEntries(tables.map((table) => [table, tableCount(before, table)]))
  const integrityBefore = before.prepare('PRAGMA integrity_check').get().integrity_check
  before.close()
  assert(integrityBefore === 'ok', `La copia inicial no está íntegra: ${integrityBefore}`)

  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.bitacoretech), null, { timeout: 30000 })
    await page.getByText('Bienvenido de nuevo', { exact: true }).waitFor({ timeout: 20000 })
    console.log('PASS la base migrada abre en la pantalla de inicio de sesión')
  } finally {
    await app.close().catch(() => {})
  }

  const after = new DatabaseSync(path.join(data, 'bitacoretech.db'))
  const countsAfter = Object.fromEntries(tables.map((table) => [table, tableCount(after, table)]))
  const integrityAfter = after.prepare('PRAGMA integrity_check').get().integrity_check
  const foreignKeys = after.prepare('PRAGMA foreign_key_check').all()
  const versions = after
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => Number(row.version))
  const purchaseColumns = columns(after, 'purchases')
  const purchaseItemColumns = columns(after, 'purchase_items')
  const purchasesSql = after
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'purchases'")
    .get().sql
  const purchaseIndexes = after.prepare('PRAGMA index_list(purchases)').all()
  const lookupIndex = purchaseIndexes.find((row) => row.name === 'idx_purchases_supplier_number')
  const ivaMissing = Number(
    after
      .prepare(
        "SELECT COUNT(*) AS count FROM purchase_items WHERE unit_price_cents > 0 AND (iva_rate IS NULL OR iva_cents = 0)"
      )
      .get().count
  )
  after.close()

  assert(integrityAfter === 'ok', `La base migrada no está íntegra: ${integrityAfter}`)
  assert(foreignKeys.length === 0, `La base migrada tiene claves foráneas rotas: ${JSON.stringify(foreignKeys)}`)
  assert(versions.includes(10), 'Falta la migración 10')
  assert(purchaseColumns.some((row) => row.name === 'discount_cents'), 'Falta purchases.discount_cents')
  assert(purchaseColumns.some((row) => row.name === 'adjustment_cents'), 'Falta purchases.adjustment_cents')
  assert(purchaseColumns.some((row) => row.name === 'ai_metadata_json'), 'Falta purchases.ai_metadata_json')
  assert(purchaseItemColumns.some((row) => row.name === 'iva_rate'), 'Falta purchase_items.iva_rate')
  assert(purchaseItemColumns.some((row) => row.name === 'iva_cents'), 'Falta purchase_items.iva_cents')
  assert(!/number\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(purchasesSql), 'La tabla purchases conserva UNIQUE global')
  assert(lookupIndex && Number(lookupIndex.unique) === 0, 'Falta el índice no único proveedor + número')
  assert(ivaMissing === 0, `Hay ${ivaMissing} ítems de compra sin IVA migrado`)
  assert(
    JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
    `Cambiaron los registros: antes ${JSON.stringify(countsBefore)} después ${JSON.stringify(countsAfter)}`
  )

  console.log('PASS esquema 10, IVA por línea y columnas de revisión')
  console.log('PASS unicidad global retirada e índice proveedor + número')
  console.log('PASS integridad, claves foráneas y conservación de datos')
  console.log(`COUNTS ${JSON.stringify(countsAfter)}`)
  console.log(`VERSIONS ${versions.join(',')}`)
  console.log('ROOT=' + root)
})().catch((error) => {
  console.error('FAIL migración 1.10.0 —', error?.stack || error)
  process.exit(1)
})
