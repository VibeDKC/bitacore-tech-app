const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.17.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const catalogTarget = path.join(root, 'catalog-web')
const shots = path.join(root, 'shots')
const results = []
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAIHSURBVHhe5dD1XtRBGIXx9xKwC7ADFVHB7m7spBaWBRYQFUVUVLDF7hbz3ubMVRw+M/Pbqzh/PBfwfay30bGnKdXd7FhscewK5Rw7c44drY6FtlR73jGfd2xrT7UWHHMFx5aOVHOnY1OXY2Oo6NhQdLzQ7Xi+J3WuNwSevQieCfWBp/vAU5dSJy+DJ66Ax0P94LF+8OhVsP5a6sgAeHgAPHQ9dXAQPDAI7r+R2ncT3HsL3BMaAncPgbtugzvvpHbcBbcPg9tCI+DWEdCU8VvuZQNU8Zvvg6aMjwOU8ZsegKaM3xgHCOM3PARNGR8HKOPXPwJNGb+uNEAVv/YxaMr4OEAZv+YJaMr4uqfZAFV8bRigjK8dBU0ZvzoMUMavepYNUMWvfA6aMj4OUMbXvABNGb8iDhDGV78ETRkfByjjl78CTRm/rDRAFb/0NWjK+GyALr7qDWjK+Kq3nqaMXxIHCOMXv/M0ZXwcoIxf9D4boIpf+MHTlPFxgDJ+wUdPU8bPjwOE8fM+eZoyPg5Qxs/97GnK+DmlAar42V88TRkfByjjK796mjK+4ls2QBVfHgYo48u/e5oyflYYoIyf+SMboIqf8dPTlPFxgDJ++pinKeOnxQHC+Km/PE0ZHwco46f89jRl/OTSAFX8pD+epoyPA5TxE/96mjJ+wr8wQBhfFgYo48v+e44Dg7BUIzQnErcAAAAASUVORK5CYII='

fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

function readDb() {
  return new DatabaseSync(path.join(data, 'bitacoretech.db'), { readOnly: true })
}

