import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Globe2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Tag,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  CatalogSyncStatus,
  Promotion,
  PromotionInput,
  PromotionPreview
} from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { SearchInput, Select } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Drawer'
import { EmptyState } from '@/components/ui/EmptyState'

interface PromotionForm {
  name: string
  description: string
  discountType: 'percent' | 'amount'
  discountPercent: string
  discountAmount: string
  startsOn: string
  endsOn: string
  priority: string
  active: boolean
  publishWeb: boolean
  allowBelowCost: boolean
  targetType: 'all' | 'category' | 'sku'
  targetCategory: string
  targetProductId: string
}

const emptyForm: PromotionForm = {
  name: '',
  description: '',
  discountType: 'percent',
  discountPercent: '10',
  discountAmount: '',
  startsOn: '',
  endsOn: '',
  priority: '0',
  active: true,
  publishWeb: true,
  allowBelowCost: false,
  targetType: 'all',
  targetCategory: '',
  targetProductId: ''
}

function statusTone(status: Promotion['status']) {
  if (status === 'activa') return 'success' as const
  if (status === 'programada') return 'sky' as const
  if (status === 'vencida') return 'neutral' as const
  return 'warning' as const
}

function scopeLabel(promotion: Promotion) {
  if (!promotion.targets.length) return 'Todo el catálogo'
  return promotion.targets.map((target) => target.label).join(', ')
}

function discountLabel(promotion: Promotion) {
  return promotion.discountType === 'percent'
    ? `${promotion.discountPercent}%`
    : formatCurrency(promotion.discountAmount)
}

function formToInput(form: PromotionForm, id?: string): PromotionInput {
  const targets: PromotionInput['targets'] =
    form.targetType === 'all'
      ? []
      : form.targetType === 'category'
        ? [{ type: 'category', category: form.targetCategory }]
        : [{ type: 'sku', productId: form.targetProductId }]
  return {
    ...(id ? { id } : {}),
    name: form.name.trim(),
    description: form.description.trim(),
    discountType: form.discountType,
    discountPercent: Number(form.discountPercent) || 0,
    discountAmount: Number(form.discountAmount) || 0,
    startsOn: form.startsOn || null,
    endsOn: form.endsOn || null,
    active: form.active,
    publishWeb: form.publishWeb,
    priority: Number(form.priority) || 0,
    allowBelowCost: form.allowBelowCost,
    targets
  }
}

