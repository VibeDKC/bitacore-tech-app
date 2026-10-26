import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  CreditCard,
  Landmark,
  Minus,
  Plus,
  ReceiptText,
  ShoppingCart,
  Tag,
  Trash2,
  UserRound,
  Wallet
} from 'lucide-react'
import { toast } from 'sonner'
import type { CartLine, Customer, Invoice, PaymentMethod, ProductCategory, SaleReceipt } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { formatCurrency } from '@/lib/format'
import { getStockStatus } from '@/lib/status'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { defaultLegalConfig } from '@/lib/legalConfig'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { SearchInput, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ReceiptPreviewModal } from '@/components/pos/ReceiptPreview'
import { cn } from '@/lib/utils'

const categories: Array<'Todos' | ProductCategory> = [
  'Todos',
  'Almacenamiento',
  'Memoria',
  'Periféricos',
  'Repuestos',
  'Componentes',
  'Accesorios',
  'Insumos',
  'Servicios'
]

const paymentMethods: Array<{ value: PaymentMethod; label: string; hint: string; icon: typeof Banknote }> = [
  { value: 'Efectivo', label: 'Efectivo', hint: 'Recibe y calcula el cambio', icon: Banknote },
  { value: 'Tarjeta', label: 'Tarjeta', hint: 'Débito o crédito', icon: CreditCard },
  { value: 'Transferencia', label: 'Transferencia', hint: 'Nequi, Daviplata o banco', icon: Landmark }
]

interface SaleResult {
  receipt: SaleReceipt
  invoice: Invoice
  customer: Customer | null
}

