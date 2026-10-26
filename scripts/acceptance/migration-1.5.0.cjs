const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root =
  process.env.BITACORETECH_MIGRATION_ROOT ||
  path.join(os.tmpdir(), 'bitacoretech-migration', '1.5.0')
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
  const tables = ['users', 'customers', 'work_orders', 'products', 'invoices', 'invoice_items', 'purchases']
  const countsBefore = Object.fromEntries(tables.map((table) => [table, tableCount(before, table)]))
  const integrityBefore = before.prepare('PRAGMA integrity_check').get().integrity_check
  before.close()
  assert(integrityBefore === 'ok', `La copia inicial no está íntegra: ${integrityBefore}`)

  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: project,
    env: {
      ...process.env,
      BITACORETECH_DATA_PATH: data,
      BITACORETECH_LEGACY_DATA_PATH: legacy,
      BITACORETECH_TEST_PATHS: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 90000
  })

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
  const productColumns = columns(after, 'products')
  const invoiceItemColumns = columns(after, 'invoice_items')
  const versions = after.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => Number(row.version))
  const sample = after
    .prepare('SELECT alert_enabled, rotation FROM products WHERE active = 1 ORDER BY created_at ASC LIMIT 1')
    .get()
  after.close()

  assert(integrityAfter === 'ok', `La base migrada no está íntegra: ${integrityAfter}`)
  assert(productColumns.includes('alert_enabled'), 'Falta products.alert_enabled')
  assert(productColumns.includes('rotation'), 'Falta products.rotation')
  assert(invoiceItemColumns.includes('note'), 'Falta invoice_items.note')
  assert(versions.includes(5), 'Falta la migración 5')
  assert(
    JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
    `Cambiaron los registros: antes ${JSON.stringify(countsBefore)} después ${JSON.stringify(countsAfter)}`
  )
  assert(sample && sample.alert_enabled === 1 && sample.rotation === 'rotativo', 'Los productos existentes no conservaron la alerta por defecto')

  console.log('PASS esquema 5 aplicado sin pérdida de datos')
  console.log('PASS integridad SQLite correcta')
  console.log('PASS productos existentes conservan alerta activa y rotación')
  console.log(`COUNTS ${JSON.stringify(countsAfter)}`)
  console.log(`VERSIONS ${versions.join(',')}`)
  console.log('ROOT=' + root)
})().catch((error) => {
  console.error('FAIL migración 1.5.0 —', error?.stack || error)
  process.exit(1)
})
