const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.13.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVChTY/hPJGBAF8AFRhXiBUQrBAAj+46AaYVdLAAAAABJRU5ErkJggg=='
const SECRET = 'sb_secret_test_1234567890abcdef'
const WRONG_SECRET = 'sb_secret_wrong_1234567890abcdef'
const BUCKET = 'catalogo-web'

fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

function startMock() {
  const storage = new Map()
  const stats = { uploads: 0, deletes: 0, lists: 0, unauthorized: 0, lastDeleted: [] }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter(Boolean)
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const authorized =
      req.headers.apikey === SECRET &&
      req.headers.authorization === `Bearer ${SECRET}`
    const guard = () => {
      if (authorized) return true
      stats.unauthorized += 1
      json(401, { message: 'Invalid API key' })
      return false
    }
    const readBody = async () => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      return Buffer.concat(chunks)
    }

    if (parts[0] === 'storage' && parts[1] === 'v1') {
      if (parts[2] === 'bucket' && parts[3] === BUCKET && req.method === 'GET') {
        if (!guard()) return
        return json(200, { id: BUCKET, name: BUCKET, public: true })
      }
      if (parts[2] === 'object' && parts[3] === 'list' && parts[4] === BUCKET && req.method === 'POST') {
        if (!guard()) return
        stats.lists += 1
        const body = JSON.parse((await readBody()).toString('utf8') || '{}')
        const prefix = String(body.prefix || '')
        const limit = Number(body.limit || 100)
        const offset = Number(body.offset || 0)
        const names = [...storage.keys()]
          .filter((name) => name === prefix || name.startsWith(`${prefix}/`))
          .sort()
        const page = names.slice(offset, offset + limit).map((name) => ({
          name,
          id: name,
          metadata: { size: storage.get(name).body.length }
        }))
        return json(200, page)
      }
      if (parts[2] === 'object' && parts[3] === 'public' && parts[4] === BUCKET && req.method === 'GET') {
        const objectPath = parts.slice(5).map(decodeURIComponent).join('/')
        const object = storage.get(objectPath)
        if (!object) return json(404, { message: 'Object not found' })
        res.writeHead(200, {
          'Content-Type': object.contentType,
          'Cache-Control': 'no-cache'
        })
        return res.end(object.body)
      }
      if (parts[2] === 'object' && parts[3] === BUCKET && req.method === 'POST') {
        if (!guard()) return
        const objectPath = parts.slice(4).map(decodeURIComponent).join('/')
        const body = await readBody()
        storage.set(objectPath, {
          body,
          contentType: String(req.headers['content-type'] || 'application/octet-stream')
        })
        stats.uploads += 1
        return json(200, { Key: objectPath })
      }
      if (parts[2] === 'object' && parts[3] === BUCKET && req.method === 'DELETE') {
        if (!guard()) return
        const body = JSON.parse((await readBody()).toString('utf8') || '{}')
        const prefixes = Array.isArray(body.prefixes) ? body.prefixes : []
        for (const prefix of prefixes) {
          storage.delete(prefix)
          stats.deletes += 1
        }
        stats.lastDeleted = prefixes
        return json(200, { message: 'Deleted' })
      }
    }
    json(404, { message: 'Not found' })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        storage,
        stats,
        baseUrl: `http://127.0.0.1:${address.port}`
      })
    })
  })
}

