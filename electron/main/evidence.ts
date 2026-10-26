import fs from 'node:fs'
import path from 'node:path'
import type { Database } from './database'
import { RpcError } from './permissions'
import { sha256, sha256Bytes } from './security'

export const EVIDENCE_SCHEME = 'bitacoretech-evidence'
export const EVIDENCE_FOLDER = 'evidence'
export const EVIDENCE_CATEGORIES = ['general', 'pantalla', 'carcasa', 'serial', 'accesorios', 'otro'] as const
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number]
export type EvidenceStage = 'ingreso' | 'reparacion'
export type EvidenceSource = 'archivo' | 'camara'

export const MAX_EVIDENCE_PER_BATCH = 10
export const MAX_EVIDENCE_FILE_BYTES = 2.5 * 1024 * 1024
export const MAX_EVIDENCE_TOTAL_BYTES = 25 * 1024 * 1024
export const MAX_EVIDENCE_THUMB_BYTES = 1.5 * 1024 * 1024

export const EVIDENCE_CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  general: 'Estado general',
  pantalla: 'Pantalla',
  carcasa: 'Carcasa',
  serial: 'Serial',
  accesorios: 'Accesorios',
  otro: 'Otro detalle'
}

interface DecodedImage {
  buffer: Buffer
  mime: string
  extension: string
}

export interface EvidenceActor {
  userId: string
  userName: string
}

export interface PreparedEvidence {
  id: string
  orderId: string
  category: EvidenceCategory
  note: string | null
  stage: EvidenceStage
  source: EvidenceSource
  filename: string
  relativePath: string
  absolutePath: string
  thumbFilename: string
  thumbRelativePath: string
  thumbAbsolutePath: string
  mimeType: string
  sizeBytes: number
  thumbSizeBytes: number
  width: number | null
  height: number | null
  sha256: string
  capturedAt: string
  capturedBy: string
  capturedByName: string
}

function evidenceError(message: string): never {
  throw new RpcError(message, 'BAD_REQUEST')
}

function decodeBase64(value: unknown, field: string, maxBytes: number): DecodedImage {
  if (typeof value !== 'string' || !value) evidenceError(`${field} no contiene una imagen válida`)
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim())
  if (!match) evidenceError(`${field} debe ser una imagen JPEG, PNG o WebP en base64`)
  const clean = match[2].replace(/\s+/g, '')
  const estimated = Math.floor((clean.length * 3) / 4)
  if (estimated > maxBytes + 4) {
    evidenceError(`${field} supera el límite de ${(maxBytes / (1024 * 1024)).toFixed(1)} MB por fotografía`)
  }
  const buffer = Buffer.from(clean, 'base64')
  if (!buffer.length) evidenceError(`${field} está vacía`)
  if (buffer.length > maxBytes) {
    evidenceError(`${field} supera el límite de ${(maxBytes / (1024 * 1024)).toFixed(1)} MB por fotografía`)
  }
  const mime = sniffImageMime(buffer)
  if (!mime) evidenceError(`${field} no contiene una imagen JPEG, PNG o WebP reconocible`)
  const declared = match[1].toLowerCase().replace('image/jpg', 'image/jpeg')
  if (declared !== mime) evidenceError(`${field} no coincide con el tipo de imagen declarado`)
  return { buffer, mime, extension: mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp' }
}

function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}

export function evidenceRoot(userDataPath: string) {
  return path.join(userDataPath, EVIDENCE_FOLDER)
}

export function resolveEvidenceFile(userDataPath: string, relativePath: string) {
  const root = path.resolve(evidenceRoot(userDataPath))
  const absolute = path.resolve(userDataPath, relativePath)
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    evidenceError('La ruta de la evidencia no es válida.')
  }
  return absolute
}

export function evidenceUrl(relativePath: string) {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean).map((segment) => encodeURIComponent(segment))
  return `${EVIDENCE_SCHEME}://local/${segments.join('/')}`
}

function normalizeCategory(value: unknown): EvidenceCategory {
  return EVIDENCE_CATEGORIES.includes(value as EvidenceCategory) ? (value as EvidenceCategory) : 'general'
}

function normalizeSource(value: unknown): EvidenceSource {
  return value === 'camara' ? 'camara' : 'archivo'
}

function normalizeDimension(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(20000, Math.round(parsed))
}

