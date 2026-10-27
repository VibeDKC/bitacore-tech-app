const path = require('node:path')
const os = require('node:os')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))
const fs = require('node:fs')

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.6.1')
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

async function setTokenAndReload(page, token) {
  await page.evaluate((value) => sessionStorage.setItem('bitacoretech.session.token', value), token)
  await page.reload()
  await page.getByText('Punto de venta', { exact: true }).first().waitFor({ timeout: 30000 })
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
    await page.getByPlaceholder('Nombre y apellido').fill('Owner 1.6.1')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.6.1')
    await page.getByPlaceholder('usuario').fill('owner')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill('Owner12345')
    await page.getByPlaceholder('Repite la contraseña').fill('Owner12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    pass('primer arranque 1.6.1')

    const ownerToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    const owner = await rpc(page, 'auth.session')
    const ownerUsers = await rpc(page, 'users.list')
    assert(ownerUsers.some((member) => member.id === owner.user.id), 'El propietario no se ve a sí mismo en usuarios')

    const admin = await rpc(page, 'users.create', {
      name: 'Admin 1.6.1',
      username: 'admin161',
      email: 'admin161@taller.co',
      role: 'admin',
      password: 'Admin12345',
      phone: '3000000000'
    })
    const tech = await rpc(page, 'users.create', {
      name: 'Tecnico 1.6.1',
      username: 'tec161',
      email: 'tec161@taller.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const adminLogin = await rpc(page, 'auth.login', { username: 'admin161', password: 'Admin12345' })
    const adminToken = adminLogin.token
    const adminUsers = await rpc(page, 'users.list', {}, adminToken)
    assert(!adminUsers.some((member) => member.id === owner.user.id), 'El admin ve al propietario en usuarios')
    const adminBackups = await rpc(page, 'backups.list', {}, adminToken)
    assert(
      adminBackups.every((backup) => backup.author !== 'Owner 1.6.1'),
      'El admin ve el nombre del propietario en respaldos'
    )
    const ownerPhotoByAdmin = await rpcRaw(
      page,
      'users.updatePhoto',
      { id: owner.user.id, photoDataUrl: null },
      adminToken
    )
    assert(!ownerPhotoByAdmin.ok, 'El admin pudo modificar la foto del propietario')
    const adminProfile = await rpc(page, 'profile.update', { phone: '3001112233' }, adminToken)
    assert(adminProfile.phone === '3001112233', 'El admin no pudo editar su propio perfil')
    pass('propietario invisible para admin y perfil propio disponible')

    await page.getByRole('button', { name: 'Cuenta', exact: true }).click()
    await page.getByText('Mi perfil', { exact: true }).click()
    await page.getByRole('dialog', { name: 'Mi perfil' }).waitFor({ timeout: 15000 })
    await page.screenshot({ path: path.join(shots, '01-mi-perfil.png') })
    await page.getByRole('dialog', { name: 'Mi perfil' }).getByLabel('Teléfono').fill('3115556677')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await page.getByText('Perfil actualizado', { exact: false }).first().waitFor({ timeout: 15000 })
    const ownerProfile = await rpc(page, 'profile.get')
    assert(ownerProfile.phone === '3115556677', 'El perfil del propietario no guardó el teléfono')
    pass('Mi perfil abre un modal propio y guarda datos')

    await page.getByRole('button', { name: 'Cuenta', exact: true }).click()
    await page.getByText('Configuración', { exact: true }).last().click()
    await page.getByText('Identidad del negocio', { exact: false }).first().waitFor({ timeout: 15000 })
    pass('Configuración sigue llevando a los datos del taller')

    const customer = await rpc(page, 'customers.create', {
      name: 'Cliente Armado 1.6.1',
      documentType: 'CC',
      document: '80808080',
      phone: '3100001122'
    })
    const naSheet = {
      os: 'Windows 11',
      osNotVisible: true,
      cpu: { brand: '', family: '', model: '', notVisible: true },
      gpu: { type: 'dedicated', brand: '', model: '', vram: '', notVisible: true },
      ramModules: [],
      ramNotVisible: true,
      storageDrives: [],
      storageNotVisible: true,
      battery: '',
      batteryNotVisible: true,
      notes: 'Componentes no visibles al ingreso'
    }
    const customOrder = await rpc(page, 'orders.create', {
      customerId: customer.id,
      deviceCategory: 'pc_torre',
      categoryLabel: 'PC Torre',
      equipmentType: 'PC de escritorio',
      customBuild: true,
      alias: 'Torre gaming 1.6.1',
      brand: '',
      model: '',
      serial: '',
      accessories: 'Cable de poder',
      physicalCondition: 'Sin observaciones',
      reportedIssue: 'Equipo armado con componentes no visibles.',
      technicianId: tech.id,
      promisedAt: futureDate(),
      notes: 'OT armada 1.6.1',
      intake: {
        category: 'pc_torre',
        categoryLabel: 'PC Torre',
        customBuild: true,
        alias: 'Torre gaming 1.6.1',
        estimate: 400000,
        diagnosticFee: 0,
        accessories: ['Cable de poder'],
        powerState: 'enciende',
        conditions: {},
        conditionNotes: '',
        lockType: 'sin_bloqueo',
        customerAuthorizesAccess: false,
        customerWithheldCredentials: false,
        technicalSheet: naSheet
      }
    })
    assert(customOrder.brand === 'Armado', `Marca inesperada: ${customOrder.brand}`)
    assert(customOrder.model === 'Torre gaming 1.6.1', `Alias inesperado: ${customOrder.model}`)
    assert(String(customOrder.serial).startsWith('ARM-'), `Código interno inesperado: ${customOrder.serial}`)
    assert(customOrder.intake?.customBuild === true, 'La OT no guardó customBuild')
    const customerDetail = await rpc(page, 'customers.detail', { id: customer.id })
    const customEquipment = customerDetail.equipment.find((item) => item.serial === customOrder.serial)
    assert(customEquipment?.brand === 'Armado' && customEquipment?.model === 'Torre gaming 1.6.1', 'El equipo armado no se creó')
    pass('equipo armado PC Torre normalizado con alias y código interno')

    const customOther = await rpc(page, 'equipment.create', {
      customerId: customer.id,
      category: 'otro',
      categoryLabel: 'Otro',
      equipmentType: 'Equipo especial',
      customBuild: true,
      alias: 'Equipo especial 1.6.1',
      brand: '',
      model: '',
      serial: '',
      accessories: 'Sin accesorios'
    })
    assert(customOther.brand === 'Armado' && customOther.model === 'Equipo especial 1.6.1', 'Equipo armado Otro no normalizado')
    assert(String(customOther.serial).startsWith('ARM-'), 'Equipo armado Otro sin código interno')
    const invalidCustom = await rpcRaw(page, 'orders.create', {
      customerId: customer.id,
      deviceCategory: 'laptop',
      categoryLabel: 'Portátil',
      equipmentType: 'Portátil',
      customBuild: true,
      alias: 'No permitido',
      brand: '',
      model: '',
      serial: '',
      accessories: 'Cargador',
      physicalCondition: 'Sin observaciones',
      reportedIssue: 'Prueba inválida',
      technicianId: tech.id,
      promisedAt: futureDate(),
      intake: { category: 'laptop', categoryLabel: 'Portátil', technicalSheet: {} }
    })
    assert(!invalidCustom.ok, 'Se permitió equipo armado en una laptop')
    pass('equipo armado disponible para PC Torre y Otro, bloqueado en otros tipos')

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByText(customOrder.number, { exact: true }).first().click()
    await page.getByText('Equipo y recepción', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Ficha técnica avanzada', { exact: true }).first().waitFor({ timeout: 15000 })
    await page.getByText('Torre gaming 1.6.1', { exact: false }).first().waitFor({ timeout: 15000 })
    const naCount = await page.getByText('N/A', { exact: true }).count()
    assert(naCount >= 5, `La ficha N/A no se muestra completa (${naCount})`)
    pass('detalle de OT muestra ficha N/A y equipo armado')
    await page.screenshot({ path: path.join(shots, '02-detalle-armado-n-a.png') })

    await page.getByRole('button', { name: 'Imprimir' }).first().click()
    await page.getByRole('button', { name: 'A4 · dos copias' }).first().click()
    await page.getByText('CPU: N/A', { exact: false }).first().waitFor({ timeout: 15000 })
    await page.getByText('RAM: N/A', { exact: false }).first().waitFor({ timeout: 15000 })
    await page.getByText('Código interno', { exact: false }).first().waitFor({ timeout: 15000 })
    pass('comprobante A4 imprime N/A y código interno del equipo armado')
    await page.screenshot({ path: path.join(shots, '03-impresion-armado-n-a.png') })
    await page.getByLabel('Cerrar vista previa').click()

    await page.getByText('Órdenes de trabajo', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Nueva OT' }).first().click()
    await page.getByText('Recepción de equipo', { exact: true }).first().waitFor({ timeout: 20000 })
    const sectionOrder = await page.evaluate(() => {
      const titles = ['Cliente', 'Equipo', 'Ficha técnica avanzada', 'Accesorios dejados', 'Evidencia fotográfica', 'Falla y presupuesto']
      return titles.map((title) => {
        const element = Array.from(document.querySelectorAll('h2')).find((node) => node.textContent?.trim() === title)
        return element ? element.getBoundingClientRect().top + window.scrollY : null
      })
    })
    assert(sectionOrder.every((value) => value !== null), `Faltan secciones: ${JSON.stringify(sectionOrder)}`)
    for (let index = 1; index < sectionOrder.length; index += 1) {
      assert(sectionOrder[index] > sectionOrder[index - 1], `Orden de secciones incorrecto: ${JSON.stringify(sectionOrder)}`)
    }
    assert((await page.getByText('Ficha técnica avanzada', { exact: true }).count()) > 0, 'La ficha no está visible')
    assert((await page.getByText('No visible / N/A', { exact: true }).count()) >= 6, 'Faltan controles N/A en la ficha')
    pass('formulario en orden 1–6 con ficha completa y controles N/A')
    await page.screenshot({ path: path.join(shots, '04-formulario-orden-n-a.png') })

    await page.getByRole('button', { name: /PC Torre/ }).first().click()
    const customCheckbox = page.getByText('Equipo armado por partes', { exact: true }).first()
    await customCheckbox.waitFor({ timeout: 15000 })
    await customCheckbox.click()
    await page.getByPlaceholder('Ej. Torre gaming, PC de la oficina, Servidor de recepción').waitFor({ timeout: 15000 })
    pass('casilla de equipo armado visible en PC Torre y alias editable')
    await page.screenshot({ path: path.join(shots, '05-formulario-armado.png') })

    await page.evaluate((token) => sessionStorage.setItem('bitacoretech.session.token', token), adminToken)
    await page.reload()
    await page.getByText('Punto de venta', { exact: true }).first().waitFor({ timeout: 30000 })
    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('Usuarios y roles', { exact: true }).first().click()
    await page.getByText('Admin 1.6.1', { exact: true }).first().waitFor({ timeout: 15000 })
    assert((await page.getByText('Owner 1.6.1', { exact: true }).count()) === 0, 'El admin ve al propietario en la UI')
    pass('propietario invisible para el admin también en Configuración')

    await page.evaluate((token) => sessionStorage.setItem('bitacoretech.session.token', token), ownerToken)
    await page.reload()
    await page.getByText('Configuración', { exact: true }).first().click()
    await page.getByText('Usuarios y roles', { exact: true }).first().click()
    await page.getByText('Owner 1.6.1', { exact: true }).first().waitFor({ timeout: 15000 })
    assert((await page.getByLabel('Cambiar foto de Owner 1.6.1').count()) === 0, 'El propietario conserva cámara en la lista')
    pass('propietario se ve a sí mismo en Configuración')
    await page.screenshot({ path: path.join(shots, '06-propietario-config.png') })

    await app.close()
  } catch (error) {
    fail('flujo 1.6.1', error)
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
