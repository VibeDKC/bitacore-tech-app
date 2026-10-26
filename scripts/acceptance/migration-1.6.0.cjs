const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root =
  process.env.BITACORETECH_MIGRATION_ROOT ||
  path.join(os.tmpdir(), 'bitacoretech-migration', '1.6.0')
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
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)
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
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 90000
  })
}

async function openAndWaitForLogin() {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.bitacoretech), null, { timeout: 30000 })
    await page.getByText('Bienvenido de nuevo', { exact: true }).waitFor({ timeout: 20000 })
  } finally {
    await app.close().catch(() => {})
  }
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
  const tables = ['users', 'customers', 'work_orders', 'products', 'invoices', 'invoice_items', 'purchases', 'suppliers']
  const countsBefore = Object.fromEntries(tables.map((table) => [table, tableCount(before, table)]))
  const integrityBefore = before.prepare('PRAGMA integrity_check').get().integrity_check
  before.close()
  assert(integrityBefore === 'ok', `La copia inicial no está íntegra: ${integrityBefore}`)

  await openAndWaitForLogin()
  console.log('PASS la base migrada abre en la pantalla de inicio de sesión')

  const first = new DatabaseSync(path.join(data, 'bitacoretech.db'))
  const dictionaryCount = tableCount(first, 'dictionary_nodes')
  const firstData = {
    counts: Object.fromEntries(tables.map((table) => [table, tableCount(first, table)])),
    integrity: first.prepare('PRAGMA integrity_check').get().integrity_check,
    versions: first.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => Number(row.version)),
    dictionaryCount,
    dictionaryColumns: columns(first, 'dictionary_nodes'),
    productColumns: columns(first, 'products'),
    serviceTypeCount: Number(first.prepare("SELECT COUNT(*) AS count FROM dictionary_nodes WHERE type = 'service_type'").get().count),
    adminDictionaryPermission: first
      .prepare("SELECT allowed FROM role_permissions WHERE role = 'admin' AND capability = 'manageDictionaries'")
      .get(),
    productCategories: first.prepare('SELECT DISTINCT category AS value FROM products').all().map((row) => row.value),
    productLocations: first.prepare('SELECT DISTINCT location AS value FROM products').all().map((row) => row.value),
    supplierCategories: first.prepare('SELECT DISTINCT category AS value FROM suppliers').all().map((row) => row.value),
    deviceLabels: first.prepare('SELECT DISTINCT category_label AS value FROM work_orders').all().map((row) => row.value),
    dictionaryCategories: first.prepare("SELECT name FROM dictionary_nodes WHERE type = 'inventory_category'").all().map((row) => row.name),
    dictionaryLocations: first.prepare("SELECT name FROM dictionary_nodes WHERE type = 'inventory_location'").all().map((row) => row.name),
    dictionarySupplierCategories: first.prepare("SELECT name FROM dictionary_nodes WHERE type = 'supplier_category'").all().map((row) => row.name),
    dictionaryDeviceTypes: first.prepare("SELECT name FROM dictionary_nodes WHERE type = 'device_type'").all().map((row) => row.name)
  }
  first.close()

  assert(firstData.integrity === 'ok', `La base migrada no está íntegra: ${firstData.integrity}`)
  assert(firstData.versions.includes(6), 'Falta la migración 6')
  assert(firstData.dictionaryColumns.includes('parent_id'), 'Falta dictionary_nodes.parent_id')
  assert(firstData.dictionaryColumns.includes('active'), 'Falta dictionary_nodes.active')
  assert(firstData.productColumns.includes('service_type'), 'Falta products.service_type')
  assert(firstData.serviceTypeCount > 0, 'Falta el diccionario de tipos de servicio')
  assert(firstData.dictionaryCount > 50, `Diccionarios insuficientes: ${firstData.dictionaryCount}`)
  assert(firstData.adminDictionaryPermission?.allowed === 1, 'El admin no recibió manageDictionaries')
  assert(
    JSON.stringify(countsBefore) === JSON.stringify(firstData.counts),
    `Cambiaron los registros: antes ${JSON.stringify(countsBefore)} después ${JSON.stringify(firstData.counts)}`
  )
  for (const value of firstData.productCategories) {
    assert(firstData.dictionaryCategories.includes(value), `Categoría de producto sin diccionario: ${value}`)
  }
  for (const value of firstData.productLocations) {
    assert(firstData.dictionaryLocations.includes(value), `Ubicación sin diccionario: ${value}`)
  }
  for (const value of firstData.supplierCategories) {
    assert(firstData.dictionarySupplierCategories.includes(value), `Categoría de proveedor sin diccionario: ${value}`)
  }
  for (const value of firstData.deviceLabels) {
    assert(firstData.dictionaryDeviceTypes.includes(value), `Tipo de equipo histórico sin diccionario: ${value}`)
  }
  console.log('PASS esquema 6, diccionarios y permiso de admin')
  console.log('PASS valores históricos de inventario, proveedores y equipos conservados en diccionarios')

  await openAndWaitForLogin()
  const second = new DatabaseSync(path.join(data, 'bitacoretech.db'))
  const dictionaryCountAfterSecond = tableCount(second, 'dictionary_nodes')
  second.close()
  assert(
    dictionaryCountAfterSecond === firstData.dictionaryCount,
    `La semilla de diccionarios duplicó datos: ${firstData.dictionaryCount} → ${dictionaryCountAfterSecond}`
  )
  console.log('PASS la semilla de diccionarios es idempotente')

  console.log('PASS integridad SQLite correcta')
  console.log(`COUNTS ${JSON.stringify(firstData.counts)}`)
  console.log(`DICTIONARIES ${firstData.dictionaryCount}`)
  console.log(`VERSIONS ${firstData.versions.join(',')}`)
  console.log('ROOT=' + root)
})().catch((error) => {
  console.error('FAIL migración 1.6.0 —', error?.stack || error)
  process.exit(1)
})