async function main() {
  let app
  let page
  let token

  async function rpcRaw(command, payload = {}, useToken = token) {
    return page.evaluate(
      async ({ command, payload, token }) => {
        const body = token ? { ...payload, __token: token } : payload
        return window.bitacoretech.rpc(command, body)
      },
      { command, payload, token: useToken }
    )
  }
  async function rpc(command, payload = {}, useToken = token) {
    const response = await rpcRaw(command, payload, useToken)
    if (!response.ok) throw new Error(`${command}: ${response.error.code} ${response.error.message}`)
    return response.data
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
    await page.getByPlaceholder('Nombre y apellido').fill('Admin 1.17.0')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.17.0')
    await page.getByPlaceholder('usuario').fill('admin117')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.locator('input[type="password"]').nth(1).fill('Admin12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    token = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    check('primer arranque y sesión', Boolean(token))

    await rpc('cash.open', { initialAmount: 200000 })
    await rpc('settings.updateSection', {
      section: 'catalog',
      value: { targetPath: catalogTarget, autoPublish: false }
    })

    const supplier = await rpc('suppliers.create', {
      name: 'Proveedor Galería 1.17',
      nit: '901777117',
      contact: 'Contacto Galería',
      phone: '3007771170',
      category: 'Repuestos'
    })
    check('proveedor creado', Boolean(supplier.id), supplier.name)

    const product = await rpc('inventory.create', {
      name: 'Producto Galería 1.17',
      sku: 'GAL-117',
      barcode: 'GAL117',
      supplierSku: 'REF-117',
      category: 'Accesorios',
      location: 'Mostrador',
      condition: 'Nuevo',
      origin: 'Proveedor',
      price: 100000,
      cost: 50000,
      stock: 4,
      minStock: 1,
      warrantyDays: 90,
      rotation: 'rotativo',
      alertEnabled: true,
      publishWeb: true,
      service: false,
      description: 'Descripción pública del producto de prueba.',
      internalNotes: 'Nota interna que no debe publicarse.',
      imageDataUrl: PNG,
      imageThumbnailDataUrl: PNG
    })
    check(
      'producto con descripción, notas y slug',
      product.description === 'Descripción pública del producto de prueba.' &&
        product.internalNotes === 'Nota interna que no debe publicarse.' &&
        Boolean(product.slug),
      product.slug
    )
    check(
      'portada inicial en galería',
      product.images?.length === 1 &&
        product.images[0].isCover === true &&
        Boolean(product.images[0].thumbnailUrl),
      JSON.stringify(product.images)
    )
    const originalSlug = product.slug

    const renamed = await rpc('inventory.update', {
      id: product.id,
      name: 'Producto Galería Renombrado 1.17',
      description: 'Descripción pública actualizada.',
      internalNotes: 'Nota interna actualizada.'
    })
    check(
      'slug estable al renombrar',
      renamed.slug === originalSlug && renamed.description === 'Descripción pública actualizada.'
    )

    let current = renamed
    for (let index = 2; index <= 8; index += 1) {
      current = await rpc('inventory.addImage', {
        productId: product.id,
        dataUrl: PNG,
        thumbnailDataUrl: PNG,
        alt: `Imagen ${index}`
      })
    }
    check('galería admite ocho imágenes', current.images?.length === 8, String(current.images?.length))
    const ninth = await rpcRaw('inventory.addImage', {
      productId: product.id,
      dataUrl: PNG,
      thumbnailDataUrl: PNG
    })
    check(
      'la novena imagen se rechaza',
      !ninth.ok && String(ninth.error?.message ?? '').includes('8 imágenes'),
      ninth.error?.message
    )

    const nonCover = current.images.filter((image) => !image.isCover)
    const selectedCover = nonCover[nonCover.length - 1]
    const withCover = await rpc('inventory.setCoverImage', {
      productId: product.id,
      imageId: selectedCover.id
    })
    check(
      'cambio de portada',
      withCover.images?.[0]?.id === selectedCover.id &&
        withCover.images?.[0]?.isCover === true,
      selectedCover.id
    )

    const reordered = [...withCover.images]
    const cover = reordered.find((image) => image.isCover)
    const rest = reordered.filter((image) => !image.isCover)
    const reversed = [...rest].reverse()
    const ordered = await rpc('inventory.reorderImages', {
      productId: product.id,
      imageIds: [cover.id, ...reversed.map((image) => image.id)]
    })
    check(
      'orden de galería actualizado',
      ordered.images?.filter((image) => !image.isCover).map((image) => image.id).join(',') ===
        reversed.map((image) => image.id).join(',')
    )

    const removed = await rpc('inventory.removeImage', {
      productId: product.id,
      imageId: ordered.images.find((image) => !image.isCover).id
    })
    check('imagen eliminada de la galería', removed.images?.length === 7, String(removed.images?.length))

    const firstPurchase = await rpc('purchases.create', {
      supplierId: supplier.id,
      number: 'FC-GAL-117-1',
      date: '2026-10-20T12:00:00.000Z',
      status: 'recibida',
      paymentCondition: 'credito',
      initialPayment: 0,
      paymentMethod: 'Transferencia',
      items: [
        {
          productId: product.id,
          quantity: 2,
          unitPrice: 55000,
          supplierSku: 'REF-117'
        }
      ]
    })
    check(
      'compra registrada y stock actualizado',
      firstPurchase.total === 130900 &&
        (await rpc('inventory.list')).find((item) => item.id === product.id)?.stock === 6,
      String(firstPurchase.total)
    )

    await rpc('purchases.create', {
      supplierId: supplier.id,
      number: 'FC-GAL-117-2',
      date: '2026-10-25T12:00:00.000Z',
      status: 'recibida',
      paymentCondition: 'credito',
      initialPayment: 0,
      paymentMethod: 'Transferencia',
      items: [{ productId: product.id, quantity: 1, unitPrice: 60000 }]
    })
    const history = await rpc('inventory.purchaseHistory', { productId: product.id })
    check(
      'historial de compras del producto',
      history.length === 2 &&
        history[0].supplier === supplier.name &&
        history[0].quantity === 1 &&
        history[0].unitCost === 60000 &&
        history[1].unitCost === 55000,
      JSON.stringify(history)
    )
    const afterPurchase = (await rpc('inventory.list')).find((item) => item.id === product.id)
    check(
      'costo actualizado por la última compra',
      afterPurchase?.cost === 60000 && afterPurchase?.stock === 7,
      `${afterPurchase?.cost} · ${afterPurchase?.stock}`
    )

    const reviewPurchase = await rpc('purchases.createFromReview', {
      supplierId: supplier.id,
      number: 'FC-GAL-117-3',
      date: '2026-10-26T12:00:00.000Z',
      discount: 0,
      realTotal: 35700,
      updatePrices: false,
      duplicateConfirmed: false,
      paymentCondition: 'credito',
      paymentMethod: 'Transferencia',
      initialPayment: 0,
      lines: [
        {
          description: 'Producto IA 1.17',
          quantity: 1,
          unitCost: 30000,
          ivaRate: 19,
          newProduct: {
            name: 'Producto IA 1.17',
            sku: 'IA-117',
            category: 'Accesorios',
            location: 'Mostrador',
            condition: 'Nuevo',
            origin: 'Proveedor',
            price: 50000,
            warrantyDays: 30
          }
        }
      ]
    })
    const aiProduct = (await rpc('inventory.list')).find((item) => item.sku === 'IA-117')
    check(
      'compra con producto nuevo genera slug',
      Boolean(reviewPurchase.id) && Boolean(aiProduct?.slug),
      aiProduct?.slug
    )

    await rpc('catalog.publish')
    const catalogFile = path.join(catalogTarget, 'data', 'catalog.json')
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
    const publicProduct = catalog.products.find((item) => item.id === product.id)
    check(
      'catálogo publica descripción, slug e imágenes',
      Boolean(publicProduct) &&
        publicProduct.slug === originalSlug &&
        publicProduct.description === 'Descripción pública actualizada.' &&
        publicProduct.images?.length === 7 &&
        publicProduct.image === publicProduct.images[0],
      JSON.stringify({
        slug: publicProduct?.slug,
        images: publicProduct?.images?.length
      })
    )
    check(
      'catálogo incluye las imágenes en public/products',
      publicProduct.images.every((url) => {
        const filename = url.split('/').pop()
        return fs.existsSync(path.join(catalogTarget, 'public', 'products', filename))
      })
    )
    check(
      'catálogo no publica notas internas',
      !JSON.stringify(publicProduct).includes('Nota interna actualizada')
    )

    const db = readDb()
    const version = Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v)
    const productColumns = db.prepare('PRAGMA table_info(products)').all().map((row) => row.name)
    const imageCount = Number(
      db.prepare('SELECT COUNT(*) AS c FROM product_images WHERE product_id = ?').get(product.id).c
    )
    db.close()
    check(
      'esquema 18 con galería y campos de catálogo',
      version >= 18 &&
        productColumns.includes('description') &&
        productColumns.includes('internal_notes') &&
        productColumns.includes('slug') &&
        imageCount === 7,
      `v${version} · ${imageCount} imágenes`
    )

    await page.locator('a[href="#/inventario"]').click()
    await page.getByText('Producto Galería Renombrado 1.17', { exact: true }).first().click()
    await page.getByText('Descripción pública actualizada.', { exact: true }).waitFor()
    await page.getByText('Historial de compras', { exact: true }).waitFor()
    await page.getByText(supplier.name, { exact: false }).first().waitFor()
    check(
      'interfaz muestra descripción e historial de compras',
      (await page.locator('img[src*="product-images"]').count()) >= 2
    )
    await page.getByText('Cerrar', { exact: true }).click()

    await page.locator('a[href="#/pos"]').click()
    await page.getByRole('heading', { name: 'Punto de venta' }).waitFor({ timeout: 30000 })
    check(
      'POS muestra la miniatura del producto',
      (await page.locator('img[src*="product-images"]').count()) >= 1
    )
    await page.screenshot({ path: path.join(shots, 'inventario-1.17.0.png'), fullPage: true })

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
