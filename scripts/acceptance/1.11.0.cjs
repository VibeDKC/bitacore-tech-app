const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const http = require('node:http')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.11.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVChTY/hPJGBAF8AFRhXiBUQrBAAj+46AaYVdLAAAAABJRU5ErkJggg=='
const PNG_ALT_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let mockMode = 'standard'
const primaryModel = 'gemini-primary-test'
const fallbackModel = 'gemini-fallback-test'
const adminModel = 'gemini-admin-test'
const mockCalls = []

const modelCatalog = {
  models: [
    {
      name: `models/${primaryModel}`,
      displayName: 'Gemini Principal de Prueba',
      description: 'Modelo principal simulado',
      supportedGenerationMethods: ['generateContent'],
      inputTokenLimit: 1000000,
      outputTokenLimit: 8192
    },
    {
      name: `models/${fallbackModel}`,
      displayName: 'Gemini Respaldo de Prueba',
      description: 'Modelo de respaldo simulado',
      supportedGenerationMethods: ['generateContent'],
      inputTokenLimit: 1000000,
      outputTokenLimit: 8192
    },
    {
      name: `models/${adminModel}`,
      displayName: 'Gemini Administrador de Prueba',
      description: 'Modelo para el cambio manual',
      supportedGenerationMethods: ['generateContent'],
      inputTokenLimit: 1000000,
      outputTokenLimit: 8192
    },
    {
      name: 'models/gemini-embedding-001',
      displayName: 'Embedding de Prueba',
      supportedGenerationMethods: ['embedContent']
    }
  ]
}

function quotaResponse(message = 'Quota exceeded') {
  return {
    error: {
      code: 429,
      message,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
              quotaMetric: 'generate_content_free_tier_requests',
              quotaValue: '10'
            }
          ]
        },
        {
          '@type': 'type.googleapis.com/google.rpc.RetryInfo',
          retryDelay: '2s'
        }
      ]
    }
  }
}

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

const richInvoice = {
  supplier: { name: 'Proveedor IA 1.10', nit: '900123456', confidence: 0.96 },
  invoice: { number: 'IA-102-001', date: '2026-10-27', currency: 'COP', confidence: 0.95 },
  lines: [
    {
      description: 'ADAPTADOR NANO USB INAL TL-WN725N SERIAL: 2261124011483 Hot Sale',
      quantity: 1,
      unitCost: 20000,
      ivaRate: 19,
      supplierSku: 'TL-WN725N',
      serials: ['2261124011483'],
      skuSugerido: '',
      lineTotal: 23800,
      category: 'Redes',
      confidence: 0.97
    },
    {
      description: 'Auriculares KZ Castor Bass 3.5mm con Mic Silver HIFI Bass Hot Sale',
      quantity: 2,
      unitCost: 50000,
      ivaRate: 19,
      supplierSku: 'KZ-CASTOR-BASS',
      serials: [],
      skuSugerido: 'KZ-CASB-35-MIC-SIL',
      lineTotal: 119000,
      category: 'Periféricos',
      confidence: 0.95
    }
  ],
  subtotal: 120000,
  discount: 0,
  iva: 22800,
  total: 142800,
  paymentCondition: 'Crédito',
  paymentMethod: 'Transferencia',
  confidence: 0.95,
  warnings: []
}

const routerInvoice = {
  supplier: { name: 'Proveedor IA 1.10', nit: '900123456', confidence: 0.96 },
  invoice: { number: 'IA-102-003', date: '2026-10-27', currency: 'COP', confidence: 0.95 },
  lines: [
    {
      description: 'Router Mercusys MW302R',
      quantity: 1,
      unitCost: 30000,
      ivaRate: 19,
      supplierSku: 'MW302R',
      serials: [],
      skuSugerido: '',
      lineTotal: 35700,
      category: 'Redes',
      confidence: 0.95
    }
  ],
  subtotal: 30000,
  discount: 0,
  iva: 5700,
  total: 35700,
  confidence: 0.95,
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

function imagePathFromUrl(url) {
  const parsed = new URL(url)
  return path.join(data, decodeURIComponent(parsed.pathname).replace(/^\/+/, ''))
}

async function imageSize(page, src) {
  return page.evaluate(
    (value) =>
      new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () =>
          resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => reject(new Error('No se pudo cargar la imagen'))
        image.src = value
      }),
    src
  )
}