export function prepareEvidenceFiles(options: {
  userDataPath: string
  orderId: string
  actor: EvidenceActor
  images: unknown
  stage: EvidenceStage
  capturedAt: string
  existingBytes?: number
}) {
  const { userDataPath, orderId, actor, stage, capturedAt } = options
  if (!Array.isArray(options.images) || !options.images.length) {
    evidenceError('Selecciona al menos una fotografía.')
  }
  if (options.images.length > MAX_EVIDENCE_PER_BATCH) {
    evidenceError(`Puedes registrar hasta ${MAX_EVIDENCE_PER_BATCH} fotografías por operación.`)
  }

  const prepared: PreparedEvidence[] = []
  let totalBytes = Number(options.existingBytes ?? 0)
  try {
    for (const [index, raw] of options.images.entries()) {
      if (!raw || typeof raw !== 'object') evidenceError(`La fotografía ${index + 1} no es válida`)
      const image = raw as Record<string, unknown>
      const main = decodeBase64(image.dataUrl ?? image.data, `La fotografía ${index + 1}`, MAX_EVIDENCE_FILE_BYTES)
      const thumb =
        image.thumbnailDataUrl || image.thumbnail
          ? decodeBase64(image.thumbnailDataUrl ?? image.thumbnail, `La miniatura ${index + 1}`, MAX_EVIDENCE_THUMB_BYTES)
          : main

      const id = `ev_${sha256(`${orderId}|${index}|${Date.now()}|${Math.random()}`).slice(0, 20)}`
      const filename = `${id}.${main.extension}`
      const thumbFilename = `${id}-thumb.${thumb.extension}`
      const relativePath = path.posix.join(EVIDENCE_FOLDER, orderId, filename)
      const thumbRelativePath = path.posix.join(EVIDENCE_FOLDER, orderId, thumbFilename)
      const absolutePath = resolveEvidenceFile(userDataPath, relativePath)
      const thumbAbsolutePath = resolveEvidenceFile(userDataPath, thumbRelativePath)

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
      fs.writeFileSync(absolutePath, main.buffer)
      fs.writeFileSync(thumbAbsolutePath, thumb.buffer)

      totalBytes += main.buffer.length
      if (totalBytes > MAX_EVIDENCE_TOTAL_BYTES) {
        evidenceError(
          `Las evidencias de esta OT superan el límite de ${(MAX_EVIDENCE_TOTAL_BYTES / (1024 * 1024)).toFixed(0)} MB.`
        )
      }

      prepared.push({
        id,
        orderId,
        category: normalizeCategory(image.category),
        note: typeof image.note === 'string' && image.note.trim() ? image.note.trim().slice(0, 500) : null,
        stage,
        source: normalizeSource(image.source),
        filename,
        relativePath,
        absolutePath,
        thumbFilename,
        thumbRelativePath,
        thumbAbsolutePath,
        mimeType: main.mime,
        sizeBytes: main.buffer.length,
        thumbSizeBytes: thumb.buffer.length,
        width: normalizeDimension(image.width),
        height: normalizeDimension(image.height),
        sha256: sha256Bytes(main.buffer),
        capturedAt,
        capturedBy: actor.userId,
        capturedByName: actor.userName
      })
    }
    return prepared
  } catch (error) {
    cleanupEvidenceFiles(prepared)
    throw error
  }
}

export function insertEvidenceRows(db: Database, prepared: PreparedEvidence[]) {
  for (const item of prepared) {
    db.run(
      `INSERT INTO work_order_evidence
        (id, work_order_id, category, note, stage, status, source, filename, path, thumb_filename, thumb_path,
         mime_type, size_bytes, thumb_size_bytes, width, height, sha256, captured_at, captured_by, captured_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, 'activa', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.id,
      item.orderId,
      item.category,
      item.note,
      item.stage,
      item.source,
      item.filename,
      item.relativePath,
      item.thumbFilename,
      item.thumbRelativePath,
      item.mimeType,
      item.sizeBytes,
      item.thumbSizeBytes,
      item.width,
      item.height,
      item.sha256,
      item.capturedAt,
      item.capturedBy,
      item.capturedByName,
      item.capturedAt
    )
  }
}

export function cleanupEvidenceFiles(prepared: PreparedEvidence[]) {
  for (const item of prepared) {
    for (const file of [item.absolutePath, item.thumbAbsolutePath]) {
      try {
        if (fs.existsSync(file)) fs.rmSync(file, { force: true })
      } catch {
        // La limpieza no debe ocultar el error original.
      }
    }
    try {
      const directory = path.dirname(item.absolutePath)
      if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory)
    } catch {
      // La carpeta puede seguir en uso o contener evidencias anteriores.
    }
  }
}

export function evidenceDto(row: any) {
  const relativePath = String(row.path)
  return {
    id: row.id,
    orderId: row.work_order_id,
    category: row.category,
    note: row.note ?? null,
    stage: row.stage,
    status: row.status,
    source: row.source ?? 'archivo',
    filename: row.filename,
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    sha256: row.sha256,
    capturedAt: row.captured_at,
    capturedByName: row.captured_by_name,
    createdAt: row.created_at,
    voidedAt: row.voided_at ?? null,
    voidedByName: row.voided_by_name ?? null,
    voidReason: row.void_reason ?? null,
    verifiedAt: row.verified_at ?? null,
    verifiedByName: row.verified_by_name ?? null,
    url: evidenceUrl(relativePath),
    thumbnailUrl: evidenceUrl(String(row.thumb_path || relativePath)),
    path: relativePath,
    thumbnailPath: row.thumb_path || relativePath
  }
}

export function evidenceSetHash(rows: any[]) {
  const active = rows
    .filter((row) => row.status === 'activa')
    .sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)) || String(a.id).localeCompare(String(b.id)))
  if (!active.length) return null
  return sha256(active.map((row) => `${row.id}|${row.sha256}|${row.captured_at}|${row.stage}`).join('\n'))
}

export function evidenceCategoryLabel(value: string) {
  return EVIDENCE_CATEGORY_LABELS[value as EvidenceCategory] ?? value
}
