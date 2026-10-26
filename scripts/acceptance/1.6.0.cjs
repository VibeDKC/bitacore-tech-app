const path = require('node:path')
const os = require('node:os')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))
const fs = require('node:fs')

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.6.0')
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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner 1.6')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.6')
    await page.getByPlaceholder('usuario').fill('owner')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('Owner12345')
    await page.getByPlaceholder('Repite la contraseña').fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    pass('primer arranque 1.6.0')

    const dictionary = await rpc(page, 'dictionaries.list')
    assert(dictionary.length > 50, `Diccionarios insuficientes: ${dictionary.length}`)
    const win11 = dictionary.find((node) => node.type === 'os' && node.name === 'Windows 11')
    const intel = dictionary.find((node) => node.type === 'cpu_brand' && node.name === 'Intel')
    const coreI7 = dictionary.find((node) => node.type === 'cpu_brand' && node.parentId === intel?.id && node.name === 'Core i7')
    const repuestos = dictionary.find((node) => node.type === 'inventory_category' && node.name === 'Repuestos')
    assert(win11 && intel && coreI7 && repuestos, 'Faltan valores semilla de diccionarios')
    const seededOwnerPermissions = await rpc(page, 'settings.get')
    assert(
      seededOwnerPermissions.rolePermissions.some(
        (item) => item.role === 'admin' && item.capability === 'manageDictionaries' && item.allowed
      ),
      'El admin no recibió manageDictionaries'
    )
    pass('diccionarios sembrados y permiso de administración')

    const customCategory = await rpc(page, 'dictionaries.create', {
      type: 'inventory_category',
      name: 'Pruebas 1.6',
      active: true
    })
    const customProduct = await rpc(page, 'inventory.create', {
      name: 'Producto categoría dinámica',
      sku: 'T6-CAT-001',
      category: 'Pruebas 1.6',
      stock: 1,
      minStock: 0,
      cost: 5000,
      price: 10000
    })
    await rpc(page, 'dictionaries.update', { id: customCategory.id, name: 'Pruebas 1.6 renombrada' })
    const productsAfterRename = await rpc(page, 'inventory.list')
    assert(
      productsAfterRename.find((product) => product.id === customProduct.id)?.category === 'Pruebas 1.6 renombrada',
      'Renombrar la categoría no actualizó el producto'
    )
    const categoryDelete = await rpcRaw(page, 'dictionaries.delete', { id: customCategory.id })
    assert(!categoryDelete.ok, 'Se pudo eliminar una categoría en uso')
    const serviceProduct = await rpc(page, 'inventory.create', {
      name: 'Servicio con tipo de diccionario',
      sku: 'T6-SERV-001',
      category: 'Servicios',
      price: 80000,
      service: true,
      serviceType: 'Mantenimiento preventivo'
    })
    assert(serviceProduct.service === true, 'El producto no quedó marcado como servicio')
    assert(
      serviceProduct.serviceType === 'Mantenimiento preventivo',
      `Tipo de servicio inesperado: ${serviceProduct.serviceType}`
    )
    const serviceTypeNode = dictionary.find(
      (node) => node.type === 'service_type' && node.name === 'Mantenimiento preventivo'
    )
    await rpc(page, 'dictionaries.update', { id: serviceTypeNode.id, name: 'Mantenimiento preventivo T6' })
    const serviceProductAfter = await rpc(page, 'inventory.list')
    assert(
      serviceProductAfter.find((product) => product.id === serviceProduct.id)?.serviceType === 'Mantenimiento preventivo T6',
      'Renombrar el tipo de servicio no actualizó el producto'
    )
    const serviceTypeDelete = await rpcRaw(page, 'dictionaries.delete', { id: serviceTypeNode.id })
    assert(!serviceTypeDelete.ok, 'Se pudo eliminar un tipo de servicio en uso')
    pass('diccionario de inventario: renombrado, uso y tipo de servicio')

    const customOs = await rpc(page, 'dictionaries.create', {
      type: 'os',
      name: 'Windows 12 Beta',
      code: 'windows_12_beta',
      active: true
    })
    await rpc(page, 'dictionaries.update', { id: customOs.id, name: 'Windows 12 RC' })
    await rpc(page, 'dictionaries.delete', { id: customOs.id })
    const systemDelete = await rpcRaw(page, 'dictionaries.delete', { id: win11.id })
    assert(!systemDelete.ok, 'Se pudo eliminar un valor del sistema')
    pass('diccionarios: edición, eliminación y protección de sistema')

    const cpuParent = await rpc(page, 'dictionaries.create', { type: 'cpu_brand', name: 'PruebaCPU', active: true })
    const cpuChild = await rpc(page, 'dictionaries.create', {
      type: 'cpu_brand',
      name: 'Prueba 9000',
      parentId: cpuParent.id,
      active: true
    })
    await rpc(page, 'dictionaries.update', { id: cpuChild.id, active: false })
    const afterToggle = await rpc(page, 'dictionaries.list')
    assert(
      afterToggle.find((node) => node.id === cpuChild.id)?.active === false,
      'El hijo del diccionario no se desactivó'
    )
    await rpc(page, 'dictionaries.delete', { id: cpuChild.id })
    await rpc(page, 'dictionaries.delete', { id: cpuParent.id })
    pass('diccionarios jerárquicos y activación')

    const admin = await rpc(page, 'users.create', {
      name: 'Admin Diccionarios',
      username: 'admindict',
      email: 'admindict@taller.co',
      role: 'admin',
      password: 'Admin12345'
    })
    const adminLogin = await rpc(page, 'auth.login', { username: 'admindict', password: 'Admin12345' })
    const adminNode = await rpc(
      page,
      'dictionaries.create',
      { type: 'service_type', name: 'Servicio creado por admin', active: true },
      adminLogin.token
    )
    assert(adminNode.id, 'El admin no pudo crear un valor de diccionario')
    await rpc(page, 'dictionaries.delete', { id: adminNode.id })

    const tech = await rpc(page, 'users.create', {
      name: 'Tecnico 1.6',
      username: 'tec16',
      email: 'tec16@taller.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const techLogin = await rpc(page, 'auth.login', { username: 'tec16', password: 'Tecnico12345' })
    const techDictionary = await rpcRaw(
      page,
      'dictionaries.create',
      { type: 'service_type', name: 'Servicio no autorizado', active: true },
      techLogin.token
    )
    assert(!techDictionary.ok, 'El técnico pudo crear un diccionario')
    pass('permisos: admin administra diccionarios, técnico no')

    const uiOs = await rpc(page, 'dictionaries.create', {
      type: 'os',
      name: 'Windows 12 UI',
      active: true
    })
    assert(uiOs.id, 'No se creó el sistema operativo para la UI')
    const uiDeviceType = await rpc(page, 'dictionaries.create', {
      type: 'device_type',
      name: 'Servidor 1.6',
      active: true
    })
    assert(uiDeviceType.id, 'No se creó el tipo de equipo para la UI')

    const customer = await rpc(page, 'customers.create', {
      name: 'Cliente Ficha 1.6',
      documentType: 'CC',
      document: '70707070',
      phone: '3102223344'
    })
    const structuredSheet = {
      os: 'Windows 11',
      cpu: { brand: 'Intel', family: 'Core i7', model: 'i7-12700H' },
      gpu: { type: 'dedicated', brand: 'NVIDIA', model: 'RTX 3060', vram: '6 GB' },
      ramModules: [
        {
          id: 'ram_test_1',
          type: 'DDR4',
          capacity: '16 GB',
          speed: '3200 MHz',
          brand: 'Kingston',
          warranty: '12 meses'
        }
      ],
      storageDrives: [
        {
          id: 'disk_test_1',
          type: 'SSD M.2 NVMe',
          capacity: '1 TB',
          speed: '3500 MB/s',
          model: 'Kingston NV2',
          health: 'Bueno',
          warranty: '12 meses'
        }
      ],
      battery: 'Buena',
      notes: 'Equipo de prueba 1.6'
    }
    const order = await rpc(page, 'orders.create', {
      customerId: customer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Portátil',
      equipmentType: 'Portátil',
      brand: 'Lenovo',
      model: 'ThinkPad T6',
      serial: 'T6-SERIAL-001',
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones',
      reportedIssue: 'Prueba de ficha estructurada.',
      technicianId: tech.id,
      promisedAt: futureDate(),
      notes: 'OT 1.6 estructurada',
      intake: {
        category: 'laptop',
        categoryLabel: 'Portátil',
        estimate: 500000,
        diagnosticFee: 0,
        accessories: ['Cargador'],
        powerState: 'enciende',
        conditions: {},
        conditionNotes: '',
        lockType: 'sin_bloqueo',
        customerAuthorizesAccess: false,
        customerWithheldCredentials: false,
        technicalSheet: structuredSheet
      }
    })
    const savedOrder = await rpc(page, 'orders.get', { id: order.id })
    const savedSheet = savedOrder.intake?.technicalSheet
    assert(savedSheet?.cpu?.model === 'i7-12700H', 'La CPU estructurada no se guardó')
    assert(savedSheet?.ramModules?.[0]?.capacity === '16 GB', 'La RAM estructurada no se guardó')
    assert(savedSheet?.storageDrives?.[0]?.type === 'SSD M.2 NVMe', 'El disco estructurado no se guardó')
    pass('ficha técnica estructurada persistida en la OT')

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(order.number, { exact: true }).first().click()
    await page.getByText('Ficha técnica avanzada', { exact: true }).first().click()
    await page.getByText('i7-12700H', { exact: false }).first().waitFor({ timeout: 15000 })
    await page.getByText('DDR4 16 GB', { exact: false }).first().waitFor({ timeout: 15000 })
    await page.getByText('SSD M.2 NVMe 1 TB', { exact: false }).first().waitFor({ timeout: 15000 })
    pass('detalle de OT muestra CPU, RAM y almacenamiento estructurados')
    await page.screenshot({ path: path.join(shots, '01-ficha-estructurada.png') })

    await page.getByRole('button', { name: 'Imprimir' }).first().click()
    await page.getByRole('button', { name: 'A4 · dos copias' }).first().click()
    await page.getByText('Ficha técnica registrada', { exact: false }).first().waitFor({ timeout: 15000 })
    await page.getByText('CPU: Intel Core i7 i7-12700H', { exact: false }).first().waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(shots, '02-impresion-ficha.png') })
    await page.getByLabel('Cerrar vista previa').click()
    pass('comprobante imprime la ficha estructurada')

    const legacyOrder = await rpc(page, 'orders.create', {
      customerId: customer.id,
      deviceCategory: 'pc_torre',
      categoryLabel: 'PC Torre',
      equipmentType: 'PC de escritorio',
      brand: 'Armada',
      model: 'Legacy T6',
      serial: 'T6-SERIAL-LEGACY',
      accessories: 'Cable de poder',
      physicalCondition: 'Sin observaciones',
      reportedIssue: 'Prueba de ficha antigua.',
      technicianId: tech.id,
      promisedAt: futureDate(),
      notes: 'OT 1.6 legado',
      intake: {
        category: 'pc_torre',
        categoryLabel: 'PC Torre',
        estimate: 300000,
        diagnosticFee: 0,
        accessories: ['Cable de poder'],
        powerState: 'enciende',
        conditions: {},
        conditionNotes: '',
        lockType: 'sin_bloqueo',
        customerAuthorizesAccess: false,
        customerWithheldCredentials: false,
        technicalSheet: {
          os: 'Windows 10',
          cpu: 'Intel Core i5',
          gpu: 'GTX 1050',
          ram: '8 GB DDR4',
          storage: 'HDD 1 TB',
          battery: 'No aplica'
        }
      }
    })
    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(legacyOrder.number, { exact: true }).first().click()
    await page.getByText('Ficha técnica avanzada', { exact: true }).first().click()
    await page.getByText('CPU · ficha anterior', { exact: false }).first().waitFor({ timeout: 15000 })
    await page.getByText('Intel Core i5', { exact: false }).first().waitFor({ timeout: 15000 })
    pass('OT antigua conserva y muestra su ficha plana')
    await page.screenshot({ path: path.join(shots, '03-ficha-legado.png') })

    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('Diccionarios', { exact: true }).first().click()
    await page.getByText('Sistemas operativos', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Windows 11', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Marcas y familias de CPU', { exact: true }).first().click()
    await page.getByText('Core i7', { exact: true }).first().waitFor({ timeout: 15000 })
    pass('panel de diccionarios muestra tipos, valores y jerarquía')
    await page.screenshot({ path: path.join(shots, '04-diccionarios.png') })

    await page.getByText('Sistemas operativos', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Añadir valor' }).click()
    await page.getByLabel('Nombre').fill('Windows 12 UI creado')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await page.getByText('Windows 12 UI creado', { exact: true }).first().waitFor({ timeout: 15000 })
    pass('creación de diccionario desde la interfaz')

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Nueva OT' }).first().click()
    await page.getByText('Recepción de equipo', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.getByText('Servidor 1.6', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Ficha técnica avanzada', { exact: true }).first().click()
    const osOptionCount = await page.locator('option', { hasText: 'Windows 12 UI creado' }).count()
    assert(osOptionCount > 0, 'El nuevo sistema operativo no aparece en la ficha de recepción')
    await page.getByRole('button', { name: 'Añadir módulo' }).click()
    await page.getByText('Módulo 1', { exact: false }).first().waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Añadir disco' }).click()
    await page.getByText('Disco 1', { exact: false }).first().waitFor({ timeout: 10000 })
    pass('formulario de recepción usa diccionarios y filas repetibles')
    await page.screenshot({ path: path.join(shots, '05-formulario-ficha.png') })

    await page.getByText('Inventario', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Nuevo producto' }).first().click()
    const categoryOptionCount = await page.locator('option', { hasText: 'Pruebas 1.6 renombrada' }).count()
    assert(categoryOptionCount > 0, 'La categoría del diccionario no aparece en inventario')
    pass('inventario usa las categorías del diccionario')

    await app.close()
  } catch (error) {
    fail('flujo 1.6.0', error)
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