function buildBmp(width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelSize = rowSize * height
  const buffer = Buffer.alloc(54 + pixelSize)
  buffer.write('BM', 0, 'ascii')
  buffer.writeUInt32LE(buffer.length, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(0, 30)
  buffer.writeUInt32LE(pixelSize, 34)
  buffer.writeInt32LE(2835, 38)
  buffer.writeInt32LE(2835, 42)
  let offset = 54
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      buffer[offset++] = Math.round((x / width) * 255)
      buffer[offset++] = Math.round((y / height) * 255)
      buffer[offset++] = Math.round(((x + y) / (width + height)) * 255)
    }
    offset += rowSize - width * 3
  }
  return buffer
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
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
      if (request.method === 'GET' && url.pathname === '/v1beta/models') {
        if (mockMode === 'models-error') {
          sendJson(503, { error: { message: 'Models endpoint unavailable' } })
          return
        }
        sendJson(200, modelCatalog)
        return
      }
      const modelMatch = url.pathname.match(/\/v1beta\/models\/(.+):generateContent$/)
      const model = modelMatch ? decodeURIComponent(modelMatch[1]).replace(/^models\//, '') : ''
      if (model) mockCalls.push(model)
      let payload = {}
      try {
        payload = JSON.parse(body)
      } catch {
        payload = {}
      }
      const prompt = JSON.stringify(payload)
      if (mockMode === 'quota') {
        sendJson(429, { error: { message: 'Quota exceeded' } })
        return
      }
      if (mockMode === 'model-404') {
        sendJson(404, { error: { message: 'Model not found' } })
        return
      }
      if (mockMode === 'invalid-json') {
        sendText('esto no es json')
        return
      }
      if (mockMode === 'primary-quota' && model === primaryModel) {
        sendJson(429, quotaResponse())
        return
      }
      if (mockMode === 'all-quota') {
        sendJson(429, quotaResponse())
        return
      }
      if (mockMode === 'fallback-404' && model === primaryModel) {
        sendJson(404, { error: { message: 'Model not found' } })
        return
      }
      if (mockMode === 'fallback-503' && model === primaryModel) {
        sendJson(503, { error: { message: 'Service unavailable' } })
        return
      }
      if (prompt.includes('Responde únicamente')) {
        sendText('OK')
        return
      }
      if (mockMode === 'rich') {
        sendText(JSON.stringify(richInvoice))
        return
      }
      if (mockMode === 'router') {
        sendText(JSON.stringify(routerInvoice))
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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner 1.10.1')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.10.1')
    await page.getByPlaceholder('usuario').fill('owner')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('Owner12345')
    await page.getByPlaceholder('Repite la contraseña').fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    pass('primer arranque 1.11.0')

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
        model: primaryModel,
        fallbackModels: [fallbackModel, adminModel],
        autoFallback: false,
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
    const badKey = await rpcRaw(page, 'ai.testConnection', { apiKey: 'bad-key', model: primaryModel })
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

    const catalog = await rpc(page, 'ai.listModels')
    assert(catalog.models.length === 3, `El catálogo devolvió ${catalog.models.length} modelos`)
    assert(catalog.models.some((model) => model.id === primaryModel), 'Falta el modelo principal en el catálogo')
    assert(catalog.models.some((model) => model.id === fallbackModel), 'Falta el modelo de respaldo en el catálogo')
    assert(
      !catalog.models.some((model) => model.id.includes('embedding')),
      'El catálogo incluyó modelos sin generateContent'
    )
    const settingsWithCatalog = await rpc(page, 'settings.get')
    assert(settingsWithCatalog.ai.modelCatalog?.length === 3, 'El catálogo no se persistió')
    pass('catálogo de modelos: lista real simulada, filtro y persistencia')

    const fallbackEnabled = await rpc(page, 'settings.updateSection', {
      section: 'ai',
      value: { autoFallback: true, fallbackModels: [fallbackModel, adminModel] }
    })
    assert(fallbackEnabled.ai.autoFallback === true, 'El respaldo automático no se activó')
    assert(
      fallbackEnabled.ai.fallbackModels?.length === 2,
      'No se guardaron los dos modelos de respaldo'
    )

    await rpc(page, 'ai.setModel', { model: primaryModel })
    mockCalls.length = 0
    mockMode = 'primary-quota'
    const fallbackDraft = await rpc(page, 'purchases.scanInvoice', { file: imageFile })
    assert(fallbackDraft.ai.model === fallbackModel, 'No se usó el modelo de respaldo')
    assert(fallbackDraft.ai.requestedModel === primaryModel, 'No se conservó el modelo solicitado')
    assert(fallbackDraft.ai.fallbackUsed === true, 'La extracción no marca el respaldo')
    assert(fallbackDraft.ai.attempts?.[0]?.code === 'AI_QUOTA', 'El intento agotado no quedó registrado')
    assert(fallbackDraft.ai.attempts?.[0]?.retryAfterSeconds === 2, 'No se conservó el retryDelay')
    assert(
      fallbackDraft.warnings.some((warning) => warning.includes('respaldo')),
      'La revisión no advierte que se usó el respaldo'
    )
    assert(
      mockCalls[0] === primaryModel && mockCalls[1] === fallbackModel,
      `Orden de intentos inesperado: ${mockCalls.join(', ')}`
    )
    pass('respaldo automático: cuota agotada, espera y segundo modelo')

    for (const model of [primaryModel, fallbackModel, adminModel]) {
      await rpc(page, 'ai.setModel', { model })
    }
    await rpc(page, 'ai.setModel', { model: primaryModel })
    await rpc(page, 'settings.updateSection', {
      section: 'ai',
      value: { autoFallback: true, fallbackModels: [fallbackModel, adminModel] }
    })
    mockCalls.length = 0
    mockMode = 'all-quota'
    const allQuota = await rpcRaw(page, 'purchases.scanInvoice', { file: imageFile })
    assert(!allQuota.ok, 'La IA aceptó una factura con todos los modelos agotados')
    assert(allQuota.error.code === 'AI_ALL_MODELS_FAILED', `Código inesperado: ${allQuota.error.code}`)
    assert(allQuota.error.details?.attempts?.length === 3, 'No se registraron los tres intentos')
    assert(allQuota.error.details?.retryAfterSeconds === 2, 'No se propagó el retryDelay al error final')
    pass('cuota agotada en todos los modelos: error agregado y espera')

    for (const model of [primaryModel, fallbackModel, adminModel]) {
      await rpc(page, 'ai.setModel', { model })
    }
    await rpc(page, 'ai.setModel', { model: primaryModel })
    await rpc(page, 'settings.updateSection', {
      section: 'ai',
      value: { autoFallback: false }
    })
    mockCalls.length = 0
    mockMode = 'primary-quota'
    const quotaOnly = await rpcRaw(page, 'purchases.scanInvoice', { file: imageFile })
    assert(!quotaOnly.ok, 'La IA aceptó una factura con el modelo agotado')
    assert(quotaOnly.error.code === 'AI_QUOTA', `Código inesperado: ${quotaOnly.error.code}`)
    assert(quotaOnly.error.details?.retryAfterSeconds === 2, 'El error de cuota no conservó la espera')
    assert(
      mockCalls.length === 1 && mockCalls[0] === primaryModel,
      'Se intentó el respaldo con el cambio automático desactivado'
    )
    pass('cambio automático desactivado: solo se intenta el principal')

    await rpc(page, 'ai.setModel', { model: primaryModel })
    await rpc(page, 'settings.updateSection', {
      section: 'ai',
      value: { autoFallback: true, fallbackModels: [fallbackModel, adminModel] }
    })
    mockMode = 'fallback-404'
    mockCalls.length = 0
    const fallback404 = await rpc(page, 'purchases.scanInvoice', { file: imageFile })
    assert(fallback404.ai.model === fallbackModel, 'No se usó el respaldo ante un modelo inexistente')
    assert(fallback404.ai.attempts?.[0]?.code === 'AI_MODEL_NOT_FOUND', 'No se registró el 404 del principal')
    mockMode = 'fallback-503'
    mockCalls.length = 0
    const fallback503 = await rpc(page, 'purchases.scanInvoice', { file: imageFile })
    assert(fallback503.ai.model === fallbackModel, 'No se usó el respaldo ante un 503')
    assert(fallback503.ai.attempts?.[0]?.code === 'AI_UNAVAILABLE', 'No se registró el 503 del principal')
    pass('respaldo ante modelo inexistente y servicio no disponible')

    const admin = await rpc(page, 'users.create', {
      name: 'Admin IA 1.10.1',
      username: 'admin101',
      email: 'admin101@taller.co',
      role: 'admin',
      password: 'Admin12345'
    })
    const tech = await rpc(page, 'users.create', {
      name: 'Tecnico IA 1.10.1',
      username: 'tec101',
      email: 'tec101@taller.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const adminLogin = await rpc(page, 'auth.login', {
      username: 'admin101',
      password: 'Admin12345'
    })
    const techLogin = await rpc(page, 'auth.login', {
      username: 'tec101',
      password: 'Tecnico12345'
    })
    assert(admin.id && tech.id, 'No se crearon los usuarios de prueba')
    const adminCatalog = await rpc(page, 'ai.listModels', {}, adminLogin.token)
    assert(adminCatalog.models.length === 3, 'El administrador no pudo consultar el catálogo')
    const adminSet = await rpc(page, 'ai.setModel', { model: fallbackModel }, adminLogin.token)
    assert(adminSet.model === fallbackModel, 'El administrador no pudo cambiar el modelo')
    const adminSettings = await rpc(page, 'settings.get', {}, adminLogin.token)
    assert(adminSettings.ai.model === fallbackModel, 'El cambio del administrador no se persistió')
    const adminCannotConfigure = await rpcRaw(
      page,
      'settings.updateSection',
      { section: 'ai', value: { model: primaryModel } },
      adminLogin.token
    )
    assert(!adminCannotConfigure.ok, 'El administrador pudo modificar la clave o el respaldo')
    const techCannotList = await rpcRaw(page, 'ai.listModels', {}, techLogin.token)
    assert(!techCannotList.ok, 'El técnico pudo consultar el catálogo de IA')
    const techCannotSet = await rpcRaw(
      page,
      'ai.setModel',
      { model: primaryModel },
      techLogin.token
    )
    assert(!techCannotSet.ok, 'El técnico pudo cambiar el modelo de IA')
    await rpc(page, 'ai.setModel', { model: primaryModel })
    pass('permisos: administrador cambia modelo; técnico no; clave sigue siendo del propietario')

    mockMode = 'rich'
    const richDraft = await rpc(page, 'purchases.scanInvoice', { file: imageFile })
    assert(richDraft.invoice.number === 'IA-102-001', 'Número de factura enriquecida incorrecto')
    assert(richDraft.invoice.paymentCondition === 'credito', 'No se detectó la condición de crédito')
    const adapterLine = richDraft.lines[0]
    const headphoneLine = richDraft.lines[1]
    assert(
      adapterLine.description === 'ADAPTADOR NANO USB INAL TL-WN725N',
      `Nombre del adaptador no limpio: ${adapterLine.description}`
    )
    assert(adapterLine.serialText === '2261124011483', 'No se extrajo el serial del nombre')
    assert(adapterLine.supplierSku === 'TL-WN725N', 'No se conservó el SKU del proveedor')
    assert(adapterLine.skuSugerido === 'WIFI-TPL-WN725N', `SKU local inesperado: ${adapterLine.skuSugerido}`)
    assert(adapterLine.skuSource === 'local', `Origen de SKU inesperado: ${adapterLine.skuSource}`)
    assert(adapterLine.unitCostWithTax === 23800, 'Costo con IVA incorrecto para el adaptador')
    assert(
      headphoneLine.description === 'Auriculares KZ Castor Bass 3.5mm con Mic Silver',
      `Nombre de auriculares no limpio: ${headphoneLine.description}`
    )
    assert(headphoneLine.skuSugerido === 'KZ-CASB-35-MIC-SIL', 'No se aceptó el SKU modular de la IA')
    assert(headphoneLine.skuSource === 'ia', 'El SKU de la IA no se marcó como tal')
    assert(headphoneLine.unitCostWithTax === 59500, 'Costo con IVA incorrecto para auriculares')
    pass('IA 1.10.2: SKU interno, SKU proveedor, seriales y limpieza de nombre')

    const creditPurchase = await rpc(page, 'purchases.createFromReview', {
      supplierId: supplier.id,
      number: 'IA-102-001',
      date: '2026-10-27T12:00:00.000Z',
      discount: 0,
      realTotal: 142800,
      updatePrices: false,
      duplicateConfirmed: false,
      paymentCondition: 'credito',
      paymentMethod: 'Transferencia',
      initialPayment: 50000,
      dueDate: '2026-11-27T12:00:00.000Z',
      notes: 'Compra a crédito 1.10.2',
      aiMetadata: richDraft.ai,
      lines: [
        {
          description: adapterLine.description,
          quantity: 1,
          unitCost: 20000,
          ivaRate: 19,
          productId: null,
          supplierSku: adapterLine.supplierSku,
          serialText: adapterLine.serialText,
          newProduct: {
            name: adapterLine.description,
            sku: adapterLine.skuSugerido,
            supplierSku: adapterLine.supplierSku,
            category: 'Redes',
            location: 'Bodega A',
            price: 35000,
            warrantyDays: 90
          }
        },
        {
          description: headphoneLine.description,
          quantity: 2,
          unitCost: 50000,
          ivaRate: 19,
          productId: null,
          supplierSku: headphoneLine.supplierSku,
          serialText: '',
          newProduct: {
            name: headphoneLine.description,
            sku: headphoneLine.skuSugerido,
            supplierSku: headphoneLine.supplierSku,
            category: 'Periféricos',
            location: 'Bodega A',
            price: 100000,
            warrantyDays: 90
          }
        }
      ]
    })
    assert(creditPurchase.total === 142800, 'Total de la compra a crédito incorrecto')
    assert(creditPurchase.paymentStatus === 'parcial', 'La compra a crédito no quedó abonada')
    assert(creditPurchase.paid === 50000 && creditPurchase.balance === 92800, 'Saldo inicial incorrecto')
    assert(creditPurchase.payments.length === 1, 'No se registró el abono inicial')
    assert(creditPurchase.lines[0].supplierSku === 'TL-WN725N', 'El SKU proveedor no se guardó en la línea')
    assert(creditPurchase.lines[0].serialText === '2261124011483', 'El serial no se guardó en la línea')
    assert(creditPurchase.lines[0].unitPriceWithTax === 23800, 'El costo con IVA de la línea no se calculó')
    const inventoryAfterRich = await rpc(page, 'inventory.list')
    const adapterProduct = inventoryAfterRich.find((item) => item.sku === 'WIFI-TPL-WN725N')
    const headphoneProduct = inventoryAfterRich.find((item) => item.sku === 'KZ-CASB-35-MIC-SIL')
    assert(adapterProduct?.supplierSku === 'TL-WN725N', 'El producto nuevo no conservó el SKU proveedor')
    assert(headphoneProduct?.supplierSku === 'KZ-CASTOR-BASS', 'El segundo producto no conservó su referencia')
    pass('compra IA a crédito: SKU proveedor, seriales, saldo inicial y productos nuevos')

    const overpay = await rpcRaw(page, 'purchases.addPayment', {
      purchaseId: creditPurchase.id,
      amount: 999999,
      method: 'Transferencia'
    })
    assert(!overpay.ok, 'Se permitió un abono mayor al saldo')
    const firstPayment = await rpc(page, 'purchases.addPayment', {
      purchaseId: creditPurchase.id,
      amount: 40000,
      method: 'Transferencia',
      notes: 'Abono 1'
    })
    assert(firstPayment.paymentStatus === 'parcial', 'El abono parcial no actualizó el estado')
    assert(firstPayment.balance === 52800, `Saldo tras abono inesperado: ${firstPayment.balance}`)
    assert(firstPayment.payments.length === 2, 'No se acumularon los abonos')
    const finalPayment = await rpc(page, 'purchases.addPayment', {
      purchaseId: creditPurchase.id,
      amount: 52800,
      method: 'Transferencia',
      notes: 'Abono final'
    })
    assert(finalPayment.paymentStatus === 'pagada', 'La compra no quedó pagada')
    assert(finalPayment.balance === 0 && finalPayment.paid === 142800, 'Saldo final incorrecto')
    assert(finalPayment.payments.length === 3, 'No se registró el historial completo de pagos')
    pass('crédito: abonos, saldo, estado y bloqueo de sobrepago')

    const manualCredit = await rpc(page, 'purchases.create', {
      supplierId: supplier.id,
      number: 'IA-102-002',
      date: '2026-10-27T12:00:00.000Z',
      status: 'recibida',
      paymentCondition: 'credito',
      initialPayment: 0,
      paymentMethod: 'Transferencia',
      items: [
        {
          productId: battery.id,
          quantity: 1,
          unitPrice: 60000,
          supplierSku: 'BAT-EXTRA',
          serialText: 'SN-102'
        }
      ]
    })
    assert(manualCredit.paymentStatus === 'pendiente', 'La compra manual no quedó pendiente')
    assert(manualCredit.paid === 0 && manualCredit.balance === 71400, 'Saldo manual incorrecto')
    assert(manualCredit.payments.length === 0, 'La compra a crédito no debe tener abonos')
    assert(manualCredit.lines[0].supplierSku === 'BAT-EXTRA', 'El SKU proveedor manual no se guardó')
    assert(manualCredit.lines[0].serialText === 'SN-102', 'El serial manual no se guardó')
    const inventoryAfterManual = await rpc(page, 'inventory.list')
    const batteryAfterManual = inventoryAfterManual.find((item) => item.id === battery.id)
    assert(batteryAfterManual?.supplierSku === 'BAT-EXTRA', 'No se actualizó el SKU proveedor del producto')
    pass('compra manual a crédito: SKU proveedor, seriales y cuenta por pagar')

    mockMode = 'standard'
    await page.getByText('Compras', { exact: true }).first().click()
    await page.getByText('Compras y proveedores', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.getByText('IA-102-002', { exact: true }).first().click()
    const creditDrawer = page.getByRole('dialog', { name: 'Compra IA-102-002' })
    await creditDrawer.waitFor({ timeout: 15000 })
    await creditDrawer.getByRole('button', { name: 'Registrar abono' }).waitFor({ timeout: 15000 })
    await creditDrawer.getByText('Crédito', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(shots, '05-credito.png') })
    await creditDrawer.getByLabel('Cerrar').click()
    pass('interfaz de crédito: saldo y acción de abono visibles')

    await rpc(page, 'inventory.create', {
      name: 'Producto viejo de prueba',
      sku: 'ROU-MERC-MW302R',
      supplierSku: 'OLD-ROUTER',
      category: 'Redes',
      location: 'Bodega A',
      stock: 0,
      minStock: 0,
      cost: 5000,
      price: 10000,
      warrantyDays: 0,
      rotation: 'rotativo'
    })
    mockMode = 'router'
    const routerDraft = await rpc(page, 'purchases.scanInvoice', { file: imageFile })
    assert(
      routerDraft.lines[0].skuSugerido === 'ROU-MERC-MW302R-2',
      `La colisión de SKU no se resolvió: ${routerDraft.lines[0].skuSugerido}`
    )
    pass('SKU interno: colisión resuelta sin duplicar productos')

    mockMode = 'standard'
    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('IA y API', { exact: true }).first().click()
    await page.getByText('Modelo principal', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.getByText('Respaldo automático', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Modelo de respaldo', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Actualizar modelos' }).click()
    await page.getByText('Modelos actualizados', { exact: false }).first().waitFor({ timeout: 20000 })
    const catalogAfterUi = await rpc(page, 'settings.get')
    assert(catalogAfterUi.ai.modelCatalog?.length === 3, 'La interfaz no actualizó el catálogo')
    await page.getByRole('button', { name: 'Probar conexión' }).click()
    await page.getByText('Conexión con Gemini correcta', { exact: false }).first().waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await page.getByText('Configuración de IA guardada', { exact: false }).first().waitFor({ timeout: 20000 })
    pass('interfaz de propietario: modelo principal, respaldos, catálogo y prueba de conexión')
    await page.screenshot({ path: path.join(shots, '01-configuracion-ia.png') })

    mockMode = 'all-quota'
    await page.getByText('Compras', { exact: true }).first().click()
    await page.getByText('Compras y proveedores', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'Escanear factura' }).first().click()
    const errorScanDialog = page.getByRole('dialog', { name: 'Escanear factura de compra' })
    await errorScanDialog.waitFor({ timeout: 15000 })
    await errorScanDialog.locator('input[type=file]').last().setInputFiles({
      name: 'factura-cuota.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_BASE64, 'base64')
    })
    await errorScanDialog.getByText('factura-cuota.png', { exact: true }).waitFor({ timeout: 15000 })
    await errorScanDialog.getByRole('button', { name: 'Escanear factura' }).click()
    await errorScanDialog
      .getByText('No se pudo analizar la factura', { exact: true })
      .waitFor({ timeout: 30000 })
    await errorScanDialog
      .getByText('Puedes reintentar en aproximadamente 2 s.', { exact: true })
      .waitFor({ timeout: 15000 })
    await errorScanDialog.getByText('Modelos intentados:', { exact: false }).waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(shots, '02-error-cuota.png') })
    const modelInput = errorScanDialog.getByLabel('Modelo de IA para la factura')
    await modelInput.fill(adminModel)
    await errorScanDialog.getByRole('button', { name: 'Cambiar' }).click()
    await page.getByText('Modelo actualizado', { exact: false }).first().waitFor({ timeout: 20000 })
    mockMode = 'standard'
    await errorScanDialog.getByRole('button', { name: 'Reintentar' }).click()
    const retryReviewDialog = page.getByRole('dialog', { name: 'Revisar factura de compra' })
    await retryReviewDialog.waitFor({ timeout: 30000 })
    await retryReviewDialog.getByRole('button', { name: 'Cancelar' }).click()
    pass('interfaz: cuota agotada, cambio de modelo y reintento sin perder la factura')

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

    await page.evaluate(
      (token) => sessionStorage.setItem('bitacoretech.session.token', token),
      adminLogin.token
    )
    await page.reload()
    await page.getByText('Compras', { exact: true }).first().waitFor({ timeout: 30000 })
    await page.getByText('Compras', { exact: true }).first().click()
    await page.getByText('Compras y proveedores', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'Escanear factura' }).first().click()
    const adminScanDialog = page.getByRole('dialog', { name: 'Escanear factura de compra' })
    await adminScanDialog.waitFor({ timeout: 15000 })
    await adminScanDialog.getByLabel('Modelo de IA para la factura').fill(primaryModel)
    await adminScanDialog.getByRole('button', { name: 'Cambiar' }).click()
    await page.getByText('Modelo actualizado', { exact: false }).first().waitFor({ timeout: 20000 })
    const adminAfterUi = await rpc(page, 'settings.get', {}, adminLogin.token)
    assert(adminAfterUi.ai.model === primaryModel, 'El cambio de modelo del administrador no se guardó')
    await adminScanDialog.getByRole('button', { name: 'Cancelar' }).click()
    pass('interfaz de administrador: cambio rápido de modelo dentro del escaneo')
    await page.screenshot({ path: path.join(shots, '04-admin-modelo.png') })

    const ownerLogin = await rpc(page, 'auth.login', {
      username: 'owner',
      password: 'Owner12345'
    })
    await page.evaluate(
      (token) => sessionStorage.setItem('bitacoretech.session.token', token),
      ownerLogin.token
    )
    await page.reload()
    await page.getByText('Inventario', { exact: true }).first().waitFor({ timeout: 30000 })
    await page.getByText('Inventario', { exact: true }).first().click()
    await page.getByRole('heading', { name: 'Inventario' }).waitFor({ timeout: 20000 })

    const dictionariesBefore = await rpc(page, 'dictionaries.list')
    const incomeAccountSeed = dictionariesBefore.find((item) => item.type === 'income_account')
    assert(incomeAccountSeed, 'No se creó la cuenta de ingresos')
    const incomeAccount = await rpc(page, 'dictionaries.update', {
      id: incomeAccountSeed.id,
      active: true,
      responsibleUserId: admin.id
    })
    assert(incomeAccount.active && incomeAccount.responsibleUserId === admin.id, 'La cuenta de ingresos no quedó activa con responsable')
    const purchaseAccount = await rpc(page, 'dictionaries.create', {
      type: 'purchase_payment_account',
      name: 'Nequi David 1.11',
      code: 'nequi_david_111',
      channel: 'Transferencia',
      linkedIncomeAccountId: incomeAccount.id,
      active: true
    })
    assert(purchaseAccount.channel === 'Transferencia', 'La cuenta de compra no conservó el canal')
    assert(purchaseAccount.linkedIncomeAccountId === incomeAccount.id, 'La cuenta de compra no quedó vinculada')
    pass('cuentas de pago: cuenta de ingresos con responsable y cuenta de compra vinculada')

    const cashBefore = await rpc(page, 'cash.current')
    if (cashBefore.current) await rpc(page, 'cash.close', { counted: 0 })
    const cashOpened = await rpc(page, 'cash.open', { initialAmount: 0 })
    assert(cashOpened.initialAmount === 0, 'La caja no abrió con base 0')
    const cashClosedZero = await rpc(page, 'cash.close', { counted: 0 })
    assert(cashClosedZero.status === 'cerrado' && cashClosedZero.counted === 0, 'No se cerró con conteo 0')
    assert(cashClosedZero.difference === 0, `Diferencia inesperada con base 0: ${cashClosedZero.difference}`)
    assert(cashClosedZero.carryOver === 0, 'La base siguiente no quedó en 0')
    pass('caja: base 0, conteo total y cierre con 0')

    const customer = await rpc(page, 'customers.create', {
      name: 'Cliente 1.11',
      documentType: 'CC',
      document: '900111222'
    })
    await rpc(page, 'cash.open', { initialAmount: 0 })
    const digitalSale = await rpc(page, 'pos.sell', {
      customerId: customer.id,
      lines: [{ productId: battery.id, quantity: 1 }],
      method: 'Transferencia',
      receipt: {
        dataUrl: `data:image/png;base64,${PNG_BASE64}`,
        name: 'venta-1.11.png',
        mimeType: 'image/png'
      }
    })
    assert(digitalSale.invoice.incomeAccountName === incomeAccount.name, 'La venta digital no se asoció a la cuenta de ingresos')
    assert(digitalSale.invoice.createdByName, 'La venta no guardó el vendedor')
    assert(digitalSale.invoice.createdByRole === 'superadmin', 'La venta no guardó el rol del vendedor')
    assert(digitalSale.invoice.paymentReceipt?.filename === 'venta-1.11.png', 'La venta no guardó el comprobante')
    assert(
      fs.existsSync(imagePathFromUrl(digitalSale.invoice.paymentReceipt.url)),
      'El comprobante de la venta no existe en disco'
    )
    const cashSale = await rpc(page, 'pos.sell', {
      customerId: customer.id,
      lines: [{ productId: battery.id, quantity: 1 }],
      method: 'Efectivo',
      received: 999999
    })
    const cashClosedNegative = await rpc(page, 'cash.close', { counted: 0 })
    assert(cashClosedNegative.difference < 0, 'El cierre con 0 no mostró diferencia negativa')
    assert(cashClosedNegative.status === 'cerrado', 'El cierre con diferencia negativa no se permitió')
    assert(cashSale.invoice.total > 0, 'La venta en efectivo no se registró')
    pass('POS: vendedor, cuenta digital y comprobante; cierre con 0 y diferencia')

    await rpc(page, 'cash.open', { initialAmount: 0 })
    const testOrder = await rpc(page, 'orders.create', {
      customerId: customer.id,
      category: 'laptop',
      categoryLabel: 'Laptop',
      equipmentType: 'Portátil',
      brand: 'Lenovo',
      model: 'IdeaPad 1.11',
      serial: `TEST-OT-${Date.now()}`,
      physicalCondition: 'Sin observaciones',
      accessories: 'Cargador',
      reportedIssue: 'Prueba de comprobante',
      promisedAt: new Date(Date.now() + 86400000).toISOString(),
      technicianId: admin.id,
      intake: { estimate: 100000, diagnosticFee: 0 }
    })
    assert(testOrder.technicianId === admin.id, 'El administrador no pudo quedar como técnico')
    const orderPayment = await rpc(page, 'orders.addPayment', {
      id: testOrder.id,
      amount: 20000,
      method: 'Transferencia',
      receipt: {
        dataUrl: `data:image/png;base64,${PNG_BASE64}`,
        name: 'anticipo-1.11.png',
        mimeType: 'image/png'
      }
    })
    assert(orderPayment.payments?.[0]?.receipt?.filename === 'anticipo-1.11.png', 'La OT no guardó el comprobante')
    assert(
      fs.existsSync(imagePathFromUrl(orderPayment.payments[0].receipt.url)),
      'El comprobante de la OT no existe en disco'
    )
    pass('OT: administrador como técnico y anticipo con comprobante')

    await rpc(page, 'cash.close', { counted: 0 })
    const accountPurchase = await rpc(page, 'purchases.create', {
      supplierId: supplier.id,
      number: `ACC-1.11-${Date.now()}`,
      date: new Date().toISOString(),
      paymentCondition: 'contado',
      paymentMethod: 'Transferencia',
      paymentAccountId: purchaseAccount.id,
      items: [{ productId: battery.id, quantity: 1, unitPrice: 10000 }]
    })
    assert(accountPurchase.paymentAccount === purchaseAccount.name, 'La compra no guardó la cuenta de pago')
    assert(accountPurchase.linkedIncomeAccountName === incomeAccount.name, 'La compra no se vinculó a la cuenta de ingresos')
    const report = await rpc(page, 'reports.summary', { period: '30d' })
    assert(report.salesByUser.some((row) => row.name === 'Owner 1.10.1'), 'El reporte no agrupó las ventas por vendedor')
    assert(report.purchasesByUser.some((row) => row.name === 'Owner 1.10.1'), 'El reporte no agrupó las compras por comprador')
    assert(report.accountSummary.some((row) => row.accountName === incomeAccount.name && row.income > 0), 'La cuenta de ingresos no registró entradas')
    assert(report.accountSummary.some((row) => row.accountName === incomeAccount.name && row.expenses > 0), 'La cuenta de ingresos no registró la compra')
    await rpc(page, 'settings.updateSection', { section: 'tracking', value: { purchasesByUser: false } })
    const reportWithoutTracking = await rpc(page, 'reports.summary', { period: '30d' })
    assert(reportWithoutTracking.purchaseTrackingEnabled === false, 'El interruptor de compras no se desactivó')
    assert(reportWithoutTracking.purchasesByUser.length === 0, 'El reporte de compras siguió visible con el rastreo apagado')
    await rpc(page, 'settings.updateSection', { section: 'tracking', value: { purchasesByUser: true } })
    pass('reportes: ventas por vendedor, compras por comprador e interruptor de rastreo')

    const techDictionaries = await rpc(page, 'dictionaries.list', {}, techLogin.token)
    assert(
      !techDictionaries.some((item) => item.type === 'purchase_payment_account' || item.type === 'income_account'),
      'El técnico pudo ver las cuentas de pago'
    )
    const techCreateAccount = await rpcRaw(
      page,
      'dictionaries.create',
      { type: 'purchase_payment_account', name: 'No permitido', channel: 'Transferencia' },
      techLogin.token
    )
    assert(!techCreateAccount.ok, 'El técnico pudo crear una cuenta de pago')
    const technicianOptions = await rpc(page, 'orders.technicians', {}, techLogin.token)
    assert(technicianOptions.some((item) => item.id === admin.id), 'El administrador no aparece como técnico')
    assert(!technicianOptions.some((item) => item.id === 'u1'), 'El superadmin aparece como técnico')
    pass('permisos: diccionarios solo admin, admin como técnico y superadmin fuera de técnicos')

    const uiName = 'Impresora térmica UI 1.11.0'
    const bmpBuffer = buildBmp(1600, 1200)
    await page.getByRole('button', { name: 'Nuevo producto' }).click()
    const createDialog = page.getByRole('dialog', { name: 'Nuevo producto' })
    await createDialog.waitFor({ timeout: 15000 })
    await createDialog.getByPlaceholder('Ej. SSD NVMe 1TB').fill(uiName)
    await createDialog.locator('input[type=file]').setInputFiles({
      name: 'producto-1600.bmp',
      mimeType: 'image/bmp',
      buffer: bmpBuffer
    })
    const uiPreview = createDialog.locator('img[alt="Imagen del producto"]')
    await uiPreview.waitFor({ timeout: 20000 })
    const previewSrc = await uiPreview.getAttribute('src')
    assert(previewSrc?.startsWith('data:image/jpeg'), 'La vista previa no se comprimió a JPEG')
    const previewSize = await imageSize(page, previewSrc)
    assert(
      previewSize.width === 1200 && previewSize.height === 900,
      `La imagen principal no se limitó a 1200 px: ${JSON.stringify(previewSize)}`
    )
    await createDialog.getByLabel('Costo unitario').fill('20000')
    await createDialog.getByLabel('Precio de venta').fill('45000')
    await createDialog.getByRole('button', { name: 'Crear producto' }).click()
    await page.getByText('Producto creado', { exact: true }).first().waitFor({ timeout: 30000 })
    const uiProduct = (await rpc(page, 'inventory.list')).find((item) => item.name === uiName)
    assert(uiProduct, 'El producto con imagen no se creó')
    assert(
      uiProduct.sku.startsWith('PROD-'),
      `El SKU automático no tiene formato interno: ${uiProduct.sku}`
    )
    assert(uiProduct.imageUrl && uiProduct.imageThumbnailUrl, 'El producto no conservó las imágenes')
    const uiImagePath = imagePathFromUrl(uiProduct.imageUrl)
    const uiThumbPath = imagePathFromUrl(uiProduct.imageThumbnailUrl)
    assert(fs.existsSync(uiImagePath), 'No se guardó la imagen principal')
    assert(fs.existsSync(uiThumbPath), 'No se guardó la miniatura')
    const thumbnailSize = await imageSize(page, uiProduct.imageThumbnailUrl)
    assert(
      thumbnailSize.width === 300 && thumbnailSize.height === 225,
      `La miniatura no se limitó a 300 px: ${JSON.stringify(thumbnailSize)}`
    )
    await page.getByText(uiName, { exact: true }).first().click()
    const detailDrawer = page.getByRole('dialog', { name: uiName })
    await detailDrawer.waitFor({ timeout: 15000 })
    const detailImage = detailDrawer.getByRole('img', { name: uiName })
    await detailImage.waitFor({ timeout: 15000 })
    const detailSize = await imageSize(page, await detailImage.getAttribute('src'))
    assert(
      detailSize.width === 1200 && detailSize.height === 900,
      'La ficha no muestra la imagen principal guardada'
    )
    await page.screenshot({ path: path.join(shots, '06-imagen-producto.png') })
    pass('imagen principal: archivo, compresión, miniatura y protocolo local')

    await detailDrawer.getByRole('button', { name: 'Editar referencia' }).click()
    const editDialog = page.getByRole('dialog', { name: 'Editar referencia' })
    await editDialog.waitFor({ timeout: 15000 })
    await page.evaluate(
      ({ base64 }) => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        const file = new File([bytes], 'pegada.png', { type: 'image/png' })
        const transfer = new DataTransfer()
        transfer.items.add(file)
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', { value: transfer })
        document.body.dispatchEvent(event)
      },
      { base64: PNG_BASE64 }
    )
    await editDialog.getByRole('button', { name: 'Guardar cambios' }).click()
    await page.waitForFunction(
      async ({ id, previous }) => {
        const token = sessionStorage.getItem('bitacoretech.session.token')
        const response = await window.bitacoretech.rpc(
          'inventory.list',
          token ? { __token: token } : {}
        )
        if (!response.ok) return false
        const product = response.data.find((item) => item.id === id)
        return Boolean(product && product.imageUrl && product.imageUrl !== previous)
      },
      { id: uiProduct.id, previous: uiProduct.imageUrl },
      { timeout: 30000 }
    )
    const replacedProduct = (await rpc(page, 'inventory.list')).find(
      (item) => item.id === uiProduct.id
    )
    assert(replacedProduct?.imageUrl, 'La imagen pegada no se guardó')
    assert(
      replacedProduct.imageUrl !== uiProduct.imageUrl,
      'La imagen principal no se reemplazó'
    )
    const replacedImagePath = imagePathFromUrl(replacedProduct.imageUrl)
    assert(fs.existsSync(replacedImagePath), 'No se guardó la imagen reemplazada')
    assert(!fs.existsSync(uiImagePath), 'La imagen anterior no se eliminó del disco')
    assert(!fs.existsSync(uiThumbPath), 'La miniatura anterior no se eliminó del disco')

    await detailDrawer.getByRole('button', { name: 'Editar referencia' }).click()
    const removeDialog = page.getByRole('dialog', { name: 'Editar referencia' })
    await removeDialog.waitFor({ timeout: 15000 })
    await removeDialog.getByRole('button', { name: 'Quitar' }).click()
    assert(
      (await removeDialog.locator('img[alt="Imagen del producto"]').count()) === 0,
      'La vista previa no se ocultó al quitar la imagen'
    )
    await removeDialog.getByRole('button', { name: 'Guardar cambios' }).click()
    await page.waitForFunction(
      async ({ id }) => {
        const token = sessionStorage.getItem('bitacoretech.session.token')
        const response = await window.bitacoretech.rpc(
          'inventory.list',
          token ? { __token: token } : {}
        )
        if (!response.ok) return false
        const product = response.data.find((item) => item.id === id)
        return Boolean(product && product.imageUrl === null)
      },
      { id: uiProduct.id },
      { timeout: 30000 }
    )
    assert(!fs.existsSync(replacedImagePath), 'La imagen eliminada sigue en el disco')
    pass('imagen principal: Ctrl+V, reemplazo y eliminación con limpieza de archivos')

    const suggestion = await rpc(page, 'inventory.suggestSku', {
      name: 'Router Mercusys MW302R'
    })
    assert(
      suggestion.sku === 'ROU-MERC-MW302R-2',
      `La sugerencia de SKU no resolvió la colisión: ${suggestion.sku}`
    )
    const autoProduct = await rpc(page, 'inventory.create', {
      name: 'Router Mercusys MW302R',
      sku: '',
      supplierSku: 'MW302R',
      category: 'Redes',
      location: 'Bodega A',
      stock: 0,
      minStock: 0,
      cost: 5000,
      price: 10000,
      warrantyDays: 0,
      rotation: 'rotativo'
    })
    assert(
      autoProduct.sku === suggestion.sku,
      `El alta sin SKU no generó el SKU esperado: ${autoProduct.sku}`
    )
    const bulkProduct = await rpc(page, 'inventory.create', {
      name: 'Producto legado sin SKU',
      sku: 'LEG-103',
      category: 'Repuestos',
      location: 'Bodega A',
      stock: 0,
      minStock: 0,
      cost: 1000,
      price: 2000,
      warrantyDays: 0,
      rotation: 'rotativo'
    })
    const external = new DatabaseSync(path.join(data, 'bitacoretech.db'))
    try {
      external.exec('PRAGMA busy_timeout = 5000')
      external.prepare('UPDATE products SET sku = ? WHERE id = ?').run('', bulkProduct.id)
    } finally {
      external.close()
    }
    const bulkResult = await rpc(page, 'inventory.generateMissingSkus')
    assert(bulkResult.updated >= 1, 'La generación masiva no actualizó el producto legado')
    const bulkAfter = (await rpc(page, 'inventory.list')).find(
      (item) => item.id === bulkProduct.id
    )
    assert(
      bulkAfter?.sku?.startsWith('PROD-'),
      `El producto legado no recibió un SKU válido: ${bulkAfter?.sku}`
    )
    pass('SKU automático: sugerencia, alta vacía y generación masiva')

    const backupProduct = await rpc(page, 'inventory.create', {
      name: 'Producto respaldo con imagen',
      sku: '',
      supplierSku: 'BKP-103',
      category: 'Repuestos',
      location: 'Bodega A',
      stock: 0,
      minStock: 0,
      cost: 1000,
      price: 2000,
      warrantyDays: 0,
      rotation: 'rotativo',
      imageDataUrl: `data:image/png;base64,${PNG_ALT_BASE64}`,
      imageThumbnailDataUrl: `data:image/png;base64,${PNG_ALT_BASE64}`
    })
    assert(backupProduct.imageUrl, 'El producto de respaldo no quedó con imagen')
    const backupImagePath = imagePathFromUrl(backupProduct.imageUrl)
    const fullBackup = await rpc(page, 'backups.create')
    const fullManifest = JSON.parse(
      fs.readFileSync(path.join(fullBackup.backup.path, 'manifest.json'), 'utf8')
    )
    const archivedImage = fullManifest.productImages.files.find((file) =>
      file.path.replace(/\\/g, '/').startsWith(`${backupProduct.id}/`)
    )
    assert(fullManifest.productImages.count >= 2, 'El respaldo no contó las imágenes de inventario')
    assert(archivedImage, 'El manifiesto no incluyó la imagen del producto')
    assert(
      fs.existsSync(path.join(fullBackup.backup.path, 'product-images', archivedImage.path)),
      'La imagen no se copió a la carpeta de respaldo'
    )
    const saleReceiptPath = imagePathFromUrl(digitalSale.invoice.paymentReceipt.url)
    const saleReceiptRelative = path
      .relative(path.join(data, 'payment-receipts'), saleReceiptPath)
      .replace(/\\/g, '/')
    const archivedReceipt = fullManifest.paymentReceipts?.files?.find(
      (file) => file.path.replace(/\\/g, '/') === saleReceiptRelative
    )
    assert(fullManifest.paymentReceipts?.count >= 1, 'El respaldo no contó los comprobantes')
    assert(archivedReceipt, 'El manifiesto no incluyó el comprobante de pago')
    assert(
      fs.existsSync(path.join(fullBackup.backup.path, 'payment-receipts', archivedReceipt.path)),
      'El comprobante no se copió a la carpeta de respaldo'
    )
    await rpc(page, 'inventory.update', { id: backupProduct.id, removeImage: true })
    assert(!fs.existsSync(backupImagePath), 'La imagen no se eliminó antes de restaurar')
    fs.rmSync(saleReceiptPath, { force: true })
    assert(!fs.existsSync(saleReceiptPath), 'El comprobante no se eliminó antes de restaurar')
    const fullRestore = await rpc(page, 'backups.restore', { id: fullBackup.backup.id })
    assert(fullRestore.restored, 'No se restauró el respaldo completo')
    const afterFullRestore = (await rpc(page, 'inventory.list')).find(
      (item) => item.id === backupProduct.id
    )
    assert(afterFullRestore?.imageUrl, 'La restauración no recuperó la imagen del producto')
    assert(
      fs.existsSync(imagePathFromUrl(afterFullRestore.imageUrl)),
      'La imagen restaurada no existe en el disco'
    )
    assert(fs.existsSync(saleReceiptPath), 'La restauración no recuperó el comprobante')
    pass('respaldo completo: incluye y restaura imágenes y comprobantes')

    const backupPassword = 'Respaldo103'
    await rpc(page, 'backups.setPassword', { password: backupPassword })
    const exportPath = path.join(root, 'respaldo-1.10.3.bctbackup')
    const exported = await rpc(page, 'backups.export', { path: exportPath })
    assert(exported.exported && fs.existsSync(exportPath), 'No se exportó el respaldo cifrado')
    await rpc(page, 'inventory.update', { id: backupProduct.id, removeImage: true })
    assert(
      !fs.existsSync(imagePathFromUrl(afterFullRestore.imageUrl)),
      'La imagen no se eliminó antes de importar'
    )
    const imported = await rpc(page, 'backups.import', {
      path: exportPath,
      password: backupPassword
    })
    assert(imported.imported && imported.restored, 'No se importó el respaldo cifrado')
    const afterImport = (await rpc(page, 'inventory.list')).find(
      (item) => item.id === backupProduct.id
    )
    assert(afterImport?.imageUrl, 'La importación cifrada no recuperó la imagen')
    assert(
      fs.existsSync(imagePathFromUrl(afterImport.imageUrl)),
      'La imagen importada no existe en el disco'
    )
    assert(fs.existsSync(saleReceiptPath), 'La importación cifrada no recuperó el comprobante')
    pass('respaldo cifrado: exporta e importa imágenes y comprobantes')

    const adminSetPassword = await rpcRaw(
      page,
      'backups.setPassword',
      { password: 'OtraClave123' },
      adminLogin.token
    )
    assert(!adminSetPassword.ok, 'El administrador pudo cambiar la contraseña de respaldo')
    const adminRevealPassword = await rpcRaw(
      page,
      'backups.revealPassword',
      {},
      adminLogin.token
    )
    assert(!adminRevealPassword.ok, 'El administrador pudo ver la contraseña de respaldo')
    const adminImportWithoutPassword = await rpcRaw(
      page,
      'backups.import',
      { path: exportPath },
      adminLogin.token
    )
    assert(!adminImportWithoutPassword.ok, 'El administrador importó sin contraseña')
    assert(
      adminImportWithoutPassword.error?.code === 'INVALID_PASSWORD',
      'Código inesperado sin contraseña: ' + adminImportWithoutPassword.error?.code
    )
    const adminImportWrongPassword = await rpcRaw(
      page,
      'backups.import',
      { path: exportPath, password: 'ClaveIncorrecta1' },
      adminLogin.token
    )
    assert(!adminImportWrongPassword.ok, 'El administrador importó con contraseña incorrecta')

    await page.evaluate(
      (token) => sessionStorage.setItem('bitacoretech.session.token', token),
      adminLogin.token
    )
    await page.reload()
    await page.getByText('Inventario', { exact: true }).first().waitFor({ timeout: 30000 })
    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('Respaldos', { exact: true }).first().click()
    await page.getByText('Importar base', { exact: true }).waitFor({ timeout: 20000 })
    assert(
      (await page.getByText('Contraseña de respaldo', { exact: true }).count()) === 0,
      'El administrador vio el campo de contraseña de respaldo'
    )
    assert(
      (await page.getByRole('button', { name: 'Copiar', exact: true }).count()) === 0,
      'El administrador pudo copiar la contraseña de respaldo'
    )
    pass('administrador: sin acceso a la contraseña y con importación visible')

    const adminImported = await rpc(
      page,
      'backups.import',
      { path: exportPath, password: backupPassword },
      adminLogin.token
    )
    assert(adminImported.imported && adminImported.restored, 'El administrador no pudo importar la base')
    const restoredProduct = (await rpc(page, 'inventory.list')).find(
      (item) => item.id === backupProduct.id
    )
    assert(restoredProduct?.imageUrl, 'La importación del administrador no restauró la base')
    pass('administrador: importa la base escribiendo la contraseña del archivo')


    await app.close()
  } catch (error) {
    fail('flujo 1.11.0', error)
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
