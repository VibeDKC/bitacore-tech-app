import fs from 'node:fs'
import path from 'node:path'
import { EVIDENCE_SCHEME } from './evidence'
import { sha256Bytes } from './security'

export const PAYMENT_RECEIPT_FOLDER = 'payment-receipts'
export const MAX_PAYMENT_RECEIPT_BYTES = 8 * 1024 * 1024

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
}

export interface PreparedPaymentReceipt {
  relativePath: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

export function paymentReceiptRoot(userDataPath: string) {
  return path.join(userDataPath, PAYMENT_RECEIPT_FOLDER)
}

export function resolvePaymentReceiptFile(userDataPath: string, relativePath: string) {
  const root = path.resolve(paymentReceiptRoot(userDataPath))
  const absolute = path.resolve(userDataPath, relativePath)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('La ruta del comprobante no es válida.')
  }
  return absolute
}

export function paymentReceiptUrl(relativePath: string) {
  const segments = relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
  return `${EVIDENCE_SCHEME}://local/${segments.join('/')}`
}

function safeFilename(value: unknown, fallback: string) {
  const name = String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return name || fallback
}

function decodeReceiptDataUrl(dataUrl: unknown) {
  const raw = String(dataUrl ?? '')
  const match = raw.match(
    /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/
  )
  if (!match) throw new Error('El comprobante debe ser una imagen PNG/JPEG/WebP o un PDF.')
  const mimeType = match[1].toLowerCase()
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  if (!buffer.length) throw new Error('El comprobante está vacío.')
  if (buffer.length > MAX_PAYMENT_RECEIPT_BYTES) {
    throw new Error('El comprobante supera el límite de 8 MB.')
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
    (mimeType === 'application/pdf' && buffer.subarray(0, 4).toString('ascii') === '%PDF')
  if (!valid) throw new Error('El contenido del comprobante no corresponde al formato indicado.')
  return { buffer, mimeType, extension: MIME_EXTENSIONS[mimeType] }
}

export function preparePaymentReceipt({
  userDataPath,
  paymentId,
  dataUrl,
  filename
}: {
  userDataPath: string
  paymentId: string
  dataUrl: unknown
  filename?: unknown
}): PreparedPaymentReceipt {
  const decoded = decodeReceiptDataUrl(dataUrl)
  const safePaymentId = String(paymentId).replace(/[^A-Za-z0-9_-]/g, '')
  const hash = sha256Bytes(decoded.buffer)
  const relativePath = path.posix.join(
    PAYMENT_RECEIPT_FOLDER,
    safePaymentId,
    `${hash.slice(0, 20)}.${decoded.extension}`
  )
  const absolute = resolvePaymentReceiptFile(userDataPath, relativePath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, decoded.buffer)
  return {
    relativePath,
    filename: safeFilename(filename, `comprobante.${decoded.extension}`),
    mimeType: decoded.mimeType,
    sizeBytes: decoded.buffer.length,
    sha256: hash
  }
}

export function removePaymentReceiptFiles(
  userDataPath: string,
  relativePaths: Array<string | null | undefined>
) {
  for (const relativePath of relativePaths) {
    if (!relativePath) continue
    try {
      const absolute = resolvePaymentReceiptFile(userDataPath, relativePath)
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
