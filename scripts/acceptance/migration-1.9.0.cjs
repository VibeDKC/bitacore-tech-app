const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root =
  process.env.BITACORETECH_MIGRATION_ROOT ||
  path.join(os.tmpdir(), 'bitacoretech-migration', '1.9.0')
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
  const customerColumns = columns(after, 'customers')
  const productColumns = columns(after, 'products')
  const phoneColumns = columns(after, 'customer_phones')
  const phoneCount = tableCount(after, 'customer_phones')
  const customersWithPhone = Number(
    after
      .prepare("SELECT COUNT(*) AS count FROM customers WHERE phone IS NOT NULL AND phone <> '—'")
      .get().count
  )
  const customersWithoutPhoneRow = Number(
    after
      .prepare(
        "SELECT COUNT(*) AS count FROM customers c WHERE c.phone IS NOT NULL AND c.phone <> '—' AND NOT EXISTS (SELECT 1 FROM customer_phones p WHERE p.customer_id = c.id)"
      )
      .get().count
  )
  const dictionaryCount = tableCount(after, 'dictionary_nodes')
  const newDictionaryCount = Number(
    after
      .prepare(
        "SELECT COUNT(*) AS count FROM dictionary_nodes WHERE type IN ('inventory_condition', 'inventory_origin', 'component_brand')"
      )
      .get().count
  )
  after.close()

  assert(integrityAfter === 'ok', `La base migrada no está íntegra: ${integrityAfter}`)
  assert(foreignKeys.length === 0, `La base migrada tiene claves foráneas rotas: ${JSON.stringify(foreignKeys)}`)
  assert(versions.includes(9), 'Falta la migración 9')
  assert(customerColumns.some((row) => row.name === 'document_missing'), 'Falta customers.document_missing')
  assert(productColumns.some((row) => row.name === 'condition'), 'Falta products.condition')
  assert(productColumns.some((row) => row.name === 'origin'), 'Falta products.origin')
  assert(phoneColumns.some((row) => row.name === 'customer_id'), 'Falta customer_phones.customer_id')
  assert(phoneColumns.some((row) => row.name === 'is_primary'), 'Falta customer_phones.is_primary')
  assert(phoneCount >= customersWithPhone, `Faltan teléfonos migrados: ${phoneCount} vs ${customersWithPhone}`)
  assert(customersWithoutPhoneRow === 0, `Hay ${customersWithoutPhoneRow} clientes sin fila de teléfono`)
  assert(dictionaryCount >= 132, `Faltan diccionarios nuevos: ${dictionaryCount}`)
  assert(newDictionaryCount >= 22, `Faltan valores en condición/origen/componentes: ${newDictionaryCount}`)
  assert(
    JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
    `Cambiaron los registros: antes ${JSON.stringify(countsBefore)} después ${JSON.stringify(countsAfter)}`
  )

  console.log('PASS esquema 9, documento opcional y columnas de inventario')
  console.log('PASS teléfonos migrados y diccionarios de condición/origen/componentes')
  console.log('PASS integridad, claves foráneas y conservación de datos')
  console.log(`COUNTS ${JSON.stringify(countsAfter)}`)
  console.log(`PHONES ${phoneCount} · CUSTOMERS_WITH_PHONE ${customersWithPhone}`)
  console.log(`DICTIONARIES ${dictionaryCount} · NEW_VALUES ${newDictionaryCount}`)
  console.log(`VERSIONS ${versions.join(',')}`)
  console.log('ROOT=' + root)
})().catch((error) => {
  console.error('FAIL migración 1.9.0 —', error?.stack || error)
  process.exit(1)
})
