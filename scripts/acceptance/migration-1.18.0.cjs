const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = path.join(os.tmpdir(), 'bitacoretech-migration', '1.18.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const source =
  process.env.BITACORETECH_SOURCE_DB ||
  'C:\\Users\\Dave\\Desktop\\BitacoreTech-1.17.0-limpia\\bitacoretech.db'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function count(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.c ?? 0)
}

async function launch() {
  return electron.launch({
    executablePath:
      process.env.BITACORETECH_PACKAGED_EXE ||
      path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: process.env.BITACORETECH_PACKAGED_EXE ? [] : ['.'],
    cwd: process.env.BITACORETECH_PACKAGED_EXE ? path.dirname(process.env.BITACORETECH_PACKAGED_EXE) : project,
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
    if (fs.existsSync(`${source}${suffix}`)) {
      fs.copyFileSync(`${source}${suffix}`, path.join(data, `bitacoretech.db${suffix}`))
    }
  }

  const before = new DatabaseSync(path.join(data, 'bitacoretech.db'))
  const productsBefore = count(before, 'SELECT COUNT(*) AS c FROM products')
  const ordersBefore = count(before, 'SELECT COUNT(*) AS c FROM work_orders')
  const invoicesBefore = count(before, 'SELECT COUNT(*) AS c FROM invoices')
  const integrityBefore = before.prepare('PRAGMA integrity_check').get().integrity_check
  before.close()
  assert(integrityBefore === 'ok', `Copia inicial no íntegra: ${integrityBefore}`)

  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByText('Bienvenido de nuevo', { exact: true }).waitFor({ timeout: 30000 })
    console.log('PASS la base 1.17 abre en login')
  } finally {
    await app.close().catch(() => {})
  }

  const after = new DatabaseSync(path.join(data, 'bitacoretech.db'))
  const version = Number(after.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v)
  const productsAfter = count(after, 'SELECT COUNT(*) AS c FROM products')
  const ordersAfter = count(after, 'SELECT COUNT(*) AS c FROM work_orders')
  const invoicesAfter = count(after, 'SELECT COUNT(*) AS c FROM invoices')
  const orderColumns = after.prepare('PRAGMA table_info(work_orders)').all().map((row) => row.name)
  const itemColumns = after.prepare('PRAGMA table_info(work_order_items)').all().map((row) => row.name)
  const loginTable = after.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='login_attempts'").get()
  const abandonedStatus = after.prepare("SELECT * FROM order_status_config WHERE status = 'abandonado'").get()
  const despiece = after.prepare("SELECT id FROM dictionary_nodes WHERE type = 'inventory_category' AND name = 'Despiece'").get()
  const integrityAfter = after.prepare('PRAGMA integrity_check').get().integrity_check
  const fk = after.prepare('PRAGMA foreign_key_check').all()
  after.close()

  assert(productsAfter === productsBefore, `Productos cambiaron: ${productsBefore} -> ${productsAfter}`)
  assert(ordersAfter === ordersBefore, `OT cambiaron: ${ordersBefore} -> ${ordersAfter}`)
  assert(invoicesAfter === invoicesBefore, `Facturas cambiaron: ${invoicesBefore} -> ${invoicesAfter}`)
  assert(version === 19, `Versión de esquema: ${version}`)
  for (const column of [
    'warranty_of_order_id',
    'warranty_claim_reason',
    'warranty_checks_json',
    'warranty_result',
    'abandoned_at',
    'disassembly_product_id'
  ]) {
    assert(orderColumns.includes(column), `Falta work_orders.${column}`)
  }
  assert(itemColumns.includes('warranty_covered'), 'Falta work_order_items.warranty_covered')
  assert(Boolean(loginTable), 'Falta login_attempts')
  assert(Boolean(abandonedStatus), 'Falta estado abandonado')
  assert(Boolean(despiece), 'Falta categoría Despiece')
  assert(integrityAfter === 'ok', `Integridad posterior: ${integrityAfter}`)
  assert(fk.length === 0, `Llaves foráneas: ${JSON.stringify(fk)}`)

  console.log(
    `MIGRATION 1.18.0 OK · versión ${version} · ${ordersAfter} OT · ${invoicesAfter} factura · ${productsAfter} productos`
  )
  console.log('ROOT=' + root)
})().catch((error) => {
  console.error('FAIL migración 1.18.0 -', error?.stack || error)
  process.exit(1)
})
