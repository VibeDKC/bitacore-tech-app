const path = require('node:path')
const os = require('node:os')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', 'f0-f1')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
const shots = path.join(root, 'shots')
const username = 'dueno'
const password = 'ClaveSegura123'
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
async function launch() {
  return electron.launch({
    executablePath: path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: project,
    env: {
      ...process.env,
      BITACORETECH_DATA_PATH: data,
      BITACORETECH_LEGACY_DATA_PATH: legacy,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    timeout: 90000
  })
}

;(async () => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(shots, { recursive: true })
  fs.mkdirSync(legacy, { recursive: true })

  let app = await launch()
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
    pass('primer arranque muestra configuración inicial')

    await page.getByPlaceholder('Nombre y apellido').fill('Dave Prueba')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller Prueba')
    await page.getByPlaceholder('usuario').fill(username)
    await page.getByPlaceholder('correo@taller.co').fill('dueno@taller.co')
    await page.getByPlaceholder('Mínimo 8 caracteres').fill(password)
    await page.getByPlaceholder('Repite la contraseña').fill(password)
    await page.screenshot({ path: path.join(shots, '01-setup.png') })
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Clientes', { exact: true }).first().waitFor({ timeout: 30000 })
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    const dashboardError = await page.getByText('No se pudo cargar el dashboard', { exact: true }).count()
    assert(dashboardError === 0, 'El dashboard mostró un error con la base vacía')
    pass('propietario creado y dashboard vacío sin errores')
    await page.screenshot({ path: path.join(shots, '02-dashboard.png') })

    const status = await page.evaluate(() => window.bitacoretech.rpc('auth.status', {}))
    assert(status.ok && status.data.setupRequired === false, 'auth.status sigue indicando setupRequired')
    pass('auth.status confirma que la configuración está completa')

    const again = await page.evaluate(() =>
      window.bitacoretech.rpc('auth.setup', {
        name: 'Otro',
        username: 'otro',
        password: 'OtraClave123',
        businessName: 'Otro taller'
      })
    )
    assert(!again.ok && again.error.code === 'ALREADY_SETUP', `Segundo setup inesperado: ${JSON.stringify(again)}`)
    pass('no se puede repetir la configuración inicial')

    const defaultLogin = await page.evaluate(() =>
      window.bitacoretech.rpc('auth.login', { username: 'superadmin', password: '3mm4hy3r' })
    )
    assert(!defaultLogin.ok, 'El login con superadmin/3mm4hy3r no debe funcionar')
    pass('no existen credenciales demo conocidas')
  } catch (error) {
    fail('flujo de primer arranque', error)
  } finally {
    await app.close().catch(() => {})
  }

  try {
    const db = new DatabaseSync(path.join(data, 'bitacoretech.db'), { readOnly: true })
    const users = db.prepare('SELECT username, role, is_protected FROM users').all()
    const audit = db.prepare("SELECT action FROM audit_log WHERE action = 'Configuración inicial'").all()
    const backups = db.prepare('SELECT filename FROM backups').all()
    db.close()
    assert(users.length === 1, `Usuarios inesperados: ${JSON.stringify(users)}`)
    assert(users[0].username === username && users[0].role === 'superadmin' && users[0].is_protected === 1, 'Propietario incorrecto')
    assert(audit.length === 1, 'No quedó auditoría de configuración inicial')
    assert(backups.length === 1, 'No se creó el respaldo inicial')
    pass('base limpia: 1 propietario, auditoría y respaldo inicial', `${users.length} usuario · ${backups.length} respaldo`)
  } catch (error) {
    fail('verificación de base de datos', error)
  }

  app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.bitacoretech), null, { timeout: 30000 })
    await page.getByText('Bienvenido de nuevo', { exact: true }).waitFor({ timeout: 20000 })
    pass('reinicio: la app pide login, no configuración')
    await page.getByPlaceholder('usuario').fill(username)
    await page.getByPlaceholder('••••••••').fill(password)
    await page.getByRole('button', { name: 'Ingresar al taller' }).click()
    await page.getByText('Clientes', { exact: true }).first().waitFor({ timeout: 30000 })
    pass('login posterior con la cuenta creada')
    await page.screenshot({ path: path.join(shots, '03-relogin.png') })
  } catch (error) {
    fail('reinicio y login posterior', error)
  } finally {
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