export function POSPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi(async () => {
    const [products, customers, cash, legal] = await Promise.all([
      api.inventory.list(),
      api.customers.list(),
      api.cash.current(),
      api.legal.get().catch(() => defaultLegalConfig)
    ])
    return { products, customers, cashSession: cash.current, legal }
  }, [])

  const products = useMemo(() => data?.products ?? [], [data?.products])
  const customers = useMemo(() => data?.customers ?? [], [data?.customers])
  const legal = data?.legal ?? defaultLegalConfig
  const cashSession = data?.cashSession ?? null

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'Todos' | ProductCategory>('Todos')
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState('')
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent')
  const [discountInput, setDiscountInput] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [method, setMethod] = useState<PaymentMethod>('Efectivo')
  const [received, setReceived] = useState('')
  const [reference, setReference] = useState('')
  const [sale, setSale] = useState<SaleResult | null>(null)
  const [selling, setSelling] = useState(false)

  const canDiscount = can(role, 'applyDiscount')
  const customer = customers.find((item) => item.id === customerId) ?? customers[0] ?? null
  const loyaltyActive = Boolean(
    customer?.loyaltyActive &&
      (!customer.loyaltyValidUntil || new Date(`${customer.loyaltyValidUntil}T23:59:59`).getTime() >= Date.now()) &&
      Number(customer.loyaltyDiscountValue ?? 0) > 0
  )
  const loyaltyType = customer?.loyaltyDiscountType === 'amount' ? 'amount' : 'percent'
  const loyaltyValue = Number(customer?.loyaltyDiscountValue ?? 0)

  useEffect(() => {
    if (!customers.length) return
    if (!customerId || !customers.some((item) => item.id === customerId)) {
      setCustomerId(customers.find((item) => item.isFinalConsumer)?.id ?? customers[0].id)
    }
  }, [customers, customerId])

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLowerCase()
    return products.filter((product) => {
      const matchesCategory = category === 'Todos' || product.category === category
      const matchesQuery =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.barcode.includes(term)
      return matchesCategory && matchesQuery
    })
  }, [products, query, category])

  const subtotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0)
  const discountValue = loyaltyActive
    ? loyaltyType === 'percent'
      ? Math.round((subtotal * loyaltyValue) / 100)
      : Math.min(loyaltyValue, subtotal)
    : discountType === 'percent'
      ? Math.round((subtotal * (Number(discountInput) || 0)) / 100)
      : Math.min(Number(discountInput) || 0, subtotal)
  const total = subtotal - discountValue
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0)
  const receivedValue = Number(received.replace(/[^0-9]/g, '')) || 0
  const change = Math.max(receivedValue - total, 0)
  const shiftSales = cashSession ? cashSession.movements.filter((movement) => movement.type === 'venta').length : 0

  function addToCart(product: (typeof products)[number]) {
    if (!product.service && getStockStatus(product) === 'out') {
      toast.error('Producto agotado', { description: 'Repón el inventario antes de venderlo.' })
      return
    }
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id)
      if (existing) {
        if (!product.service && existing.quantity >= product.stock) {
          toast.warning('Límite de stock alcanzado', { description: `Solo hay ${product.stock} unidades disponibles.` })
          return current
        }
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line
        )
      }
      return [...current, { product, quantity: 1 }]
    })
  }

  function updateQuantity(productId: string, delta: number) {
    setCart((current) =>
      current
        .map((line) => {
          if (line.product.id !== productId) return line
          const next = line.quantity + delta
          if (next > line.product.stock && !line.product.service) return line
          return { ...line, quantity: Math.max(next, 0) }
        })
        .filter((line) => line.quantity > 0)
    )
  }

  function removeLine(productId: string) {
    setCart((current) => current.filter((line) => line.product.id !== productId))
  }

  function openPayment() {
    if (!cart.length) {
      toast.error('Agrega productos a la venta')
      return
    }
    if (!customer) {
      toast.error('Selecciona un cliente para la venta')
      return
    }
    if (!cashSession) {
      toast.error('No hay un turno de caja abierto', {
        description: 'Abre la caja antes de cobrar para que el pago quede registrado en el turno.'
      })
      return
    }
    setMethod('Efectivo')
    setReceived(String(total))
    setReference('')
    setPaymentOpen(true)
  }

  async function confirmPayment() {
    if (!customer || !cart.length || selling) return
    if (method === 'Efectivo' && receivedValue < total) {
      toast.error('El efectivo recibido es menor al total')
      return
    }
    setSelling(true)
    try {
      const result = await api.pos.sell({
        customerId: customer.id,
        lines: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        method,
        discountType: loyaltyActive ? loyaltyType : discountType,
        discountValue: loyaltyActive ? loyaltyValue : Number(discountInput) || 0,
        received: method === 'Efectivo' ? receivedValue : undefined,
        reference: reference.trim() || undefined
      })
      setSale({ ...result, customer })
      setPaymentOpen(false)
      setCart([])
      setDiscountInput('')
      setDiscountType('percent')
      setReference('')
      toast.success(`Venta ${result.receipt.number} registrada`, {
        description: `${formatCurrency(result.receipt.total)} · ${method} · ${customer.name}`
      })
      reload()
    } catch (failure) {
      toast.error('No se pudo registrar la venta', { description: errorMessage(failure) })
    } finally {
      setSelling(false)
    }
  }

  const cashSuggestions = Array.from(
    new Set([total, 50000, 100000, 200000, 300000].filter((value) => value >= total))
  ).slice(0, 4)

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando punto de venta…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudo cargar el punto de venta</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>Reintentar</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Punto de venta"
        description="Cobra productos, repuestos y servicios en segundos. Las ventas internas no llevan IVA por ahora."
        actions={
          <>
            {cashSession ? (
              <Badge variant="success" dot>
                Turno #{cashSession.id} abierto
              </Badge>
            ) : (
              <button type="button" onClick={() => navigate('/caja')} className="focus-ring">
                <Badge variant="warning" dot>
                  Caja cerrada · abrir
                </Badge>
              </button>
            )}
            <div className="hidden items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[11px] text-slate-500 shadow-sm sm:flex">
              <ReceiptText className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-semibold text-ink">{shiftSales}</span> ventas en el turno
            </div>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-[16px] font-bold text-ink">Catálogo</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">{filteredProducts.length} artículos disponibles</p>
              </div>
              <SearchInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery('')}
                placeholder="Buscar por nombre, SKU o código..."
                wrapClassName="w-full sm:w-[320px]"
              />
            </div>

            <div className="no-scrollbar -mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={cn(
                    'focus-ring shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition',
                    category === item
                      ? 'border-brand-500 bg-brand-500 text-white shadow-[0_6px_14px_-8px_rgba(108,92,231,0.9)]'
                      : 'border-line bg-white text-slate-500 hover:border-slate-300 hover:text-ink'
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2.5 p-4 sm:grid-cols-2 lg:grid-cols-3 lg:p-5">
            {filteredProducts.map((product) => {
              const Icon = product.icon
              const stock = getStockStatus(product)
              const inCart = cart.find((line) => line.product.id === product.id)?.quantity ?? 0
              const unavailable = !product.service && stock === 'out'

              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={unavailable}
                  onClick={() => addToCart(product)}
                  className={cn(
                    'group relative flex flex-col rounded-2xl border border-line bg-white p-3.5 text-left transition duration-150',
                    unavailable
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft active:translate-y-0'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br', product.tone)}>
                      <Icon className="h-5 w-5" />
                    </span>
                    {inCart ? (
                      <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">
                        {inCart}
                      </span>
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-slate-300 transition group-hover:border-brand-200 group-hover:bg-brand-50 group-hover:text-brand-600">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>

                  <p className="mt-3 line-clamp-2 min-h-[34px] text-[12px] font-semibold leading-snug text-ink">{product.name}</p>
                  <p className="mt-1 font-mono text-[9px] text-slate-400">{product.sku}</p>

                  <div className="mt-3 flex items-end justify-between gap-2 border-t border-line/70 pt-3">
                    <div>
                      <p className="tabular text-[14px] font-bold text-ink">{formatCurrency(product.price)}</p>
                      <p className="mt-0.5 text-[9px] text-slate-400">
                        {product.service ? 'Servicio' : `${product.stock} en stock`}
                      </p>
                    </div>
                    {unavailable ? (
                      <Badge variant="danger">Agotado</Badge>
                    ) : product.service ? (
                      <Badge variant="brand">Servicio</Badge>
                    ) : stock === 'low' ? (
                      <Badge variant="warning">Bajo</Badge>
                    ) : null}
                  </div>
                </button>
              )
            })}

            {!filteredProducts.length ? (
              <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 px-6 py-14 text-center">
                <ShoppingCart className="h-6 w-6 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-ink">Sin resultados</p>
                <p className="mt-1 text-xs text-slate-500">Prueba con otro nombre, SKU o categoría.</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card flex h-fit flex-col overflow-hidden xl:sticky xl:top-0">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <ShoppingCart className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h2 className="font-display text-[15px] font-bold text-ink">Venta actual</h2>
                <p className="text-[10px] text-slate-400">{itemCount} artículos · {formatCurrency(total)}</p>
              </div>
            </div>
            {cart.length ? (
              <button
                type="button"
                onClick={() => setCart([])}
                className="focus-ring rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 transition hover:bg-danger-50 hover:text-danger-600"
              >
                Vaciar
              </button>
            ) : null}
          </div>

          <div className="space-y-3 border-b border-line px-5 py-4">
            <label className="block">
              <span className="field-label">Cliente</span>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Select
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                  className="h-10 pl-9 text-[12px]"
                >
                  {customers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} {item.document !== '222222222222' ? `· ${item.document}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
            </label>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-500">
              <span>{customer && customer.phone !== '—' ? customer.phone : 'Venta de mostrador'}</span>
              <span>{customer?.purchases ?? 0} compras</span>
            </div>
          </div>

          <div className="min-h-[180px] flex-1 overflow-y-auto px-5 py-4">
            {cart.length ? (
              <div className="space-y-3">
                {cart.map((line) => {
                  const Icon = line.product.icon
                  return (
                    <div key={line.product.id} className="flex gap-3">
                      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br', line.product.tone)}>
                        <Icon className="h-[17px] w-[17px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-[12px] font-semibold text-ink">{line.product.name}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{formatCurrency(line.product.price)} c/u</p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <div className="flex items-center rounded-lg border border-line">
                            <button
                              type="button"
                              onClick={() => updateQuantity(line.product.id, -1)}
                              className="focus-ring flex h-6 w-6 items-center justify-center rounded-l-lg text-slate-500 transition hover:bg-slate-50"
                              aria-label="Quitar una unidad"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-7 text-center text-[11px] font-semibold tabular text-ink">{line.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(line.product.id, 1)}
                              className="focus-ring flex h-6 w-6 items-center justify-center rounded-r-lg text-slate-500 transition hover:bg-slate-50"
                              aria-label="Agregar una unidad"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="tabular text-[12px] font-bold text-ink">
                              {formatCurrency(line.product.price * line.quantity)}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeLine(line.product.id)}
                              className="focus-ring flex h-6 w-6 items-center justify-center rounded-md text-slate-300 transition hover:bg-danger-50 hover:text-danger-500"
                              aria-label={`Eliminar ${line.product.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-300">
                  <ShoppingCart className="h-5 w-5" />
                </span>
                <p className="mt-3 text-[12px] font-semibold text-ink">Carrito vacío</p>
                <p className="mt-1 max-w-[190px] text-[10px] leading-relaxed text-slate-400">
                  Toca un producto del catálogo para iniciar la venta.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3 border-t border-line bg-slate-50/60 px-5 py-4">
            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between text-slate-500">
                <span>Subtotal</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Tag className="h-3 w-3" /> Descuento
                </span>
                {loyaltyActive ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="warning">
                      Fidelidad{' '}
                      {loyaltyType === 'percent' ? `${loyaltyValue}%` : formatCurrency(loyaltyValue)}
                    </Badge>
                    <span className="tabular w-16 text-right font-semibold text-ink">-{formatCurrency(discountValue)}</span>
                  </div>
                ) : canDiscount ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-line bg-white">
                      <button
                        type="button"
                        onClick={() => setDiscountType('percent')}
                        className={cn(
                          'focus-ring h-7 px-2 text-[10px] font-semibold transition first:rounded-l-lg',
                          discountType === 'percent' ? 'bg-brand-50 text-brand-700' : 'text-slate-400 hover:text-slate-600'
                        )}
                      >
                        %
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscountType('amount')}
                        className={cn(
                          'focus-ring h-7 px-2 text-[10px] font-semibold transition last:rounded-r-lg',
                          discountType === 'amount' ? 'bg-brand-50 text-brand-700' : 'text-slate-400 hover:text-slate-600'
                        )}
                      >
                        $
                      </button>
                    </div>
                    <input
                      value={discountInput}
                      onChange={(event) => setDiscountInput(event.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      className="field h-7 w-20 text-right text-[10px] tabular"
                    />
                    <span className="tabular w-16 text-right font-semibold text-ink">-{formatCurrency(discountValue)}</span>
                  </div>
                ) : (
                  <span className="text-[10px] text-slate-400">Sin permiso</span>
                )}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-[10px] text-slate-400">
                <span>IVA en ventas</span>
                <span className="font-semibold">No aplica por ahora</span>
              </div>
            </div>

            <div className="flex items-end justify-between border-t border-line pt-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Total a cobrar</p>
                <p className="tabular mt-0.5 font-display text-[26px] font-bold leading-none tracking-[-0.02em] text-ink">
                  {formatCurrency(total)}
                </p>
              </div>
              <Badge variant="brand">{itemCount} art.</Badge>
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={!cart.length}
              onClick={openPayment}
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              Cobrar venta
            </Button>
            {!cashSession ? (
              <button
                type="button"
                onClick={() => navigate('/caja')}
                className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-lg bg-warning-50 px-2 py-1.5 text-[9px] font-semibold text-warning-700"
              >
                <Wallet className="h-3 w-3" />
                Caja cerrada · abre un turno para cobrar
              </button>
            ) : (
              <p className="flex items-center justify-center gap-1.5 text-[9px] text-slate-400">
                <Wallet className="h-3 w-3" />
                Factura interna · no reemplaza facturación electrónica DIAN
              </p>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title="Cobrar venta"
        description={`${itemCount} artículos · ${customer?.name ?? 'Cliente'}`}
        size="md"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-slate-400">Total</p>
              <p className="tabular font-display text-lg font-bold text-ink">{formatCurrency(total)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPaymentOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => void confirmPayment()} loading={selling} leftIcon={<CheckCircle2 className="h-4 w-4" />}>
                Confirmar pago
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {paymentMethods.map((item) => {
              const Icon = item.icon
              const active = method === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setMethod(item.value)
                    setReceived(item.value === 'Efectivo' ? String(total) : '')
                  }}
                  className={cn(
                    'focus-ring rounded-xl border p-3 text-left transition',
                    active
                      ? 'border-brand-300 bg-brand-50 ring-4 ring-brand-100/60'
                      : 'border-line bg-white hover:border-slate-300'
                  )}
                >
                  <Icon className={cn('h-4 w-4', active ? 'text-brand-600' : 'text-slate-400')} />
                  <p className={cn('mt-2 text-[11px] font-semibold', active ? 'text-brand-900' : 'text-ink')}>{item.label}</p>
                  <p className="mt-0.5 text-[9px] leading-snug text-slate-400">{item.hint}</p>
                </button>
              )
            })}
          </div>

          {method === 'Efectivo' ? (
            <div className="rounded-xl border border-line bg-slate-50/60 p-4">
              <label className="block">
                <span className="field-label">Efectivo recibido</span>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <input
                    value={received}
                    onChange={(event) => setReceived(event.target.value)}
                    inputMode="numeric"
                    className="field h-11 pl-7 text-right text-base font-semibold tabular"
                  />
                </div>
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cashSuggestions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setReceived(String(value))}
                    className="focus-ring rounded-lg border border-line bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500 transition hover:border-brand-200 hover:text-brand-600"
                  >
                    {formatCurrency(value)}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                <span className="text-[11px] text-slate-500">Cambio</span>
                <span className={cn('tabular text-[18px] font-bold', receivedValue < total ? 'text-danger-600' : 'text-success-600')}>
                  {receivedValue < total ? 'Falta efectivo' : formatCurrency(change)}
                </span>
              </div>
            </div>
          ) : (
            <label className="block">
              <span className="field-label">Referencia del pago (opcional)</span>
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder={method === 'Tarjeta' ? 'N.º de aprobación' : 'N.º de transacción'}
                className="field h-11"
              />
            </label>
          )}

          <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
            <div className="flex items-center justify-between text-[11px] text-brand-700">
              <span>Subtotal</span>
              <span className="tabular font-semibold">{formatCurrency(subtotal)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-brand-700">
              <span>Descuento</span>
              <span className="tabular font-semibold">-{formatCurrency(discountValue)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-brand-100 pt-2 text-[12px] font-bold text-brand-900">
              <span>Total</span>
              <span className="tabular">{formatCurrency(total)}</span>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[10px] leading-relaxed text-slate-500">
            El pago se registra en caja y descuenta el stock de los productos. La factura es interna y no lleva IVA.
          </div>
        </div>
      </Modal>

      <ReceiptPreviewModal
        receipt={sale?.receipt ?? null}
        invoice={sale?.invoice ?? null}
        customer={sale?.customer ?? null}
        legal={legal}
        open={Boolean(sale)}
        onClose={() => setSale(null)}
        initialFormat="80mm"
      />
    </div>
  )
}
