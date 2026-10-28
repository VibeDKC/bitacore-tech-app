const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root =
  process.env.BITACORETECH_MIGRATION_ROOT ||
  path.join(os.tmpdir(), 'bitacoretech-migration', '1.17.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const source =
  process.env.BITACORETECH_SOURCE_DB ||
  path.join(process.env.APPDATA || '', 'BitacoreTech', 'bitacoretech.db')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function count(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.c ?? 0)
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
    if (fs.existsSync(`${source}${suffix}`)) {
      fs.copyFileSync(`${source}${suffix}`, path.join(data, `bitacoretech.db${suffix}`))
    }
  }

  const before = new DatabaseSync(path.join(data, 'bitacoretech.db'))
  const beforeProducts = count(before, 'SELECT COUNT(*) AS c FROM products')
  const beforeImages = count(
    before,
    "SELECT COUNT(*) AS c FROM products WHERE image_path IS NOT NULL AND image_path <> ''"
  )
  const integrityBefore = before.prepare('PRAGMA integrity_check').get().integrity_check
  before.close()
  assert(integrityBefore === 'ok', `Copia inicial no íntegra: ${integrityBefore}`)

  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.bitacoretech), null, { timeout: 30000 })
    await page
      .getByText('Bienvenido de nuevo', { exact: true })
      .or(page.getByText('Configura tu taller', { exact: true }))
      .first()
      .waitFor({ timeout: 20000 })
    console.log('PASS la base migrada abre correctamente')
  } finally {
    await app.close().catch(() => {})
  }

  const after = new DatabaseSync(path.join(data, 'bitacoretech.db'))
  const afterProducts = count(after, 'SELECT COUNT(*) AS c FROM products')
  const galleryImages = count(after, 'SELECT COUNT(*) AS c FROM product_images')
  const missingSlugs = count(
    after,
    "SELECT COUNT(*) AS c FROM products WHERE slug IS NULL OR slug = ''"
  )
  const duplicateSlugs = count(
    after,
    'SELECT COUNT(*) AS c FROM (SELECT slug FROM products GROUP BY slug HAVING COUNT(*) > 1)'
  )
  const wrongCover = count(
    after,
    `SELECT COUNT(*) AS c FROM products p
     WHERE p.image_path IS NOT NULL AND p.image_path <> ''
       AND NOT EXISTS (
         SELECT 1 FROM product_images pi
         WHERE pi.product_id = p.id AND pi.is_cover = 1 AND pi.image_path = p.image_path
       )`
  )
  const version = Number(after.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v)
  const columns = after.prepare('PRAGMA table_info(products)').all().map((row) => row.name)
  const integrityAfter = after.prepare('PRAGMA integrity_check').get().integrity_check
  after.close()

  assert(afterProducts === beforeProducts, `Productos cambiaron: ${beforeProducts} -> ${afterProducts}`)
  assert(galleryImages >= beforeImages, `Galería insuficiente: ${galleryImages} < ${beforeImages}`)
  assert(missingSlugs === 0, `Productos sin slug: ${missingSlugs}`)
  assert(duplicateSlugs === 0, `Slugs duplicados: ${duplicateSlugs}`)
  assert(wrongCover === 0, `Portadas no sincronizadas: ${wrongCover}`)
  assert(version === 18, `Versión de esquema: ${version}`)
  assert(columns.includes('description'), 'Falta products.description')
  assert(columns.includes('internal_notes'), 'Falta products.internal_notes')
  assert(columns.includes('slug'), 'Falta products.slug')
  assert(integrityAfter === 'ok', `Integridad posterior: ${integrityAfter}`)

  console.log(
    `MIGRATION 1.17.0 OK · versión ${version} · ${afterProducts} productos · ${galleryImages} imágenes de galería`
  )
  console.log('ROOT=' + root)
})().catch((error) => {
  console.error('FAIL migración 1.17.0 -', error?.stack || error)
  process.exit(1)
})
