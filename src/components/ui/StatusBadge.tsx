import type { StockStatus, WorkOrderStatus } from '@/types'
import { getStockStatus, stockStatusLabel, workOrderStatusConfig } from '@/lib/status'
import { Badge } from '@/components/ui/Badge'

export function WorkOrderStatusBadge({ status, dot = true }: { status: WorkOrderStatus; dot?: boolean }) {
  const config = workOrderStatusConfig[status]
  return (
    <Badge variant={config.tone} dot={dot}>
      {config.label}
    </Badge>
  )
}

export function StockStatusBadge({ product }: { product: Parameters<typeof getStockStatus>[0] }) {
  const status: StockStatus = getStockStatus(product)
  const variant = status === 'in' ? 'success' : status === 'low' ? 'warning' : 'danger'
  return (
    <Badge variant={variant} dot>
      {stockStatusLabel(status)}
    </Badge>
  )
}
