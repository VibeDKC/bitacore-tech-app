const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const http = require('node:http')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.10.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVChTY/hPJGBAF8AFRhXiBUQrBAAj+46AaYVdLAAAAABJRU5ErkJggg=='

let mockMode = 'standard'

const standardInvoice = {
  supplier: { name: 'Proveedor IA 1.10', nit: '900123456', confidence: 0.96 },
  invoice: { number: 'IA-110-001', date: '2026-10-26', currency: 'COP', confidence: 0.95 },
  lines: [
    { description: 'Batería IA 1.10', quantity: 2, unitCost: 60000, ivaRate: 19, confidence: 0.97 },
    { description: 'Repuesto AliExpress 1.10', quantity: 1, unitCost: 25000, ivaRate: 19, confidence: 0.92 }
  ],
  subtotal: 145000,
  discount: 0,
  iva: 27550,
  total: 172550,
  confidence: 0.94,
  warnings: []
}

const aliasUiInvoice = {
  supplier: { name: 'Proveedor IA 1.10', nit: '900123456', confidence: 0.96 },
  invoice: { number: 'ALI-UI-001', date: '2026-10-26', currency: 'COP', confidence: 0.95 },
  lines: [
    { description: 'Batería IA 1.10', quantity: 1, unitCost: 70000, ivaRate: 19, confidence: 0.97 }
  ],
  subtotal: 70000,
  discount: 0,
  iva: 13300,
  total: 70000,
  confidence: 0.94,
  warnings: ['El descuento de AliExpress no aparece en la imagen.']
}

