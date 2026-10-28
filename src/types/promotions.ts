export type PromotionDiscountType = 'percent' | 'amount'
export type PromotionStatus = 'activa' | 'programada' | 'vencida' | 'pausada'
export type PromotionScope = 'all' | 'category' | 'sku' | 'mixed'

export interface PromotionTarget {
  id?: string
  type: 'category' | 'sku'
  category?: string
  productId?: string
  sku?: string
  label: string
}

export interface PromotionInputTarget {
  type: 'category' | 'sku'
  category?: string
  productId?: string
}

export interface Promotion {
  id: string
  name: string
  description: string
  discountType: PromotionDiscountType
  discountPercent: number
  discountAmount: number
  startsOn: string | null
  endsOn: string | null
  active: boolean
  publishWeb: boolean
  priority: number
  allowBelowCost: boolean
  scope: PromotionScope
  targets: PromotionTarget[]
  status: PromotionStatus
  affectedCount: number
  belowCostCount: number
  badge: string
  createdAt: string
  updatedAt: string
}

export interface PromotionInput {
  id?: string
  name: string
  description?: string
  discountType: PromotionDiscountType
  discountPercent?: number
  discountAmount?: number
  startsOn?: string | null
  endsOn?: string | null
  active?: boolean
  publishWeb?: boolean
  priority?: number
  allowBelowCost?: boolean
  targets?: PromotionInputTarget[]
}

export interface PromotionPreviewProduct {
  id: string
  name: string
  sku: string
  category: string
  regularPrice: number
  promoPrice: number
  belowCost: boolean
}

export interface ProductPromotion {
  id: string
  name: string
  discountType: PromotionDiscountType
  discountPercent: number
  discountAmount: number
  regularPrice: number
  price: number
  discount: number
  badge: string
  startsOn: string | null
  endsOn: string | null
  allowBelowCost: boolean
}

export interface PromotionPreview {
  affectedCount: number
  belowCostCount: number
  products: PromotionPreviewProduct[]
}

export type CatalogSyncState = 'idle' | 'success' | 'error' | 'pending'
export type CatalogStockVisibility = 'always' | 'outOnly'

export interface CatalogRemoteStatus {
  enabled: boolean
  supabaseUrl: string
  bucket: string
  hasSecret: boolean
  lastPublishedAt: string | null
  lastStatus: CatalogSyncState
  lastMessage: string
  lastProductCount: number
  lastImageCount: number
  lastPromotionCount: number
  lastBytes: number
}

export interface CatalogSyncStatus {
  targetPath: string
  autoPublish: boolean
  stockVisibility: CatalogStockVisibility
  lastPublishedAt: string | null
  lastStatus: CatalogSyncState
  lastMessage: string
  lastProductCount: number
  lastImageCount: number
  lastPromotionCount: number
  remote: CatalogRemoteStatus
}

export interface CatalogPublishResult {
  ok: boolean
  status: CatalogSyncStatus
  error?: string
  local?: { ok: boolean; error?: string }
  remote?: { ok: boolean; error?: string } | null
}

export interface CatalogConnectionResult {
  ok: boolean
  message: string
  publicBucket?: boolean
}
