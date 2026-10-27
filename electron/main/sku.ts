const BRAND_CODES: Array<[string, string]> = [
  ['TP-LINK', 'TPL'],
  ['TPLINK', 'TPL'],
  ['MERCUSYS', 'MERC'],
  ['JALTECH', 'JAL'],
  ['GENIUS', 'GEN'],
  ['LOGITECH', 'LOG'],
  ['XIAOMI', 'XIA'],
  ['REDMI', 'XIA'],
  ['REDRAGON', 'RDRG'],
  ['TECHZONE', 'TECH'],
  ['DAHUA', 'DAH'],
  ['HIKVISION', 'HIK'],
  ['TENDA', 'TEN'],
  ['D-LINK', 'DLK'],
  ['DLINK', 'DLK'],
  ['NEXXT', 'NXT'],
  ['KINGSTON', 'KING'],
  ['SANDISK', 'SAND'],
  ['ADATA', 'ADAT'],
  ['LEXAR', 'LEX'],
  ['SOMNAMBULIST', 'SOMN'],
  ['CRUCIAL', 'CRUC'],
  ['SAMSUNG', 'SAMS'],
  ['SEAGATE', 'SEA'],
  ['WESTERN', 'WD'],
  ['CORSAIR', 'CORS'],
  ['LENOVO', 'LEN'],
  ['DELL', 'DELL'],
  ['ASUS', 'ASUS'],
  ['ACER', 'ACER'],
  ['APPLE', 'APL']
]

const INTERNAL_TYPES = new Set([
  'WIFI',
  'ROU',
  'SW',
  'BASE',
  'MOU',
  'TEC',
  'BAT',
  'CARG',
  'SOP',
  'FUN',
  'CASE',
  'CBL',
  'AUD',
  'USB',
  'MSD',
  'SSD',
  'HDD',
  'DISC',
  'RAM',
  'KZ',
  'QKZ',
  'PROD'
])

function normalizeText(value: string) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function brandCode(text: string) {
  const upper = normalizeText(text)
  for (const [name, code] of BRAND_CODES) {
    if (upper.includes(name)) return code
  }
  return ''
}

function modelFromSupplierCode(supplierSku: string) {
  let clean = normalizeText(supplierSku).replace(/[^A-Z0-9-]/g, '')
  for (const prefix of ['TL-', 'DZ-', 'JAL-', 'ST-']) {
    if (clean.startsWith(prefix)) {
      clean = clean.slice(prefix.length)
      break
    }
  }
  return clean.replace(/-/g, '').slice(0, 18)
}

function modelFromName(name: string) {
  const words = normalizeText(name).split(/[^A-Z0-9-]+/).filter(Boolean)
  const excluded = new Set([
    'USB',
    'DDR2',
    'DDR3',
    'DDR4',
    'DDR5',
    '300MBPS',
    '1000MBPS',
    'GIGABIT',
    'CON',
    'SIN',
    'MIC',
    'TYPE-C',
    '3.5MM'
  ])
  for (const word of words) {
    if (excluded.has(word)) continue
    if (/^[A-Z0-9]{2,}[0-9]+[A-Z0-9]*$/.test(word) || (word.includes('-') && word.length >= 3)) {
      return word.replace(/-/g, '').slice(0, 18)
    }
  }
  return ''
}

