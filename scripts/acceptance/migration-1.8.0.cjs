const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root =
  process.env.BITACORETECH_MIGRATION_ROOT ||
  path.join(os.tmpdir(), 'bitacoretech-migration', '1.8.0')
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

function canAccess(db, role, capability) {
  return db
    .prepare('SELECT allowed FROM role_permissions WHERE role = ? AND capability = ?')
    .get(role, capability)?.allowed
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
  const itemColumns = columns(after, 'work_order_items')
  const dictionaryCount = tableCount(after, 'dictionary_nodes')
  const adminBusiness = canAccess(after, 'admin', 'configureBusiness')
  const adminPermissions = canAccess(after, 'admin', 'managePermissions')
  const ownerOnlyLegal = canAccess(after, 'admin', 'configureLegal')
  after.close()

  assert(integrityAfter === 'ok', `La base migrada no está íntegra: ${integrityAfter}`)
  assert(foreignKeys.length === 0, `La base migrada tiene claves foráneas rotas: ${JSON.stringify(foreignKeys)}`)
  assert(versions.includes(8), 'Falta la migración 8')
  const warrantyColumn = itemColumns.find((row) => row.name === 'warranty_days')
  assert(warrantyColumn, 'Falta work_order_items.warranty_days')
  assert(Number(warrantyColumn.dflt_value) === 0, 'warranty_days no tiene valor por defecto 0')
  assert(dictionaryCount > 50, `Se perdieron los diccionarios: ${dictionaryCount}`)
  assert(Number(adminBusiness) === 1, 'El admin no recibió configureBusiness')
  assert(Number(adminPermissions) === 1, 'El admin no recibió managePermissions')
  assert(Number(ownerOnlyLegal) === 0, 'configureLegal se delegó al admin en la migración')
  assert(
    JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
    `Cambiaron los registros: antes ${JSON.stringify(countsBefore)} después ${JSON.stringify(countsAfter)}`
  )

  console.log('PASS esquema 8 y columna warranty_days')
  console.log('PASS nuevas capacidades de negocio y permisos para admin')
  console.log('PASS integridad, claves foráneas y conservación de datos')
  console.log(`COUNTS ${JSON.stringify(countsAfter)}`)
  console.log(`DICTIONARIES ${dictionaryCount}`)
  console.log(`VERSIONS ${versions.join(',')}`)
  console.log('ROOT=' + root)
})().catch((error) => {
  console.error('FAIL migración 1.8.0 —', error?.stack || error)
  process.exit(1)
})
