import type {
  GpuKind,
  TechnicalSheet,
  TechnicalSheetCpu,
  TechnicalSheetGpu,
  TechnicalSheetLegacy,
  TechnicalSheetRamModule,
  TechnicalSheetStorageDrive
} from '@/types'

function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function newRamModule(): TechnicalSheetRamModule {
  return { id: makeId('ram'), type: '', capacity: '', speed: '', brand: '', warranty: '' }
}

export function newStorageDrive(): TechnicalSheetStorageDrive {
  return { id: makeId('disk'), type: '', capacity: '', speed: '', model: '', health: '', warranty: '' }
}

export function emptyTechnicalSheet(): TechnicalSheet {
  return {
    os: '',
    cpu: { brand: '', family: '', model: '' },
    gpu: { type: '', brand: '', model: '', vram: '' },
    ramModules: [],
    storageDrives: [],
    battery: '',
    notes: ''
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function normalizeCpu(value: unknown): TechnicalSheetCpu {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { brand: '', family: '', model: '' }
  const row = value as any
  return {
    brand: text(row.brand),
    family: text(row.family),
    model: text(row.model)
  }
}

function normalizeGpu(value: unknown): TechnicalSheetGpu {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { type: '', brand: '', model: '', vram: '' }
  const row = value as any
  const type: GpuKind =
    row.type === 'none' || row.type === 'integrated' || row.type === 'dedicated' ? row.type : ''
  return {
    type,
    brand: text(row.brand),
    model: text(row.model),
    vram: text(row.vram)
  }
}

function normalizeRamRows(value: unknown): TechnicalSheetRamModule[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item: any, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `ram_legacy_${index}`,
      type: text(item.type),
      capacity: text(item.capacity),
      speed: text(item.speed),
      brand: text(item.brand),
      warranty: text(item.warranty)
    }))
}

function normalizeStorageRows(value: unknown): TechnicalSheetStorageDrive[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item: any, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `disk_legacy_${index}`,
      type: text(item.type),
      capacity: text(item.capacity),
      speed: text(item.speed),
      model: text(item.model),
      health: text(item.health),
      warranty: text(item.warranty)
    }))
}

/**
 * Acepta la ficha nueva y también la ficha plana de 1.5.0. Los textos
 * antiguos que no se pueden separar en campos (CPU, GPU, RAM, disco) se
 * conservan en `legacy` para no perder información.
 */
export function normalizeTechnicalSheet(value: unknown): TechnicalSheet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyTechnicalSheet()
  const source = value as any
  const legacySource = source.legacy && typeof source.legacy === 'object' ? source.legacy : {}
  const legacy: TechnicalSheetLegacy = {
    cpu: text(legacySource.cpu) || (typeof source.cpu === 'string' ? text(source.cpu) : ''),
    gpu: text(legacySource.gpu) || (typeof source.gpu === 'string' ? text(source.gpu) : ''),
    ram: text(legacySource.ram) || (typeof source.ram === 'string' ? text(source.ram) : ''),
    storage: text(legacySource.storage) || (typeof source.storage === 'string' ? text(source.storage) : '')
  }
  const hasLegacy = Object.values(legacy).some(Boolean)
  return {
    os: text(source.os),
    cpu: normalizeCpu(source.cpu),
    gpu: normalizeGpu(source.gpu),
    ramModules: normalizeRamRows(source.ramModules),
    storageDrives: normalizeStorageRows(source.storageDrives),
    battery: text(source.battery),
    notes: text(source.notes),
    ...(hasLegacy ? { legacy } : {})
  }
}

export function sanitizeTechnicalSheet(value: TechnicalSheet): TechnicalSheet {
  const cpu = value.cpu
  const gpu = value.gpu
  const cleanCpu = cpu && (cpu.brand || cpu.family || cpu.model)
    ? { brand: cpu.brand?.trim() ?? '', family: cpu.family?.trim() ?? '', model: cpu.model?.trim() ?? '' }
    : undefined
  const cleanGpu = gpu && (gpu.type || gpu.brand || gpu.model || gpu.vram)
    ? {
        type: gpu.type ?? '',
        brand: gpu.brand?.trim() ?? '',
        model: gpu.model?.trim() ?? '',
        vram: gpu.vram?.trim() ?? ''
      }
    : undefined
  const ramModules = (value.ramModules ?? [])
    .map((row) => ({
      id: row.id,
      type: row.type?.trim() ?? '',
      capacity: row.capacity?.trim() ?? '',
      speed: row.speed?.trim() ?? '',
      brand: row.brand?.trim() ?? '',
      warranty: row.warranty?.trim() ?? ''
    }))
    .filter((row) => Object.entries(row).some(([key, item]) => key !== 'id' && Boolean(item)))
  const storageDrives = (value.storageDrives ?? [])
    .map((row) => ({
      id: row.id,
      type: row.type?.trim() ?? '',
      capacity: row.capacity?.trim() ?? '',
      speed: row.speed?.trim() ?? '',
      model: row.model?.trim() ?? '',
      health: row.health?.trim() ?? '',
      warranty: row.warranty?.trim() ?? ''
    }))
    .filter((row) => Object.entries(row).some(([key, item]) => key !== 'id' && Boolean(item)))
  return {
    os: value.os?.trim() ?? '',
    cpu: cleanCpu,
    gpu: cleanGpu,
    ramModules,
    storageDrives,
    battery: value.battery?.trim() ?? '',
    notes: value.notes?.trim() ?? '',
    ...(value.legacy ? { legacy: value.legacy } : {})
  }
}

export function gpuKindLabel(value?: GpuKind) {
  if (value === 'none') return 'Sin GPU'
  if (value === 'integrated') return 'Integrada'
  if (value === 'dedicated') return 'Dedicada'
  return ''
}

export function technicalSheetEntries(value: unknown): Array<[string, string]> {
  const sheet = normalizeTechnicalSheet(value)
  const entries: Array<[string, string]> = []
  if (sheet.os) entries.push(['Sistema operativo', sheet.os])
  const cpu = [sheet.cpu?.brand, sheet.cpu?.family, sheet.cpu?.model].filter(Boolean).join(' ')
  if (cpu) entries.push(['CPU', cpu])
  const gpu = [gpuKindLabel(sheet.gpu?.type), sheet.gpu?.brand, sheet.gpu?.model, sheet.gpu?.vram]
    .filter(Boolean)
    .join(' ')
  if (gpu) entries.push(['GPU', gpu])
  const ramRows = (sheet.ramModules ?? [])
    .map((row) => [row.type, row.capacity, row.speed, row.brand, row.warranty].filter(Boolean).join(' '))
    .filter(Boolean)
  if (ramRows.length) entries.push(['RAM', ramRows.join(' · ')])
  const storageRows = (sheet.storageDrives ?? [])
    .map((row) => [row.type, row.capacity, row.speed, row.model, row.health, row.warranty].filter(Boolean).join(' '))
    .filter(Boolean)
  if (storageRows.length) entries.push(['Almacenamiento', storageRows.join(' · ')])
  if (sheet.battery) entries.push(['Batería', sheet.battery])
  if (sheet.notes) entries.push(['Observaciones', sheet.notes])
  if (sheet.legacy?.cpu) entries.push(['CPU · ficha anterior', sheet.legacy.cpu])
  if (sheet.legacy?.gpu) entries.push(['GPU · ficha anterior', sheet.legacy.gpu])
  if (sheet.legacy?.ram) entries.push(['RAM · ficha anterior', sheet.legacy.ram])
  if (sheet.legacy?.storage) entries.push(['Almacenamiento · ficha anterior', sheet.legacy.storage])
  return entries
}