export function PromotionsPage() {
  const { role } = useAuth()
  const canManage = can(role, 'managePromotions')
  const canPublish = can(role, 'publishCatalog')
  const { data, loading, error, reload } = useApi(async () => {
    const [promotions, products] = await Promise.all([
      api.promotions.list(),
      api.inventory.list()
    ])
    return { promotions, products }
  }, [])
  const promotions = data?.promotions ?? []
  const products = data?.products ?? []
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('todas')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PromotionForm>(emptyForm)
  const [preview, setPreview] = useState<PromotionPreview | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [catalog, setCatalog] = useState<CatalogSyncStatus | null>(null)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!canPublish) return
    let active = true
    api.catalog
      .status()
      .then((status) => {
        if (active) setCatalog(status)
      })
      .catch(() => {
        // La tarjeta de estado es informativa.
      })
    return () => {
      active = false
    }
  }, [canPublish])

  function refreshCatalogStatus() {
    if (!canPublish) return
    api.catalog
      .status()
      .then(setCatalog)
      .catch(() => {
        // El estado es informativo.
      })
  }

  const categories = useMemo(
    () =>
      [...new Set(products.filter((product) => !product.service).map((product) => product.category))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [products]
  )
  const skuProducts = useMemo(
    () =>
      products
        .filter((product) => !product.service)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  )

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return promotions.filter((promotion) => {
      const matchesStatus = statusFilter === 'todas' || promotion.status === statusFilter
      const matchesQuery =
        !term ||
        promotion.name.toLowerCase().includes(term) ||
        promotion.description.toLowerCase().includes(term) ||
        scopeLabel(promotion).toLowerCase().includes(term)
      return matchesStatus && matchesQuery
    })
  }, [promotions, query, statusFilter])

  function openCreate() {
    setEditingId(null)
    setForm({
      ...emptyForm,
      targetCategory: categories[0] ?? '',
      targetProductId: skuProducts[0]?.id ?? ''
    })
    setPreview(null)
    setDrawerOpen(true)
  }

  function openEdit(promotion: Promotion) {
    const target = promotion.targets[0]
    setEditingId(promotion.id)
    setForm({
      name: promotion.name,
      description: promotion.description,
      discountType: promotion.discountType,
      discountPercent: String(promotion.discountPercent || ''),
      discountAmount: promotion.discountType === 'amount' ? String(promotion.discountAmount) : '',
      startsOn: promotion.startsOn ?? '',
      endsOn: promotion.endsOn ?? '',
      priority: String(promotion.priority),
      active: promotion.active,
      publishWeb: promotion.publishWeb,
      allowBelowCost: promotion.allowBelowCost,
      targetType:
        promotion.scope === 'sku' ? 'sku' : promotion.scope === 'category' ? 'category' : 'all',
      targetCategory: target?.category ?? categories[0] ?? '',
      targetProductId: target?.productId ?? skuProducts[0]?.id ?? ''
    })
    setPreview(null)
    setDrawerOpen(true)
  }

  function validateForm() {
    if (form.name.trim().length < 2) {
      toast.error('Escribe un nombre para la promoción.')
      return false
    }
    if (form.discountType === 'percent' && !(Number(form.discountPercent) > 0)) {
      toast.error('El porcentaje debe ser mayor a cero.')
      return false
    }
    if (form.discountType === 'amount' && !(Number(form.discountAmount) > 0)) {
      toast.error('El monto fijo debe ser mayor a cero.')
      return false
    }
    if (form.targetType === 'category' && !form.targetCategory) {
      toast.error('Selecciona una categoría.')
      return false
    }
    if (form.targetType === 'sku' && !form.targetProductId) {
      toast.error('Selecciona un producto.')
      return false
    }
    return true
  }

  async function runPreview() {
    if (!validateForm()) return
    setPreviewing(true)
    try {
      setPreview(await api.promotions.preview(formToInput(form, editingId ?? undefined)))
    } catch (failure) {
      toast.error('No se pudo calcular la vista previa', { description: errorMessage(failure) })
    } finally {
      setPreviewing(false)
    }
  }

  async function save() {
    if (!validateForm()) return
    setSaving(true)
    try {
      const input = formToInput(form, editingId ?? undefined)
      if (editingId) {
        await api.promotions.update(input)
        toast.success('Promoción actualizada')
      } else {
        await api.promotions.create(input)
        toast.success('Promoción creada')
      }
      setDrawerOpen(false)
      setPreview(null)
      reload()
      refreshCatalogStatus()
    } catch (failure) {
      toast.error('No se pudo guardar la promoción', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  async function toggle(promotion: Promotion) {
    try {
      await api.promotions.toggle(promotion.id, !promotion.active)
      toast.success(promotion.active ? 'Promoción pausada' : 'Promoción activada')
      reload()
      refreshCatalogStatus()
    } catch (failure) {
      toast.error('No se pudo cambiar el estado', { description: errorMessage(failure) })
    }
  }

  async function toggleWeb(promotion: Promotion) {
    try {
      await api.promotions.publishWeb(promotion.id, !promotion.publishWeb)
      toast.success(promotion.publishWeb ? 'Promoción retirada de la web' : 'Promoción publicada en la web')
      reload()
      refreshCatalogStatus()
    } catch (failure) {
      toast.error('No se pudo cambiar la publicación web', { description: errorMessage(failure) })
    }
  }

  async function remove(promotion: Promotion) {
    if (!window.confirm(`¿Eliminar la promoción “${promotion.name}”?`)) return
    try {
      await api.promotions.remove(promotion.id)
      toast.success('Promoción eliminada')
      reload()
      refreshCatalogStatus()
    } catch (failure) {
      toast.error('No se pudo eliminar la promoción', { description: errorMessage(failure) })
    }
  }

  async function publishCatalog() {
    setPublishing(true)
    try {
      const result = await api.catalog.publish()
      setCatalog(result.status)
      if (result.ok) {
        toast.success('Catálogo web publicado', {
          description: `${result.status.lastProductCount} productos · ${result.status.lastPromotionCount} con promoción`
        })
      } else {
        toast.error('No se pudo publicar el catálogo', { description: result.error })
      }
    } catch (failure) {
      toast.error('No se pudo publicar el catálogo', { description: errorMessage(failure) })
    } finally {
      setPublishing(false)
    }
  }

  if (loading) {
    return (
      <div className="card p-8 text-center text-sm text-slate-500">
        Cargando promociones…
      </div>
    )
  }

  if (error) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold text-ink">No se pudieron cargar las promociones</p>
        <p className="max-w-md text-xs text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Promociones"
        description="Visible para todo el equipo. Solo propietario y administradores pueden crear, editar, activar o publicar promociones."
        actions={
          <>
            {canPublish ? (
              <Button
                variant="secondary"
                size="sm"
                loading={publishing}
                leftIcon={<Globe2 className="h-3.5 w-3.5" />}
                onClick={() => void publishCatalog()}
              >
                Publicar catálogo web
              </Button>
            ) : null}
            {canManage ? (
              <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
                Nueva promoción
              </Button>
            ) : null}
          </>
        }
      />

      {canPublish && catalog ? (
        <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <RefreshCw className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[12px] font-semibold text-ink">Catálogo web local</p>
              <p className="mt-0.5 text-[10px] text-slate-500">{catalog.lastMessage || 'Sin publicar todavía.'}</p>
              <p className="mt-1 text-[9px] text-slate-400">
                Última publicación: {catalog.lastPublishedAt ? formatDateTime(catalog.lastPublishedAt) : 'Nunca'} ·{' '}
                {catalog.lastProductCount} productos · {catalog.lastPromotionCount} con promoción
              </p>
            </div>
          </div>
          <Badge
            variant={
              catalog.lastStatus === 'success'
                ? 'success'
                : catalog.lastStatus === 'error'
                  ? 'danger'
                  : catalog.lastStatus === 'pending'
                    ? 'warning'
                    : 'neutral'
            }
            dot
          >
            {catalog.lastStatus === 'success'
              ? 'Publicado'
              : catalog.lastStatus === 'error'
                ? 'Error'
                : catalog.lastStatus === 'pending'
                  ? 'Publicando'
                  : 'Sin publicar'}
          </Badge>
        </div>
      ) : null}

      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
            placeholder="Buscar promoción, SKU o categoría…"
            wrapClassName="w-full sm:max-w-md"
          />
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="sm:w-44"
          >
            <option value="todas">Todos los estados</option>
            <option value="activa">Activas</option>
            <option value="programada">Programadas</option>
            <option value="vencida">Vencidas</option>
            <option value="pausada">Pausadas</option>
          </Select>
        </div>
      </div>

      {filtered.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[11px]">
            <thead className="border-b border-line bg-slate-50/70 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Promoción</th>
                <th className="px-4 py-3">Alcance</th>
                <th className="px-4 py-3">Descuento</th>
                <th className="px-4 py-3">Vigencia</th>
                <th className="px-4 py-3">Prioridad</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Web</th>
                {canManage ? <th className="px-4 py-3 text-right">Acciones</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((promotion) => (
                <tr key={promotion.id} className="align-top hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink">{promotion.name}</p>
                    {promotion.description ? (
                      <p className="mt-0.5 max-w-[240px] text-[10px] leading-snug text-slate-500">
                        {promotion.description}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[9px] text-slate-400">
                      {promotion.affectedCount} producto{promotion.affectedCount === 1 ? '' : 's'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <p className="max-w-[220px] leading-snug">{scopeLabel(promotion)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="brand">{discountLabel(promotion)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    <p>{promotion.startsOn || 'Desde ahora'}</p>
                    <p>{promotion.endsOn ? `hasta ${promotion.endsOn}` : 'sin fecha final'}</p>
                  </td>
                  <td className="px-4 py-3 tabular font-semibold text-slate-600">{promotion.priority}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusTone(promotion.status)}>{promotion.status}</Badge>
                    {promotion.belowCostCount > 0 ? (
                      <span className="mt-1 flex items-center gap-1 text-[9px] font-semibold text-danger-600">
                        <AlertTriangle className="h-3 w-3" /> Bajo costo ({promotion.belowCostCount})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={promotion.publishWeb ? 'success' : 'neutral'}>
                      {promotion.publishWeb ? 'Publicada' : 'No publicada'}
                    </Badge>
                  </td>
                  {canManage ? (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Editar promoción"
                          title="Editar"
                          onClick={() => openEdit(promotion)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={promotion.active ? 'Pausar promoción' : 'Activar promoción'}
                          title={promotion.active ? 'Pausar' : 'Activar'}
                          onClick={() => void toggle(promotion)}
                        >
                          {promotion.active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={promotion.publishWeb ? 'Retirar de la web' : 'Publicar en la web'}
                          title={promotion.publishWeb ? 'Retirar de la web' : 'Publicar en la web'}
                          onClick={() => void toggleWeb(promotion)}
                        >
                          <Globe2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Eliminar promoción"
                          title="Eliminar"
                          onClick={() => void remove(promotion)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger-500" />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Tag}
          title={promotions.length ? 'No hay promociones con ese filtro' : 'Aún no hay promociones'}
          description={
            promotions.length
              ? 'Cambia la búsqueda o el estado seleccionado.'
              : canManage
                ? 'Crea la primera promoción para aplicarla en ventas y publicarla en el catálogo web.'
                : 'Cuando el administrador cree una promoción, aparecerá aquí.'
          }
          action={
            canManage && !promotions.length ? (
              <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
                Nueva promoción
              </Button>
            ) : null
          }
        />
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? 'Editar promoción' : 'Nueva promoción'}
        description="Se aplica al POS y, si está publicada, al catálogo web. No se acumula con descuento manual ni fidelidad."
        width="lg"
        footer={
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
              Cancelar
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="secondary" loading={previewing} onClick={() => void runPreview()}>
                Vista previa
              </Button>
              <Button loading={saving} onClick={() => void save()}>
                {editingId ? 'Guardar cambios' : 'Crear promoción'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="field"
              placeholder="Ej. Semana de almacenamiento"
              maxLength={120}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Descripción</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              className="field min-h-20 resize-y"
              placeholder="Nota interna o texto para la web"
              maxLength={500}
            />
          </label>

          <label className="block">
            <span className="field-label">Tipo de descuento</span>
            <Select
              value={form.discountType}
              onChange={(event) =>
                setForm({ ...form, discountType: event.target.value as 'percent' | 'amount' })
              }
            >
              <option value="percent">Porcentaje</option>
              <option value="amount">Monto fijo</option>
            </Select>
          </label>
          <label className="block">
            <span className="field-label">
              {form.discountType === 'percent' ? 'Porcentaje (%)' : 'Monto fijo (COP)'}
            </span>
            <input
              value={form.discountType === 'percent' ? form.discountPercent : form.discountAmount}
              onChange={(event) =>
                setForm(
                  form.discountType === 'percent'
                    ? { ...form, discountPercent: event.target.value }
                    : { ...form, discountAmount: event.target.value }
                )
              }
              className="field text-right tabular"
              inputMode="decimal"
              placeholder={form.discountType === 'percent' ? '10' : '10000'}
            />
          </label>

          <label className="block">
            <span className="field-label">Desde</span>
            <input
              type="date"
              value={form.startsOn}
              onChange={(event) => setForm({ ...form, startsOn: event.target.value })}
              className="field"
            />
          </label>
          <label className="block">
            <span className="field-label">Hasta</span>
            <input
              type="date"
              value={form.endsOn}
              onChange={(event) => setForm({ ...form, endsOn: event.target.value })}
              className="field"
            />
          </label>

          <label className="block">
            <span className="field-label">Alcance</span>
            <Select
              value={form.targetType}
              onChange={(event) =>
                setForm({ ...form, targetType: event.target.value as PromotionForm['targetType'] })
              }
            >
              <option value="all">Todo el catálogo</option>
              <option value="category">Categoría</option>
              <option value="sku">SKU específico</option>
            </Select>
          </label>
          {form.targetType === 'category' ? (
            <label className="block">
              <span className="field-label">Categoría</span>
              <Select
                value={form.targetCategory}
                onChange={(event) => setForm({ ...form, targetCategory: event.target.value })}
              >
                <option value="">Selecciona…</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </label>
          ) : form.targetType === 'sku' ? (
            <label className="block">
              <span className="field-label">Producto</span>
              <Select
                value={form.targetProductId}
                onChange={(event) => setForm({ ...form, targetProductId: event.target.value })}
              >
                <option value="">Selecciona…</option>
                {skuProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.sku} · {product.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}

          <label className="block">
            <span className="field-label">Prioridad</span>
            <input
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
              className="field text-right tabular"
              inputMode="numeric"
            />
            <span className="mt-1 block text-[9px] text-slate-400">
              Mayor prioridad gana si varias aplican al mismo producto.
            </span>
          </label>

          <div className="flex flex-col gap-2 rounded-xl border border-line bg-slate-50/60 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-ink">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              Activa
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-ink">
              <input
                type="checkbox"
                checked={form.publishWeb}
                onChange={(event) => setForm({ ...form, publishWeb: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              Publicar en catálogo web
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-ink">
              <input
                type="checkbox"
                checked={form.allowBelowCost}
                onChange={(event) => setForm({ ...form, allowBelowCost: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              Autorizar precio bajo costo
            </label>
          </div>

          {preview ? (
            <div className="sm:col-span-2 rounded-xl border border-line bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="brand">{preview.affectedCount} productos afectados</Badge>
                {preview.belowCostCount > 0 ? (
                  <Badge variant="danger" dot>
                    {preview.belowCostCount} bajo costo
                  </Badge>
                ) : (
                  <Badge variant="success" dot>
                    Sin alerta de costo
                  </Badge>
                )}
              </div>
              {preview.belowCostCount > 0 ? (
                <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-danger-600">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Revisa los productos y autoriza el precio bajo costo si es intencional.
                </p>
              ) : null}
              <div className="mt-2 max-h-48 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="text-left text-slate-400">
                    <tr>
                      <th className="py-1">Producto</th>
                      <th className="py-1 text-right">Regular</th>
                      <th className="py-1 text-right">Promo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.products.slice(0, 12).map((product) => (
                      <tr key={product.id} className="border-t border-line/60">
                        <td className="py-1 pr-2">
                          {product.name}
                          {product.belowCost ? (
                            <AlertTriangle className="ml-1 inline h-3 w-3 text-danger-500" />
                          ) : null}
                        </td>
                        <td className="py-1 text-right tabular text-slate-400">
                          {formatCurrency(product.regularPrice)}
                        </td>
                        <td className="py-1 text-right tabular font-semibold text-ink">
                          {formatCurrency(product.promoPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="sm:col-span-2 text-[10px] leading-relaxed text-slate-400">
              Usa <b>Vista previa</b> para ver los productos afectados y el aviso de costo antes de guardar.
            </p>
          )}
        </div>
      </Drawer>
    </div>
  )
}
