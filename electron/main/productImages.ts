import fs from 'node:fs'
import path from 'node:path'
import { EVIDENCE_SCHEME } from './evidence'
import { sha256Bytes } from './security'

export const PRODUCT_IMAGE_FOLDER = 'product-images'
export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_PRODUCT_THUMB_BYTES = 2 * 1024 * 1024

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/bmp': 'bmp'
}

export interface PreparedProductImage {
  imagePath: string
  imageThumbPath: string
  imageBytes: number
  thumbBytes: number
}

export function productImageRoot(userDataPath: string) {
  return path.join(userDataPath, PRODUCT_IMAGE_FOLDER)
}

export function resolveProductImageFile(userDataPath: string, relativePath: string) {
  const root = path.resolve(productImageRoot(userDataPath))
  const absolute = path.resolve(userDataPath, relativePath)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('La ruta de la imagen del producto no es válida.')
  }
  return absolute
}

export function productImageUrl(relativePath: string) {
  const segments = relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
  return `${EVIDENCE_SCHEME}://local/${segments.join('/')}`
}

function decodeImageDataUrl(dataUrl: unknown, label: string, maxBytes: number) {
  const raw = String(dataUrl ?? '')
  const match = raw.match(/^data:(image\/(?:jpeg|png|webp|bmp));base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) throw new Error(`${label}: formato de imagen no válido.`)
  const mimeType = match[1].toLowerCase()
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  if (!buffer.length) throw new Error(`${label}: la imagen está vacía.`)
  if (buffer.length > maxBytes) {
    throw new Error(`${label}: supera el límite de ${(maxBytes / (1024 * 1024)).toFixed(0)} MB.`)
  }
  const valid =
    (mimeType === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8) ||
    (mimeType === 'image/png' &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47) ||
    (mimeType === 'image/webp' &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') ||
    (mimeType === 'image/bmp' && buffer[0] === 0x42 && buffer[1] === 0x4d)
  if (!valid) throw new Error(`${label}: el contenido no corresponde al formato indicado.`)
  return { buffer, mimeType, extension: MIME_EXTENSIONS[mimeType] }
}

export function prepareProductImage({
  userDataPath,
  productId,
  dataUrl,
  thumbnailDataUrl
}: {
  userDataPath: string
  productId: string
  dataUrl: unknown
  thumbnailDataUrl?: unknown
}): PreparedProductImage {
  const main = decodeImageDataUrl(dataUrl, 'Imagen del producto', MAX_PRODUCT_IMAGE_BYTES)
  const thumb = thumbnailDataUrl
    ? decodeImageDataUrl(
        thumbnailDataUrl,
        'Miniatura del producto',
        MAX_PRODUCT_THUMB_BYTES
      )
    : main
  const safeProductId = String(productId).replace(/[^A-Za-z0-9_-]/g, '')
  const hash = sha256Bytes(main.buffer).slice(0, 16)
  const relativeImage = path.posix.join(
    PRODUCT_IMAGE_FOLDER,
    safeProductId,
    `${hash}.${main.extension}`
  )
  const relativeThumb = path.posix.join(
    PRODUCT_IMAGE_FOLDER,
    safeProductId,
    `${hash}-thumb.${thumb.extension}`
  )
  const absoluteImage = resolveProductImageFile(userDataPath, relativeImage)
  const absoluteThumb = resolveProductImageFile(userDataPath, relativeThumb)
  fs.mkdirSync(path.dirname(absoluteImage), { recursive: true })
  fs.writeFileSync(absoluteImage, main.buffer)
  fs.writeFileSync(absoluteThumb, thumb.buffer)
  return {
    imagePath: relativeImage,
    imageThumbPath: relativeThumb,
    imageBytes: main.buffer.length,
    thumbBytes: thumb.buffer.length
  }
}

export function removeProductImageFiles(
  userDataPath: string,
  relativePaths: Array<string | null | undefined>
) {
  for (const relativePath of relativePaths) {
    if (!relativePath) continue
    try {
      const absolute = resolveProductImageFile(userDataPath, relativePath)
      if (fs.existsSync(absolute)) fs.rmSync(absolute, { force: true })
      const directory = path.dirname(absolute)
      if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
        fs.rmdirSync(directory)
      }
    } catch {
      // La limpieza no debe ocultar el resultado principal.
    }
  }
}
