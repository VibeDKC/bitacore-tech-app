import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownToLine,
  Boxes,
  ChevronDown,
  Download,
  Eye,
  Hash,
  Layers,
  LockKeyhole,
  MapPin,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Wand2,
  Warehouse
} from 'lucide-react'
import { toast } from 'sonner'
import type { Product, ProductRotation, StockMovement, StockStatus } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { isWebEligibleCondition } from '@/lib/products'
import { formatCurrency, formatNumber, formatDateTime } from '@/lib/format'
import { getStockStatus } from '@/lib/status'
import { downloadCsv } from '@/lib/download'
import { dictionaryValues } from '@/lib/dictionaries'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { SearchInput, Select } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { StockStatusBadge } from '@/components/ui/StatusBadge'
import { ProgressBar } from '@/components/ui/EmptyState'
import { SegmentedTabs } from '@/components/ui/Tabs'
import { ProductImageField } from '@/components/inventory/ProductImageField'
import { cn } from '@/lib/utils'

const defaultCategories = [
  'Almacenamiento',
  'Memoria',
  'Periféricos',
  'Repuestos',
  'Componentes',
  'Accesorios',
  'Insumos',
  'Servicios'
]
const defaultLocations = ['Bodega A', 'Bodega B', 'Mostrador', 'Taller']
const movementSeed = [
  { id: 'mv1', type: 'Venta', quantity: -1, detail: 'FV-000184 · Camila Ríos', date: '25 oct 2026 · 10:42' },
  { id: 'mv2', type: 'Consumo en OT', quantity: -2, detail: 'OT-002341 · Julián Vélez', date: '24 oct 2026 · 16:20' },
  { id: 'mv3', type: 'Compra', quantity: 12, detail: 'FC-88214 · TecnoPartes S.A.S.', date: '24 oct 2026 · 15:30' },
  { id: 'mv4', type: 'Ajuste de inventario', quantity: 1, detail: 'Conteo físico · Andrea Salazar', date: '23 oct 2026 · 09:10' }
]

const emptyProductForm = {
  name: '',
  sku: '',
  barcode: '',
  supplierSku: '',
  category: 'Repuestos',
  location: 'Bodega A',
  condition: '',
  origin: '',
  stock: '0',
  minStock: '2',
  cost: '',
  price: '',
  warrantyDays: '90',
  rotation: 'rotativo' as ProductRotation,
  alertEnabled: true,
  publishWeb: true,
  service: false,
  serviceType: '',
  imageDataUrl: null as string | null,
  imageThumbnailDataUrl: null as string | null,
  removeImage: false
}