async function main() {
  const mock = await startMock()
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

  try {
    app = await electron.launch({
      executablePath: process.env.BITACORETECH_PACKAGED_EXE || path.join(project, 'node_modules/electron/dist/electron.exe'),
      args: process.env.BITACORETECH_PACKAGED_EXE ? [] : ['.'],
      cwd: process.env.BITACORETECH_PACKAGED_EXE ? path.dirname(process.env.BITACORETECH_PACKAGED_EXE) : project,
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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner 1.13')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.13')
    await page.getByPlaceholder('usuario').fill('owner113')
    await page.locator('input[type="password"]').nth(0).fill('Owner12345')
    await page.locator('input[type="password"]').nth(1).fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    ownerToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    check('primer arranque y sesión', Boolean(ownerToken))

    const catalogConfig = await rpc('settings.updateSection', {
      section: 'catalog',
      value: { targetPath: path.join(root, 'catalog-web'), autoPublish: false }
    })
    check('configuración local disponible', Boolean(catalogConfig.catalog.targetPath))

    const imageDataUrl = `data:image/png;base64,${PNG_BASE64}`
    const promoProduct = await rpc('inventory.create', {
      name: 'Auriculares 1.13 Test',
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
      service: false,
      imageDataUrl
    })
    const bestSellerProduct = await rpc('inventory.create', {
      name: 'Producto Más Vendido 1.13',
      price: 30000,
      cost: 15000,
      stock: 10,
      category: 'Accesorios',
      location: 'Mostrador',
      condition: 'Nuevo',
      origin: 'Proveedor',
      warrantyDays: 30,
      rotation: 'rotativo',
      alertEnabled: false,
      publishWeb: true,
      service: false,
      imageDataUrl
    })
    const oneSaleProduct = await rpc('inventory.create', {
      name: 'Producto Una Venta 1.13',
      price: 20000,
      cost: 10000,
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
    check('productos de prueba creados', Boolean(promoProduct.id && bestSellerProduct.id && oneSaleProduct.id))
    check('producto con imagen', Boolean(promoProduct.imageUrl), promoProduct.imageUrl || '')

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
    const promo = await rpc('promotions.create', {
      name: 'Promo 1.13 Test',
      discountType: 'percent',
      discountPercent: 15,
      startsOn: today,
      endsOn: '2026-12-31',
      active: true,
      publishWeb: true,
      priority: 10,
      allowBelowCost: false,
      targets: [{ type: 'sku', productId: promoProduct.id }]
    })
    check('promoción creada', promo.status === 'activa')

    const customers = await rpc('customers.list')
    let customer = customers.find((item) => item.isFinalConsumer) ?? customers[0]
    if (!customer) {
      customer = await rpc('customers.create', {
        name: 'Cliente 1.13',
        documentType: 'CC',
        document: '90113001',
        phone: '3000000013',
        email: 'cliente113@test.co',
        address: 'Medellín'
      })
    }
    await rpc('cash.open', { initialAmount: 0 })
    await rpc('pos.sell', {
      customerId: customer.id,
      lines: [{ productId: bestSellerProduct.id, quantity: 2 }],
      method: 'Efectivo',
      discountValue: 0,
      received: 60000
    })
    await rpc('pos.sell', {
      customerId: customer.id,
      lines: [{ productId: oneSaleProduct.id, quantity: 1 }],
      method: 'Efectivo',
      discountValue: 0,
      received: 20000
    })
    check('ventas de prueba registradas', true)

    const configured = await rpc('catalog.configureRemote', {
      enabled: true,
      supabaseUrl: mock.baseUrl,
      bucket: BUCKET
    })
    check('configuración remota guardada', configured.remote.enabled === true && configured.remote.bucket === BUCKET)

    const withSecret = await rpc('catalog.saveSecret', { secret: SECRET })
    check('clave secreta guardada cifrada', withSecret.remote.hasSecret === true)
    const statusJson = JSON.stringify(await rpc('catalog.status'))
    const settingsJson = JSON.stringify(await rpc('settings.get'))
    check('la clave no se expone en estado', !statusJson.includes(SECRET) && !statusJson.includes('secretCipher'))
    check('la clave no se expone en configuración', !settingsJson.includes(SECRET) && !settingsJson.includes('secretCipher'))

    const connection = await rpc('catalog.testConnection')
    check('prueba de conexión Supabase', connection.ok === true && connection.publicBucket === true, connection.message)

    const publish = await rpc('catalog.publishRemote')
    check('publicación remota', publish.ok === true, publish.error || publish.status.remote.lastMessage)
    check('subida de catálogo y órdenes', mock.storage.has('catalog.json') && mock.storage.has('orders-demo.json'))
    check('subida de imágenes', [...mock.storage.keys()].filter((key) => key.startsWith('products/')).length >= 2)

    const remoteCatalog = JSON.parse(mock.storage.get('catalog.json').body.toString('utf8'))
    const remotePromo = remoteCatalog.products.find((item) => item.id === promoProduct.id)
    const remoteBest = remoteCatalog.products.find((item) => item.id === bestSellerProduct.id)
    const remoteOne = remoteCatalog.products.find((item) => item.id === oneSaleProduct.id)
    check('precio promocional remoto', remotePromo?.price === 51000 && remotePromo?.promotion?.name === 'Promo 1.13 Test', JSON.stringify(remotePromo?.promotion))
    check(
      'imagen remota absoluta y versionada',
      typeof remotePromo?.image === 'string' &&
        remotePromo.image.startsWith(`${mock.baseUrl}/storage/v1/object/public/${BUCKET}/products/`) &&
        remotePromo.image.includes('?v='),
      remotePromo?.image
    )
    check('más vendido con 2 unidades', remoteBest?.bestSeller === true && remoteCatalog.bestSellers?.some((item) => item.productId === bestSellerProduct.id && item.quantity === 2))
    check('una venta no marca más vendido', remoteOne?.bestSeller === false)
    check('la clave no viaja en el catálogo', !mock.storage.get('catalog.json').body.toString('utf8').includes(SECRET))
    check(
      'estado remoto actualizado',
      publish.status.remote.lastStatus === 'success' &&
        publish.status.remote.lastProductCount >= 3 &&
        publish.status.remote.lastPromotionCount === 1,
      JSON.stringify(publish.status.remote)
    )

    const publicResponse = await fetch(`${mock.baseUrl}/storage/v1/object/public/${BUCKET}/catalog.json`)
    check('lectura pública del catálogo', publicResponse.ok)

    const imageKey = [...mock.storage.keys()].find((key) => key.startsWith('products/') && key.includes(promoProduct.id))
    check('imagen del producto encontrada', Boolean(imageKey), imageKey || '')
    await rpc('inventory.update', { id: promoProduct.id, removeImage: true })
    const secondPublish = await rpc('catalog.publishRemote')
    check('republicación sin imagen', secondPublish.ok === true, secondPublish.error || '')
    check('limpieza de imagen huérfana', !mock.storage.has(imageKey), imageKey || '')

    const wrongSecret = await rpc('catalog.saveSecret', { secret: WRONG_SECRET })
    check('clave incorrecta guardada para prueba', wrongSecret.remote.hasSecret === true)
    const wrongConnection = await rpc('catalog.testConnection')
    check('conexión rechaza clave incorrecta', wrongConnection.ok === false, wrongConnection.message)
    await rpc('catalog.saveSecret', { secret: SECRET })

    await rpc('settings.updateSection', { section: 'catalog', value: { autoPublish: true } })
    const uploadsBefore = mock.stats.uploads
    await rpc('promotions.toggle', { id: promo.id, active: false })
    await new Promise((resolve) => setTimeout(resolve, 3500))
    const autoCatalog = JSON.parse(mock.storage.get('catalog.json').body.toString('utf8'))
    const autoProduct = autoCatalog.products.find((item) => item.id === promoProduct.id)
    check('publicación automática remota', mock.stats.uploads > uploadsBefore && autoProduct?.price === 60000, `uploads ${uploadsBefore} -> ${mock.stats.uploads}`)
    await rpc('settings.updateSection', { section: 'catalog', value: { autoPublish: false } })

    await rpc('users.create', {
      name: 'Tecnico 1.13',
      username: 'tec113',
      email: 'tec113@test.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const techLogin = await rpc('auth.login', { username: 'tec113', password: 'Tecnico12345' })
    const techPublish = await rpcRaw('catalog.publishRemote', {}, techLogin.token)
    const techSecret = await rpcRaw('catalog.saveSecret', { secret: SECRET }, techLogin.token)
    check('técnico no publica en Supabase', !techPublish.ok && techPublish.error.code === 'FORBIDDEN')
    check('técnico no guarda la clave', !techSecret.ok && techSecret.error.code === 'FORBIDDEN')

    await page.evaluate((token) => sessionStorage.setItem('bitacoretech.session.token', token), ownerToken)
    await page.reload()
    await page.getByText(/Configuraci/).first().click()
    await page.getByText(/Cat.logo web/).first().click()
    await page.getByText('Supabase Storage', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.screenshot({ path: path.join(shots, 'catalogo-web-supabase.png') })
    check('interfaz de Supabase visible', true)

    console.log(`\nRESULT ${results.filter((item) => item.ok).length}/${results.length} OK`)
    console.log(`SHOTS ${shots}`)
    console.log(`MOCK ${mock.baseUrl}`)
  } finally {
    try {
      await app?.close()
    } catch {
      // La app ya estaba cerrada.
    }
    await new Promise((resolve) => mock.server.close(resolve))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
