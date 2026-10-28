const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const project = process.env.BITACORETECH_PROJECT || path.resolve(__dirname, '../..')
const { _electron: electron } = require(path.join(project, 'node_modules/playwright-core'))

const root =
  process.env.BITACORETECH_TEST_ROOT ||
  path.join(os.tmpdir(), 'bitacoretech-acceptance', '1.16.1')
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

function pngSize(file) {
  const buffer = fs.readFileSync(file)
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

async function main() {
  let app
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
    const page = await app.firstWindow()
    await page.getByText('Configura tu taller', { exact: true }).waitFor({ timeout: 30000 })

    const images = await page.locator('img').evaluateAll((nodes) =>
      nodes.map((node) => ({
        alt: node.alt,
        src: node.getAttribute('src'),
        width: node.naturalWidth,
        height: node.naturalHeight
      }))
    )
    const mark = images.find((image) => image.width === 512 && image.height === 512)
    const full = images.find((image) => image.alt === 'BitacoreTech')
    check(
      'símbolo de marca cargado',
      Boolean(mark) && String(mark.src).includes('bitacoretech-mark'),
      mark ? `${mark.width}×${mark.height}` : ''
    )
    check(
      'logo completo cargado',
      Boolean(full) && full.width === 1072 && full.height === 196,
      full ? `${full.width}×${full.height}` : ''
    )
    check(
      'wordmark visible en el login',
      (await page.getByText('BitacoreTech', { exact: true }).count()) > 0 &&
        (await page.getByText('Taller & POS', { exact: true }).count()) > 0
    )
    await page.screenshot({ path: path.join(shots, 'login.png') })

    await page.getByPlaceholder('Nombre y apellido').fill('Admin 1.16.1')
    await page.locator('input[placeholder="BitacoreTech"]').fill('Taller 1.16.1')
    await page.getByPlaceholder('usuario').fill('admin1161')
    await page.locator('input[type="password"]').nth(0).fill('Admin12345')
    await page.locator('input[type="password"]').nth(1).fill('Admin12345')
    await page.getByRole('button', { name: 'Crear cuenta y entrar' }).click()
    await page.getByText('Ventas hoy', { exact: true }).first().waitFor({ timeout: 30000 })
    await page.getByText('BitacoreTech', { exact: true }).first().waitFor()
    check('marca visible en la barra lateral', true)
    await page.screenshot({ path: path.join(shots, 'dashboard.png') })

    const icon = pngSize(path.join(project, 'build/icon.png'))
    const favicon = pngSize(path.join(project, 'public/favicon.png'))
    check('icono del instalador 512×512', icon.width === 512 && icon.height === 512, JSON.stringify(icon))
    check('favicon 256×256', favicon.width === 256 && favicon.height === 256, JSON.stringify(favicon))

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
