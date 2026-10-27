const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root =
  process.env.BITACORETECH_MIGRATION_ROOT ||
  path.join(os.tmpdir(), 'bitacoretech-migration', '1.11.0')
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
  const productColumns = columns(after, 'products')
  const dictionaryColumns = columns(after, 'dictionary_nodes')
  const invoiceColumns = columns(after, 'invoices')
  const supplierPaymentColumns = columns(after, 'supplier_payments')
  const paymentColumns = columns(after, 'payments')
  const cashSessionColumns = columns(after, 'cash_sessions')
  const newTables = after
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('payment_receipts','cash_transfers','account_movements')"
    )
    .all()
    .map((row) => row.name)
  const incomeAccounts = after
    .prepare("SELECT COUNT(*) AS count FROM dictionary_nodes WHERE type = 'income_account' AND active = 1")
    .get().count
  const purchaseAccounts = after
    .prepare("SELECT COUNT(*) AS count FROM dictionary_nodes WHERE type = 'purchase_payment_account'")
    .get().count
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
  const supplierPaymentsTable = after
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'supplier_payments'")
    .get()
  const paymentTotals = after
    .prepare(
      `SELECT COUNT(*) AS count,
              SUM(CASE WHEN paid_cents < 0 OR balance_cents < 0 THEN 1 ELSE 0 END) AS negatives,
              SUM(CASE WHEN paid_cents + balance_cents <> total_cents THEN 1 ELSE 0 END) AS mismatches
       FROM purchases`
    )
    .get()
  const supplierPaymentMismatch = Number(
    after
      .prepare(
        `SELECT COUNT(*) AS count
         FROM purchases p
         WHERE p.paid_cents <> COALESCE(
           (SELECT SUM(sp.amount_cents) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0
         )`
      )
      .get().count
  )
  const supplierPayments = Number(
    after.prepare('SELECT COUNT(*) AS count FROM supplier_payments').get().count
  )
  after.close()

  assert(integrityAfter === 'ok', `La base migrada no está íntegra: ${integrityAfter}`)
  assert(foreignKeys.length === 0, `La base migrada tiene claves foráneas rotas: ${JSON.stringify(foreignKeys)}`)
  assert(versions.includes(10), 'Falta la migración 10')
  assert(versions.includes(11), 'Falta la migración 11')
  assert(versions.includes(12), 'Falta la migración 12')
  assert(versions.includes(13), 'Falta la migración 13')
  assert(purchaseColumns.some((row) => row.name === 'discount_cents'), 'Falta purchases.discount_cents')
  assert(purchaseColumns.some((row) => row.name === 'adjustment_cents'), 'Falta purchases.adjustment_cents')
  assert(purchaseColumns.some((row) => row.name === 'ai_metadata_json'), 'Falta purchases.ai_metadata_json')
  assert(purchaseColumns.some((row) => row.name === 'payment_status'), 'Falta purchases.payment_status')
  assert(purchaseColumns.some((row) => row.name === 'payment_method'), 'Falta purchases.payment_method')
  assert(purchaseColumns.some((row) => row.name === 'paid_cents'), 'Falta purchases.paid_cents')
  assert(purchaseColumns.some((row) => row.name === 'balance_cents'), 'Falta purchases.balance_cents')
  assert(purchaseColumns.some((row) => row.name === 'due_date'), 'Falta purchases.due_date')
  assert(purchaseItemColumns.some((row) => row.name === 'iva_rate'), 'Falta purchase_items.iva_rate')
  assert(purchaseItemColumns.some((row) => row.name === 'iva_cents'), 'Falta purchase_items.iva_cents')
  assert(purchaseItemColumns.some((row) => row.name === 'supplier_sku'), 'Falta purchase_items.supplier_sku')
  assert(purchaseItemColumns.some((row) => row.name === 'serial_text'), 'Falta purchase_items.serial_text')
  assert(productColumns.some((row) => row.name === 'supplier_sku'), 'Falta products.supplier_sku')
  assert(productColumns.some((row) => row.name === 'image_path'), 'Falta products.image_path')
  assert(
    productColumns.some((row) => row.name === 'image_thumb_path'),
    'Falta products.image_thumb_path'
  )
  assert(
    productColumns.some((row) => row.name === 'image_updated_at'),
    'Falta products.image_updated_at'
  )
  assert(dictionaryColumns.some((row) => row.name === 'channel'), 'Falta dictionary_nodes.channel')
  assert(
    dictionaryColumns.some((row) => row.name === 'responsible_user_id'),
    'Falta dictionary_nodes.responsible_user_id'
  )
  assert(
    dictionaryColumns.some((row) => row.name === 'linked_income_account_id'),
    'Falta dictionary_nodes.linked_income_account_id'
  )
  assert(invoiceColumns.some((row) => row.name === 'created_by_name'), 'Falta invoices.created_by_name')
  assert(invoiceColumns.some((row) => row.name === 'created_by_role'), 'Falta invoices.created_by_role')
  assert(purchaseColumns.some((row) => row.name === 'created_by_name'), 'Falta purchases.created_by_name')
  assert(purchaseColumns.some((row) => row.name === 'created_by_role'), 'Falta purchases.created_by_role')
  assert(purchaseColumns.some((row) => row.name === 'payment_account'), 'Falta purchases.payment_account')
  assert(
    purchaseColumns.some((row) => row.name === 'payment_account_id'),
    'Falta purchases.payment_account_id'
  )
  assert(
    supplierPaymentColumns.some((row) => row.name === 'payment_account'),
    'Falta supplier_payments.payment_account'
  )
  assert(
    supplierPaymentColumns.some((row) => row.name === 'payment_account_id'),
    'Falta supplier_payments.payment_account_id'
  )
  assert(paymentColumns.some((row) => row.name === 'income_account_id'), 'Falta payments.income_account_id')
  assert(paymentColumns.some((row) => row.name === 'income_account_name'), 'Falta payments.income_account_name')
  assert(paymentColumns.some((row) => row.name === 'created_by_role'), 'Falta payments.created_by_role')
  assert(
    cashSessionColumns.some((row) => row.name === 'carry_over_cents'),
    'Falta cash_sessions.carry_over_cents'
  )
  assert(newTables.includes('payment_receipts'), 'Falta payment_receipts')
  assert(newTables.includes('cash_transfers'), 'Falta cash_transfers')
  assert(newTables.includes('account_movements'), 'Falta account_movements')
  assert(Number(incomeAccounts) === 1, `Cuentas de ingreso activas: ${incomeAccounts}`)
  assert(Number(purchaseAccounts) >= 3, `Cuentas de compra: ${purchaseAccounts}`)
  assert(Boolean(supplierPaymentsTable), 'Falta la tabla supplier_payments')
  assert(!/number\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(purchasesSql), 'La tabla purchases conserva UNIQUE global')
  assert(lookupIndex && Number(lookupIndex.unique) === 0, 'Falta el índice no único proveedor + número')
  assert(ivaMissing === 0, `Hay ${ivaMissing} ítems de compra sin IVA migrado`)
  assert(Number(paymentTotals.negatives ?? 0) === 0, 'Hay pagos o saldos negativos')
  assert(Number(paymentTotals.mismatches ?? 0) === 0, 'Hay compras donde pagado + saldo no coincide con el total')
  assert(supplierPaymentMismatch === 0, 'Hay compras cuyo pagado no coincide con la suma de abonos')
  assert(
    JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
    `Cambiaron los registros: antes ${JSON.stringify(countsBefore)} después ${JSON.stringify(countsAfter)}`
  )

  console.log('PASS esquema 13, cuentas, trazabilidad y comprobantes')
  console.log('PASS esquema 11, SKU proveedor, seriales, pago y crédito')
  console.log('PASS backfill de pagos y consistencia pagado + saldo')
  console.log('PASS unicidad global retirada e índice proveedor + número')
  console.log('PASS integridad, claves foráneas y conservación de datos')
  console.log(`COUNTS ${JSON.stringify(countsAfter)}`)
  console.log(`VERSIONS ${versions.join(',')}`)
  console.log('ROOT=' + root)
})().catch((error) => {
  console.error('FAIL migración 1.11.0 -', error?.stack || error)
  process.exit(1)
})
