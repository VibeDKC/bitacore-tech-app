const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root = path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.18.0-lockout')
const data = path.join(root, 'data')
const legacy = path.join(root, 'legacy')
fs.rmSync(root, { recursive: true, force: true })

function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function launch() {
  return electron.launch({
    executablePath:
      process.env.BITACORETECH_PACKAGED_EXE ||
      path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: process.env.BITACORETECH_PACKAGED_EXE ? [] : ['.'],
    cwd: process.env.BITACORETECH_PACKAGED_EXE ? path.dirname(process.env.BITACORETECH_PACKAGED_EXE) : project,
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

async function loginRaw(page, username, password) {
  return page.evaluate(
    async ({ username, password }) => window.bitacoretech.rpc('auth.login', { username, password }),
    { username, password }
  )
}

;(async () => {
  let app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByText('Configura tu taller', { exact: true }).waitFor({ timeout: 30000 })
    await page.getByPlaceholder('Nombre y apellido').fill('Admin Lockout')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller Lockout')
    await page.getByPlaceholder('usuario').fill('adminlock')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.locator('input[type="password"]').nth(1).fill('Admin12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })

    let last
    for (let index = 0; index < 5; index += 1) {
      last = await loginRaw(page, 'lock_test', 'incorrecta')
    }
    check('cinco intentos bloquean la cuenta', !last.ok && last.error?.code === 'LOCKED', last.error?.message)

    const db = new DatabaseSync(path.join(data, 'bitacoretech.db'), { readOnly: true })
    const row = db.prepare("SELECT fails, blocked_until FROM login_attempts WHERE username = 'lock_test'").get()
    db.close()
    check(
      'bloqueo guardado en la base',
      Boolean(row?.blocked_until) && new Date(row.blocked_until).getTime() > Date.now(),
      JSON.stringify(row)
    )
  } finally {
    await app.close().catch(() => {})
  }

  app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByText('Bienvenido de nuevo', { exact: true }).waitFor({ timeout: 30000 })
    const blocked = await loginRaw(page, 'lock_test', 'incorrecta')
    check(
      'bloqueo persiste tras reiniciar',
      !blocked.ok && blocked.error?.code === 'LOCKED',
      blocked.error?.message
    )
    const admin = await loginRaw(page, 'adminlock', 'Admin12345')
    check('otro usuario puede iniciar sesión', admin.ok === true, admin.ok ? 'sesión válida' : admin.error?.message)
  } finally {
    await app.close().catch(() => {})
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
