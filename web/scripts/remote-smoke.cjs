/**
 * Verifica que la web use CATALOG_URL (snapshot remoto) en lugar del JSON local.
 *
 * 1. Levanta un servidor HTTP con un catálogo modificado y sus imágenes.
 * 2. Compila Next.js con CATALOG_URL apuntando a ese servidor.
 * 3. Inicia la web en un puerto de prueba y comprueba el marcador remoto.
 */
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')

const webRoot = path.resolve(__dirname, '..')
const dataFile = path.join(webRoot, 'data', 'catalog.json')
const ordersFile = path.join(webRoot, 'data', 'orders-demo.json')
const productsRoot = path.join(webRoot, 'public', 'products')
const MARKER = 'Producto Remoto 1.13'
const PORT = Number(process.env.REMOTE_SMOKE_PORT || 3013)

const catalog = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
const orders = fs.readFileSync(ordersFile, 'utf8')
const hero =
  catalog.products.find((product) => product.id === catalog.heroProductId) ??
  catalog.products[0]
if (!hero) {
  console.error('El catálogo no tiene productos.')
  process.exit(1)
}
hero.name = MARKER
hero.bestSeller = true
catalog.generatedAt = new Date().toISOString()

const mime = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif'
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/catalog.json') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
      })
      return res.end(JSON.stringify(catalog))
    }
    if (url.pathname === '/orders-demo.json') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
      })
      return res.end(orders)
    }
    if (url.pathname.startsWith('/products/')) {
      const filename = path.basename(decodeURIComponent(url.pathname))
      const file = path.join(productsRoot, filename)
      if (fs.existsSync(file)) {
        res.writeHead(200, {
          'Content-Type': mime[path.extname(filename).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        })
        return res.end(fs.readFileSync(file))
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` })
    })
  })
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: webRoot,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} terminó con código ${code}`))
    })
    child.on('error', reject)
  })
}

function startNext(env) {
  const nextBin = path.join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
    cwd: webRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  })
  return child
}

async function waitFor(url, timeoutMs = 60000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      // La web todavía no está lista.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`La web no respondió en ${url}`)
}

async function main() {
  const mock = await startServer()
  const catalogUrl = `${mock.baseUrl}/catalog.json`
  for (const product of catalog.products) {
    if (product.image?.startsWith('/products/')) {
      product.image = `${mock.baseUrl}${product.image}`
    }
  }
  const env = { CATALOG_URL: catalogUrl, CATALOG_REVALIDATE_SECONDS: '30' }
  let next
  try {
    console.log(`Compilando web con CATALOG_URL=${catalogUrl}`)
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], env)
    next = startNext(env)
    await waitFor(`http://127.0.0.1:${PORT}/`)

    const checks = []
    async function check(name, url, expected = MARKER) {
      const response = await fetch(url)
      const body = await response.text()
      const ok = response.ok && body.includes(expected)
      checks.push({ name, ok, status: response.status })
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} (${response.status})`)
      if (!ok) process.exitCode = 1
    }

    await check('Home usa el catálogo remoto', `http://127.0.0.1:${PORT}/`)
    await check(
      'Home muestra más vendido remoto',
      `http://127.0.0.1:${PORT}/`,
      'Más vendido'
    )
    await check('Catálogo usa el catálogo remoto', `http://127.0.0.1:${PORT}/catalogo`)
    await check(
      'Ficha usa el catálogo remoto',
      `http://127.0.0.1:${PORT}/producto/${hero.slug}`
    )
    await check(
      'Ficha muestra más vendido remoto',
      `http://127.0.0.1:${PORT}/producto/${hero.slug}`,
      'Más vendido'
    )
    await check(
      'Seguimiento usa órdenes remotas',
      `http://127.0.0.1:${PORT}/seguimiento/DEMO-01`,
      'DEMO-01'
    )

    const imageUrl = catalog.products.find((product) => product.image)?.image
    if (imageUrl) {
      const image = await fetch(imageUrl)
      const ok = image.ok && String(image.headers.get('content-type')).startsWith('image/')
      checks.push({ name: 'Imagen remota disponible', ok, status: image.status })
      console.log(`${ok ? 'OK  ' : 'FAIL'} Imagen remota disponible (${image.status})`)
      if (!ok) process.exitCode = 1
    }

    console.log(`\nRESULT ${checks.filter((item) => item.ok).length}/${checks.length} OK`)
  } finally {
    if (next) {
      next.kill()
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(next.pid), '/T', '/F'], { stdio: 'ignore' })
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    await new Promise((resolve) => mock.server.close(resolve))
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
