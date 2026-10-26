import type { EvidenceCategory, EvidenceInput, EvidenceSource, EvidenceStage } from '@/types'

export const MAX_EVIDENCE_PER_BATCH = 10
export const MAX_EVIDENCE_FILE_BYTES = 2.5 * 1024 * 1024
export const MAX_EVIDENCE_TOTAL_BYTES = 25 * 1024 * 1024
export const MAX_RAW_EVIDENCE_FILE_BYTES = 20 * 1024 * 1024
export const EVIDENCE_IMAGE_MAX_DIMENSION = 1600
export const EVIDENCE_THUMB_DIMENSION = 640
export const EVIDENCE_JPEG_QUALITY = 0.82

export const evidenceCategories: Array<{ value: EvidenceCategory; label: string }> = [
  { value: 'general', label: 'Estado general' },
  { value: 'pantalla', label: 'Pantalla' },
  { value: 'carcasa', label: 'Carcasa' },
  { value: 'serial', label: 'Serial' },
  { value: 'accesorios', label: 'Accesorios' },
  { value: 'otro', label: 'Otro detalle' }
]

export const evidenceCategoryLabels: Record<EvidenceCategory, string> = {
  general: 'Estado general',
  pantalla: 'Pantalla',
  carcasa: 'Carcasa',
  serial: 'Serial',
  accesorios: 'Accesorios',
  otro: 'Otro detalle'
}

export const evidenceStageLabels: Record<EvidenceStage, string> = {
  ingreso: 'Ingreso',
  reparacion: 'Reparación'
}

export interface EvidenceDraft extends EvidenceInput {
  id: string
  dataUrl: string
  thumbnailDataUrl: string
  category: EvidenceCategory
  note: string
  source: EvidenceSource
  width: number
  height: number
  size: number
}

type ImageSource = HTMLImageElement | HTMLVideoElement | ImageBitmap

function draftId() {
  try {
    return `ev_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
  } catch {
    return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}

export function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] ?? ''
  return Math.floor((base64.length * 3) / 4)
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function sourceDimensions(source: ImageSource) {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth || 0, height: source.videoHeight || 0 }
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth || 0, height: source.naturalHeight || 0 }
  }
  return { width: source.width || 0, height: source.height || 0 }
}

function drawToCanvas(source: ImageSource, maxDimension: number) {
  const dimensions = sourceDimensions(source)
  if (!dimensions.width || !dimensions.height) throw new Error('La imagen no tiene dimensiones válidas.')
  const scale = Math.min(1, maxDimension / Math.max(dimensions.width, dimensions.height))
  const width = Math.max(1, Math.round(dimensions.width * scale))
  const height = Math.max(1, Math.round(dimensions.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No fue posible procesar la imagen en este equipo.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source as CanvasImageSource, 0, 0, width, height)
  return { canvas, width, height }
}

function encodeWithLimit(source: ImageSource) {
  let maxDimension = EVIDENCE_IMAGE_MAX_DIMENSION
  let quality = EVIDENCE_JPEG_QUALITY
  let last = ''
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { canvas, width, height } = drawToCanvas(source, maxDimension)
    last = canvas.toDataURL('image/jpeg', quality)
    if (dataUrlBytes(last) <= MAX_EVIDENCE_FILE_BYTES) {
      return { dataUrl: last, width, height, quality }
    }
    if (quality > 0.6) quality = Math.max(0.6, quality - 0.08)
    else maxDimension = Math.max(960, Math.round(maxDimension * 0.82))
  }
  return {
    dataUrl: last,
    width: drawToCanvas(source, maxDimension).width,
    height: drawToCanvas(source, maxDimension).height,
    quality
  }
}

function encodeThumbnail(source: ImageSource) {
  const { canvas, width, height } = drawToCanvas(source, EVIDENCE_THUMB_DIMENSION)
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.78),
    width,
    height
  }
}

async function loadBitmap(file: File): Promise<ImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    } catch {
      return await createImageBitmap(file)
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    // El llamador no puede liberar la URL antes de dibujar; se libera al terminar.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

export async function fileToEvidence(file: File): Promise<EvidenceDraft> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name} no es una imagen compatible.`)
  }
  if (file.size > MAX_RAW_EVIDENCE_FILE_BYTES) {
    throw new Error(`${file.name} supera los 20 MB. Usa una foto más liviana.`)
  }
  const source = await loadBitmap(file)
  try {
    const main = encodeWithLimit(source)
    const thumbnail = encodeThumbnail(source)
    return {
      id: draftId(),
      dataUrl: main.dataUrl,
      thumbnailDataUrl: thumbnail.dataUrl,
      category: 'general',
      note: '',
      source: 'archivo',
      width: main.width,
      height: main.height,
      size: dataUrlBytes(main.dataUrl)
    }
  } finally {
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close()
  }
}

export async function captureVideoFrame(video: HTMLVideoElement): Promise<EvidenceDraft> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('La cámara todavía no está lista. Espera un segundo e intenta de nuevo.')
  }
  const main = encodeWithLimit(video)
  const thumbnail = encodeThumbnail(video)
  return {
    id: draftId(),
    dataUrl: main.dataUrl,
    thumbnailDataUrl: thumbnail.dataUrl,
    category: 'general',
    note: '',
    source: 'camara',
    width: main.width,
    height: main.height,
    size: dataUrlBytes(main.dataUrl)
  }
}

export function downloadBase64File(filename: string, base64: string, mimeType: string) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const blob = new Blob([bytes], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}
