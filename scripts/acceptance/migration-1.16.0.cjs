const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root =
  process.env.BITACORETECH_MIGRATION_ROOT ||
  path.join(os.tmpdir(), 'bitacoretech-migration', '1.16.0')
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
  const tables = ['users', 'customers', 'work_orders', 'products', 'invoices', 'payments']
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
  const customerColumns = columns(after, 'customers').map((row) => row.name)
  const invoiceColumns = columns(after, 'invoices').map((row) => row.name)
  const modules = after
    .prepare("SELECT role, allowed FROM role_modules WHERE module = 'receivables'")
    .all()
  const missingDueDates = Number(
    after
      .prepare(
        "SELECT COUNT(*) AS count FROM invoices WHERE credit_authorized = 1 AND (due_date IS NULL OR due_date = '')"
      )
      .get().count
  )
  after.close()

  for (const table of tables) {
    assert(
      countsAfter[table] >= countsBefore[table],
      `Se perdió información en ${table}: ${countsBefore[table]} -> ${countsAfter[table]}`
    )
  }
  assert(integrityAfter === 'ok', `Integridad posterior: ${integrityAfter}`)
  assert(foreignKeys.length === 0, `Llaves foráneas rotas: ${foreignKeys.length}`)
  assert(versions.includes(16), 'Falta la migración 16')
  assert(versions.includes(17), 'Falta la migración 17')
  assert(customerColumns.includes('credit_limit_cents'), 'Falta customers.credit_limit_cents')
  assert(customerColumns.includes('credit_days'), 'Falta customers.credit_days')
  assert(invoiceColumns.includes('due_date'), 'Falta invoices.due_date')
  assert(modules.some((row) => row.role === 'admin'), 'Falta el módulo de cartera para admin')
  assert(modules.some((row) => row.role === 'cajero'), 'Falta el módulo de cartera para cajero')
  assert(missingDueDates === 0, `Facturas a crédito sin vencimiento: ${missingDueDates}`)

  console.log(
    `MIGRATION 1.16.0 OK · versión ${Math.max(...versions)} · ${JSON.stringify(countsAfter)} · módulos ${JSON.stringify(modules)}`
  )
  console.log('ROOT=' + root)
})().catch((error) => {
  console.error('FAIL migración 1.16.0 -', error?.stack || error)
  process.exit(1)
})
