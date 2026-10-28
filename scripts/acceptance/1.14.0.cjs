const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.14.0')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const results = []

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
  let adminToken

  async function rpcRaw(command, payload = {}, token = adminToken) {
    return page.evaluate(
      async ({ command, payload, token }) => {
        const body = token ? { ...payload, __token: token } : payload
        return window.bitacoretech.rpc(command, body)
      },
      { command, payload, token }
    )
  }
  async function rpc(command, payload = {}, token = adminToken) {
    const response = await rpcRaw(command, payload, token)
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

    const freshDb = readDb()
    const ownerRows = freshDb
      .prepare("SELECT username, name, role, is_protected, active FROM users WHERE role = 'superadmin'")
      .all()
    const adminRows = freshDb
      .prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1")
      .all()
    freshDb.close()
    check('cuenta raíz precreada', ownerRows.length === 1, JSON.stringify(ownerRows))
    check('cuenta raíz protegida', ownerRows[0]?.is_protected === 1 && ownerRows[0]?.active === 1)
    check('primer arranque sin administrador', adminRows.length === 0)

    await page.getByPlaceholder('Nombre y apellido').fill('Admin 1.14')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.14')
    await page.getByPlaceholder('usuario').fill('admin114')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.locator('input[type="password"]').nth(1).fill('Admin12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    adminToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    check('primer arranque crea administrador', Boolean(adminToken))

    const session = await rpc('auth.session')
    check('sesión inicial es administrador', session.actualRole === 'admin', session.actualRole)
    check('administrador tiene gestión de admins', session.permissions.includes('manageAdmins'))
    check('administrador tiene módulo de configuración', session.modules.includes('settings'))

    let users = await rpc('users.list')
    check('cuenta raíz oculta para el admin', users.every((user) => user.role !== 'superadmin'))
    check('solo existe el admin creado', users.length === 1, `${users.length} usuarios`)
    const admin = users[0]

    const lastAdmin = await rpcRaw('users.update', { id: admin.id, active: false })
    check(
      'no se puede desactivar el último admin',
      !lastAdmin.ok,
      lastAdmin.error?.message ?? ''
    )

    await rpc('users.create', {
      name: 'Admin Dos 1.14',
      username: 'admin114b',
      email: 'admin114b@test.co',
      role: 'admin',
      password: 'Admin12345'
    })
    users = await rpc('users.list')
    const secondAdmin = users.find((user) => user.username === 'admin114b')
    check('admin crea otro admin', Boolean(secondAdmin), `${users.length} usuarios`)

    const deactivated = await rpc('users.update', { id: secondAdmin.id, active: false })
    check('admin desactiva a otro admin', deactivated.active === false)

    await rpc('users.create', {
      name: 'Tecnico 1.14',
      username: 'tec114',
      email: 'tec114@test.co',
      role: 'tecnico',
      password: 'Tecnico12345'
    })
    const tecnico = (await rpc('users.list')).find((user) => user.username === 'tec114')
    const elevated = await rpc('users.update', { id: tecnico.id, role: 'admin' })
    check('admin eleva técnico a admin', elevated.role === 'admin')

    const settings = await rpc('settings.get')
    check('matriz de módulos disponible', Array.isArray(settings.roleModules) && settings.roleModules.length > 0)

    const rootCapability = await rpcRaw('permissions.updateRole', {
      role: 'admin',
      permissions: [{ capability: 'purgeData', allowed: true }],
      modules: []
    })
    check(
      'admin no puede delegar permisos del propietario',
      !rootCapability.ok &&
        (rootCapability.error?.code === 'FORBIDDEN' ||
          rootCapability.error?.code === 'BAD_REQUEST'),
      rootCapability.error?.message ?? ''
    )

    const rootModule = await rpcRaw('permissions.updateRole', {
      role: 'admin',
      permissions: [],
      modules: [{ module: 'audit', allowed: true }]
    })
    check(
      'admin no puede habilitar auditoría',
      !rootModule.ok,
      rootModule.error?.message ?? ''
    )

    await rpc('users.create', {
      name: 'Cajero 1.14',
      username: 'caj114',
      email: 'caj114@test.co',
      role: 'cajero',
      password: 'Cajero12345'
    })
    const cajeroLogin = await rpc('auth.login', {
      username: 'caj114',
      password: 'Cajero12345'
    })
    const inventoryBefore = await rpcRaw('inventory.list', {}, cajeroLogin.token)
    check('cajero tiene inventario por defecto', inventoryBefore.ok)

    await rpc('permissions.updateRole', {
      role: 'cajero',
      permissions: [],
      modules: [{ module: 'inventory', allowed: false }]
    })
    const inventoryAfter = await rpcRaw('inventory.list', {}, cajeroLogin.token)
    check(
      'quitar módulo bloquea el acceso',
      !inventoryAfter.ok && inventoryAfter.error?.code === 'FORBIDDEN',
      inventoryAfter.error?.message ?? ''
    )

    const cajeroSession = await rpcRaw('auth.session', {}, cajeroLogin.token)
    check(
      'sesión devuelve módulos efectivos',
      cajeroSession.ok && !cajeroSession.data.modules.includes('inventory')
    )

    const ownerPassword = process.env.BITACORETECH_OWNER_PASSWORD
    if (ownerPassword) {
      const ownerLogin = await rpcRaw(
        'auth.login',
        { username: 'propietario', password: ownerPassword },
        undefined
      )
      check('propietario puede iniciar sesión', ownerLogin.ok, ownerLogin.error?.message ?? '')
      if (ownerLogin.ok) {
        const ownerUsers = await rpcRaw('users.list', {}, ownerLogin.data.token)
        check(
          'propietario se ve a sí mismo',
          ownerUsers.ok && ownerUsers.data.some((user) => user.role === 'superadmin')
        )
      }
    }

    await page.evaluate((token) => sessionStorage.setItem('bitacoretech.session.token', token), adminToken)
    await page.reload()
    await page.getByText(/Configuraci/).first().click()
    await page.getByText(/Usuarios y roles/).first().click()
    await page.getByText('Permisos por rol', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.screenshot({ path: path.join(shots, 'permisos-por-rol.png') })
    check('interfaz de permisos visible', true)

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
