/**
 * Utilidad de NIT colombiano. El NIT se almacena solo con dígitos y el DV se
 * calcula con los pesos DIAN. Los NIT extranjeros no usan esta regla.
 */
export function normalizeNit(value: string) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 15)
}

export function calculateNitDv(value: string) {
  const digits = normalizeNit(value)
  if (!digits) return ''
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
  let sum = 0
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[digits.length - 1 - index])
    sum += digit * weights[index]
  }
  const remainder = sum % 11
  return String(remainder === 0 || remainder === 1 ? remainder : 11 - remainder)
}

export function isValidNit(value: string, dv?: string) {
  const digits = normalizeNit(value)
  if (!digits) return false
  if (String(value ?? '') !== digits) return false
  return calculateNitDv(digits) === String(dv ?? '').trim()
}

export function formatNit(value: string, dv?: string) {
  const digits = normalizeNit(value)
  if (!digits) return '—'
  const calculated = String(dv ?? '').trim() || calculateNitDv(digits)
  return `${digits}-${calculated}`
}