function pass(name, extra = '') {
  results.push({ ok: true, name })
  console.log(`PASS ${name}${extra ? ' — ' + extra : ''}`)
}
function fail(name, error) {
  results.push({ ok: false, name, error: String(error?.stack || error) })
  console.log(`FAIL ${name} — ${error?.stack || error}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rpcRaw(page, command, payload = {}, tokenOverride) {
  return page.evaluate(
    ({ command, payload, tokenOverride }) => {
      const token =
        tokenOverride ||
        sessionStorage.getItem('bitacoretech.session.token') ||
        localStorage.getItem('bitacoretech.session.token')
      return window.bitacoretech.rpc(command, token ? { ...payload, __token: token } : payload)
    },
    { command, payload, tokenOverride }
  )
}

async function rpc(page, command, payload = {}, tokenOverride) {
  const result = await rpcRaw(page, command, payload, tokenOverride)
  if (!result.ok) throw new Error(`${command}: ${result.error.code} ${result.error.message}`)
  return result.data
}

async function launch(geminiBaseUrl) {
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
      BITACORETECH_GEMINI_BASE_URL: geminiBaseUrl,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 90000
  })
}

function mockServer() {
  return http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const sendJson = (status, payload) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(payload))
      }
      const sendText = (text) => {
        sendJson(200, { candidates: [{ content: { parts: [{ text }] } }] })
      }
      if (request.headers['x-goog-api-key'] !== 'test-key') {
        sendJson(401, { error: { message: 'API key invalid' } })
        return
      }
      if (mockMode === 'quota') {
        sendJson(429, { error: { message: 'Quota exceeded' } })
        return
      }
      if (mockMode === 'model-404') {
        sendJson(404, { error: { message: 'Model not found' } })
        return
      }
      let payload = {}
      try {
        payload = JSON.parse(body)
      } catch {
        payload = {}
      }
      const prompt = JSON.stringify(payload)
      if (prompt.includes('Responde únicamente')) {
        sendText('OK')
        return
      }
      if (mockMode === 'invalid-json') {
        sendText('esto no es json')
        return
      }
      sendText(JSON.stringify(mockMode === 'alias-ui' ? aliasUiInvoice : standardInvoice))
    })
  })
}

;(async () => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(shots, { recursive: true })
  fs.mkdirSync(legacy, { recursive: true })

  const server = mockServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const geminiBaseUrl = `http://127.0.0.1:${port}`

  const app = await launch(geminiBaseUrl)
  try {
    const page = await app.firstWindow()
    page.on('pageerror', (error) => console.log('PAGEERROR', error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/favicon|Autofill|DevTools/i.test(message.text())) {
        console.log('CONSOLE', message.text())
      }
    })
    await page.waitForFunction(() => Boolean(window.bitacoretech), null, { timeout: 30000 })
    await page.getByText('Configura tu taller', { exact: true }).waitFor({ timeout: 20000 })
    await page.getByPlaceholder('Nombre y apellido').fill('Owner 1.10')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.10')
    await page.getByPlaceholder('usuario').fill('owner')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('Owner12345')
    await page.getByPlaceholder('Repite la contraseña').fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    pass('primer arranque 1.10.0')

    const noKey = await rpcRaw(page, 'ai.testConnection')
    assert(!noKey.ok, 'La IA respondió sin clave configurada')

    const supplier = await rpc(page, 'suppliers.create', {
      name: 'Proveedor IA 1.10',
      nit: '900123456',
      category: 'Repuestos'
    })
    const battery = await rpc(page, 'inventory.create', {
      name: 'Batería IA 1.10',
      sku: 'BAT-IA-110',
      category: 'Repuestos',
      location: 'Taller',
      condition: 'Nuevo',
      origin: 'Importado',
      stock: 5,
      minStock: 1,
      cost: 30000,
      price: 70000,
      warrantyDays: 90,
      rotation: 'rotativo'
    })

    const settingsSaved = await rpc(page, 'settings.updateSection', {
      section: 'ai',
      value: {
        enabled: true,
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        diagnosis: false,
        summary: false,
        anomalies: false,
        apiKey: 'test-key'
      }
    })
    assert(settingsSaved.ai.configured === true, 'La IA no quedó configurada')
    const settingsNow = await rpc(page, 'settings.get')
    assert(settingsNow.ai.configured === true, 'settings.get no reporta la IA configurada')
    assert(!JSON.stringify(settingsNow).includes('test-key'), 'La clave se filtró al renderer')
    assert(!JSON.stringify(settingsNow).includes('encrypted'), 'La clave cifrada se filtró al renderer')

    const tested = await rpc(page, 'ai.testConnection')
    assert(tested.ok === true, 'La prueba de conexión válida falló')
    const badKey = await rpcRaw(page, 'ai.testConnection', { apiKey: 'bad-key', model: 'gemini-3.5-flash' })
    assert(!badKey.ok, 'La clave incorrecta fue aceptada')
    mockMode = 'model-404'
    const badModel = await rpcRaw(page, 'ai.testConnection', { model: 'modelo-inexistente' })
    assert(!badModel.ok, 'El modelo inexistente fue aceptado')
    mockMode = 'standard'
    pass('IA: clave cifrada, sin filtración, prueba de conexión y errores de clave/modelo')

    const imageFile = {
      name: 'factura.png',
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_BASE64}`
    }
    const draft = await rpc(page, 'purchases.scanInvoice', { file: imageFile })
    assert(draft.supplier.match === 'exact' && draft.supplier.supplierId === supplier.id, 'No se preseleccionó el proveedor')
    assert(draft.invoice.number === 'IA-110-001', 'Número de factura extraído incorrecto')
    assert(draft.lines.length === 2, 'No se extrajeron las dos líneas')
    assert(draft.lines[0].productId === battery.id, 'No se sugirió la batería del inventario')
    assert(draft.lines[0].costChange?.previousCost === 30000, 'No se detectó el costo anterior')
    assert(draft.lines[1].productId === null, 'La línea nueva se asoció a un producto existente')
    assert(draft.subtotal === 145000 && draft.iva === 27550, 'Totales extraídos incorrectos')
    assert(draft.realTotal === 172550 && draft.difference === 0, 'Total real inicial incorrecto')

    mockMode = 'invalid-json'
    const invalidJson = await rpcRaw(page, 'purchases.scanInvoice', { file: imageFile })
    assert(!invalidJson.ok, 'La IA aceptó un JSON inválido')
    mockMode = 'quota'
    const quota = await rpcRaw(page, 'purchases.scanInvoice', { file: imageFile })
    assert(!quota.ok, 'La IA aceptó una cuota agotada')
    mockMode = 'standard'
    const pdfDraft = await rpc(page, 'purchases.scanInvoice', {
      file: {
        name: 'factura.pdf',
        mimeType: 'application/pdf',
        dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 factura de prueba').toString('base64')}`
      }
    })
    assert(pdfDraft.lines.length === 2, 'El escaneo de PDF no devolvió líneas')
    pass('escaneo: imagen, PDF, JSON inválido y cuota agotada')

    const duplicateBefore = await rpc(page, 'purchases.checkDuplicate', {
      supplierId: supplier.id,
      number: 'IA-110-001'
    })
    assert(duplicateBefore.duplicate === false, 'Se detectó un duplicado inexistente')

    const reviewBase = {
      supplierId: supplier.id,
      number: 'IA-110-001',
      date: '2026-10-26T12:00:00.000Z',
      discount: 0,
      realTotal: 160000,
      updatePrices: true,
      duplicateConfirmed: false,
      notes: 'Prueba IA 1.10',
      aiMetadata: draft.ai
    }
    const purchase = await rpc(page, 'purchases.createFromReview', {
      ...reviewBase,
      lines: [
        {
          description: 'Batería IA 1.10',
          quantity: 2,
          unitCost: 60000,
          ivaRate: 19,
          productId: battery.id,
          sellPrice: 120000,
          updatePrice: true
        },
        {
          description: 'Repuesto AliExpress 1.10',
          quantity: 1,
          unitCost: 25000,
          ivaRate: 19,
          newProduct: {
            name: 'Repuesto AliExpress 1.10',
            sku: 'ALI-110',
            category: 'Repuestos',
            location: 'Taller',
            condition: 'Nuevo',
            origin: 'Importado',
            price: 50000,
            warrantyDays: 0
          }
        }
      ]
    })
    assert(purchase.subtotal === 145000 && purchase.iva === 27550, 'Subtotal/IVA de la compra IA incorrectos')
    assert(purchase.discount === 12550 && purchase.adjustment === 0, 'La diferencia de AliExpress no quedó como descuento')
    assert(purchase.total === 160000, 'El total real no quedó como total de compra')
    assert(purchase.lines?.length === 2, 'La compra IA no guardó las dos líneas')
    assert(purchase.lines?.[0].ivaRate === 19 && purchase.lines?.[0].iva === 22800, 'El IVA por línea no se guardó')
    assert(purchase.ai?.extractionHash, 'No se guardaron metadatos de IA')

    const inventory = await rpc(page, 'inventory.list')
    const batteryAfter = inventory.find((item) => item.id === battery.id)
    const newProduct = inventory.find((item) => item.sku === 'ALI-110')
    assert(batteryAfter?.stock === 7, `Stock de batería inesperado: ${batteryAfter?.stock}`)
    assert(batteryAfter?.cost === 60000, 'No se actualizó el costo de la batería')
    assert(batteryAfter?.price === 120000, 'No se actualizó el precio de venta')
    assert(newProduct?.stock === 1, `Stock del producto nuevo inesperado: ${newProduct?.stock}`)
    assert(newProduct?.cost === 25000 && newProduct?.price === 50000, 'El producto nuevo no quedó con costo/precio correctos')
    pass('revisión: total real AliExpress, descuento, nuevo producto y actualización de costo/precio')

    const duplicateNow = await rpc(page, 'purchases.checkDuplicate', {
      supplierId: supplier.id,
      number: 'IA-110-001'
    })
    assert(duplicateNow.duplicate === true, 'No se detectó el duplicado después de crear la compra')
    const batteryLine = {
      description: 'Batería IA 1.10',
      quantity: 1,
      unitCost: 60000,
      ivaRate: 19,
      productId: battery.id
    }
    const duplicateReview = {
      ...reviewBase,
      lines: [batteryLine],
      realTotal: 71400,
      updatePrices: false
    }
    const duplicateWithoutConfirmation = await rpcRaw(page, 'purchases.createFromReview', duplicateReview)
    assert(!duplicateWithoutConfirmation.ok, 'Se permitió un duplicado sin confirmación')
    const duplicateWithConfirmation = await rpc(page, 'purchases.createFromReview', {
      ...duplicateReview,
      duplicateConfirmed: true
    })
    assert(duplicateWithConfirmation.total === 71400, 'El duplicado confirmado no se guardó')

    const supplier2 = await rpc(page, 'suppliers.create', {
      name: 'Proveedor IA 2',
      nit: '901999999',
      category: 'Repuestos'
    })
    const otherSupplier = await rpc(page, 'purchases.createFromReview', {
      ...duplicateReview,
      supplierId: supplier2.id,
      duplicateConfirmed: false
    })
    assert(otherSupplier.supplierId === supplier2.id, 'Otro proveedor no pudo usar el mismo número')

    const manualDuplicate = await rpcRaw(page, 'purchases.create', {
      supplierId: supplier.id,
      number: 'IA-110-001',
      date: '2026-10-26T12:00:00.000Z',
      status: 'recibida',
      items: [{ productId: battery.id, quantity: 1, unitPrice: 60000 }]
    })
    assert(!manualDuplicate.ok, 'El alta manual permitió un número duplicado del mismo proveedor')

    const adjusted = await rpc(page, 'purchases.createFromReview', {
      ...duplicateReview,
      number: 'IA-110-002',
      realTotal: 75000,
      duplicateConfirmed: false
    })
    assert(adjusted.discount === 0 && adjusted.adjustment === 3600, 'El ajuste positivo no se calculó')
    assert(adjusted.total === 75000, 'El total con ajuste positivo no se guardó')
    pass('duplicados por proveedor + número, otro proveedor y ajuste positivo')

    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('IA y API', { exact: true }).first().click()
    await page.getByText('Escaneo de facturas de compra', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'Probar conexión' }).click()
    await page.getByText('Conexión con Gemini correcta', { exact: false }).first().waitFor({ timeout: 20000 })
    pass('interfaz de configuración de IA y prueba de conexión')
    await page.screenshot({ path: path.join(shots, '01-configuracion-ia.png') })

    mockMode = 'alias-ui'
    await page.getByText('Compras', { exact: true }).first().click()
    await page.getByText('Compras y proveedores', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'Escanear factura' }).first().click()
    const scanDialog = page.getByRole('dialog', { name: 'Escanear factura de compra' })
    await scanDialog.waitFor({ timeout: 15000 })
    const fileInput = scanDialog.locator('input[type=file]').last()
    await fileInput.setInputFiles({
      name: 'factura.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_BASE64, 'base64')
    })
    await page.screenshot({ path: path.join(shots, 'debug-file-input.png') })
    await scanDialog.getByText('factura.png', { exact: true }).waitFor({ timeout: 15000 })
    await scanDialog.getByLabel('Quitar archivo').click()

    await page.evaluate(
      ({ base64 }) => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        const file = new File([bytes], 'captura.png', { type: 'image/png' })
        const transfer = new DataTransfer()
        transfer.items.add(file)
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', { value: transfer })
        document.body.dispatchEvent(event)
      },
      { base64: PNG_BASE64 }
    )
    await scanDialog.getByText('captura.png', { exact: true }).waitFor({ timeout: 15000 })
    await scanDialog.getByRole('button', { name: 'Escanear factura' }).click()
    const reviewDialog = page.getByRole('dialog', { name: 'Revisar factura de compra' })
    await reviewDialog.waitFor({ timeout: 30000 })
    await reviewDialog.getByText('Diferencia:', { exact: false }).waitFor({ timeout: 15000 })
    await reviewDialog.getByText('El costo subió de', { exact: false }).waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(shots, '02-revision-factura.png') })
    await reviewDialog.getByLabel('Confirmo el total real y el ajuste.').check()
    await reviewDialog.getByRole('button', { name: 'Aprobar factura de compra' }).click()
    await page.getByText('Compra registrada', { exact: false }).first().waitFor({ timeout: 30000 })
    await page.getByText('Compra ALI-UI-001', { exact: true }).first().waitFor({ timeout: 15000 })
    pass('interfaz: archivo, Ctrl+V, vista previa y aprobación de AliExpress')
    await page.screenshot({ path: path.join(shots, '03-compra-aprobada.png') })

    await app.close()
  } catch (error) {
    fail('flujo 1.10.0', error)
    await app.close().catch(() => {})
  } finally {
    server.close()
  }

  const failed = results.filter((item) => !item.ok)
  console.log(`\nRESULT ${results.length - failed.length}/${results.length} OK`)
  console.log('ROOT=' + root)
  if (failed.length) process.exit(1)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
