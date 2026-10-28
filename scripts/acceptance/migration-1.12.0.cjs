const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const source = process.env.BITACORETECH_DB || path.join(process.env.APPDATA, 'BitacoreTech', 'bitacoretech.db')
const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', 'migration-1.12.0')
const data = path.join(root, 'data')
const target = path.join(data, 'bitacoretech.db')

if (!fs.existsSync(source)) {
  console.error(`No se encontró la base real: ${source}`)
  process.exit(1)
}

fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(data, { recursive: true })

const sourceDb = new DatabaseSync(source, { readOnly: true })
sourceDb.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
sourceDb.close()

function counts(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  const tables = ['products', 'customers', 'work_orders', 'invoices', 'invoice_items', 'purchases', 'users']
  const result = Object.fromEntries(
    tables.map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c)])
  )
  db.close()
  return result
}

const before = counts(target)

;(async () => {
  const app = await electron.launch({
    executablePath: path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: project,
    env: {
      ...process.env,
      BITACORETECH_DATA_PATH: data,
      BITACORETECH_LEGACY_DATA_PATH: path.join(root, 'legacy'),
      BITACORETECH_TEST_PATHS: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 90000
  })
  await app.firstWindow()
  await new Promise((resolve) => setTimeout(resolve, 2500))
  await app.close()
})().then(() => {
  const db = new DatabaseSync(target, { readOnly: true })
  const after = counts(target)
  const version = Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v)
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
  const foreign = db.prepare('PRAGMA foreign_key_check').all()
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name)
  )
  const columns = (table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)
  const promoColumns = columns('promotions')
  const itemColumns = columns('invoice_items')
  const productColumns = columns('products')
  db.close()

  const errors = []
  if (version !== 14) errors.push(`schema version ${version}`)
  if (integrity !== 'ok') errors.push(`integrity ${integrity}`)
  if (foreign.length) errors.push(`foreign keys ${foreign.length}`)
  if (!tables.has('promotions') || !tables.has('promotion_targets')) errors.push('faltan tablas de promociones')
  if (!productColumns.includes('publish_web')) errors.push('falta products.publish_web')
  if (!itemColumns.includes('promotion_id') || !itemColumns.includes('original_unit_price_cents')) {
    errors.push('faltan columnas de promoción en invoice_items')
  }
  for (const key of ['id', 'name', 'scope', 'discount_type', 'starts_on', 'ends_on', 'publish_web', 'priority']) {
    if (!promoColumns.includes(key)) errors.push(`falta promotions.${key}`)
  }
  for (const key of Object.keys(before)) {
    if (after[key] !== before[key]) errors.push(`${key}: ${before[key]} -> ${after[key]}`)
  }
  if (errors.length) {
    console.error(`MIGRATION 1.12.0 FAIL: ${errors.join(' | ')}`)
    process.exit(1)
  }
  console.log(`MIGRATION 1.12.0 OK · versión ${version} · ${JSON.stringify(after)}`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