export function InventoryPage() {
  const { role } = useAuth()
  const [searchParams] = useSearchParams()
  const { data, loading, error, reload, setData } = useApi(async () => {
    const [products, dictionaries] = await Promise.all([api.inventory.list(), api.dictionaries.list()])
    return { products, dictionaries }
  }, [])
  const items = data?.products ?? []
  const dictionaries = data?.dictionaries ?? []
  const categoryOptions = useMemo(() => {
    const names = dictionaryValues(dictionaries, 'inventory_category')
    return ['Todas', ...(names.length ? names : defaultCategories)]
  }, [dictionaries])
  const locationOptions = useMemo(() => {
    const names = dictionaryValues(dictionaries, 'inventory_location')
    return names.length ? names : defaultLocations
  }, [dictionaries])
  const serviceTypeOptions = useMemo(() => dictionaryValues(dictionaries, 'service_type'), [dictionaries])
  const conditionOptions = useMemo(() => dictionaryValues(dictionaries, 'inventory_condition'), [dictionaries])
  const originOptions = useMemo(() => dictionaryValues(dictionaries, 'inventory_origin'), [dictionaries])
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [category, setCategory] = useState('Todas')
  const [stockFilter, setStockFilter] = useState<'todos' | StockStatus>('todos')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustQuantity, setAdjustQuantity] = useState('1')
  const [adjustReason, setAdjustReason] = useState('Conteo físico')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyProductForm)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState(emptyProductForm)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [saving, setSaving] = useState(false)
  const [skuSaving, setSkuSaving] = useState(false)
  const [bulkSkuSaving, setBulkSkuSaving] = useState(false)

  const canEdit = can(role, 'editInventory') && (role === 'admin' || role === 'superadmin')
  const canCosts = can(role, 'viewCosts')
  const selected = items.find((item) => item.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId) {
      setMovements([])
      return
    }
    let active = true
    api.inventory
      .movements(selectedId)
      .then((rows) => {
        if (active) setMovements(rows)
      })
      .catch(() => {
        if (active) setMovements([])
      })
    return () => {
      active = false
    }
  }, [selectedId])

  const stats = useMemo(() => {
    const physical = items.filter((item) => !item.service)
    return {
      references: physical.length,
      units: physical.reduce((sum, item) => sum + item.stock, 0),
      alerts: physical.filter((item) => item.alertEnabled && getStockStatus(item) !== 'in').length,
      value: physical.reduce((sum, item) => sum + item.stock * (item.cost ?? 0), 0)
    }
  }, [items])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return items.filter((product) => {
      const matchesQuery =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.barcode.includes(term) ||
        (product.supplierSku ?? '').toLowerCase().includes(term) ||
        product.serials.some((serial) => serial.toLowerCase().includes(term))
      const matchesCategory = category === 'Todas' || product.category === category
      const status = getStockStatus(product)
      const matchesStock = stockFilter === 'todos' || status === stockFilter
      return matchesQuery && matchesCategory && matchesStock
    })
  }, [items, query, category, stockFilter])

  async function applyAdjustment() {
    if (!selected) return
    const amount = Number(adjustQuantity)
    if (!amount || Number.isNaN(amount)) {
      toast.error('Ingresa una cantidad válida')
      return
    }
    setSaving(true)
    try {
      const updated = await api.inventory.adjust(selected.id, amount, adjustReason)
      setData((current) =>
        current ? { ...current, products: current.products.map((item) => (item.id === updated.id ? updated : item)) } : current
      )
      const rows = await api.inventory.movements(selected.id)
      setMovements(rows)
      setAdjustOpen(false)
      setAdjustQuantity('1')
      toast.success('Stock actualizado', {
        description: `${selected.name} · ${amount > 0 ? '+' : ''}${amount} unidades · ${adjustReason}`
      })
    } catch (failure) {
      toast.error('No se pudo ajustar el stock', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  function openCreate() {
    const firstCategory = categoryOptions.find((item) => item !== 'Todas') ?? 'Repuestos'
    const firstCondition = conditionOptions[0] ?? ''
    setForm({
      ...emptyProductForm,
      category: firstCategory,
      location: locationOptions[0] ?? 'Bodega A',
      condition: firstCondition,
      publishWeb: isWebEligibleCondition(firstCondition),
      origin: originOptions[0] ?? ''
    })
    setCreateOpen(true)
  }

  async function createProduct() {
    if (!form.name.trim() || Number(form.price) <= 0) {
      toast.error('Completa nombre y precio de venta')
      return
    }
    setSaving(true)
    try {
      let sku = form.sku.trim()
      if (!sku) {
        const generated = await api.inventory.suggestSku({
          name: form.name.trim(),
          supplierSku: form.supplierSku.trim() || undefined
        })
        sku = generated.sku
        setForm((value) => ({ ...value, sku }))
      }
      const product = await api.inventory.create({
        name: form.name.trim(),
        sku,
        barcode: form.barcode.trim() || undefined,
        supplierSku: form.supplierSku.trim() || undefined,
        category: form.category,
        location: form.location,
        condition: form.condition || undefined,
        origin: form.origin || undefined,
        stock: Number(form.stock) || 0,
        minStock: Number(form.minStock) || 0,
        cost: Number(form.cost) || 0,
        price: Number(form.price),
        warrantyDays: Number(form.warrantyDays) || 0,
        rotation: form.rotation,
        alertEnabled: form.alertEnabled,
        publishWeb: form.publishWeb,
        service: form.service,
        serviceType: form.service ? form.serviceType || undefined : undefined,
        imageDataUrl: form.imageDataUrl || undefined,
        imageThumbnailDataUrl: form.imageThumbnailDataUrl || undefined
      })
      setData((current) => (current ? { ...current, products: [product, ...current.products] } : current))
      setCreateOpen(false)
      setForm({
        ...emptyProductForm,
        category: categoryOptions.find((item) => item !== 'Todas') ?? 'Repuestos',
        location: locationOptions[0] ?? 'Bodega A',
        condition: conditionOptions[0] ?? '',
        origin: originOptions[0] ?? ''
      })
      toast.success('Producto creado', { description: `${product.name} · ${product.sku}` })
    } catch (failure) {
      toast.error('No se pudo crear el producto', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  function openEdit(product: Product) {
    setSelectedId(product.id)
    setEditForm({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      supplierSku: product.supplierSku ?? '',
      category: product.category,
      location: product.location,
      condition: product.condition ?? '',
      origin: product.origin ?? '',
      stock: String(product.stock),
      minStock: String(product.minStock),
      cost: String(product.cost ?? 0),
      price: String(product.price),
      warrantyDays: String(product.warrantyDays),
      rotation: product.rotation,
      alertEnabled: product.alertEnabled,
      publishWeb: product.publishWeb,
      service: Boolean(product.service),
      serviceType: product.serviceType ?? '',
      imageDataUrl: null,
      imageThumbnailDataUrl: null,
      removeImage: false
    })
    setEditOpen(true)
  }

  async function updateProduct() {
    if (!selected) return
    if (!editForm.name.trim() || Number(editForm.price) <= 0) {
      toast.error('Completa nombre y precio de venta')
      return
    }
    setSaving(true)
    try {
      let sku = editForm.sku.trim()
      if (!sku) {
        const generated = await api.inventory.suggestSku({
          name: editForm.name.trim(),
          supplierSku: editForm.supplierSku.trim() || undefined,
          productId: selected.id
        })
        sku = generated.sku
        setEditForm((value) => ({ ...value, sku }))
      }
      const updated = await api.inventory.update(selected.id, {
        name: editForm.name.trim(),
        sku,
        supplierSku: editForm.supplierSku.trim(),
        ...(editForm.barcode.trim() ? { barcode: editForm.barcode.trim() } : {}),
        category: editForm.category,
        location: editForm.location,
        condition: editForm.condition,
        origin: editForm.origin,
        minStock: Number(editForm.minStock) || 0,
        cost: Number(editForm.cost) || 0,
        price: Number(editForm.price),
        warrantyDays: Number(editForm.warrantyDays) || 0,
        rotation: editForm.rotation,
        alertEnabled: editForm.alertEnabled,
        publishWeb: editForm.publishWeb,
        service: editForm.service,
        serviceType: editForm.service ? editForm.serviceType || undefined : undefined,
        imageDataUrl: editForm.imageDataUrl || undefined,
        imageThumbnailDataUrl: editForm.imageThumbnailDataUrl || undefined,
        removeImage: editForm.removeImage
      })
      setData((current) =>
        current ? { ...current, products: current.products.map((item) => (item.id === updated.id ? updated : item)) } : current
      )
      setEditOpen(false)
      toast.success('Referencia actualizada', { description: `${updated.name} · ${updated.sku}` })
    } catch (failure) {
      toast.error('No se pudo actualizar la referencia', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  async function suggestSku(mode: 'create' | 'edit') {
    const current = mode === 'create' ? form : editForm
    if (!current.name.trim()) {
      toast.error('Escribe primero el nombre del producto')
      return
    }
    setSkuSaving(true)
    try {
      const result = await api.inventory.suggestSku({
        name: current.name.trim(),
        supplierSku: current.supplierSku.trim() || undefined,
        productId: mode === 'edit' ? selected?.id : undefined
      })
      if (mode === 'create') {
        setForm((value) => ({ ...value, sku: result.sku }))
      } else {
        setEditForm((value) => ({ ...value, sku: result.sku }))
      }
      toast.success('SKU generado', { description: result.sku })
      if (result.warning) toast.info(result.warning)
    } catch (failure) {
      toast.error('No se pudo generar el SKU', { description: errorMessage(failure) })
    } finally {
      setSkuSaving(false)
    }
  }

  async function generateMissingSkus() {
    if (bulkSkuSaving) return
    setBulkSkuSaving(true)
    try {
      const result = await api.inventory.generateMissingSkus()
      if (result.updated > 0) {
        toast.success('SKUs generados', {
          description: `${result.updated} producto${result.updated === 1 ? '' : 's'} actualizado${result.updated === 1 ? '' : 's'}.`
        })
        await reload()
      } else {
        toast.info('Todos los productos ya tienen SKU')
      }
      if (result.pending > 0) {
        toast.warning(`${result.pending} producto${result.pending === 1 ? '' : 's'} quedó sin SKU`, {
          description: 'Revisa los nombres o SKU de proveedor.'
        })
      }
    } catch (failure) {
      toast.error('No se pudieron generar los SKUs', { description: errorMessage(failure) })
    } finally {
      setBulkSkuSaving(false)
    }
  }

  function exportInventory() {
    downloadCsv('bitacoretech-inventario.csv', [
      ['Producto', 'SKU', 'SKU proveedor', 'Categoría', 'Ubicación', 'Stock', 'Stock mínimo', 'Costo', 'Precio', 'Rotación', 'Alerta', 'Estado'],
      ...filtered.map((product) => [
        product.name,
        product.sku,
        product.supplierSku,
        product.category,
        product.location ?? '',
        product.stock,
        product.minStock,
        canCosts ? (product.cost ?? 0) : 'Restringido',
        product.price,
        product.rotation,
        product.alertEnabled ? 'Activa' : 'Desactivada',
        getStockStatus(product)
      ])
    ])
    toast.success('Inventario exportado', { description: 'Archivo CSV descargado con los filtros actuales.' })
  }

  const statCards = [
    { label: 'Referencias', value: formatNumber(stats.references), icon: Boxes, tone: 'bg-brand-50 text-brand-600' },
    { label: 'Unidades en stock', value: formatNumber(stats.units), icon: Warehouse, tone: 'bg-sky-50 text-sky-600' },
    { label: 'Alertas de reposición', value: formatNumber(stats.alerts), icon: AlertTriangle, tone: 'bg-warning-50 text-warning-600' },
    {
      label: 'Valor del inventario',
      value: canCosts ? formatCurrency(stats.value) : 'Restringido',
      icon: LockKeyhole,
      tone: 'bg-slate-100 text-slate-500'
    }
  ]

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando inventario…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <AlertTriangle className="h-6 w-6 text-danger-500" />
        <p className="text-sm font-semibold text-ink">No se pudo cargar el inventario</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>Reintentar</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventario"
        description="Existencias, costos, seriales y alertas de reposición del taller y el mostrador."
        actions={
          <>
            {canEdit ? (
              <Button
                variant="secondary"
                onClick={() => void generateMissingSkus()}
                loading={bulkSkuSaving}
                leftIcon={<Wand2 className="h-4 w-4" />}
              >
                Generar SKUs
              </Button>
            ) : null}
            <Button variant="secondary" onClick={exportInventory} leftIcon={<Download className="h-4 w-4" />}>
              Exportar
            </Button>
            {canEdit ? (
              <Button onClick={openCreate} leftIcon={<PackagePlus className="h-4 w-4" />}>
                Nuevo producto
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card flex items-center gap-3.5 p-4">
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', stat.tone)}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-[22px] font-bold leading-none text-ink">{stat.value}</p>
                <p className="mt-1.5 text-[11px] text-slate-500">{stat.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <SegmentedTabs
            value={stockFilter}
            onChange={setStockFilter}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'in', label: 'En stock' },
              { value: 'low', label: 'Stock bajo' },
              { value: 'out', label: 'Agotados' }
            ]}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              placeholder="Buscar producto, SKU, serial..."
              wrapClassName="w-full sm:w-[300px]"
            />
            <div className="relative">
              <Select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-10 w-full pl-3 pr-8 text-[11px] font-semibold sm:w-[170px]"
              >
                {categoryOptions.map((item) => (
                  <option key={item} value={item}>
                    {item === 'Todas' ? 'Todas las categorías' : item}
                  </option>
                ))}
              </Select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] table-fixed">
            <thead>
              <tr className="border-b border-line bg-slate-50/60">
                <th className="table-th w-[30%] pl-5 lg:pl-6">Producto</th>
                <th className="table-th w-[15%]">Categoría</th>
                <th className="table-th w-[16%]">Stock</th>
                {canCosts ? <th className="table-th w-[9%] text-right">Costo</th> : null}
                <th className="table-th w-[11%] text-right">Precio venta</th>
                <th className="table-th w-[9%]">Estado</th>
                <th className="table-th w-[10%] pr-5 text-right lg:pr-6">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => {
                const Icon = product.icon
                const status = getStockStatus(product)
                const ratio = product.service ? 100 : Math.min((product.stock / Math.max(product.minStock * 2, 1)) * 100, 100)
                return (
                  <tr
                    key={product.id}
                    onClick={() => setSelectedId(product.id)}
                    className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="table-td pl-5 lg:pl-6">
                      <div className="flex items-center gap-3">
                        {product.imageThumbnailUrl ? (
                          <img
                            src={product.imageThumbnailUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-xl border border-line bg-white object-cover"
                          />
                        ) : (
                          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br', product.tone)}>
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold text-ink">{product.name}</p>
                          <p className="mt-0.5 truncate font-mono text-[9px] text-slate-400">
                            {product.sku} · {product.barcode}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="table-td">
                      <p className="truncate text-[11px] font-medium text-ink">{product.category}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-[9px] text-slate-400">
                        <MapPin className="h-2.5 w-2.5 shrink-0 text-slate-300" />
                        <span className="truncate">{product.location}</span>
                      </p>
                    </td>
                    <td className="table-td">
                      <div className="flex items-center gap-2">
                        <span className={cn('tabular w-7 text-[12px] font-bold', status === 'out' ? 'text-danger-600' : 'text-ink')}>
                          {product.service ? '∞' : product.stock}
                        </span>
                        <div className="w-12">
                          <ProgressBar
                            value={ratio}
                            tone={status === 'in' ? 'success' : status === 'low' ? 'warning' : 'danger'}
                          />
                        </div>
                        <span className="truncate text-[9px] text-slate-400">mín. {product.minStock}</span>
                      </div>
                    </td>
                    {canCosts ? (
                      <td className="table-td text-right text-[11px] tabular text-slate-500">{formatCurrency(product.cost ?? 0)}</td>
                    ) : null}
                    <td className="table-td text-right text-[12px] font-semibold tabular text-ink">{formatCurrency(product.price)}</td>
                    <td className="table-td">
                      <StockStatusBadge product={product} />
                      <p className={cn('mt-1 text-[8px]', product.alertEnabled ? 'text-success-600' : 'text-slate-400')}>
                        {product.alertEnabled ? 'Aviso activo' : 'Sin aviso'}
                      </p>
                    </td>
                    <td className="table-td pr-5 lg:pr-6">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedId(product.id)
                          }}
                          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand-600 hover:shadow-sm"
                          aria-label={`Ver ${product.name}`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              openEdit(product)
                            }}
                            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-brand-600 hover:shadow-sm"
                            aria-label={`Editar ${product.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!filtered.length ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <Search className="h-6 w-6 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-ink">Sin productos que coincidan</p>
            <p className="mt-1 text-xs text-slate-500">Cambia la búsqueda o los filtros de existencias.</p>
          </div>
        ) : null}

        <div className="flex flex-col items-start justify-between gap-2 border-t border-line px-5 py-3.5 text-[10px] text-slate-400 sm:flex-row sm:items-center lg:px-6">
          <span>Mostrando {filtered.length} de {items.length} referencias.</span>
          <span className="flex items-center gap-1.5">
            <ArrowDownToLine className="h-3 w-3" />
            Movimientos sincronizados con caja, compras y OTs.
          </span>
        </div>
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? 'Producto'}
        description={selected ? `${selected.sku} · ${selected.category}` : ''}
        width="md"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setSelectedId(null)}>
              Cerrar
            </Button>
            {canEdit && selected ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => openEdit(selected)} leftIcon={<Pencil className="h-4 w-4" />}>
                  Editar referencia
                </Button>
                <Button onClick={() => setAdjustOpen(true)} leftIcon={<SlidersHorizontal className="h-4 w-4" />}>
                  Ajustar stock
                </Button>
              </div>
            ) : null}
          </div>
        }
      >
        {selected ? (
          <div className="space-y-4">
            {selected.imageUrl ? (
              <img
                src={selected.imageUrl}
                alt={selected.name}
                className="h-56 w-full rounded-2xl border border-line bg-white object-contain"
              />
            ) : null}
            <div className="flex items-center gap-3">
              <span className={cn('flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br', selected.tone)}>
                <selected.icon className="h-7 w-7" />
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <StockStatusBadge product={selected} />
                <Badge variant="outline">{selected.location}</Badge>
                <Badge variant="outline">Garantía {selected.warrantyDays} días</Badge>
                <Badge variant={selected.alertEnabled ? 'warning' : 'neutral'}>
                  {selected.alertEnabled ? 'Alerta de stock' : 'Sin alerta'}
                </Badge>
                <Badge variant="outline">
                  {selected.rotation === 'rotativo' ? 'Rotativo' : selected.rotation === 'prueba' ? 'Prueba' : 'No rotativo'}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-line bg-slate-50/60 p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Stock actual</p>
                <p className="tabular mt-1 font-display text-xl font-bold text-ink">{selected.service ? '∞' : selected.stock}</p>
                <p className="mt-0.5 text-[9px] text-slate-400">Mínimo {selected.minStock}</p>
              </div>
              <div className="rounded-xl border border-line bg-slate-50/60 p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Precio venta</p>
                <p className="tabular mt-1 font-display text-xl font-bold text-ink">{formatCurrency(selected.price)}</p>
                <p className="mt-0.5 text-[9px] text-slate-400">{canCosts ? `Costo ${formatCurrency(selected.cost ?? 0)}` : 'Costo restringido'}</p>
              </div>
            </div>

            <div>
              <p className="field-label">Datos del producto</p>
              <div className="divide-y divide-line rounded-xl border border-line">
                {[
                  ['SKU', selected.sku],
                  ['SKU de proveedor', selected.supplierSku || 'Sin especificar'],
                  ['Código de barras', selected.barcode],
                  ['Categoría', selected.category],
                  ['Ubicación', selected.location],
                  ['Condición', selected.condition || 'Sin especificar'],
                  ['Origen', selected.origin || 'Sin especificar'],
                  ...(selected.service ? [['Tipo de servicio', selected.serviceType || 'No definido']] : []),
                  ['Garantía', `${selected.warrantyDays} días`]
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-[10px] text-slate-400">{label}</span>
                    <span className="text-[11px] font-medium text-ink">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {canCosts ? (
              <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3.5">
                <div className="flex items-center justify-between text-[11px] text-brand-800">
                  <span>Margen bruto unitario</span>
                  <span className="font-semibold tabular">
                    {selected.price > 0 ? Math.round(((selected.price - (selected.cost ?? 0)) / selected.price) * 100) : 0}%
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-brand-700/70">
                  <span>Utilidad por unidad</span>
                  <span className="font-semibold tabular">{formatCurrency(selected.price - (selected.cost ?? 0))}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-xl border border-line bg-slate-50 p-3">
                <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Tu rol puede consultar precios de venta y existencias, pero no costos ni márgenes.
                </p>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="field-label mb-0">Seriales registrados</p>
                <Badge variant="neutral">{selected.serials.length}</Badge>
              </div>
              {selected.serials.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {selected.serials.map((serial) => (
                    <span key={serial} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 font-mono text-[9px] text-slate-500">
                      <Hash className="h-2.5 w-2.5 text-slate-300" />
                      {serial}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-line px-3 py-3 text-center text-[10px] text-slate-400">
                  Producto sin control individual de seriales.
                </p>
              )}
            </div>

            <div>
              <p className="field-label">Movimientos recientes</p>
              <div className="space-y-2">
                {movements.length ? (
                  movements.map((movement) => (
                    <div key={movement.id} className="flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={cn(
                            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                            movement.quantity > 0 ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600'
                          )}
                        >
                          {movement.quantity > 0 ? <Plus className="h-3 w-3" /> : <ArrowDownToLine className="h-3 w-3" />}
                        </span>
                        <div>
                          <p className="text-[11px] font-semibold text-ink">{movement.type.replace(/_/g, ' ')}</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">{movement.detail}</p>
                          <p className="mt-0.5 text-[9px] text-slate-300">{formatDateTime(movement.date)} · {movement.user}</p>
                        </div>
                      </div>
                      <span className={cn('tabular text-[11px] font-bold', movement.quantity > 0 ? 'text-success-600' : 'text-danger-600')}>
                        {movement.quantity > 0 ? '+' : ''}
                        {movement.quantity}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-line px-3 py-3 text-center text-[10px] text-slate-400">
                    Este producto todavía no tiene movimientos.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Ajustar stock"
        description={selected ? `${selected.name} · stock actual ${selected.stock}` : ''}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdjustOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={applyAdjustment} disabled={saving}>{saving ? 'Guardando…' : 'Guardar ajuste'}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="field-label">Cantidad (+ ingreso / − salida)</span>
            <input
              value={adjustQuantity}
              onChange={(event) => setAdjustQuantity(event.target.value)}
              className="field text-right text-base font-semibold tabular"
              inputMode="numeric"
            />
          </label>
          <label className="block">
            <span className="field-label">Motivo</span>
            <select value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} className="field">
              {['Conteo físico', 'Producto dañado', 'Devolución', 'Consumo interno', 'Corrección de error'].map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-xl border border-warning-100 bg-warning-50/70 px-3.5 py-2.5 text-[10px] leading-relaxed text-warning-800">
            Todo ajuste manual queda registrado en auditoría con usuario, motivo y fecha.
          </div>
        </div>
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuevo producto"
        description="Agrega una referencia al catálogo del taller."
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={createProduct} disabled={saving} leftIcon={<PackagePlus className="h-4 w-4" />}>
              {saving ? 'Creando…' : 'Crear producto'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" placeholder="Ej. SSD NVMe 1TB" />
          </label>
          <div className="sm:col-span-2">
            <ProductImageField
              previewUrl={form.imageDataUrl}
              hasExisting={false}
              disabled={saving}
              onChange={(imageDataUrl, imageThumbnailDataUrl) =>
                setForm({ ...form, imageDataUrl, imageThumbnailDataUrl, removeImage: false })
              }
              onRemove={() =>
                setForm({ ...form, imageDataUrl: null, imageThumbnailDataUrl: null })
              }
            />
          </div>
          <div className="block">
            <div className="flex items-center justify-between gap-2">
              <span className="field-label mb-0">SKU</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void suggestSku('create')}
                loading={skuSaving}
                leftIcon={<Wand2 className="h-3.5 w-3.5" />}
              >
                Generar
              </Button>
            </div>
            <input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} className="field" placeholder="SSD-NVME-1TB" />
          </div>
          <label className="block">
            <span className="field-label">Código de barras (opcional)</span>
            <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} className="field" placeholder="Se genera si se deja vacío" />
          </label>
          <label className="block">
            <span className="field-label">SKU de proveedor (opcional)</span>
            <input value={form.supplierSku} onChange={(event) => setForm({ ...form, supplierSku: event.target.value })} className="field" placeholder="Ej. TL-WN725N" />
          </label>
          <label className="block">
            <span className="field-label">Categoría</span>
            <select
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              className="field"
            >
              {categoryOptions.filter((item) => item !== 'Todas').map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Ubicación</span>
            <select value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className="field">
              {locationOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Condición</span>
            <select
              value={form.condition}
              onChange={(event) => {
                const condition = event.target.value
                setForm({
                  ...form,
                  condition,
                  publishWeb: isWebEligibleCondition(condition) ? form.publishWeb : false
                })
              }}
              className="field"
            >
              <option value="">Sin especificar</option>
              {conditionOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Origen</span>
            <select
              value={form.origin}
              onChange={(event) => setForm({ ...form, origin: event.target.value })}
              className="field"
            >
              <option value="">Sin especificar</option>
              {originOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end">
            <span className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={form.service}
                onChange={(event) => {
                  const service = event.target.checked
                  setForm({
                    ...form,
                    service,
                    serviceType: service ? form.serviceType : '',
                    category: service && categoryOptions.includes('Servicios') ? 'Servicios' : form.category,
                    stock: service ? '0' : form.stock,
                    minStock: service ? '0' : form.minStock,
                    alertEnabled: service ? false : form.alertEnabled,
                    publishWeb: service ? false : form.publishWeb
                  })
                }}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
              />
              <span className="text-[11px] font-semibold text-ink">Es un servicio</span>
            </span>
          </label>
          {form.service ? (
            <label className="block">
              <span className="field-label">Tipo de servicio</span>
              <select
                value={form.serviceType}
                onChange={(event) => setForm({ ...form, serviceType: event.target.value })}
                className="field"
              >
                <option value="">Sin especificar</option>
                {[...new Set([...serviceTypeOptions, form.serviceType].filter(Boolean))].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="field-label">Garantía (días)</span>
            <input
              value={form.warrantyDays}
              onChange={(event) => setForm({ ...form, warrantyDays: event.target.value })}
              className="field text-right tabular"
              inputMode="numeric"
            />
          </label>
          <label className="block">
            <span className="field-label">Stock inicial</span>
            <input value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} className="field text-right tabular" inputMode="numeric" />
          </label>
          <label className="block">
            <span className="field-label">Stock mínimo</span>
            <input value={form.minStock} onChange={(event) => setForm({ ...form, minStock: event.target.value })} className="field text-right tabular" inputMode="numeric" />
          </label>
          <label className="block">
            <span className="field-label">Tipo de rotación</span>
            <select
              value={form.rotation}
              onChange={(event) => {
                const rotation = event.target.value as ProductRotation
                setForm({ ...form, rotation, alertEnabled: rotation === 'rotativo' })
              }}
              disabled={form.service}
              className="field disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="rotativo">Rotativo</option>
              <option value="no_rotativo">No rotativo</option>
              <option value="prueba">Prueba / demostración</option>
            </select>
          </label>
          <label className="flex items-end">
            <span className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={form.alertEnabled}
                disabled={form.service}
                onChange={(event) => setForm({ ...form, alertEnabled: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200 disabled:opacity-40"
              />
              <span className="text-[11px] font-semibold text-ink">Generar alerta de stock</span>
            </span>
          </label>
          <label className="flex items-end">
            <span className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={form.publishWeb}
                disabled={form.service || !isWebEligibleCondition(form.condition)}
                onChange={(event) => setForm({ ...form, publishWeb: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200 disabled:opacity-40"
              />
              <span className="text-[11px] font-semibold text-ink">Publicar en catálogo web</span>
            </span>
          </label>
          <p className="text-[9px] leading-relaxed text-slate-400 sm:col-span-2">
            Solo Nuevo o Reacondicionado se publican en la web. Usados, Para repuesto y Otro
            quedan fuera del catálogo público.
          </p>
          <label className="block">
            <span className="field-label">Costo unitario</span>
            <div className="relative">
              <Tag className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={form.cost}
                onChange={(event) => setForm({ ...form, cost: event.target.value })}
                className="field pl-9 text-right tabular"
                inputMode="numeric"
                placeholder="0"
              />
            </div>
          </label>
          <label className="block">
            <span className="field-label">Precio de venta</span>
            <div className="relative">
              <Layers className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value })}
                className="field pl-9 text-right tabular"
                inputMode="numeric"
                placeholder="0"
              />
            </div>
          </label>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Editar referencia"
        description={selected ? `${selected.name} · stock actual ${selected.stock}` : 'Producto'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void updateProduct()} loading={saving} leftIcon={<Pencil className="h-4 w-4" />}>
              Guardar cambios
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre</span>
            <input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} className="field" />
          </label>
          <div className="sm:col-span-2">
            <ProductImageField
              previewUrl={
                editForm.removeImage
                  ? null
                  : editForm.imageDataUrl || selected?.imageUrl || null
              }
              hasExisting={Boolean(selected?.imageUrl) && !editForm.removeImage}
              disabled={saving}
              onChange={(imageDataUrl, imageThumbnailDataUrl) =>
                setEditForm({ ...editForm, imageDataUrl, imageThumbnailDataUrl, removeImage: false })
              }
              onRemove={() =>
                setEditForm({ ...editForm, imageDataUrl: null, imageThumbnailDataUrl: null, removeImage: true })
              }
            />
          </div>
          <div className="block">
            <div className="flex items-center justify-between gap-2">
              <span className="field-label mb-0">SKU</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void suggestSku('edit')}
                loading={skuSaving}
                leftIcon={<Wand2 className="h-3.5 w-3.5" />}
              >
                Generar
              </Button>
            </div>
            <input value={editForm.sku} onChange={(event) => setEditForm({ ...editForm, sku: event.target.value })} className="field" />
          </div>
          <label className="block">
            <span className="field-label">Código de barras</span>
            <input value={editForm.barcode} onChange={(event) => setEditForm({ ...editForm, barcode: event.target.value })} className="field" />
          </label>
          <label className="block">
            <span className="field-label">SKU de proveedor</span>
            <input value={editForm.supplierSku} onChange={(event) => setEditForm({ ...editForm, supplierSku: event.target.value })} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Categoría</span>
            <select
              value={editForm.category}
              onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}
              className="field"
            >
              {categoryOptions.filter((item) => item !== 'Todas').map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Ubicación</span>
            <select
              value={editForm.location}
              onChange={(event) => setEditForm({ ...editForm, location: event.target.value })}
              className="field"
            >
              {[...new Set([...locationOptions, editForm.location].filter(Boolean))].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Condición</span>
            <select
              value={editForm.condition}
              onChange={(event) => {
                const condition = event.target.value
                setEditForm({
                  ...editForm,
                  condition,
                  publishWeb: isWebEligibleCondition(condition) ? editForm.publishWeb : false
                })
              }}
              className="field"
            >
              <option value="">Sin especificar</option>
              {[...new Set([...conditionOptions, editForm.condition].filter(Boolean))].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Origen</span>
            <select
              value={editForm.origin}
              onChange={(event) => setEditForm({ ...editForm, origin: event.target.value })}
              className="field"
            >
              <option value="">Sin especificar</option>
              {[...new Set([...originOptions, editForm.origin].filter(Boolean))].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end">
            <span className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={editForm.service}
                onChange={(event) => {
                  const service = event.target.checked
                  setEditForm({
                    ...editForm,
                    service,
                    serviceType: service ? editForm.serviceType : '',
                    category: service && categoryOptions.includes('Servicios') ? 'Servicios' : editForm.category,
                    alertEnabled: service ? false : editForm.alertEnabled,
                    publishWeb: service ? false : editForm.publishWeb
                  })
                }}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
              />
              <span className="text-[11px] font-semibold text-ink">Es un servicio</span>
            </span>
          </label>
          {editForm.service ? (
            <label className="block">
              <span className="field-label">Tipo de servicio</span>
              <select
                value={editForm.serviceType}
                onChange={(event) => setEditForm({ ...editForm, serviceType: event.target.value })}
                className="field"
              >
                <option value="">Sin especificar</option>
                {[...new Set([...serviceTypeOptions, editForm.serviceType].filter(Boolean))].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <span className="field-label">Garantía (días)</span>
            <input
              value={editForm.warrantyDays}
              onChange={(event) => setEditForm({ ...editForm, warrantyDays: event.target.value })}
              className="field text-right tabular"
              inputMode="numeric"
            />
          </label>
          <label className="block">
            <span className="field-label">Stock mínimo</span>
            <input
              value={editForm.minStock}
              onChange={(event) => setEditForm({ ...editForm, minStock: event.target.value })}
              className="field text-right tabular"
              inputMode="numeric"
            />
          </label>
          <label className="block">
            <span className="field-label">Tipo de rotación</span>
            <select
              value={editForm.rotation}
              onChange={(event) => {
                const rotation = event.target.value as ProductRotation
                setEditForm({ ...editForm, rotation, alertEnabled: rotation === 'rotativo' })
              }}
              disabled={editForm.service}
              className="field disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="rotativo">Rotativo</option>
              <option value="no_rotativo">No rotativo</option>
              <option value="prueba">Prueba / demostración</option>
            </select>
          </label>
          <label className="flex items-end">
            <span className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={editForm.alertEnabled}
                disabled={editForm.service}
                onChange={(event) => setEditForm({ ...editForm, alertEnabled: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200 disabled:opacity-40"
              />
              <span className="text-[11px] font-semibold text-ink">Generar alerta de stock</span>
            </span>
          </label>
          <label className="flex items-end">
            <span className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={editForm.publishWeb}
                disabled={editForm.service || !isWebEligibleCondition(editForm.condition)}
                onChange={(event) => setEditForm({ ...editForm, publishWeb: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200 disabled:opacity-40"
              />
              <span className="text-[11px] font-semibold text-ink">Publicar en catálogo web</span>
            </span>
          </label>
          <p className="text-[9px] leading-relaxed text-slate-400 sm:col-span-2">
            Solo Nuevo o Reacondicionado se publican en la web. Usados, Para repuesto y Otro
            quedan fuera del catálogo público.
          </p>
          <label className="block">
            <span className="field-label">Costo unitario</span>
            <input
              value={editForm.cost}
              onChange={(event) => setEditForm({ ...editForm, cost: event.target.value })}
              className="field text-right tabular"
              inputMode="numeric"
            />
          </label>
          <label className="block">
            <span className="field-label">Precio de venta</span>
            <input
              value={editForm.price}
              onChange={(event) => setEditForm({ ...editForm, price: event.target.value })}
              className="field text-right tabular"
              inputMode="numeric"
            />
          </label>
          <div className="rounded-xl border border-line bg-slate-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-slate-500 sm:col-span-2">
            El stock no se edita aquí. Para ingresar o retirar unidades usa <b>Ajustar stock</b> y conserva el kardex.
          </div>
        </div>
      </Modal>
    </div>
  )
}
