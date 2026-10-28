import type {
  Promotion,
  PromotionDiscountType,
  PromotionInput,
  PromotionInputTarget,
  PromotionPreview,
  PromotionPreviewProduct,
  PromotionScope,
  PromotionStatus,
  PromotionTarget,
  ProductPromotion
} from '@shared/index'
import type { Database } from './database'
import { RpcError } from './permissions'
import { sha256 } from './security'

type PromotionRow = Record<string, any>
type PromotionTargetRow = Record<string, any>

interface ActivePromotion {
  row: PromotionRow
  targets: PromotionTargetRow[]
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const money = (cents: number) => Math.round(Number(cents || 0)) / 100
const toCents = (value: number) => Math.round(Number(value || 0) * 100)

function todayInBogota(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

function dateValid(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new RpcError(`${label} debe tener formato AAAA-MM-DD.`, 'BAD_REQUEST')
  }
  return value
}

function formatBadge(type: PromotionDiscountType, percent: number, cents: number) {
  if (type === 'percent') return `-${Math.round(percent)}%`
  return `-${new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(money(cents))}`
}

function statusFor(row: PromotionRow, today = todayInBogota()): PromotionStatus {
  if (!Number(row.active)) return 'pausada'
  if (row.starts_on && today < String(row.starts_on)) return 'programada'
  if (row.ends_on && today > String(row.ends_on)) return 'vencida'
  return 'activa'
}

function isDateActive(row: PromotionRow, today = todayInBogota()) {
  if (!Number(row.active)) return false
  if (row.starts_on && today < String(row.starts_on)) return false
  if (row.ends_on && today > String(row.ends_on)) return false
  return true
}

function discountFor(row: PromotionRow, priceCents: number) {
  if (row.discount_type === 'percent') {
    const percent = Math.min(100, Math.max(0, Number(row.discount_percent || 0)))
    return Math.min(priceCents, Math.max(0, Math.round((priceCents * percent) / 100)))
  }
  return Math.min(priceCents, Math.max(0, Number(row.discount_cents || 0)))
}

function targetsFor(db: Database, promotionIds?: string[]) {
  const rows = promotionIds?.length
    ? db.all<PromotionTargetRow>(
        `SELECT * FROM promotion_targets WHERE promotion_id IN (${promotionIds.map(() => '?').join(', ')})`,
        ...promotionIds
      )
    : db.all<PromotionTargetRow>('SELECT * FROM promotion_targets')
  const map = new Map<string, PromotionTargetRow[]>()
  for (const row of rows) {
    const list = map.get(String(row.promotion_id)) ?? []
    list.push(row)
    map.set(String(row.promotion_id), list)
  }
  return map
}

function loadPromotions(db: Database, activeOnly = false): ActivePromotion[] {
  const rows = activeOnly
    ? db.all<PromotionRow>('SELECT * FROM promotions WHERE active = 1 ORDER BY priority DESC, updated_at DESC')
    : db.all<PromotionRow>('SELECT * FROM promotions ORDER BY active DESC, priority DESC, starts_on DESC, updated_at DESC')
  const targets = targetsFor(db, rows.map((row) => String(row.id)))
  return rows.map((row) => ({
    row,
    targets: targets.get(String(row.id)) ?? []
  }))
}

function specificityFor(promotion: ActivePromotion, product: PromotionRow) {
  if (promotion.row.scope === 'all') return 1
  if (!promotion.targets.length) return 0
  let specificity = 0
  for (const target of promotion.targets) {
    if (target.target_type === 'sku' && String(target.product_id) === String(product.id)) {
      specificity = Math.max(specificity, 3)
    }
    if (target.target_type === 'category' && String(target.category) === String(product.category)) {
      specificity = Math.max(specificity, 2)
    }
  }
  return specificity
}

function comparePromotions(
  left: ActivePromotion,
  leftSpecificity: number,
  right: ActivePromotion,
  rightSpecificity: number
) {
  return (
    Number(right.row.priority || 0) - Number(left.row.priority || 0) ||
    rightSpecificity - leftSpecificity ||
    String(right.row.starts_on || '').localeCompare(String(left.row.starts_on || '')) ||
    String(right.row.updated_at || '').localeCompare(String(left.row.updated_at || '')) ||
    String(right.row.id).localeCompare(String(left.row.id))
  )
}

function matchPromotion(
  promotions: ActivePromotion[],
  product: PromotionRow,
  options: { webOnly?: boolean; today?: string } = {}
) {
  const today = options.today ?? todayInBogota()
  let best: { promotion: ActivePromotion; specificity: number } | null = null
  for (const promotion of promotions) {
    if (options.webOnly && !Number(promotion.row.publish_web)) continue
    if (!isDateActive(promotion.row, today)) continue
    const specificity = specificityFor(promotion, product)
    if (!specificity) continue
    if (
      !best ||
      comparePromotions(promotion, specificity, best.promotion, best.specificity) < 0
    ) {
      best = { promotion, specificity }
    }
  }
  return best
}

function productPromotionFor(
  promotion: ActivePromotion,
  product: PromotionRow
): ProductPromotion {
  const regularCents = Number(product.price_cents || 0)
  const discountCents = discountFor(promotion.row, regularCents)
  const priceCents = Math.max(0, regularCents - discountCents)
  const row = promotion.row
  return {
    id: String(row.id),
    name: String(row.name),
    discountType: row.discount_type === 'amount' ? 'amount' : 'percent',
    discountPercent: Number(row.discount_percent || 0),
    discountAmount: money(discountCents),
    regularPrice: money(regularCents),
    price: money(priceCents),
    discount: money(discountCents),
    badge: formatBadge(
      row.discount_type === 'amount' ? 'amount' : 'percent',
      Number(row.discount_percent || 0),
      discountCents
    ),
    startsOn: row.starts_on ?? null,
    endsOn: row.ends_on ?? null,
    allowBelowCost: Boolean(row.allow_below_cost)
  }
}

export function resolveProductPromotion(
  db: Database,
  product: PromotionRow,
  options: { webOnly?: boolean; promotions?: ActivePromotion[]; today?: string } = {}
): ProductPromotion | null {
  if (Boolean(product.is_service)) return null
  if (Number(product.price_cents || 0) <= 0) return null
  const promotions = options.promotions ?? loadPromotions(db, true)
  const match = matchPromotion(promotions, product, options)
  if (!match) return null
  return productPromotionFor(match.promotion, product)
}

function targetDto(db: Database, target: PromotionTargetRow): PromotionTarget {
  if (target.target_type === 'sku') {
    const product = db.get<{ sku: string; name: string }>(
      'SELECT sku, name FROM products WHERE id = ?',
      target.product_id
    )
    return {
      id: String(target.id),
      type: 'sku',
      productId: target.product_id ?? undefined,
      sku: product?.sku,
      label: product ? `${product.sku} · ${product.name}` : String(target.product_id)
    }
  }
  return {
    id: String(target.id),
    type: 'category',
    category: target.category ?? undefined,
    label: String(target.category ?? '')
  }
}

function scopeFor(row: PromotionRow, targets: PromotionTargetRow[]): PromotionScope {
  if (row.scope === 'all' || row.scope === 'category' || row.scope === 'sku' || row.scope === 'mixed') {
    return row.scope
  }
  if (!targets.length) return 'all'
  const types = new Set(targets.map((target) => target.target_type))
  if (types.size > 1) return 'mixed'
  return types.has('sku') ? 'sku' : 'category'
}

export function promotionDto(db: Database, row: PromotionRow, products?: PromotionRow[]): Promotion {
  const targets = targetsFor(db, [String(row.id)]).get(String(row.id)) ?? []
  const allProducts =
    products ??
    db.all<PromotionRow>('SELECT * FROM products WHERE active = 1 AND is_service = 0')
  const promotion = { row, targets }
  let affectedCount = 0
  let belowCostCount = 0
  for (const product of allProducts) {
    const specificity = specificityFor(promotion, product)
    if (!specificity) continue
    affectedCount += 1
    const priceCents = Number(product.price_cents || 0)
    const promoPrice = Math.max(0, priceCents - discountFor(promotion.row, priceCents))
    if (Number(product.cost_cents || 0) > 0 && promoPrice < Number(product.cost_cents || 0)) {
      belowCostCount += 1
    }
  }
  const discountCents =
    row.discount_type === 'percent'
      ? 0
      : Number(row.discount_cents || 0)
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    discountType: row.discount_type === 'amount' ? 'amount' : 'percent',
    discountPercent: Number(row.discount_percent || 0),
    discountAmount: money(discountCents),
    startsOn: row.starts_on ?? null,
    endsOn: row.ends_on ?? null,
    active: Boolean(row.active),
    publishWeb: Boolean(row.publish_web),
    priority: Number(row.priority || 0),
    allowBelowCost: Boolean(row.allow_below_cost),
    scope: scopeFor(row, targets),
    targets: targets.map((target) => targetDto(db, target)),
    status: statusFor(row),
    affectedCount,
    belowCostCount,
    badge: formatBadge(
      row.discount_type === 'amount' ? 'amount' : 'percent',
      Number(row.discount_percent || 0),
      discountCents
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listPromotions(db: Database): Promotion[] {
  const products = db.all<PromotionRow>('SELECT * FROM products WHERE active = 1 AND is_service = 0')
  return loadPromotions(db, false).map((promotion) =>
    promotionDto(db, promotion.row, products)
  )
}

export function getPromotion(db: Database, id: string): Promotion {
  const row = db.get<PromotionRow>('SELECT * FROM promotions WHERE id = ?', id)
  if (!row) throw new RpcError('Promoción no encontrada.', 'NOT_FOUND')
  return promotionDto(db, row)
}

function validateTargets(
  db: Database,
  targets: PromotionInput['targets']
): PromotionInputTarget[] {
  if (!targets?.length) return []
  const normalized: PromotionInputTarget[] = []
  const seen = new Set<string>()
  for (const target of targets) {
    if (target.type === 'sku') {
      if (!target.productId) throw new RpcError('Selecciona un producto para el SKU.', 'BAD_REQUEST')
      const product = db.get<{ id: string }>('SELECT id FROM products WHERE id = ? AND active = 1', target.productId)
      if (!product) throw new RpcError('El producto de la promoción no existe o está inactivo.', 'BAD_REQUEST')
      const key = `sku:${target.productId}`
      if (!seen.has(key)) {
        seen.add(key)
        normalized.push({ type: 'sku', productId: target.productId })
      }
    } else {
      const category = String(target.category ?? '').trim()
      if (!category) throw new RpcError('Selecciona una categoría.', 'BAD_REQUEST')
      const key = `category:${category.toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        normalized.push({ type: 'category', category })
      }
    }
  }
  if (normalized.length > 50) throw new RpcError('Una promoción admite máximo 50 objetivos.', 'BAD_REQUEST')
  return normalized
}

function validatePromotionInput(db: Database, input: PromotionInput) {
  const name = String(input.name ?? '').trim()
  if (name.length < 2 || name.length > 120) {
    throw new RpcError('El nombre debe tener entre 2 y 120 caracteres.', 'BAD_REQUEST')
  }
  const discountType: PromotionDiscountType = input.discountType === 'amount' ? 'amount' : 'percent'
  const startsOn = dateValid(input.startsOn, 'Fecha inicial')
  const endsOn = dateValid(input.endsOn, 'Fecha final')
  if (startsOn && endsOn && startsOn > endsOn) {
    throw new RpcError('La fecha inicial no puede ser posterior a la final.', 'BAD_REQUEST')
  }
  let discountPercent = 0
  let discountCents = 0
  if (discountType === 'percent') {
    discountPercent = Number(input.discountPercent ?? 0)
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
      throw new RpcError('El porcentaje debe estar entre 1 y 100.', 'BAD_REQUEST')
    }
  } else {
    discountCents = toCents(Number(input.discountAmount ?? 0))
    if (!Number.isFinite(discountCents) || discountCents <= 0) {
      throw new RpcError('El monto fijo debe ser mayor a cero.', 'BAD_REQUEST')
    }
  }
  const priority = Math.max(0, Math.min(1000, Math.round(Number(input.priority ?? 0))))
  const targets = validateTargets(db, input.targets)
  const scope: PromotionScope = targets.length
    ? new Set(targets.map((target) => target.type)).size > 1
      ? 'mixed'
      : targets[0].type
    : 'all'
  return {
    name,
    description: String(input.description ?? '').trim().slice(0, 500),
    discountType,
    discountPercent,
    discountCents,
    startsOn,
    endsOn,
    active: input.active === undefined ? true : Boolean(input.active),
    publishWeb: input.publishWeb === undefined ? true : Boolean(input.publishWeb),
    priority,
    allowBelowCost: Boolean(input.allowBelowCost),
    scope,
    targets
  }
}

function affectedProducts(db: Database, input: ReturnType<typeof validatePromotionInput>) {
  const targets = input.targets.map((target) => ({
    target_type: target.type,
    product_id: target.productId ?? null,
    category: target.category ?? null
  }))
  const promotion: ActivePromotion = {
    row: {
      scope: input.scope,
      discount_type: input.discountType,
      discount_percent: input.discountPercent,
      discount_cents: input.discountCents
    },
    targets
  }
  const products = db.all<PromotionRow>('SELECT * FROM products WHERE active = 1 AND is_service = 0')
  return products
    .filter((product) => specificityFor(promotion, product) > 0)
    .map((product) => {
      const regularCents = Number(product.price_cents || 0)
      const promoPrice = Math.max(0, regularCents - discountFor(promotion.row, regularCents))
      const belowCost =
        Number(product.cost_cents || 0) > 0 && promoPrice < Number(product.cost_cents || 0)
      return {
        id: String(product.id),
        name: String(product.name),
        sku: String(product.sku),
        category: String(product.category),
        regularPrice: money(regularCents),
        promoPrice: money(promoPrice),
        belowCost
      } satisfies PromotionPreviewProduct
    })
}

export function previewPromotion(db: Database, input: PromotionInput): PromotionPreview {
  const parsed = validatePromotionInput(db, input)
  const products = affectedProducts(db, parsed)
  return {
    affectedCount: products.length,
    belowCostCount: products.filter((product) => product.belowCost).length,
    products: products.slice(0, 50)
  }
}

export function savePromotion(
  db: Database,
  input: PromotionInput,
  actorId: string
): { promotion: Promotion; belowCostCount: number } {
  const parsed = validatePromotionInput(db, input)
  const affected = affectedProducts(db, parsed)
  const belowCost = affected.filter((product) => product.belowCost)
  if (belowCost.length && !parsed.allowBelowCost) {
    throw new RpcError(
      `La promoción deja ${belowCost.length} producto${belowCost.length === 1 ? '' : 's'} por debajo del costo. Confirma la autorización para continuar.`,
      'PROMOTION_BELOW_COST',
      { products: belowCost.slice(0, 8).map((product) => `${product.name} (${product.sku})`) }
    )
  }
  const now = new Date().toISOString()
  const existing = input.id
    ? db.get<PromotionRow>('SELECT * FROM promotions WHERE id = ?', input.id)
    : null
  if (input.id && !existing) throw new RpcError('Promoción no encontrada.', 'NOT_FOUND')
  const id = existing?.id ?? `promo_${sha256(`${parsed.name}|${Date.now()}`).slice(0, 20)}`
  db.tx(() => {
    if (existing) {
      db.run(
        `UPDATE promotions SET
          name = ?, description = ?, scope = ?, discount_type = ?, discount_percent = ?, discount_cents = ?,
          starts_on = ?, ends_on = ?, active = ?, publish_web = ?, priority = ?,
          allow_below_cost = ?, updated_by = ?, updated_at = ?
         WHERE id = ?`,
        parsed.name,
        parsed.description,
        parsed.scope,
        parsed.discountType,
        parsed.discountPercent,
        parsed.discountCents,
        parsed.startsOn,
        parsed.endsOn,
        parsed.active ? 1 : 0,
        parsed.publishWeb ? 1 : 0,
        parsed.priority,
        parsed.allowBelowCost ? 1 : 0,
        actorId,
        now,
        id
      )
    } else {
      db.run(
        `INSERT INTO promotions
          (id, name, description, scope, discount_type, discount_percent, discount_cents,
           starts_on, ends_on, active, publish_web, priority, allow_below_cost,
           created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        parsed.name,
        parsed.description,
        parsed.scope,
        parsed.discountType,
        parsed.discountPercent,
        parsed.discountCents,
        parsed.startsOn,
        parsed.endsOn,
        parsed.active ? 1 : 0,
        parsed.publishWeb ? 1 : 0,
        parsed.priority,
        parsed.allowBelowCost ? 1 : 0,
        actorId,
        actorId,
        now,
        now
      )
    }
    db.run('DELETE FROM promotion_targets WHERE promotion_id = ?', id)
    for (const target of parsed.targets) {
      db.run(
        `INSERT INTO promotion_targets (id, promotion_id, target_type, category, product_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        `pt_${sha256(`${id}|${target.type}|${target.productId ?? target.category}|${Date.now()}`).slice(0, 20)}`,
        id,
        target.type,
        target.type === 'category' ? target.category ?? null : null,
        target.type === 'sku' ? target.productId ?? null : null,
        now
      )
    }
  })
  return { promotion: getPromotion(db, id), belowCostCount: belowCost.length }
}

export function togglePromotion(db: Database, id: string, active: boolean, actorId: string) {
  const row = db.get<PromotionRow>('SELECT id FROM promotions WHERE id = ?', id)
  if (!row) throw new RpcError('Promoción no encontrada.', 'NOT_FOUND')
  db.run(
    'UPDATE promotions SET active = ?, updated_by = ?, updated_at = ? WHERE id = ?',
    active ? 1 : 0,
    actorId,
    new Date().toISOString(),
    id
  )
  return getPromotion(db, id)
}

export function setPromotionWeb(db: Database, id: string, publishWeb: boolean, actorId: string) {
  const row = db.get<PromotionRow>('SELECT id FROM promotions WHERE id = ?', id)
  if (!row) throw new RpcError('Promoción no encontrada.', 'NOT_FOUND')
  db.run(
    'UPDATE promotions SET publish_web = ?, updated_by = ?, updated_at = ? WHERE id = ?',
    publishWeb ? 1 : 0,
    actorId,
    new Date().toISOString(),
    id
  )
  return getPromotion(db, id)
}

export function deletePromotion(db: Database, id: string) {
  const row = db.get<PromotionRow>('SELECT id FROM promotions WHERE id = ?', id)
  if (!row) throw new RpcError('Promoción no encontrada.', 'NOT_FOUND')
  db.run('DELETE FROM promotions WHERE id = ?', id)
}

export function activePromotionRows(db: Database, webOnly = false) {
  return loadPromotions(db, true)
    .filter((promotion) => isDateActive(promotion.row))
    .filter((promotion) => (webOnly ? Number(promotion.row.publish_web) : true))
}

export function resolvePromotionForProductRow(
  db: Database,
  product: PromotionRow,
  promotions?: ActivePromotion[]
) {
  const rows = promotions ?? activePromotionRows(db)
  const match = matchPromotion(rows, product)
  return match ? productPromotionFor(match.promotion, product) : null
}

export function promotionAlertData(db: Database) {
  const active = listPromotions(db).filter((promotion) => promotion.status === 'activa')
  const belowCost = active.filter((promotion) => promotion.belowCostCount > 0)
  return {
    active: active.length,
    belowCost: belowCost.length,
    belowCostNames: belowCost.slice(0, 4).map((promotion) => promotion.name)
  }
}

export function promotionDiscountForProduct(
  product: PromotionRow,
  promotion: ProductPromotion | null
) {
  const regular = Number(product.price_cents || 0)
  const price = promotion ? toCents(promotion.price) : regular
  return Math.max(0, regular - price)
}
