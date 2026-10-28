const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.12.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

let app
let page
let ownerToken
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function rpcRaw(command, payload = {}, token = ownerToken) {
  return page.evaluate(
    async ({ command, payload, token }) => {
      const body = token ? { ...payload, __token: token } : payload
      return window.bitacoretech.rpc(command, body)
    },
    { command, payload, token }
  )
}
async function rpc(command, payload = {}, token = ownerToken) {
  const response = await rpcRaw(command, payload, token)
  if (!response.ok) throw new Error(`${command}: ${response.error.code} ${response.error.message}`)
  return response.data
}

;(async () => {
  const packagedExe = process.env.BITACORETECH_PACKAGED_EXE
  app = await electron.launch({
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
  page = await app.firstWindow()
  await page.getByText('Configura tu taller', { exact: true }).waitFor({ timeout: 30000 })
  await page.getByPlaceholder('Nombre y apellido').fill('Owner Promo Test')
  await page.locator('input[placeholder="BitacoreTech"]').fill('Taller Promo Test')
  await page.getByPlaceholder('usuario').fill('ownerpromo')
  await page.locator('input[type="password"]').nth(0).fill('Owner12345')
  await page.locator('input[type="password"]').nth(1).fill('Owner12345')
  await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
  await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
  ownerToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
  check('primer arranque y sesión', Boolean(ownerToken))

  const settings = await rpc('settings.updateSection', { section: 'catalog', value: { autoPublish: false } })
  check('configuración de catálogo disponible', settings.catalog && settings.catalog.autoPublish === false)
  const targetPath = path.join(root, 'catalog-web')
  const catalogConfigured = await rpc('settings.updateSection', {
    section: 'catalog',
    value: { targetPath, autoPublish: false }
  })
  check('carpeta de publicación configurada', catalogConfigured.catalog?.targetPath === targetPath)

  const product = await rpc('inventory.create', {
    name: 'Auriculares Promo Test',
    price: 60000,
    cost: 40000,
    stock: 10,
    category: 'Accesorios',
    location: 'Mostrador',
    condition: 'Nuevo',
    origin: 'Proveedor',
    warrantyDays: 30,
    rotation: 'rotativo',
    alertEnabled: false,
    publishWeb: true,
    service: false
  })
  check('producto de prueba creado', Boolean(product.id), product.sku)

  const secondProduct = await rpc('inventory.create', {
    name: 'Producto Bajo Costo Test',
    price: 10000,
    cost: 9000,
    stock: 5,
    category: 'Accesorios',
    location: 'Mostrador',
    condition: 'Nuevo',
    origin: 'Proveedor',
    warrantyDays: 30,
    rotation: 'rotativo',
    alertEnabled: false,
    publishWeb: true,
    service: false
  })
  check('segundo producto creado', Boolean(secondProduct.id), secondProduct.sku)

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
  const end = '2026-12-31'
  const percentPromo = await rpc('promotions.create', {
    name: 'Promo 15% Test',
    description: 'Prueba de promoción',
    discountType: 'percent',
    discountPercent: 15,
    startsOn: today,
    endsOn: end,
    active: true,
    publishWeb: true,
    priority: 10,
    allowBelowCost: false,
    targets: [{ type: 'sku', productId: product.id }]
  })
  check('promoción porcentual creada', percentPromo.status === 'activa' && percentPromo.affectedCount === 1)

  const generalPromo = await rpc('promotions.create', {
    name: 'Promo general 5% Test',
    discountType: 'percent',
    discountPercent: 5,
    startsOn: today,
    endsOn: end,
    active: true,
    publishWeb: true,
    priority: 1,
    allowBelowCost: false,
    targets: []
  })
  check('promoción general creada', generalPromo.scope === 'all')

  const products = await rpc('inventory.list')
  const priced = products.find((item) => item.id === product.id)
  check('prioridad y precio en producto', priced?.promotion?.price === 51000, JSON.stringify(priced?.promotion))

  const belowPreview = await rpc('promotions.preview', {
    name: 'Promo bajo costo Test',
    discountType: 'percent',
    discountPercent: 50,
    startsOn: today,
    endsOn: end,
    active: true,
    publishWeb: true,
    priority: 0,
    allowBelowCost: false,
    targets: [{ type: 'sku', productId: secondProduct.id }]
  })
  check('vista previa detecta bajo costo', belowPreview.belowCostCount === 1)

  const belowError = await rpcRaw('promotions.create', {
    name: 'Promo bajo costo Test',
    discountType: 'percent',
    discountPercent: 50,
    startsOn: today,
    endsOn: end,
    active: true,
    publishWeb: true,
    priority: 0,
    allowBelowCost: false,
    targets: [{ type: 'sku', productId: secondProduct.id }]
  })
  check('bloquea bajo costo sin autorización', !belowError.ok && belowError.error.code === 'PROMOTION_BELOW_COST')

  const belowPromo = await rpc('promotions.create', {
    name: 'Promo bajo costo Test',
    discountType: 'percent',
    discountPercent: 50,
    startsOn: today,
    endsOn: end,
    active: true,
    publishWeb: true,
    priority: 0,
    allowBelowCost: true,
    targets: [{ type: 'sku', productId: secondProduct.id }]
  })
  check('permite bajo costo autorizado', belowPromo.allowBelowCost === true && belowPromo.belowCostCount === 1)
  const notifications = await rpc('notifications.list')
  check('aviso de promoción bajo costo', notifications.some((item) => item.id === 'promotions-below-cost'))

  const customers = await rpc('customers.list')
  let customer = customers.find((item) => item.isFinalConsumer) ?? customers[0]
  if (!customer) {
    customer = await rpc('customers.create', {
      name: 'Cliente Promo Test',
      documentType: 'CC',
      document: '90000001',
      phone: '3000000000',
      email: 'promo@test.co',
      address: 'Medellín'
    })
  }
  await rpc('cash.open', { initialAmount: 0 })

  const sale = await rpc('pos.sell', {
    customerId: customer.id,
    lines: [{ productId: product.id, quantity: 1 }],
    method: 'Efectivo',
    discountValue: 0,
    received: 51000
  })
  check('venta POS aplica promoción', sale.invoice.total === 51000, `total=${sale.invoice.total}`)
  const saleLine = sale.invoice.lines[0]
  check(
    'línea de venta conserva precio original y promoción',
    saleLine.unitPrice === 51000 && saleLine.originalUnitPrice === 60000 && saleLine.promotionName === 'Promo 15% Test',
    JSON.stringify(saleLine)
  )

  const stackError = await rpcRaw('pos.sell', {
    customerId: customer.id,
    lines: [{ productId: product.id, quantity: 1 }],
    method: 'Efectivo',
    discountValue: 1000,
    received: 50000
  })
  check('bloquea acumulación con descuento manual', !stackError.ok && stackError.error.code === 'PROMOTION_NO_STACK')

  const catalogPublish = await rpc('catalog.publish')
  check('publicación local del catálogo', catalogPublish.ok === true, catalogPublish.error || '')
  const catalogFile = path.join(targetPath, 'data', 'catalog.json')
  const published = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
  const publishedProduct = published.products.find((item) => item.id === product.id)
  check('catálogo publicado con promoción', publishedProduct?.price === 51000 && publishedProduct?.promotion?.name === 'Promo 15% Test', JSON.stringify(publishedProduct?.promotion))

  await rpc('settings.updateSection', { section: 'catalog', value: { autoPublish: true } })
  const beforeAutoPublish = fs.statSync(catalogFile).mtimeMs
  await rpc('promotions.toggle', { id: percentPromo.id, active: true })
  await new Promise((resolve) => setTimeout(resolve, 2600))
  const afterAutoPublish = fs.statSync(catalogFile).mtimeMs
  check('publicación automática después de cambios', afterAutoPublish > beforeAutoPublish)
  await rpc('settings.updateSection', { section: 'catalog', value: { autoPublish: false } })

  await rpc('users.create', {
    name: 'Tecnico Promo Test',
    username: 'tecpromo',
    email: 'tec@test.co',
    role: 'tecnico',
    password: 'Tecnico12345'
  })
  const techLogin = await rpc('auth.login', { username: 'tecpromo', password: 'Tecnico12345' })
  const techList = await rpcRaw('promotions.list', {}, techLogin.token)
  check('técnico puede ver promociones', techList.ok === true)
  const techCreate = await rpcRaw('promotions.create', {
    name: 'No permitida',
    discountType: 'percent',
    discountPercent: 5,
    targets: []
  }, techLogin.token)
  check('técnico no puede modificar promociones', !techCreate.ok && techCreate.error.code === 'FORBIDDEN')

  await page.evaluate((token) => sessionStorage.setItem('bitacoretech.session.token', token), ownerToken)
  await page.reload()
  await page.getByRole('link', { name: 'Promociones' }).click()
  await page.getByRole('heading', { name: 'Promociones' }).waitFor({ timeout: 20000 })
  await page.getByText('Promo 15% Test', { exact: true }).first().waitFor({ timeout: 20000 })
  await page.screenshot({ path: path.join(shots, 'promociones.png') })
  check('interfaz de promociones visible', true)

  await page.getByText('Configuración', { exact: true }).first().click()
  await page.getByText('Catálogo web', { exact: true }).first().click()
  await page.getByText('Supabase Storage', { exact: true }).first().waitFor({ timeout: 20000 })
  await page.screenshot({ path: path.join(shots, 'catalogo-web.png') })
  check('interfaz de catálogo web visible', true)

  console.log(`\nRESULT ${results.filter((item) => item.ok).length}/${results.length} OK`)
  console.log(`SHOTS ${shots}`)
  await app.close()
})().catch(async (error) => {
  console.error(error)
  try { await app?.close() } catch {}
  process.exit(1)
})
