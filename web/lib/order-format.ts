/**
 * Formatos que puede escribir un cliente en el portal público.
 * La app imprime números como "OT-002332" y claves como "SG-AB12CD34EF56",
 * pero el portal acepta solo los dígitos, minúsculas o la clave sin prefijo.
 */
export function normalizeOrderNumber(value: string) {
  const cleaned = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
  const digits = cleaned.replace(/\D/g, '')
  if (!digits) return ''
  return `OT-${digits.padStart(6, '0')}`
}

export function normalizeTrackingCode(value: string) {
  const cleaned = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  if (!cleaned) return ''
  if (/^SG-[0-9A-F]{16}$/.test(cleaned)) return cleaned
  if (/^SG[0-9A-F]{16}$/.test(cleaned)) {
    return `SG-${cleaned.slice(2)}`
  }
  if (/^[0-9A-F]{16}$/.test(cleaned)) return `SG-${cleaned}`
  return cleaned
}
