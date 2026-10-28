/**
 * Prueba de humo de la demo del catálogo web.
 *
 * Requiere el servidor de la demo activo y las dependencias de la raíz
 * (playwright-core ya está instalado allí). Usa Microsoft Edge en modo headless.
 *
 * Uso:
 *   node scripts/smoke-test.cjs
 *   BASE_URL=http://127.0.0.1:3001 SHOTS_DIR=... node scripts/smoke-test.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright-core')

const webRoot = path.resolve(__dirname, '..')
const baseUrl = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const shotsDir =
  process.env.SHOTS_DIR ||
  path.join(process.env.TEMP || os.tmpdir(), 'opencode', 'catalogo-web-shots')
const edgePath =
  process.env.EDGE_PATH ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const consoleErrors = []
const pageErrors = []
const localFailures = []
const intentional404 =
  /\/producto\/no-existe|\/seguimiento\/NO-EXISTE|\/ruta-inexistente|\/api\/seguimiento\?/

function checkData(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
    console.log(`OK   ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
    console.error(`FAIL ${name}: ${error.message}`)
  }
}

async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`OK   ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
    console.error(`FAIL ${name}: ${error.message}`)
  }
}

async function waitForCount(page, selector, expected, timeout = 6000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if ((await page.locator(selector).count()) === expected) return
    await page.waitForTimeout(100)
  }
  const actual = await page.locator(selector).count()
  throw new Error(`${selector}: esperado ${expected}, encontrado ${actual}`)
}

function parsePrice(value) {
  return Number(value.replace(/[^\d]/g, ''))
}

function formatPrice(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(value)
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
    window.innerWidth
  )
  assert.ok(overflow <= 1, `${label}: desborde horizontal de ${overflow}px`)
}

function attachDiagnostics(page) {
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(baseUrl)) {
      localFailures.push(`${request.method()} ${request.url()}`)
    }
  })
  page.on('response', (response) => {
    if (response.url().startsWith(baseUrl) && response.status() >= 400) {
      localFailures.push(`${response.status()} ${response.url()}`)
    }
  })
}

async function main() {
  const server = await fetch(`${baseUrl}/`).catch((error) => {
    throw new Error(`No se pudo conectar con ${baseUrl}: ${error.message}`)
  })
  assert.equal(server.status, 200, `La portada respondió ${server.status}`)
  assert.ok(fs.existsSync(edgePath), `No se encontró Edge en ${edgePath}`)

  const catalog = JSON.parse(
    fs.readFileSync(path.join(webRoot, 'data', 'catalog.json'), 'utf8')
  )
  const orders = JSON.parse(
    fs.readFileSync(path.join(webRoot, 'data', 'orders-demo.json'), 'utf8')
  )

  console.log(`\nDatos del catálogo (${catalog.generatedAt})`)
  checkData('39 referencias exportadas', () => {
    assert.equal(catalog.products.length, 39)
  })
  checkData('categorías 12/13/14', () => {
    assert.equal(catalog.categories.find((item) => item.slug === 'accesorios').count, 12)
    assert.equal(catalog.categories.find((item) => item.slug === 'almacenamiento').count, 13)
    assert.equal(catalog.categories.find((item) => item.slug === 'perifericos').count, 14)
  })
  checkData('24 imágenes existen en public/products', () => {
    const images = catalog.products.filter((product) => product.image)
    assert.equal(images.length, 24)
    for (const product of images) {
      assert.ok(
        fs.existsSync(path.join(webRoot, 'public', product.image)),
        `Falta ${product.image}`
      )
    }
  })
  checkData('9 destacados únicos y hero incluido', () => {
    assert.equal(catalog.featured.length, 9)
    assert.equal(new Set(catalog.featured).size, 9)
    assert.ok(catalog.featured.every((id) => catalog.products.some((product) => product.id === id)))
    assert.ok(catalog.featured.includes(catalog.heroProductId))
  })
  checkData('promociones publicadas válidas', () => {
    const promotions = catalog.products.filter((product) => product.promotion)
    for (const product of promotions) {
      assert.ok(product.price > 0)
      assert.ok(product.regularPrice > product.price)
      assert.ok(['percent', 'amount'].includes(product.promotion.type))
      const expected =
        product.promotion.type === 'percent'
          ? Math.round((product.regularPrice * (100 - product.promotion.value)) / 100)
          : product.regularPrice - product.promotion.value
      assert.equal(product.price, expected, product.sku)
    }
  })
  checkData('el JSON no publica el precio de servicios', () => {
    assert.equal(Object.prototype.hasOwnProperty.call(catalog, 'service'), false)
  })
  checkData('stock oculto por defecto en la web', () => {
    assert.equal(catalog.stockVisibility, 'outOnly')
  })
  checkData('3 órdenes demo con código hasheado', () => {
    assert.equal(orders.orders.length, 3)
    assert.ok(orders.orders.every((order) => /^[a-f0-9]{64}$/.test(order.codeHash)))
    assert.equal(new Set(orders.orders.map((order) => order.codeHash)).size, 3)
  })
  checkData('coincidencia con la base local', () => {
    const dbPath =
      process.env.BITACORETECH_DB ||
      path.join(process.env.APPDATA || '', 'BitacoreTech', 'bitacoretech.db')
    if (!fs.existsSync(dbPath)) return
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const physical = db
        .prepare(
          "SELECT COUNT(*) AS total FROM products WHERE active=1 AND is_service=0 AND category <> ? AND sku <> ?"
        )
        .get('Insumos de taller', '00000000000')
      assert.equal(Number(physical.total), 39)
      const categories = db
        .prepare(
          "SELECT category, COUNT(*) AS total FROM products WHERE active=1 AND is_service=0 AND category <> ? AND sku <> ? GROUP BY category"
        )
        .all('Insumos de taller', '00000000000')
      const byCategory = Object.fromEntries(
        categories.map((row) => [row.category, Number(row.total)])
      )
      assert.deepEqual(byCategory, {
        Accesorios: 12,
        Almacenamiento: 13,
        Periféricos: 14
      })
      const demoOrders = db
        .prepare(
          "SELECT number FROM work_orders WHERE number IN ('OT-002332','OT-002341','OT-002336')"
        )
        .all()
      assert.equal(demoOrders.length, 3)
    } finally {
      db.close()
    }
  })

  const browser = await chromium.launch({ executablePath: edgePath, headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'es-CO'
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  attachDiagnostics(page)

  const goto = async (route) => {
    const response = await page.goto(`${baseUrl}${route}`, {
      waitUntil: 'domcontentloaded'
    })
    await page.waitForTimeout(150)
    return response
  }

  try {
    console.log('\nEscritorio 1440×1000')

    await check('Home responde 200 y renderiza el nuevo hero', async () => {
      const response = await goto('/')
      assert.equal(response.status(), 200)
      await page.locator('.hero-title').waitFor()
      const title = (await page.locator('.hero-title').innerText())
        .replace(/\s+/g, ' ')
        .trim()
      assert.equal(
        title,
        'Servicio de mantenimiento y reparación, venta de tecnología y accesorios para tu día a día.'
      )
      assert.equal(
        (await page.locator('.hero-title span').innerText()).trim(),
        'mantenimiento y reparación'
      )
      assert.equal(await page.locator('.hero-copy .eyebrow').count(), 0)
      assert.equal(await page.locator('.hero-points').count(), 0)
      const heroText = await page.locator('.hero-text').innerText()
      assert.doesNotMatch(heroText, /envío|entrega|domicilio/i)
      assert.match(heroText, /atención presencial/i)
      const heroProduct = catalog.products.find((product) => product.id === catalog.heroProductId)
      assert.ok(heroProduct)
      assert.equal((await page.locator('.hero-product-name').innerText()).trim(), heroProduct.name)
      assert.equal(
        (await page.locator('.hero-kicker').innerText()).trim().toLowerCase(),
        heroProduct.promotion ? 'promoción' : 'destacado'
      )
      assert.match(await page.locator('.hero-guarantee').innerText(), /Garantía 30 días/i)
      assert.match(await page.locator('.hero-carousel-count').innerText(), /1 \/ 9/)
    })

    await check('Home muestra confianza y 3 categorías', async () => {
      assert.equal(await page.locator('.trust-item').count(), 4)
      assert.equal(await page.locator('.category-card').count(), 3)
      const body = await page.locator('body').innerText()
      assert.match(body, /12 referencias/i)
      assert.match(body, /13 referencias/i)
      assert.match(body, /14 referencias/i)
      assert.equal(await page.locator('.product-carousel').count(), 0)
    })

    await check('Hero: avanza automáticamente cada 4 segundos', async () => {
      await page.evaluate(() => document.activeElement?.blur())
      await page.mouse.move(0, 0)
      const initial = await page
        .locator('.hero-carousel-dots button.active')
        .getAttribute('aria-label')
      await page.waitForFunction(
        (previous) => {
          const active = document.querySelector('.hero-carousel-dots button.active')
          return active && active.getAttribute('aria-label') !== previous
        },
        initial,
        { timeout: 6000 }
      )
    })

    await check('Hero: se pausa al pasar el mouse y reanuda', async () => {
      await page.evaluate(() => document.activeElement?.blur())
      await page.mouse.move(0, 0)
      await page.waitForTimeout(100)
      await page.locator('.hero-panel').hover()
      const paused = await page
        .locator('.hero-carousel-dots button.active')
        .getAttribute('aria-label')
      await page.waitForTimeout(4500)
      assert.equal(
        await page.locator('.hero-carousel-dots button.active').getAttribute('aria-label'),
        paused
      )
      await page.mouse.move(0, 0)
      await page.waitForFunction(
        (previous) => {
          const active = document.querySelector('.hero-carousel-dots button.active')
          return active && active.getAttribute('aria-label') !== previous
        },
        paused,
        { timeout: 6000 }
      )
    })

    await check('Hero: 9 productos únicos y etiquetas válidas', async () => {
      const dots = page.locator('.hero-carousel-dots button')
      assert.equal(await dots.count(), 9)
      const names = []
      const labels = []
      for (let itemIndex = 0; itemIndex < 9; itemIndex += 1) {
        await dots.nth(itemIndex).click()
        await page.waitForTimeout(80)
        names.push((await page.locator('.hero-product-name').innerText()).trim())
        labels.push((await page.locator('.hero-kicker').innerText()).trim().toLowerCase())
      }
      assert.equal(new Set(names).size, 9)
      assert.ok(labels.every((label) => label === 'promoción' || label === 'destacado'))
      assert.equal(
        labels.filter((label) => label === 'promoción').length,
        catalog.products.filter(
          (product) => product.promotion && catalog.featured.includes(product.id)
        ).length
      )
      assert.match(await page.locator('.hero-carousel-count').innerText(), /9 \/ 9/)
      await dots.first().click()
      await page.waitForTimeout(100)
      assert.match(await page.locator('.hero-carousel-count').innerText(), /1 \/ 9/)
    })

    await check('Hero: responde a flechas y dots', async () => {
      const initial = await page
        .locator('.hero-carousel-dots button.active')
        .getAttribute('aria-label')
      await page
        .locator('.hero-carousel-controls > button[aria-label="Producto siguiente"]')
        .click()
      await page.waitForTimeout(150)
      assert.notEqual(
        await page.locator('.hero-carousel-dots button.active').getAttribute('aria-label'),
        initial
      )
      await page
        .locator('.hero-carousel-controls > button[aria-label="Producto anterior"]')
        .click()
      await page.waitForTimeout(150)
      assert.equal(
        await page.locator('.hero-carousel-dots button.active').getAttribute('aria-label'),
        initial
      )
    })

    await check('Contacto solo en barra superior y pie', async () => {
      assert.equal(
        await page.locator('.site-header a[href^="tel:"], .site-header a[href*="wa.me"]').count(),
        0
      )
      assert.equal(
        await page.locator('.topbar a[href^="tel:"]').getAttribute('href'),
        'tel:+573246381768'
      )
      assert.match(
        await page.locator('.topbar a[href*="wa.me"]').getAttribute('href'),
        /wa\.me\/573246381768/
      )
      assert.ok((await page.locator('.site-footer a[href*="wa.me"]').count()) >= 1)
      assert.ok((await page.locator('.site-footer a[href^="tel:"]').count()) >= 1)
    })

    await check('Desplegable de categorías del header', async () => {
      await page.locator('.main-nav').getByRole('button', { name: 'Catálogo' }).hover()
      await page.locator('#catalog-menu').waitFor()
      assert.equal(await page.locator('#catalog-menu a').count(), 4)
      const href = await page.getByRole('menuitem', { name: /Almacenamiento/i }).getAttribute('href')
      assert.equal(href, '/catalogo?categoria=almacenamiento')
      await page.mouse.move(0, 0)
    })

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.locator('.hero-carousel-dots button').first().click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(shotsDir, '01-home-desktop.png') })
    await page.locator('.hero-carousel-dots button').nth(1).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(shotsDir, '01b-home-carrusel.png') })

    await check('Catálogo: 39 referencias y conteos', async () => {
      await goto('/catalogo')
      await waitForCount(page, '.product-card', 39)
      assert.match(await page.locator('.catalog-count').innerText(), /39/)
      assert.match(await page.locator('body').innerText(), /Todas las categorías \(39\)/)
    })

    await check('Catálogo: filtro por categoría', async () => {
      await page.locator('.catalog-toolbar select').first().selectOption('almacenamiento')
      await waitForCount(page, '.product-card', 13)
      assert.match(await page.locator('.catalog-count').innerText(), /13/)
    })

    await check('Catálogo: búsqueda por categoría sin tilde', async () => {
      await page.locator('.catalog-toolbar select').first().selectOption('todos')
      await page.locator('.catalog-search input').fill('perifericos')
      await waitForCount(page, '.product-card', 14)
    })

    await check('Catálogo: búsqueda por SKU', async () => {
      await page.locator('.catalog-search input').fill('PB-ADAT-C100-10K')
      await waitForCount(page, '.product-card', 1)
      assert.match(await page.locator('.product-card .product-name').innerText(), /Power Bank Adata/i)
    })

    await check('Catálogo: estado vacío', async () => {
      await page.locator('.catalog-search input').fill('zzzz')
      await page.locator('.empty-state').waitFor()
      assert.match(await page.locator('.empty-state').innerText(), /No encontramos esa referencia/i)
    })

    await check('Catálogo: orden por precio ascendente y descendente', async () => {
      await page.locator('.catalog-search input').fill('')
      await page.locator('.catalog-toolbar select').first().selectOption('todos')
      await waitForCount(page, '.product-card', 39)
      const sort = page.locator('.catalog-toolbar select').nth(1)
      await sort.selectOption('price-asc')
      await page.waitForTimeout(150)
      assert.equal(
        parsePrice(await page.locator('.product-card .product-price').first().innerText()),
        Math.min(...catalog.products.map((product) => product.price))
      )
      await sort.selectOption('price-desc')
      await page.waitForTimeout(150)
      assert.equal(
        parsePrice(await page.locator('.product-card .product-price').first().innerText()),
        Math.max(...catalog.products.map((product) => product.price))
      )
    })

    await check('Catálogo: parámetros de URL', async () => {
      await goto('/catalogo?categoria=almacenamiento&q=ssd')
      await waitForCount(page, '.product-card', 4)
      assert.equal(await page.locator('.catalog-toolbar select').first().inputValue(), 'almacenamiento')
      assert.equal(await page.locator('.catalog-search input').inputValue(), 'ssd')
    })

    await goto('/catalogo')
    await waitForCount(page, '.product-card', 39)
    await page.screenshot({ path: path.join(shotsDir, '02-catalogo-desktop.png') })

    const fixedPromoProduct = catalog.products.find(
      (product) => product.promotion?.type === 'amount'
    )
    const percentPromoProduct = catalog.products.find(
      (product) => product.promotion?.type === 'percent'
    )
    const regularProduct = catalog.products.find((product) => !product.promotion && product.image)

    await check('Ficha: promoción fija o precio regular', async () => {
      const sample = fixedPromoProduct ?? regularProduct
      assert.ok(sample)
      await goto(`/producto/${sample.slug}`)
      await page.locator('.detail-title').waitFor()
      assert.equal((await page.locator('.detail-title').innerText()).trim(), sample.name)
      assert.match(await page.locator('.detail-price').innerText(), new RegExp(formatPrice(sample.price).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      if (sample.promotion) {
        assert.match(
          await page.locator('.detail-price-old').innerText(),
          new RegExp(formatPrice(sample.regularPrice).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        )
        assert.match(await page.locator('.detail-promo').innerText(), new RegExp(sample.promotion.badge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      } else {
        assert.equal(await page.locator('.detail-price-old').count(), 0)
        assert.equal(await page.locator('.detail-promo').count(), 0)
      }
      assert.equal(await page.locator('.detail-stock').count(), 0)
      const facts = await page.locator('.detail-facts').innerText()
      assert.match(facts, /Nuevo/)
      assert.match(facts, /30 días/)
      assert.match(facts, new RegExp(sample.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      const href = await page.getByRole('link', { name: /Pedir por WhatsApp/i }).getAttribute('href')
      assert.match(href, /^https:\/\/wa\.me\/573246381768\?text=/)
      const message = decodeURIComponent(href.split('?text=')[1])
      assert.match(message, new RegExp(sample.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(message, /recoger en tienda/i)
      assert.match(message, sample.promotion ? /Precio promocional/i : /Precio:/i)
      assert.ok((await page.locator('.related-section .product-card').count()) >= 2)
    })

    await page.screenshot({ path: path.join(shotsDir, '03-ficha-promo-desktop.png') })

    await check('Carrito: agregar, persistir y mensaje de WhatsApp', async () => {
      const sample = fixedPromoProduct ?? regularProduct
      assert.ok(sample)
      await goto(`/producto/${sample.slug}`)
      await page.locator('.detail-title').waitFor()
      await page.getByRole('button', { name: 'Añadir al carrito' }).click()
      await page.locator('.cart-count').waitFor()
      assert.equal((await page.locator('.cart-count').innerText()).trim(), '1')
      await page.locator('.cart-link').click()
      await page.waitForURL('**/carrito')
      await page.locator('.cart-row').waitFor()
      assert.equal(await page.locator('.cart-row').count(), 1)
      assert.match(
        await page.locator('.cart-row-name').innerText(),
        new RegExp(sample.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      )
      const href = await page.getByRole('link', { name: /Pedir por WhatsApp/i }).getAttribute('href')
      assert.match(href, /^https:\/\/wa\.me\/573246381768\?text=/)
      const message = decodeURIComponent(href.split('?text=')[1])
      assert.match(message, new RegExp(sample.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(message, new RegExp(sample.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(message, /recoger en tienda/i)
      assert.match(message, /Total referencias/i)
      await page.screenshot({ path: path.join(shotsDir, '03b-carrito-desktop.png') })
      await page.reload()
      await page.locator('.cart-row').waitFor()
      assert.equal(await page.locator('.cart-row').count(), 1)
      await page.getByRole('button', { name: 'Vaciar carrito' }).click()
      await page.locator('.cart-empty').waitFor()
    })

    await check('Ficha: promoción porcentual o sin promoción', async () => {
      const sample = percentPromoProduct ?? regularProduct
      assert.ok(sample)
      await goto(`/producto/${sample.slug}`)
      await page.locator('.detail-title').waitFor()
      if (sample.promotion) {
        assert.match(
          await page.locator('.detail-price-old').innerText(),
          new RegExp(formatPrice(sample.regularPrice).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        )
        assert.match(await page.locator('.detail-price').innerText(), new RegExp(formatPrice(sample.price).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        assert.match(await page.locator('.detail-promo').innerText(), new RegExp(sample.promotion.badge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      } else {
        assert.equal(await page.locator('.detail-price-old').count(), 0)
        assert.equal(await page.locator('.detail-promo').count(), 0)
      }
    })

    await check('Ficha sin foto usa placeholder', async () => {
      await goto('/producto/router-mercusys-mw302r-n-300mbps-2-antenas')
      await page.locator('.detail-title').waitFor()
      assert.match(
        await page.locator('.detail-media .product-placeholder').innerText(),
        /Foto próximamente/i
      )
      assert.equal(await page.locator('.detail-media .badge-promo').count(), 0)
    })

    await check('Servicios: 16 opciones y sin precios', async () => {
      await goto('/servicios')
      await page.locator('.quote-form').waitFor()
      assert.equal(await page.locator('.service-item').count(), 17)
      assert.equal(await page.locator('.quote-form select option').count(), 16)
      const body = await page.locator('body').innerText()
      assert.match(body, /No se muestra un valor por hora/i)
      assert.match(body, /se cotiza según el equipo/i)
      assert.doesNotMatch(body, /\$\s?\d/)
    })

    await check('Servicios: formulario arma el mensaje de WhatsApp', async () => {
      await page.evaluate(() => {
        window.__openedUrls = []
        window.open = (url) => {
          window.__openedUrls.push(String(url))
          return null
        }
      })
      await page.locator('.quote-form select').selectOption('Recuperación de datos')
      await page.locator('.quote-form input').fill('Laptop no enciende')
      await page.locator('.quote-form button[type="submit"]').click()
      const urls = await page.evaluate(() => window.__openedUrls)
      assert.equal(urls.length, 1)
      assert.match(urls[0], /^https:\/\/wa\.me\/573246381768\?text=/)
      const message = decodeURIComponent(urls[0].split('?text=')[1])
      assert.match(message, /Recuperación de datos/)
      assert.match(message, /Laptop no enciende/)
    })

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(shotsDir, '04-servicios-desktop.png') })
    await page.locator('.quote-form').scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(shotsDir, '04b-servicios-formulario.png') })

    await check('Buscar orden: número y clave con error controlado', async () => {
      await goto('/buscar-orden')
      await page.locator('.order-search-form').waitFor()
      assert.match(await page.locator('.order-subtitle').innerText(), /clave de seguimiento/i)
      assert.match(await page.locator('.order-qr-note').innerText(), /inactivo por defecto/i)
      assert.equal(await page.locator('.order-demo-list').count(), 0)
      await page.locator('.order-search-form input').first().fill('000000')
      await page.locator('.order-search-form input').nth(1).fill('XXXX-00')
      await page.locator('.order-search-form button[type="submit"]').click()
      await page.locator('.order-error').waitFor()
      assert.match(await page.locator('.order-error').innerText(), /No encontramos una orden/i)
    })

    await check('Buscar orden: acepta número sin #OT- y clave en minúsculas', async () => {
      await goto('/buscar-orden')
      await page.locator('.order-search-form input').first().fill('#OT-002332')
      assert.equal(await page.locator('.order-search-form input').first().inputValue(), '002332')
      await page.locator('.order-search-form input').nth(1).fill('demo-01')
      await page.locator('.order-search-form button[type="submit"]').click()
      await page.locator('.order-status-card').waitFor()
      assert.match(await page.locator('.order-number').innerText(), /OT-002332/)
    })

    await page.screenshot({ path: path.join(shotsDir, '05-buscar-orden-desktop.png') })

    await check('Seguimiento directo por clave en minúsculas y noindex', async () => {
      const response = await goto('/seguimiento/demo-02')
      assert.equal(response.status(), 200)
      await page.locator('.order-status-card').waitFor()
      assert.match(await page.locator('.order-number').innerText(), /OT-002341/)
      assert.match(await page.locator('.order-status-pill').innerText(), /En reparación/i)
      const robots = await page.locator('meta[name="robots"]').getAttribute('content')
      assert.match(robots || '', /noindex/i)
    })

    await page.screenshot({ path: path.join(shotsDir, '06-seguimiento-desktop.png') })

    await check('404 de producto, seguimiento y ruta', async () => {
      let response = await goto('/producto/no-existe')
      assert.equal(response.status(), 404)
      assert.match(await page.locator('.empty-state h1').innerText(), /No encontramos esa página/i)
      response = await goto('/seguimiento/NO-EXISTE')
      assert.equal(response.status(), 404)
      assert.match(await page.locator('.empty-state h1').innerText(), /No encontramos esa página/i)
      response = await goto('/ruta-inexistente')
      assert.equal(response.status(), 404)
    })

    await page.screenshot({ path: path.join(shotsDir, '07-404-desktop.png') })

    console.log('\nMóvil 390×844 y 360×800')
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      locale: 'es-CO',
      hasTouch: true
    })
    const mobilePage = await mobile.newPage()
    mobilePage.setDefaultTimeout(10000)
    attachDiagnostics(mobilePage)

    await check('Móvil: home sin desborde', async () => {
      await mobilePage.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
      await mobilePage.locator('.hero-title').waitFor()
      await mobilePage.waitForTimeout(700)
      await assertNoOverflow(mobilePage, 'home 390')
      assert.ok(await mobilePage.locator('.hero-product-link').isVisible())
      await mobilePage.screenshot({ path: path.join(shotsDir, '08-home-movil.png') })
      await mobilePage.locator('.hero-panel').scrollIntoViewIfNeeded()
      await mobilePage.waitForTimeout(300)
      await mobilePage.locator('.hero-panel').screenshot({
        path: path.join(shotsDir, '13-hero-panel-movil.png')
      })
    })

    await check('Móvil: menú, submenú y filtro por categoría', async () => {
      await mobilePage.getByRole('button', { name: 'Abrir menú' }).click()
      await mobilePage.locator('.mobile-nav.open').waitFor()
      assert.ok(await mobilePage.locator('.mobile-nav.open').isVisible())
      await mobilePage.waitForTimeout(300)
      await mobilePage.screenshot({ path: path.join(shotsDir, '09-menu-movil.png') })
      await mobilePage.locator('.mobile-nav-toggle').click()
      await mobilePage.locator('.mobile-subnav').waitFor()
      await mobilePage.locator('.mobile-subnav a', { hasText: 'Almacenamiento' }).click()
      await mobilePage.waitForURL(/categoria=almacenamiento/)
      await waitForCount(mobilePage, '.product-card', 13)
      assert.ok((await mobilePage.locator('.mobile-nav.open').count()) === 0)
      await mobilePage.waitForTimeout(400)
      await assertNoOverflow(mobilePage, 'catálogo 390')
      await mobilePage.screenshot({ path: path.join(shotsDir, '10-catalogo-movil.png') })
    })

    await check('Móvil: catálogo, ficha, servicios, orden y seguimiento sin desborde', async () => {
      const routes = [
        ['/catalogo', '.product-card'],
        ['/producto/power-bank-adata-c100-10000mah-tipo-c-negro', '.detail-title'],
        ['/carrito', '.cart-empty'],
        ['/servicios', '.quote-form'],
        ['/buscar-orden', '.order-search-form'],
        ['/seguimiento/DEMO-01', '.order-status-card']
      ]
      for (const [route, selector] of routes) {
        await mobilePage.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
        await mobilePage.locator(selector).first().waitFor()
        await assertNoOverflow(mobilePage, `${route} 390`)
      }
      await mobilePage.goto(`${baseUrl}/producto/power-bank-adata-c100-10000mah-tipo-c-negro`, {
        waitUntil: 'domcontentloaded'
      })
      await mobilePage.locator('.detail-title').waitFor()
      await mobilePage.waitForTimeout(400)
      await mobilePage.screenshot({ path: path.join(shotsDir, '11-ficha-movil.png') })
      await mobilePage.goto(`${baseUrl}/seguimiento/DEMO-01`, { waitUntil: 'domcontentloaded' })
      await mobilePage.locator('.order-status-card').waitFor()
      await mobilePage.waitForTimeout(300)
      await mobilePage.screenshot({ path: path.join(shotsDir, '12-seguimiento-movil.png') })
    })

    await check('Móvil 360: home, catálogo y orden sin desborde', async () => {
      const narrow = await browser.newContext({
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 1,
        locale: 'es-CO',
        hasTouch: true
      })
      const narrowPage = await narrow.newPage()
      attachDiagnostics(narrowPage)
      for (const [route, selector] of [
        ['/', '.hero-title'],
        ['/catalogo', '.product-card'],
        ['/carrito', '.cart-empty'],
        ['/buscar-orden', '.order-search-form']
      ]) {
        await narrowPage.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
        await narrowPage.locator(selector).first().waitFor()
        await assertNoOverflow(narrowPage, `${route} 360`)
      }
      await narrow.close()
    })

    await check('Reduced motion: el hero no avanza solo', async () => {
      const reduced = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: 'reduce',
        locale: 'es-CO'
      })
      const reducedPage = await reduced.newPage()
      attachDiagnostics(reducedPage)
      await reducedPage.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
      await reducedPage.locator('.hero-title').waitFor()
      await reducedPage.waitForTimeout(300)
      const active = await reducedPage
        .locator('.hero-carousel-dots button.active')
        .getAttribute('aria-label')
      await reducedPage.waitForTimeout(4500)
      assert.equal(
        await reducedPage.locator('.hero-carousel-dots button.active').getAttribute('aria-label'),
        active
      )
      await reduced.close()
    })

    await mobile.close()
  } finally {
    await browser.close()
  }

  const unexpectedLocalFailures = localFailures.filter(
    (item) =>
      !intentional404.test(item) &&
      !/\/favicon\.ico/.test(item) &&
      !/_rsc=/.test(item) &&
      !/_next\//.test(item)
  )
  const unexpectedConsole = consoleErrors.filter(
    (message) => !/404|Failed to load resource|favicon/i.test(message)
  )

  console.log('\nDiagnóstico')
  console.log(`Errores de consola inesperados: ${unexpectedConsole.length}`)
  console.log(`Errores de página: ${pageErrors.length}`)
  console.log(`Fallos locales inesperados: ${unexpectedLocalFailures.length}`)
  if (unexpectedConsole.length) console.log(unexpectedConsole.join('\n'))
  if (pageErrors.length) console.log(pageErrors.join('\n'))
  if (unexpectedLocalFailures.length) console.log(unexpectedLocalFailures.join('\n'))

  const failed = results.filter((result) => !result.ok)
  console.log(`\nCapturas: ${shotsDir}`)
  console.log(`RESULT ${results.length - failed.length}/${results.length} OK`)
  if (failed.length) {
    console.log('Fallos:')
    for (const result of failed) console.log(`- ${result.name}: ${result.error}`)
  }

  if (
    failed.length ||
    unexpectedConsole.length ||
    pageErrors.length ||
    unexpectedLocalFailures.length
  ) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
