const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = process.env.BITACORETECH_TEST_ROOT || path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.16.2')
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

async function launch() {
  return electron.launch({
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
}

async function main() {
  let app = await launch()
  let page = await app.firstWindow()
  let adminToken

  async function rpcRaw(command, payload = {}, token) {
    return page.evaluate(
      async ({ command, payload, token }) => {
        const body = token ? { ...payload, __token: token } : payload
        return window.bitacoretech.rpc(command, body)
      },
      { command, payload, token }
    )
  }

  try {
    await page.getByText('Configura tu taller', { exact: true }).waitFor({ timeout: 30000 })
    await page.screenshot({ path: path.join(shots, 'setup.png') })
    check(
      'primer arranque muestra el botón de cuenta existente',
      (await page.getByRole('button', { name: '¿Ya tienes una cuenta? Inicia sesión' }).count()) === 1
    )
    check(
      'login no muestra órdenes ni equipo interno',
      (await page.getByText('OT-002341', { exact: false }).count()) === 0 &&
        (await page.getByText('Julián Vélez', { exact: false }).count()) === 0
    )
    check(
      'login no muestra el pie de instalación local',
      (await page.getByText(/Instalación local/i).count()) === 0
    )

    const ownerWrong = await rpcRaw('auth.login', {
      username: 'propietario',
      password: 'clave-incorrecta-1162'
    })
    check(
      'propietario puede intentar login antes del setup',
      !ownerWrong.ok && ownerWrong.error?.code === 'INVALID_CREDENTIALS',
      ownerWrong.error?.code
    )
    const otherBeforeSetup = await rpcRaw('auth.login', {
      username: 'admin-inexistente',
      password: 'lo-que-sea'
    })
    check(
      'otros usuarios siguen bloqueados antes del setup',
      !otherBeforeSetup.ok && otherBeforeSetup.error?.code === 'SETUP_REQUIRED',
      otherBeforeSetup.error?.code
    )

    await page.getByRole('button', { name: '¿Ya tienes una cuenta? Inicia sesión' }).click()
    await page
      .getByText('Acceso del propietario para crear el administrador o restaurar un respaldo.', {
        exact: true
      })
      .waitFor()
    check(
      'formulario de propietario con regreso a configuración',
      (await page.getByText('Volver a la configuración inicial', { exact: true }).count()) === 1
    )
    await page.screenshot({ path: path.join(shots, 'owner-login.png') })
    await page.getByText('Volver a la configuración inicial', { exact: true }).click()
    await page.getByText('Configura tu taller', { exact: true }).waitFor()
    check('regreso a la configuración inicial', true)

    await page.getByPlaceholder('Nombre y apellido').fill('Admin 1.16.2')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.16.2')
    await page.getByPlaceholder('usuario').fill('admin1162')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.locator('input[type="password"]').nth(1).fill('Admin12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    adminToken = await page.evaluate(() => sessionStorage.getItem('bitacoretech.session.token'))
    check('configuración inicial con administrador', Boolean(adminToken))
    await page.screenshot({ path: path.join(shots, 'dashboard-setup.png') })

    await app.close()
    const db = new DatabaseSync(path.join(data, 'bitacoretech.db'))
    db.prepare("DELETE FROM meta WHERE key = 'setup_completed'").run()
    db.close()

    app = await launch()
    page = await app.firstWindow()
    await page.getByText('Bienvenido de nuevo', { exact: true }).waitFor({ timeout: 30000 })
    check(
      'una base con administrador no vuelve a pedir configuración',
      (await page.getByText('Configura tu taller', { exact: true }).count()) === 0
    )
    const publicStatus = await rpcRaw('auth.status')
    check(
      'auth.status reconoce la base existente',
      publicStatus.ok && publicStatus.data.setupRequired === false && publicStatus.data.hasAdmin === true,
      JSON.stringify(publicStatus.data)
    )
    check(
      'aviso de acceso protegido sin descripción',
      (await page.getByText('Acceso protegido', { exact: true }).count()) === 1 &&
        (await page.getByText(/hash scrypt/i).count()) === 0
    )
    check(
      'login actualizado sin pie de instalación local',
      (await page.getByText(/Instalación local/i).count()) === 0
    )
    await page.screenshot({ path: path.join(shots, 'login-existente.png') })

    await page.getByRole('button', { name: '¿Olvidaste tu clave?' }).click()
    await page.getByText('Recuperar acceso', { exact: true }).waitFor()
    await page
      .getByText(/Pide a un administrador o al propietario/i)
      .waitFor()
    check(
      'recuperación indica contactar al taller',
      (await page.getByRole('button', { name: 'Escribir al taller' }).count()) === 1
    )
    await page.screenshot({ path: path.join(shots, 'recuperacion.png') })
    await page.getByRole('button', { name: 'Entendido' }).click()

    await page.getByPlaceholder('usuario').fill('admin1162')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.getByRole('button', { name: 'Ingresar al taller' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    check('login normal después de la actualización', true)
    check(
      'versión visible actual',
      (await page.getByText(/v1\.17\.0/i).count()) >= 1
    )
    await page.screenshot({ path: path.join(shots, 'dashboard.png') })

    const currentToken = await page.evaluate(() =>
      sessionStorage.getItem('bitacoretech.session.token')
    )
    const adminSession = await rpcRaw('auth.session', {}, currentToken)
    check('sesión de administrador válida', adminSession.ok === true)

    console.log(`\nRESULT ${results.filter((item) => item.ok).length}/${results.length} OK`)
    console.log(`SHOTS ${shots}`)
  } finally {
    await app?.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
