export const WEB_PRODUCT_CONDITIONS = ['Nuevo', 'Reacondicionado'] as const

export function isWebEligibleCondition(condition?: string | null) {
  const normalized = String(condition ?? '').trim()
  return (WEB_PRODUCT_CONDITIONS as readonly string[]).includes(normalized)
}
