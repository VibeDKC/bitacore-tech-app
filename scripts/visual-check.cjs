const { chromium } = require('playwright-core')
const fs = require('node:fs')
const path = require('node:path')

const outDir = process.env.SHOTS_DIR || 'C:/Users/Dave/AppData/Local/Temp/opencode/bitacoretech-shots'
const width = Number(process.env.SHOTS_WIDTH || 1440)
const height = Number(process.env.SHOTS_HEIGHT || 1000)
const suffix = process.env.SHOTS_SUFFIX || ''
fs.mkdirSync(outDir, { recursive: true })

const pages = [
  ['pos', '/pos'],
  ['ordenes', '/ordenes'],
  ['orden-detalle', '/ordenes/o1'],
  ['inventario', '/inventario'],
  ['clientes', '/clientes'],
  ['compras', '/compras'],
  ['caja', '/caja'],
  ['reportes', '/reportes'],
  ['auditoria', '/auditoria'],
  ['configuracion', '/configuracion']
]

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true
  })
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  await page.goto('http://localhost:5173/#/login', { waitUntil: 'networkidle' })
  await page.screenshot({ path: path.join(outDir, `01-login${suffix}.png`) })

  await page.getByRole('button', { name: /Ingresar al taller/i }).click()
  await page.waitForTimeout(1400)
  await page.screenshot({ path: path.join(outDir, `02-dashboard${suffix}.png`) })

  for (const [name, route] of pages) {
    await page.evaluate((hash) => {
      window.location.hash = hash
    }, route)
    await page.waitForTimeout(900)
    await page.screenshot({ path: path.join(outDir, `${name}${suffix}.png`) })
  }

  console.log('SHOTS_DIR=' + outDir)
  console.log('ERRORS=' + JSON.stringify(errors, null, 2))
  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