function headphonesSku(name: string) {
  const parts: string[] = []
  if (name.includes('QKZ')) parts.push('QKZ')
  else if (name.includes('KZ')) parts.push('KZ')
  else parts.push('AUD')

  if (name.includes('CASTOR PRO 2') || name.includes('CASTOR PRO2')) parts.push('CASPRO2')
  else if (name.includes('CASTOR PRO')) parts.push('CASPRO')
  else if (name.includes('CASTOR BASS')) parts.push('CASB')
  else if (name.includes('CASTOR')) parts.push('CASTOR')
  else if (name.includes('EDX PRO X') || name.includes('EDX PROX')) parts.push('EDXPROX')
  else if (name.includes('EDX PRO')) parts.push('EDXPRO')
  else if (name.includes('EDX LITE')) parts.push('EDXLITE')
  else if (name.includes('EDX')) parts.push('EDX')
  else if (name.includes('ZSN PRO X') || name.includes('ZSN PROX')) parts.push('ZSNPROX')
  else if (name.includes('ZSN PRO')) parts.push('ZSNPRO')
  else if (name.includes('ZSN')) parts.push('ZSN')
  else if (name.includes('DFI') || name.includes('D-FI')) parts.push('DFI')
  else if (name.includes('KRILA')) parts.push('KRILA')
  else {
    const match = name.match(/\b(?:KZ|QKZ)\s+([A-Z0-9]+)/)
    parts.push(match?.[1]?.slice(0, 8) ?? 'MOD')
  }

  parts.push(
    name.includes('TYPE-C') || name.includes('TYPE C') || name.includes('USB-C')
      ? 'TC'
      : '35'
  )
  if (name.includes('SIN MIC') || name.includes('NO MIC') || name.includes('WITHOUT MIC')) {
    parts.push('NOMIC')
  } else if (name.includes('CON MIC') || name.includes('WITH MIC') || name.includes('MIC')) {
    parts.push('MIC')
  }
  if (name.includes('SILVER') || name.includes('PLATA')) parts.push('SIL')
  else if (name.includes('BLACK') || name.includes('NEGRO')) parts.push('BLK')
  else if (name.includes('GREEN') || name.includes('VERDE')) parts.push('GRN')
  else if (name.includes('CYAN')) parts.push('CYA')
  else if (name.includes('BLUE') || name.includes('AZUL')) parts.push('BLU')
  else if (name.includes('WHITE') || name.includes('BLANCO')) parts.push('WHT')
  else if (name.includes('GOLD') || name.includes('DORADO')) parts.push('GLD')
  return parts
}

function usbSku(name: string) {
  const parts = ['USB']
  const brand =
    ['KINGSTON', 'SANDISK', 'ADATA', 'LEXAR', 'SAMSUNG'].find((item) => name.includes(item)) ?? ''
  if (brand) parts.push(brandCode(brand))
  if (name.includes('EXODIA')) parts.push('EXO')
  else if (name.includes('DATATRAVELER') || /\bDT\d+/.test(name)) parts.push('DT')
  else if (name.includes('KYSON')) parts.push('KYS')
  else if (name.includes('CRUZER')) parts.push('CRUZ')
  else if (name.includes('ULTRA FLAIR') || name.includes('FLAIR')) parts.push('FLAIR')
  else if (name.includes('DUAL')) parts.push('DUAL')
  const capacity = name.match(/\b(\d+)\s*(GB|G)\b/)
  if (capacity) parts.push(`${capacity[1]}G`)
  if (name.includes('TYPE-C') || name.includes('TYPE C') || name.includes('USB-C')) parts.push('TC')
  else if (name.includes('3.2')) parts.push('32')
  else if (name.includes('3.1')) parts.push('31')
  else if (name.includes('3.0')) parts.push('30')
  else if (name.includes('2.0')) parts.push('20')
  return parts
}

function microSdSku(name: string) {
  const parts = ['MSD']
  const brand =
    ['KINGSTON', 'SANDISK', 'SAMSUNG'].find((item) => name.includes(item)) ?? ''
  if (brand) parts.push(brandCode(brand))
  if (name.includes('CANVAS')) parts.push('CANV')
  else if (name.includes('ULTRA')) parts.push('ULT')
  else if (name.includes('EXTREME')) parts.push('EXT')
  const capacity = name.match(/\b(\d+)\s*(GB|G)\b/)
  if (capacity) parts.push(`${capacity[1]}G`)
  if (name.includes('A1')) parts.push('A1')
  else if (name.includes('A2')) parts.push('A2')
  else if (name.includes('CLASE 10') || name.includes('CLASS 10') || name.includes('C10')) {
    parts.push('C10')
  }
  return parts
}

function storageSku(name: string) {
  const prefix = name.includes('SSD') ? 'SSD' : name.includes('HDD') ? 'HDD' : 'DISC'
  const parts = [prefix]
  if (name.includes('NVME') || name.includes('M.2')) parts.push(name.includes('NVME') ? 'NVME' : 'M2')
  const brand =
    ['SOMNAMBULIST', 'KINGSTON', 'WESTERN', 'SEAGATE', 'CRUCIAL', 'ADATA'].find((item) =>
      name.includes(item)
    ) ?? ''
  if (brand) parts.push(brandCode(brand))
  const capacity = name.match(/\b(\d+)\s*(GB|TB|G|T)\b/)
  if (capacity) parts.push(`${capacity[1]}${capacity[2].startsWith('T') ? 'T' : 'G'}`)
  return parts
}

