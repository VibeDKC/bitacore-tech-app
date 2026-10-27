const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.9.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

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

function futureDate(days = 3) {
  return new Date(Date.now() + days * 86400000).toISOString()
}

;(async () => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(shots, { recursive: true })
  fs.mkdirSync(legacy, { recursive: true })

  const app = await launch()
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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner 1.9')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.9')
    await page.getByPlaceholder('usuario').fill('owner')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('Owner12345')
    await page.getByPlaceholder('Repite la contraseña').fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    const ownerToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    assert(ownerToken, 'No se obtuvo el token del propietario')
    pass('primer arranque 1.9.0')

    const tech = await rpc(page, 'users.create', {
      name: 'Técnico 1.9',
      username: 'tec19',
      email: 'tec19@taller.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const customer = await rpc(page, 'customers.create', {
      name: 'Cliente Teléfonos 1.9',
      documentType: 'CC',
      document: '',
      phones: [
        { phone: '3001112233', label: 'Principal', isPrimary: true },
        { phone: '3004445566', label: 'WhatsApp', isPrimary: false }
      ],
      email: 'telefonos@cliente.co',
      address: 'Calle 19 # 9-19'
    })
    assert(customer.documentMissing === true, 'El documento opcional no quedó como faltante')
    assert(customer.phones?.length === 2, 'No se guardaron los dos teléfonos')
    assert(customer.phone === '3001112233', 'El teléfono principal no quedó en customers.phone')

    const duplicate = await rpc(page, 'customers.create', {
      name: 'Cliente Duplicado 1.9',
      documentType: 'CC',
      document: '',
      phones: [
        { phone: '3004445566', label: 'Principal', isPrimary: true },
        { phone: '3007778899', label: 'Trabajo', isPrimary: false }
      ]
    })
    assert(duplicate.phoneWarning?.includes('Cliente Teléfonos 1.9'), 'No se avisó el teléfono duplicado')

    const updatedCustomer = await rpc(page, 'customers.update', {
      id: customer.id,
      phones: [
        { phone: '3004445566', label: 'WhatsApp', isPrimary: true },
        { phone: '3009990011', label: 'Trabajo', isPrimary: false }
      ]
    })
    assert(updatedCustomer.phone === '3004445566', 'No se actualizó el teléfono principal')
    assert(updatedCustomer.phones?.length === 2, 'No se conservaron los teléfonos editados')
    assert(
      updatedCustomer.phones?.find((item) => item.isPrimary)?.label === 'WhatsApp',
      'No se conservó la etiqueta del principal'
    )

    const documentedCustomer = await rpc(page, 'customers.create', {
      name: 'Cliente Documento 1.9',
      documentType: 'CC',
      document: '90909090',
      phones: [{ phone: '3011112233', label: 'Principal', isPrimary: true }]
    })
    assert(documentedCustomer.documentMissing === false, 'El documento real quedó marcado como faltante')
    assert(documentedCustomer.document === '90909090', 'El documento real no se guardó')
    const missingNit = await rpc(page, 'customers.create', {
      name: 'Cliente NIT Sin Documento 1.9',
      documentType: 'NIT',
      document: '',
      phones: [{ phone: '3022223344', label: 'Principal', isPrimary: true }]
    })
    assert(missingNit.documentMissing === true, 'El NIT sin documento no quedó como faltante')
    assert(missingNit.documentDv === undefined, 'Se calculó un DV para un documento inexistente')
    pass('clientes: documento opcional, múltiples teléfonos, principal y aviso de duplicado')

    const product = await rpc(page, 'inventory.create', {
      name: 'Batería Condición 1.9',
      sku: 'BAT-19-001',
      category: 'Repuestos',
      location: 'Taller',
      condition: 'Nuevo',
      origin: 'Importado',
      stock: 5,
      minStock: 1,
      cost: 10000,
      price: 20000,
      warrantyDays: 90,
      rotation: 'rotativo'
    })
    assert(product.condition === 'Nuevo' && product.origin === 'Importado', 'No se guardaron condición/origen')
    const dictionaries = await rpc(page, 'dictionaries.list')
    assert(
      dictionaries.some((item) => item.type === 'inventory_condition' && item.name === 'Nuevo'),
      'Falta la condición Nuevo en diccionarios'
    )
    assert(
      dictionaries.some((item) => item.type === 'inventory_origin' && item.name === 'Importado'),
      'Falta el origen Importado en diccionarios'
    )
    assert(
      dictionaries.some((item) => item.type === 'component_brand' && item.name === 'Kingston'),
      'Falta Kingston en marcas de componentes'
    )
    pass('inventario: condición/origen y diccionarios de componentes')

    const order = await rpc(page, 'orders.create', {
      customerId: customer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Portátil',
      equipmentType: 'Portátil',
      brand: 'Lenovo',
      model: 'ThinkPad 1.9',
      serial: 'T9-SHEET-001',
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones',
      reportedIssue: 'Prueba de ficha 1.9.',
      technicianId: tech.id,
      promisedAt: futureDate(),
      intake: {
        category: 'laptop',
        categoryLabel: 'Portátil',
        estimate: 250000,
        diagnosticFee: 0,
        accessories: ['Cargador'],
        powerState: 'enciende',
        conditions: {},
        conditionNotes: '',
        lockType: 'sin_bloqueo',
        customerAuthorizesAccess: false,
        customerWithheldCredentials: false,
        technicalSheet: {
          os: 'Windows 11',
          cpu: { brand: 'Intel', family: 'Core i5', model: 'i5-1135G7' },
          ramModules: [
            {
              id: 'ram_19',
              type: 'DDR4',
              capacity: '16 GB',
              speed: '3200 MHz',
              brand: 'Kingston'
            }
          ],
          storageDrives: [
            {
              id: 'disk_19',
              type: 'SSD M.2 NVMe',
              capacity: '1 TB',
              speed: '3500 MB/s',
              model: 'NV2',
              healthPercent: 95
            }
          ],
          battery: 'Buena',
          other: 'Tarjeta capturadora Elgato',
          notes: 'Ficha 1.9'
        }
      }
    })
    const savedOrder = await rpc(page, 'orders.get', { id: order.id })
    assert(
      savedOrder.intake.technicalSheet.other === 'Tarjeta capturadora Elgato',
      'El campo Otro no se guardó en la ficha'
    )
    assert(
      savedOrder.intake.legal.technicalSheet.other === 'Tarjeta capturadora Elgato',
      'La ficha no se copió al snapshot legal'
    )
    assert(
      savedOrder.intake.technicalSheet.ramModules[0].brand === 'Kingston',
      'La marca de componente no se guardó'
    )
    pass('ficha: campo Otro, marca de componente y copia al snapshot legal')

    await page.getByText('Clientes', { exact: true }).first().click()
    await page.getByText('Clientes registrados', { exact: true }).first().waitFor({ timeout: 20000 })
    const customerSearch = page.getByPlaceholder('Buscar por nombre, cédula, teléfono o correo...')
    await customerSearch.fill('3009990011')
    await page.getByText('Cliente Teléfonos 1.9', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Cliente Teléfonos 1.9', { exact: true }).first().click()
    await page.getByText('Teléfonos', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText(/3004445566 \(principal\)/).first().waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Cerrar' }).first().click()
    await customerSearch.fill('')
    pass('clientes: búsqueda por teléfono secundario y principal visible')

    await page.getByRole('button', { name: 'Nuevo cliente' }).first().click()
    await page.getByText('Nuevo cliente', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByPlaceholder('Nombre o razón social').fill('Cliente UI Sin Documento')
    await page.getByLabel('Teléfono 1', { exact: true }).fill('3110001111')
    await page.getByRole('button', { name: 'Añadir teléfono' }).click()
    await page.getByLabel('Teléfono 2', { exact: true }).fill('3110002222')
    await page.getByRole('button', { name: 'Crear cliente' }).click()
    await page.getByText('Cliente creado', { exact: false }).first().waitFor({ timeout: 20000 })
    await customerSearch.fill('3110002222')
    await page.getByText('Cliente UI Sin Documento', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Sin documento', { exact: true }).first().waitFor({ timeout: 15000 })
    pass('clientes: alta desde interfaz sin documento y con dos teléfonos')
    await page.screenshot({ path: path.join(shots, '01-clientes-telefonos.png') })

    await page.getByText('Inventario', { exact: true }).first().click()
    await page.getByPlaceholder('Buscar producto, SKU, serial...').fill('Batería Condición 1.9')
    await page.getByText('Batería Condición 1.9', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Batería Condición 1.9', { exact: true }).first().click()
    await page.getByText('Condición', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Nuevo', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Importado', { exact: true }).first().waitFor({ timeout: 15000 })
    pass('inventario: condición y origen visibles en la ficha')
    await page.screenshot({ path: path.join(shots, '02-inventario-condicion.png') })
    await page.getByRole('button', { name: 'Cerrar' }).first().click()

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Nueva OT' }).first().click()
    await page.getByText('Recepción de equipo', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.getByText('Otro / componentes no listados', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Añadir módulo' }).first().click()
    const brandSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Kingston' }) })
      .first()
    await brandSelect.waitFor({ timeout: 15000 })
    assert(
      (await brandSelect.locator('option', { hasText: 'Kingston' }).count()) === 1,
      'Las marcas de componentes no alimentan la ficha'
    )
    await page.getByLabel('Otro / componentes no listados').fill('Fuente modular 750W')
    pass('recepción: campo Otro y marcas de componentes disponibles')
    await page.screenshot({ path: path.join(shots, '03-ficha-otro-marcas.png') })

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(order.number, { exact: true }).first().click()
    await page.getByText('Ficha técnica avanzada', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Otro', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Tarjeta capturadora Elgato', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Imprimir' }).first().click()
    await page.getByRole('button', { name: 'A4 · dos copias' }).first().click()
    await page.getByText(/Otro: Tarjeta capturadora Elgato/).first().waitFor({ timeout: 15000 })
    pass('OT y comprobante muestran el campo Otro')
    await page.screenshot({ path: path.join(shots, '04-ot-otro.png') })
    await page.getByLabel('Cerrar vista previa').click()

    await app.close()
  } catch (error) {
    fail('flujo 1.9.0', error)
    await app.close().catch(() => {})
  }

  const failed = results.filter((item) => !item.ok)
  console.log(`\nRESULT ${results.length - failed.length}/${results.length} OK`)
  console.log('ROOT=' + root)
  if (failed.length) process.exit(1)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
