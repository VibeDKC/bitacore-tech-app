import type { Database } from './database'

export const TERMINAL_ORDER_STATUSES = ['entregado', 'no_reparado', 'abandonado'] as const

export function isTerminalOrderStatus(status: string) {
  return (TERMINAL_ORDER_STATUSES as readonly string[]).includes(status)
}

export function warrantyForOrder(db: Database, row: any) {
  if (row.status !== 'entregado' || !row.delivered_at) return null
  let intake: any = null
  try {
    intake = row.intake_json ? JSON.parse(row.intake_json) : null
  } catch {
    intake = null
  }
  const legal = db.getSetting<any>('legal_config', { warrantyDays: 90, abandonmentDays: 45 })
  const warrantyDays = Math.max(
    0,
    Math.round(Number(intake?.legal?.warrantyDays ?? legal?.warrantyDays ?? 0))
  )
  if (warrantyDays <= 0) return null
  const startsAt = new Date(row.delivered_at)
  if (!Number.isFinite(startsAt.getTime())) return null
  const dayMs = 24 * 60 * 60 * 1000
  const until = new Date(startsAt.getTime() + warrantyDays * dayMs)
  const daysLeft = Math.ceil((until.getTime() - Date.now()) / dayMs)
  return {
    days: warrantyDays,
    startsAt: startsAt.toISOString(),
    until: until.toISOString(),
    daysLeft,
    status: daysLeft < 0 ? 'vencida' : daysLeft <= 30 ? 'por_vencer' : 'vigente'
  }
}