function ramSku(name: string) {
  const parts = ['RAM']
  if (name.includes('KINGSTON') || name.includes('FURY')) parts.push('KING')
  else if (name.includes('CRUCIAL')) parts.push('CRUC')
  else if (name.includes('CORSAIR')) parts.push('CORS')
  const capacity = name.match(/\b(\d+)\s*(GB|G)\b/)
  if (capacity) parts.push(`${capacity[1]}G`)
  for (const ddr of ['DDR5', 'DDR4', 'DDR3', 'DDR2']) {
    if (name.includes(ddr)) {
      parts.push(ddr)
      break
    }
  }
  return parts
}

function generalSku(name: string, supplierSku: string) {
  let brand = brandCode(`${name} ${supplierSku}`)
  if (!brand) {
    const code = normalizeText(supplierSku)
    if (code.startsWith('TL-') || code.startsWith('TL')) brand = 'TPL'
    else if (code.startsWith('MS') || code.startsWith('MW')) brand = 'MERC'
    else if (code.startsWith('JAL-') || code.startsWith('DZ-')) brand = 'JAL'
    else if (code.startsWith('ST-')) brand = 'ST'
    else if (code.startsWith('DX-')) brand = 'GEN'
  }

  let type = ''
  if (
    ['WIFI', 'INALAMBRICO', 'INALAMBRICA', 'WIRELESS', 'USB INAL', 'NANO USB'].some((item) =>
      name.includes(item)
    ) &&
    !['SWITCH', 'ROUTER'].some((item) => name.includes(item))
  ) {
    type = 'WIFI'
  } else if (['ROUTER', 'RUTADOR', 'REPETIDOR', 'EXTENDER'].some((item) => name.includes(item))) {
    type = 'ROU'
  } else if (['SWITCH', 'CONMUTADOR'].some((item) => name.includes(item))) {
    type = 'SW'
  } else if (
    ['BASE REFRIGERANTE', 'PAD COOLER', 'COOLER PAD', 'BASE ENFRIADORA', 'REFRIGERANTE'].some(
      (item) => name.includes(item)
    )
  ) {
    type = 'BASE'
  } else if (['MOUSE', 'RATON'].some((item) => name.includes(item))) {
    type = 'MOU'
  } else if (['TECLADO', 'KEYBOARD'].some((item) => name.includes(item))) {
    type = 'TEC'
  } else if (['BATERIA', 'BATTERY'].some((item) => name.includes(item))) {
    type = 'BAT'
  } else if (['CARGADOR', 'FUENTE', 'POWER SUPPLY'].some((item) => name.includes(item))) {
    type = 'CARG'
  } else if (['SOPORTE', 'STAND', 'BRAZO'].some((item) => name.includes(item))) {
    type = 'SOP'
  } else if (['FUNDA', 'ESTUCHE', 'MALETIN', 'SLEEVE'].some((item) => name.includes(item))) {
    type = 'FUN'
  } else if (['CAJA', 'CASE', 'COFRE'].some((item) => name.includes(item))) {
    type = 'CASE'
  } else if (['CABLE', 'HDMI', 'PATCH', 'DISPLAYPORT'].some((item) => name.includes(item))) {
    type = 'CBL'
  } else if (['AURICULAR', 'HEADPHONE', 'AUDIFONO', 'DIADEMA', 'HEADSET'].some((item) => name.includes(item))) {
    type = 'AUD'
  }

  const model = supplierSku && !/^\d+$/.test(supplierSku)
    ? modelFromSupplierCode(supplierSku)
    : modelFromName(name)
  const parts = [type, brand, model].filter(Boolean)
  if (parts.length >= 2) return parts
  return []
}

