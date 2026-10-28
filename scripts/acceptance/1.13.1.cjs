const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.13.1')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const catalogTarget = path.join(root, 'catalog-web')
const shots = path.join(root, 'shots')
const results = []

fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function main() {
  let app
  let page
  let ownerToken

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
  function readCatalog() {
    return JSON.parse(
      fs.readFileSync(path.join(catalogTarget, 'data', 'catalog.json'), 'utf8')
    )
  }

  try {
    app = await electron.launch({
      executablePath:
        process.env.BITACORETECH_PACKAGED_EXE ||
        path.join(project, 'node_modules/electron/dist/electron.exe'),
      args: process.env.BITACORETECH_PACKAGED_EXE ? [] : ['.'],
      cwd: process.env.BITACORETECH_PACKAGED_EXE
        ? path.dirname(process.env.BITACORETECH_PACKAGED_EXE)
        : project,
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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner 1.13.1')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.13.1')
    await page.getByPlaceholder('usuario').fill('owner1131')
    await page.locator('input[type="password"]').nth(0).fill('Owner12345')
    await page.locator('input[type="password"]').nth(1).fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    ownerToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    check('primer arranque y sesión', Boolean(ownerToken))

    const catalogConfig = await rpc('settings.updateSection', {
      section: 'catalog',
      value: { targetPath: catalogTarget, autoPublish: false }
    })
    check('configuración local disponible', catalogConfig.catalog.targetPath === catalogTarget)
    check(
      'stock oculto por defecto',
      catalogConfig.catalog.stockVisibility === 'outOnly',
      catalogConfig.catalog.stockVisibility
    )

    const baseProduct = {
      price: 50000,
      cost: 30000,
      stock: 3,
      category: 'Accesorios',
      location: 'Mostrador',
      origin: 'Proveedor',
      warrantyDays: 30,
      rotation: 'rotativo',
      alertEnabled: false,
      service: false
    }
    const nuevo = await rpc('inventory.create', {
      ...baseProduct,
      name: 'Nuevo 1.13.1',
      condition: 'Nuevo'
    })
    const reacondicionado = await rpc('inventory.create', {
      ...baseProduct,
      name: 'Reacondicionado 1.13.1',
      condition: 'Reacondicionado'
    })
    const usado = await rpc('inventory.create', {
      ...baseProduct,
      name: 'Usado 1.13.1',
      condition: 'Usado'
    })
    const usadoPublicado = await rpc('inventory.create', {
      ...baseProduct,
      name: 'Usado publicado 1.13.1',
      condition: 'Usado',
      publishWeb: true
    })
    const oculto = await rpc('inventory.create', {
      ...baseProduct,
      name: 'Nuevo oculto 1.13.1',
      condition: 'Nuevo',
      publishWeb: false
    })

    check('Nuevo se publica por defecto', nuevo.publishWeb === true)
    check('Reacondicionado se publica por defecto', reacondicionado.publishWeb === true)
    check('Usado se oculta por defecto', usado.publishWeb === false)
    check('Usado no se publica aunque se marque', usadoPublicado.publishWeb === false)
    check('Nuevo puede ocultarse manualmente', oculto.publishWeb === false)

    const forcedUsed = await rpc('inventory.update', {
      id: usado.id,
      publishWeb: true
    })
    check('Actualizar un usado no fuerza la web', forcedUsed.publishWeb === false)

    const published = await rpc('catalog.publish')
    check('publicación local correcta', published.ok === true, published.error ?? '')
    let catalog = readCatalog()
    const ids = new Set(catalog.products.map((product) => product.id))
    check('catálogo incluye Nuevo', ids.has(nuevo.id))
    check('catálogo incluye Reacondicionado', ids.has(reacondicionado.id))
    check('catálogo omite Usado por defecto', !ids.has(usado.id))
    check('catálogo omite Usado marcado manualmente', !ids.has(usadoPublicado.id))
    check('catálogo omite Nuevo desmarcado', !ids.has(oculto.id))
    check('catálogo publica stockVisibility', catalog.stockVisibility === 'outOnly')

    const always = await rpc('settings.updateSection', {
      section: 'catalog',
      value: { stockVisibility: 'always' }
    })
    check('configuración de stock se guarda', always.catalog.stockVisibility === 'always')
    await rpc('catalog.publish')
    catalog = readCatalog()
    check('catálogo publica stockVisibility always', catalog.stockVisibility === 'always')

    const usedEdit = await rpc('inventory.update', {
      id: nuevo.id,
      condition: 'Usado'
    })
    check('cambio a Usado despublica automáticamente', usedEdit.publishWeb === false)
    await rpc('catalog.publish')
    catalog = readCatalog()
    check('cambio a Usado sale del catálogo', !catalog.products.some((product) => product.id === nuevo.id))

    const republished = await rpc('inventory.update', {
      id: nuevo.id,
      condition: 'Nuevo',
      publishWeb: true
    })
    check('cambio a Nuevo permite republicar', republished.publishWeb === true)
    await rpc('catalog.publish')
    catalog = readCatalog()
    check('referencia republicada aparece', catalog.products.some((product) => product.id === nuevo.id))

    await page.getByText(/Configuraci/).first().click()
    await page.getByText(/Cat.logo web/).first().click()
    await page.getByText('Stock en la web', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.screenshot({ path: path.join(shots, 'catalogo-web-stock.png') })
    check('interfaz de stock visible', true)

    console.log(`\nRESULT ${results.filter((item) => item.ok).length}/${results.length} OK`)
    console.log(`SHOTS ${shots}`)
  } finally {
    try {
      await app?.close()
    } catch {
      // La app ya estaba cerrada.
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
