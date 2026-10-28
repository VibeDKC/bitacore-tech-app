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

export interface CatalogSyncStatus {
  targetPath: string
  autoPublish: boolean
  lastPublishedAt: string | null
  lastStatus: 'idle' | 'success' | 'error' | 'pending'
  lastMessage: string
  lastProductCount: number
  lastImageCount: number
  lastPromotionCount: number
}