export function generateInternalSku(name: string, supplierSku = '') {
  const normalized = normalizeText(name)
  if (!normalized) return ''
  const candidate = (() => {
    if (
      normalized.includes('KZ') ||
      normalized.includes('QKZ') ||
      (normalized.includes('AURICULAR') &&
        ['CASTOR', 'EDX', 'ZSN', 'KRILA', 'DFI'].some((item) => normalized.includes(item)))
    ) {
      return headphonesSku(normalized).filter(Boolean).join('-').slice(0, 60)
    }
    if (
      normalized.includes('USB') &&
      ['MEMORIA', 'PENDRIVE', 'FLASH', 'DRIVE', 'DATATRAVELER', 'EXODIA'].some((item) =>
        normalized.includes(item)
      )
    ) {
      return usbSku(normalized).filter(Boolean).join('-').slice(0, 60)
    }
    if (['MICROSD', 'MICRO SD', 'TF CARD'].some((item) => normalized.includes(item))) {
      return microSdSku(normalized).filter(Boolean).join('-').slice(0, 60)
    }
    if (['SSD', 'DISCO', 'HDD'].some((item) => normalized.includes(item))) {
      return storageSku(normalized).filter(Boolean).join('-').slice(0, 60)
    }
    if (
      normalized.includes('RAM') ||
      ['DDR2', 'DDR3', 'DDR4', 'DDR5'].some((item) => normalized.includes(item))
    ) {
      return ramSku(normalized).filter(Boolean).join('-').slice(0, 60)
    }
    const general = generalSku(normalized, normalizeText(supplierSku))
    if (general.length >= 2) return general.join('-').slice(0, 60)

    const stop = new Set([
      'DE',
      'CON',
      'PARA',
      'EL',
      'LA',
      'EN',
      'UN',
      'UNA',
      'Y',
      'POR',
      'SIN',
      'THE',
      'WITH',
      'FOR',
      'AND',
      'TO',
      'IN',
      'OF',
      'ON',
      'PRODUCTO',
      'NUEVO'
    ])
    const words = normalized.match(/[A-Z0-9]+/g) ?? []
    const useful = words.filter((word) => !stop.has(word) && word.length > 1)
    if (!useful.length) {
      const supplierModel = supplierSku ? modelFromSupplierCode(supplierSku) : ''
      return supplierModel ? `PROD-${supplierModel}` : 'PROD-GEN'
    }
    return `PROD-${useful
      .slice(0, 4)
      .map((word) => word.slice(0, 6))
      .join('-')}`.slice(0, 60)
  })()
  if (isValidInternalSku(candidate)) return candidate
  const supplierModel = supplierSku ? modelFromSupplierCode(supplierSku) : ''
  return supplierModel ? `PROD-${supplierModel}`.slice(0, 60) : 'PROD-GEN'
}

export function normalizeSkuCandidate(value: unknown) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

export function isValidInternalSku(value: string) {
  if (!value || value.length > 60) return false
  const parts = value.split('-')
  if (parts.length < 2 || parts.length > 5) return false
  if (!INTERNAL_TYPES.has(parts[0])) return false
  return parts.every((part) => /^[A-Z0-9]{1,14}$/.test(part))
}

export interface SkuResolution {
  sku: string
  source: 'producto' | 'ia' | 'local' | 'ajustado' | 'sin-sku'
  warning: string | null
}

export function resolveInternalSku({
  aiSku,
  name,
  supplierSku = '',
  existingSkus = [],
  currentSku = ''
}: {
  aiSku?: string
  name: string
  supplierSku?: string
  existingSkus?: string[]
  currentSku?: string
}): SkuResolution {
  if (currentSku) return { sku: currentSku, source: 'producto', warning: null }

  const used = new Set(existingSkus.map((sku) => sku.toLowerCase()))
  const supplierNormalized = normalizeSkuCandidate(supplierSku)
  const candidate = normalizeSkuCandidate(aiSku)
  let source: SkuResolution['source'] = 'ia'
  let warning: string | null = null
  let sku = ''

  if (candidate && isValidInternalSku(candidate) && candidate !== supplierNormalized) {
    sku = candidate
  } else {
    sku = generateInternalSku(name, supplierSku)
    source = 'local'
    if (candidate && candidate === supplierNormalized) {
      warning = 'La IA devolvió el código del proveedor; se generó el SKU interno modular.'
    }
  }

  if (!sku) {
    return { sku: '', source: 'sin-sku', warning: 'No se pudo generar un SKU interno.' }
  }

  if (used.has(sku.toLowerCase())) {
    const base = sku
    let suffix = 2
    while (used.has(`${base}-${suffix}`.toLowerCase()) && suffix < 1000) suffix += 1
    sku = `${base}-${suffix}`
    source = 'ajustado'
    warning = `El SKU ${base} ya existía; se propuso ${sku}.`
  }

  return { sku, source, warning }
}
