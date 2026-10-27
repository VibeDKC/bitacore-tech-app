const SEO_PHRASES = [
  'HIFI BASS',
  'HI-FI BASS',
  'HOT SALE',
  'FAST DELIVERY',
  'FREE SHIPPING',
  'HIGH QUALITY',
  'HIGH-QUALITY',
  'IN-EAR EARPHONE',
  'IN EAR EARPHONE',
  'GAME SPORT HEADSET',
  'DYNAMIC DRIVERS',
  'HIGH SPEED',
  'HIGH-SPEED',
  'FLASH PEN DRIVE',
  '2DD',
  'ORIGINAL',
  'NEW ARRIVAL',
  'BEST SELLER',
  'DROPSHIPPING'
]

const SERIAL_PATTERNS = [
  /\b(?:SERIAL|SERIE|S\/N|SN)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,})\b/gi,
  /\b(?:SERIAL|SERIE|S\/N|SN)\s*[:#-]?\s*(\d{6,})\b/gi
]

export interface CleanProductText {
  name: string
  serials: string[]
  changed: boolean
}

function cleanSpaces(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;|])\s*/g, '$1 ')
    .replace(/^[\s,;|.-]+|[\s,;|.-]+$/g, '')
    .trim()
}

export function extractSerials(raw: string, extra: string[] = []): string[] {
  const found = new Set<string>()
  const source = String(raw ?? '')
  for (const pattern of SERIAL_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const serial = String(match[1] ?? '').trim()
      if (serial) found.add(serial)
    }
  }
  for (const serial of extra) {
    const clean = String(serial ?? '').trim()
    if (clean) found.add(clean)
  }
  return [...found]
}

export function cleanProductText(raw: string, extraSerials: string[] = []): CleanProductText {
  const original = String(raw ?? '').trim()
  let name = original
  const serials = extractSerials(original, extraSerials)

  for (const pattern of SERIAL_PATTERNS) {
    name = name.replace(pattern, ' ')
  }
  for (const phrase of SEO_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    name = name.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ')
  }

  name = name
    .replace(/\bTYPE[\s-]?C\b/gi, 'Type-C')
    .replace(/\bUSB[\s-]?C\b/gi, 'USB-C')
    .replace(/\b3\.5\s*MM\b/gi, '3.5mm')
    .replace(/\bCON\s+MIC\b/gi, 'con Mic')
    .replace(/\bSIN\s+MIC\b/gi, 'sin Mic')
    .replace(/\s*[-|]\s*$/g, '')
    .replace(/^\s*[-|]\s*/g, '')

  name = cleanSpaces(name)
  if (!name) name = cleanSpaces(original)
  return {
    name,
    serials,
    changed: name !== cleanSpaces(original)
  }
}
