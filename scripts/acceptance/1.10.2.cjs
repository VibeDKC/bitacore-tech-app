const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const http = require('node:http')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.10.2')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVChTY/hPJGBAF8AFRhXiBUQrBAAj+46AaYVdLAAAAABJRU5ErkJggg=='

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
    pass('primer arranque 1.10.2')

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

    await app.close()
  } catch (error) {
    fail('flujo 1.10.2', error)
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
