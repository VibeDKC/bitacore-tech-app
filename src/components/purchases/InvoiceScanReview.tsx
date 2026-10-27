import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardPaste,
  Cpu,
  FileText,
  Image as ImageIcon,
  PackagePlus,
  Plus,
  RefreshCcw,
  ScanLine,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AiInvoiceCostChange,
  AiInvoiceDraft,
  AiModelOption,
  DictionaryNode,
  Product,
  Purchase,
  PurchaseReviewNewProduct,
  Supplier
} from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { ApiError, api, errorMessage } from '@/lib/backend'
import { formatCurrency } from '@/lib/format'
import { activeDictionaryNodes, dictionaryValues } from '@/lib/dictionaries'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'

type ScanFile = {
  name: string
  mimeType: string
  dataUrl: string
  isImage: boolean
}

type AiRuntimeSettings = {
  model: string
  fallbackModels: string[]
  autoFallback: boolean
  models: AiModelOption[]
  configured: boolean
}

type ScanFailure = {
  code: string
  message: string
  retryAfterSeconds?: number
  attempts: Array<{ model: string; code: string; message: string }>
}

type NewProductDraft = {
  name: string
  sku: string
  supplierSku: string
  category: string
  location: string
  condition: string
  origin: string
  price: string
  warrantyDays: string
}

type ReviewLineState = {
  id: string
  description: string
  quantity: string
  unitCost: string
  ivaRate: string
  unitCostWithTax: number
  productId: string
  newProduct: NewProductDraft | null
  supplierSku: string
  serialText: string
  skuSugerido: string
  skuSource: string
  skuWarning: string | null
  confidence: number
  costChange: AiInvoiceCostChange | null
  sellPrice: string
  updatePrice: boolean
}

function parseAmount(value: string) {
  const normalized = value.replace(/[^0-9.,]/g, '').replace(',', '.')
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : 0
}

function moneyInput(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? String(Math.round(amount)) : ''
}

function suggestSku(description: string) {
  const base = description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `${base || 'PRODUCTO'}-${Date.now().toString().slice(-4)}`
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })
}

async function resizeInvoiceImage(file: File) {
  if (file.type === 'application/pdf') return readAsDataUrl(file)
  const bitmap = await createImageBitmap(file)
  const maxSide = 2000
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo preparar la imagen.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.86)
}

export function InvoiceScanReviewModal({
  open,
  onClose,
  suppliers,
  products,
  dictionaries,
  onRefresh,
  onCreated
}: {
  open: boolean
  onClose: () => void
  suppliers: Supplier[]
  products: Product[]
  dictionaries: DictionaryNode[]
  onRefresh: () => void
  onCreated: (purchase: Purchase) => void
}) {
  const { role } = useAuth()
  const canSwitchModel = (role === 'superadmin' || role === 'admin') && can(role, 'useAI')
  const inputRef = useRef<HTMLInputElement>(null)
  const [localSuppliers, setLocalSuppliers] = useState<Supplier[]>(suppliers)
  const [scanFile, setScanFile] = useState<ScanFile | null>(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<AiInvoiceDraft | null>(null)
  const [aiSettings, setAiSettings] = useState<AiRuntimeSettings>({
    model: '',
    fallbackModels: [],
    autoFallback: false,
    models: [],
    configured: true
  })
  const [modelInput, setModelInput] = useState('')
  const [modelsRefreshing, setModelsRefreshing] = useState(false)
  const [modelSaving, setModelSaving] = useState(false)
  const [scanError, setScanError] = useState<ScanFailure | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [discountInput, setDiscountInput] = useState('0')
  const [realTotalInput, setRealTotalInput] = useState('')
  const [differenceConfirmed, setDifferenceConfirmed] = useState(false)
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false)
  const [paymentCondition, setPaymentCondition] = useState<'contado' | 'credito'>('contado')
  const [paymentMethod, setPaymentMethod] = useState('Transferencia')
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [initialPayment, setInitialPayment] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [duplicateInfo, setDuplicateInfo] = useState<{
    duplicate: boolean
    purchaseId: string | null
    number: string
    date: string | null
  } | null>(null)
  const [lines, setLines] = useState<ReviewLineState[]>([])
  const [newSupplierOpen, setNewSupplierOpen] = useState(false)
  const [supplierSaving, setSupplierSaving] = useState(false)
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    nit: '',
    phone: '',
    category: 'Repuestos'
  })

  useEffect(() => {
    setLocalSuppliers(suppliers)
  }, [suppliers])

  useEffect(() => {
    if (!open) return
    setScanFile(null)
    setDraft(null)
    setLines([])
    setDuplicateInfo(null)
    setDuplicateConfirmed(false)
    setDifferenceConfirmed(false)
    setPaymentCondition('contado')
    setPaymentMethod('Transferencia')
    setPaymentAccountId('')
    setInitialPayment('')
    setDueDate('')
    setNewSupplierOpen(false)
    setSupplierForm({ name: '', nit: '', phone: '', category: 'Repuestos' })
    setScanError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    api.settings
      .get()
      .then((settings) => {
        if (!active) return
        const ai = settings.ai
        const model = ai.model ?? ''
        setAiSettings({
          model,
          fallbackModels: ai.fallbackModels ?? [],
          autoFallback: Boolean(ai.autoFallback),
          models: ai.modelCatalog ?? [],
          configured: Boolean(ai.configured)
        })
        setModelInput(model)
      })
      .catch(() => {
        // La configuración es informativa; el escaneo sigue disponible si el backend la valida.
      })
    return () => {
      active = false
    }
  }, [open])

  const categoryOptions = useMemo(() => {
    const values = dictionaryValues(dictionaries, 'inventory_category')
    return values.length ? values : ['Repuestos', 'Almacenamiento', 'Memoria', 'Componentes']
  }, [dictionaries])
  const locationOptions = useMemo(() => {
    const values = dictionaryValues(dictionaries, 'inventory_location')
    return values.length ? values : ['Bodega A', 'Taller', 'Mostrador']
  }, [dictionaries])
  const conditionOptions = useMemo(() => dictionaryValues(dictionaries, 'inventory_condition'), [dictionaries])
  const originOptions = useMemo(() => dictionaryValues(dictionaries, 'inventory_origin'), [dictionaries])
  const supplierCategoryOptions = useMemo(() => {
    const values = dictionaryValues(dictionaries, 'supplier_category')
    return values.length ? values : ['Repuestos', 'Tecnología', 'Servicios']
  }, [dictionaries])
  const purchaseAccounts = useMemo(
    () => activeDictionaryNodes(dictionaries, 'purchase_payment_account'),
    [dictionaries]
  )
  useEffect(() => {
    if (!purchaseAccounts.length) return
    const preferred =
      purchaseAccounts.find((account) => account.channel === paymentMethod) ?? purchaseAccounts[0]
    setPaymentAccountId((current) => current || preferred.id)
  }, [purchaseAccounts, paymentMethod])
  const modelOptions = useMemo(() => {
    const entries = new Map<string, AiModelOption>()
    if (aiSettings.model) {
      entries.set(aiSettings.model, { id: aiSettings.model, displayName: aiSettings.model })
    }
    for (const option of aiSettings.models) entries.set(option.id, option)
    for (const fallback of aiSettings.fallbackModels) {
      if (!entries.has(fallback)) entries.set(fallback, { id: fallback, displayName: fallback })
    }
    return [...entries.values()]
  }, [aiSettings])

  const acceptFile = useCallback(
    async (file: File) => {
      if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) {
        toast.error('Formato no compatible', { description: 'Usa una imagen PNG/JPEG/WebP o un PDF.' })
        return
      }
      if (file.size > 8 * 1024 * 1024) {
        toast.error('La factura es demasiado grande', { description: 'El límite es 8 MB.' })
        return
      }
      try {
        if (file.type === 'application/pdf') {
          setScanFile({
            name: file.name,
            mimeType: file.type,
            dataUrl: await readAsDataUrl(file),
            isImage: false
          })
        } else {
          setScanFile({
            name: file.name,
            mimeType: 'image/jpeg',
            dataUrl: await resizeInvoiceImage(file),
            isImage: true
          })
        }
        setDraft(null)
        setLines([])
        setScanError(null)
      } catch (error) {
        toast.error('No se pudo preparar la factura', { description: errorMessage(error) })
      }
    },
    []
  )

  useEffect(() => {
    if (!open) return
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }
      const items = Array.from(event.clipboardData?.items ?? [])
      const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      if (imageItem) {
        const file = imageItem.getAsFile()
        if (file) {
          event.preventDefault()
          void acceptFile(file)
          return
        }
      }
      const files = Array.from(event.clipboardData?.files ?? [])
      const pdf = files.find((file) => file.type === 'application/pdf')
      if (pdf) {
        event.preventDefault()
        void acceptFile(pdf)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open, acceptFile])

  function buildNewProduct(line: ReviewLineState): NewProductDraft {
    return {
      name: line.description,
      sku: line.skuSugerido || suggestSku(line.description),
      supplierSku: line.supplierSku,
      category: categoryOptions[0] ?? 'Repuestos',
      location: locationOptions[0] ?? 'Bodega A',
      condition: conditionOptions[0] ?? '',
      origin: originOptions[0] ?? '',
      price: moneyInput(Math.max(parseAmount(line.unitCost) * 1.4, 1)),
      warrantyDays: '90'
    }
  }

  function applyDraft(result: AiInvoiceDraft) {
    setDraft(result)
    setSupplierId(result.supplier.supplierId ?? '')
    setInvoiceNumber(result.invoice.number)
    setInvoiceDate(result.invoice.date || new Date().toISOString().slice(0, 10))
    setDiscountInput(moneyInput(result.discount))
    setRealTotalInput(moneyInput(result.realTotal))
    setDifferenceConfirmed(false)
    setDuplicateConfirmed(false)
    setPaymentCondition(result.invoice.paymentCondition ?? 'contado')
    const nextMethod =
      result.invoice.paymentMethod &&
      ['Efectivo', 'Transferencia', 'Tarjeta'].includes(result.invoice.paymentMethod)
        ? result.invoice.paymentMethod
        : 'Transferencia'
    setPaymentMethod(nextMethod)
    setPaymentAccountId(
      (purchaseAccounts.find((account) => account.channel === nextMethod) ?? purchaseAccounts[0])?.id ?? ''
    )
    setInitialPayment('')
    setDueDate('')
    setLines(
      result.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: String(line.quantity),
        unitCost: moneyInput(line.unitCost),
        ivaRate: String(line.ivaRate),
        unitCostWithTax: line.unitCostWithTax,
        productId: line.productId ?? '',
        newProduct: null,
        supplierSku: line.supplierSku ?? '',
        serialText: line.serialText ?? '',
        skuSugerido: line.skuSugerido ?? '',
        skuSource: line.skuSource ?? 'sin-sku',
        skuWarning: line.skuWarning ?? null,
        confidence: line.confidence,
        costChange: line.costChange,
        sellPrice: line.costChange ? moneyInput(line.costChange.suggestedPrice) : '',
        updatePrice: false
      }))
    )
  }

  async function refreshModels() {
    if (!canSwitchModel || modelsRefreshing) return
    setModelsRefreshing(true)
    try {
      const result = await api.ai.listModels()
      setAiSettings((current) => ({ ...current, models: result.models }))
      toast.success('Lista de modelos actualizada', {
        description: `${result.models.length} modelos disponibles para esta clave.`
      })
    } catch (failure) {
      toast.error('No se pudieron cargar los modelos', { description: errorMessage(failure) })
    } finally {
      setModelsRefreshing(false)
    }
  }

  async function saveModel() {
    if (!canSwitchModel || modelSaving) return
    const next = modelInput.trim().replace(/^models\//, '')
    if (!next) {
      toast.error('Escribe o selecciona un modelo')
      return
    }
    setModelSaving(true)
    try {
      const result = await api.ai.setModel(next)
      setAiSettings((current) => ({ ...current, model: result.model }))
      setModelInput(result.model)
      toast.success('Modelo actualizado', { description: result.model })
    } catch (failure) {
      toast.error('No se pudo cambiar el modelo', { description: errorMessage(failure) })
    } finally {
      setModelSaving(false)
    }
  }

  async function scanInvoice() {
    if (!scanFile || scanning) return
    setScanning(true)
    setScanError(null)
    try {
      const result = await api.purchases.scanInvoice({
        name: scanFile.name,
        mimeType: scanFile.mimeType,
        dataUrl: scanFile.dataUrl
      })
      applyDraft(result)
      const fallbackNote = result.ai.fallbackUsed
        ? ` Se usó el respaldo ${result.ai.model}.`
        : ''
      toast.success('Factura analizada', {
        description: `${result.lines.length} línea${result.lines.length === 1 ? '' : 's'} detectada${result.lines.length === 1 ? '' : 's'}. Revisa antes de aprobar.${fallbackNote}`
      })
    } catch (failure) {
      const apiFailure = failure instanceof ApiError ? failure : null
      const details = apiFailure?.details
      const retryAfterSeconds = Number(details?.retryAfterSeconds)
      const attempts = Array.isArray(details?.attempts)
        ? details.attempts
            .filter((attempt: any) => attempt && typeof attempt.model === 'string')
            .map((attempt: any) => ({
              model: String(attempt.model),
              code: String(attempt.code ?? 'AI_ERROR'),
              message: String(attempt.message ?? '')
            }))
        : []
      setScanError({
        code: apiFailure?.code ?? 'AI_ERROR',
        message: errorMessage(failure),
        ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? { retryAfterSeconds }
          : {}),
        attempts
      })
      toast.error('No se pudo analizar la factura', { description: errorMessage(failure) })
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    if (!draft || !supplierId || !invoiceNumber.trim()) {
      setDuplicateInfo(null)
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      api.purchases
        .checkDuplicate(supplierId, invoiceNumber.trim())
        .then((result) => {
          if (active) setDuplicateInfo(result)
        })
        .catch(() => {
          if (active) setDuplicateInfo(null)
        })
    }, 350)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [draft, supplierId, invoiceNumber])

  const subtotal = lines.reduce(
    (sum, line) => sum + parseAmount(line.unitCost) * parseAmount(line.quantity),
    0
  )
  const iva = lines.reduce(
    (sum, line) =>
      sum + parseAmount(line.unitCost) * parseAmount(line.quantity) * (parseAmount(line.ivaRate) / 100),
    0
  )
  const discount = parseAmount(discountInput)
  const calculatedTotal = subtotal + iva - discount
  const realTotal = parseAmount(realTotalInput)
  const difference = realTotal - calculatedTotal
  const requiresDifferenceConfirmation = Math.abs(difference) >= 1

  const linesValid = lines.length > 0 && lines.every((line) => {
    if (!line.description.trim() || parseAmount(line.quantity) <= 0 || parseAmount(line.unitCost) < 0) return false
    const rate = parseAmount(line.ivaRate)
    if (rate < 0 || rate > 100) return false
    if (line.newProduct) {
      return (
        Boolean(line.newProduct.name.trim()) &&
        Boolean(line.newProduct.sku.trim()) &&
        Boolean(line.newProduct.category) &&
        Boolean(line.newProduct.location) &&
        parseAmount(line.newProduct.price) > 0
      )
    }
    return true
  })

  const initialPaymentValue = parseAmount(initialPayment)
  const paymentValid =
    paymentCondition === 'contado' || initialPaymentValue <= realTotal
  const canApprove =
    Boolean(draft) &&
    Boolean(supplierId) &&
    Boolean(invoiceNumber.trim()) &&
    Boolean(invoiceDate) &&
    linesValid &&
    realTotal > 0 &&
    paymentValid &&
    (!requiresDifferenceConfirmation || differenceConfirmed) &&
    (!duplicateInfo?.duplicate || duplicateConfirmed) &&
    !saving

  function updateLine(index: number, patch: Partial<ReviewLineState>) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)))
  }

  function updateNewProduct(index: number, patch: Partial<NewProductDraft>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index && line.newProduct
          ? { ...line, newProduct: { ...line.newProduct, ...patch } }
          : line
      )
    )
  }

  function toggleNewProduct(index: number) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line
        if (line.newProduct) return { ...line, newProduct: null, productId: line.productId }
        return { ...line, productId: '', newProduct: buildNewProduct(line) }
      })
    )
  }

  function addLine() {
    setLines((current) => [
      ...current,
      {
        id: `manual_${Date.now()}`,
        description: '',
        quantity: '1',
        unitCost: '',
        ivaRate: '19',
        unitCostWithTax: 0,
        productId: '',
        newProduct: null,
        supplierSku: '',
        serialText: '',
        skuSugerido: '',
        skuSource: 'sin-sku',
        skuWarning: null,
        confidence: 1,
        costChange: null,
        sellPrice: '',
        updatePrice: false
      }
    ])
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
  }

  async function createSupplier() {
    if (!supplierForm.name.trim() || supplierSaving) {
      toast.error('El nombre del proveedor es obligatorio')
      return
    }
    setSupplierSaving(true)
    try {
      const supplier = await api.suppliers.create({
        name: supplierForm.name.trim(),
        nit: supplierForm.nit.trim() || undefined,
        phone: supplierForm.phone.trim() || undefined,
        category: supplierForm.category
      })
      setLocalSuppliers((current) => [...current, supplier])
      setSupplierId(supplier.id)
      setNewSupplierOpen(false)
      setSupplierForm({ name: '', nit: '', phone: '', category: 'Repuestos' })
      onRefresh()
      toast.success('Proveedor creado')
    } catch (failure) {
      toast.error('No se pudo crear el proveedor', { description: errorMessage(failure) })
    } finally {
      setSupplierSaving(false)
    }
  }

  async function approve() {
    if (!draft || !canApprove || saving) return
    const payloadLines = lines.map((line) => ({
      description: line.description.trim(),
      quantity: parseAmount(line.quantity),
      unitCost: parseAmount(line.unitCost),
      ivaRate: parseAmount(line.ivaRate),
      productId: line.productId || null,
      supplierSku: line.supplierSku.trim(),
      serialText: line.serialText.trim(),
      newProduct: line.newProduct
        ? ({
            name: line.newProduct.name.trim(),
            sku: line.newProduct.sku.trim(),
            supplierSku: line.newProduct.supplierSku.trim(),
            category: line.newProduct.category,
            location: line.newProduct.location,
            condition: line.newProduct.condition || undefined,
            origin: line.newProduct.origin || undefined,
            price: parseAmount(line.newProduct.price),
            warrantyDays: parseAmount(line.newProduct.warrantyDays)
          } satisfies PurchaseReviewNewProduct)
        : null,
      sellPrice: line.updatePrice && line.sellPrice ? parseAmount(line.sellPrice) : null,
      updatePrice: line.updatePrice
    }))
    setSaving(true)
    try {
      const purchase = await api.purchases.createFromReview({
        supplierId,
        number: invoiceNumber.trim(),
        date: new Date(`${invoiceDate}T12:00:00`).toISOString(),
        lines: payloadLines,
        discount,
        realTotal,
        updatePrices: lines.some((line) => line.updatePrice),
        duplicateConfirmed,
        paymentCondition,
        paymentMethod,
        paymentAccountId: paymentAccountId || undefined,
        initialPayment: paymentCondition === 'credito' ? parseAmount(initialPayment) : 0,
        dueDate:
          paymentCondition === 'credito' && dueDate
            ? new Date(`${dueDate}T12:00:00`).toISOString()
            : null,
        aiMetadata: {
          ...draft.ai,
          source: draft.source,
          supplierMatch: draft.supplier.match,
          difference,
          duplicate: Boolean(duplicateInfo?.duplicate)
        }
      })
      toast.success('Compra registrada', {
        description: `${purchase.number} · ${formatCurrency(purchase.total)}`
      })
      onCreated(purchase)
      onClose()
    } catch (failure) {
      toast.error('No se pudo registrar la compra', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  const modelBar = (
    <div className="rounded-xl border border-line bg-white px-3.5 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Cpu className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
              Modelo de IA
            </p>
            {canSwitchModel ? (
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  list="invoice-ai-models"
                  value={modelInput}
                  onChange={(event) => setModelInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveModel()
                    }
                  }}
                  className="field h-8 w-44 font-mono text-[10px]"
                  aria-label="Modelo de IA para la factura"
                  autoComplete="off"
                  spellCheck={false}
                />
                <datalist id="invoice-ai-models">
                  {modelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName}
                    </option>
                  ))}
                </datalist>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void saveModel()}
                  loading={modelSaving}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <p className="mt-1 truncate text-[10px] font-semibold text-ink">
                {aiSettings.model || draft?.ai.model || 'Sin modelo'}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[9px] text-slate-400">
          {!aiSettings.configured ? (
            <span className="rounded-full bg-warning-50 px-2 py-1 font-semibold text-warning-700">
              Sin clave configurada
            </span>
          ) : null}
          {aiSettings.autoFallback && aiSettings.fallbackModels.length ? (
            <span className="rounded-full bg-slate-100 px-2 py-1">
              Respaldo: {aiSettings.fallbackModels.join(' → ')}
            </span>
          ) : null}
          {draft?.ai.fallbackUsed ? (
            <span className="rounded-full bg-warning-50 px-2 py-1 font-semibold text-warning-700">
              Respondió {draft.ai.model}
            </span>
          ) : null}
          {canSwitchModel ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void refreshModels()}
              loading={modelsRefreshing}
              leftIcon={<RefreshCcw className="h-3 w-3" />}
            >
              Actualizar lista
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )

  const footer = draft ? (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
      <Button
        variant="secondary"
        onClick={() => {
          setDraft(null)
          setLines([])
        }}
        disabled={saving}
      >
        Volver a escanear
      </Button>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={() => void approve()} loading={saving} disabled={!canApprove} leftIcon={<CheckCircle2 className="h-4 w-4" />}>
          Aprobar factura de compra
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={onClose} disabled={scanning}>
        Cancelar
      </Button>
      <Button
        onClick={() => void scanInvoice()}
        loading={scanning}
        disabled={!scanFile}
        leftIcon={<ScanLine className="h-4 w-4" />}
      >
        Escanear factura
      </Button>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft ? 'Revisar factura de compra' : 'Escanear factura de compra'}
      description={
        draft
          ? 'Revisa los datos extraídos. Nada se registra hasta que apruebes.'
          : 'Carga una imagen o PDF, arrástralo o pégalo con Ctrl+V.'
      }
      size="xl"
      footer={footer}
    >
      <div className="mb-3">{modelBar}</div>
      {!draft ? (
        <div className="space-y-4">
          {scanError ? (
            <div className="rounded-xl border border-danger-200 bg-danger-50/70 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-600" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-danger-800">
                    No se pudo analizar la factura
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-danger-800">
                    {scanError.message}
                  </p>
                  {scanError.retryAfterSeconds ? (
                    <p className="mt-1 text-[9px] text-danger-700">
                      Puedes reintentar en aproximadamente {scanError.retryAfterSeconds} s.
                    </p>
                  ) : null}
                  {scanError.attempts.length > 1 ? (
                    <p className="mt-1 text-[9px] text-danger-700">
                      Modelos intentados: {scanError.attempts.map((attempt) => attempt.model).join(', ')}.
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void scanInvoice()}
                      disabled={!scanFile}
                      loading={scanning}
                    >
                      Reintentar
                    </Button>
                    {canSwitchModel ? (
                      <span className="text-[9px] text-danger-700">
                        Cambia el modelo arriba y vuelve a intentar.
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void acceptFile(file)
              event.target.value = ''
            }}
          />
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const file = event.dataTransfer.files?.[0]
              if (file) void acceptFile(file)
            }}
            className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/40 px-6 py-10 text-center"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-sm">
              <Upload className="h-5 w-5" />
            </span>
            <p className="mt-3 text-[13px] font-semibold text-ink">Arrastra la factura aquí</p>
            <p className="mt-1 text-[10px] text-slate-500">Imagen PNG/JPEG/WebP o PDF · máximo 8 MB</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 shadow-sm">
                <ClipboardPaste className="h-3 w-3" /> Ctrl+V
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 shadow-sm">
                <ImageIcon className="h-3 w-3" /> Imagen o captura
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 shadow-sm">
                <FileText className="h-3 w-3" /> PDF
              </span>
            </div>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              leftIcon={<Upload className="h-4 w-4" />}
            >
              Elegir archivo
            </Button>
          </div>

          {scanFile ? (
            <div className="rounded-xl border border-line bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {scanFile.isImage ? (
                    <img src={scanFile.dataUrl} alt="Factura cargada" className="h-16 w-16 rounded-lg border border-line object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-danger-50 text-danger-600">
                      <FileText className="h-6 w-6" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-ink">{scanFile.name}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">
                      {scanFile.isImage ? 'Imagen optimizada para análisis' : 'PDF listo para análisis'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScanFile(null)
                    setScanError(null)
                  }}
                  className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Quitar archivo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-line bg-slate-50/70 px-3.5 py-2.5">
            <p className="text-[10px] leading-relaxed text-slate-500">
              La imagen o el PDF no se guardan en la base. Solo se conserva la extracción, el modelo y un hash de control.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {draft.warnings.length ? (
            <div className="rounded-xl border border-warning-200 bg-warning-50/70 p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold text-warning-800">
                <AlertTriangle className="h-3.5 w-3.5" /> Revisa estas advertencias
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[10px] leading-relaxed text-warning-800">
                {draft.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {duplicateInfo?.duplicate ? (
            <div className="rounded-xl border border-danger-200 bg-danger-50/70 p-3">
              <p className="text-[10px] font-semibold text-danger-800">
                Ya existe una factura de este proveedor con el número {duplicateInfo.number}.
              </p>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10px] text-danger-800">
                <input
                  type="checkbox"
                  checked={duplicateConfirmed}
                  onChange={(event) => setDuplicateConfirmed(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-danger-300 text-danger-600 focus:ring-danger-200"
                />
                Confirmo que deseo registrar esta factura duplicada.
              </label>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="flex items-end justify-between gap-2">
                <label className="block min-w-0 flex-1">
                  <span className="field-label">Proveedor</span>
                  <select
                    value={supplierId}
                    onChange={(event) => {
                      setSupplierId(event.target.value)
                      setDuplicateConfirmed(false)
                    }}
                    className="field"
                  >
                    <option value="">Selecciona o crea el proveedor</option>
                    {localSuppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name} · {supplier.nit}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setNewSupplierOpen((value) => !value)}
                  leftIcon={<Building2 className="h-3.5 w-3.5" />}
                >
                  Crear proveedor
                </Button>
              </div>
              {draft.supplier.match !== 'none' ? (
                <p className="mt-1 text-[9px] text-success-700">
                  Sugerido: {draft.supplier.matchedName} · coincidencia por {draft.supplier.match === 'exact' ? 'NIT' : 'nombre'}
                </p>
              ) : draft.supplier.name ? (
                <p className="mt-1 text-[9px] text-slate-400">Nombre leído: {draft.supplier.name}</p>
              ) : null}
              {newSupplierOpen ? (
                <div className="mt-3 grid gap-2 rounded-xl border border-line bg-slate-50/60 p-3 sm:grid-cols-2">
                  <input
                    value={supplierForm.name}
                    onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })}
                    className="field h-9 text-[11px]"
                    placeholder="Nombre del proveedor"
                  />
                  <input
                    value={supplierForm.nit}
                    onChange={(event) => setSupplierForm({ ...supplierForm, nit: event.target.value })}
                    className="field h-9 text-[11px]"
                    placeholder="NIT (opcional)"
                  />
                  <input
                    value={supplierForm.phone}
                    onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })}
                    className="field h-9 text-[11px]"
                    placeholder="Teléfono (opcional)"
                  />
                  <select
                    value={supplierForm.category}
                    onChange={(event) => setSupplierForm({ ...supplierForm, category: event.target.value })}
                    className="field h-9 text-[11px]"
                  >
                    {supplierCategoryOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2 sm:col-span-2">
                    <Button size="sm" onClick={() => void createSupplier()} loading={supplierSaving}>
                      Guardar proveedor
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setNewSupplierOpen(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <label className="block">
              <span className="field-label">Número de factura</span>
              <input
                value={invoiceNumber}
                onChange={(event) => {
                  setInvoiceNumber(event.target.value)
                  setDuplicateConfirmed(false)
                }}
                className="field"
              />
            </label>
            <label className="block">
              <span className="field-label">Fecha de factura</span>
              <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="field" />
            </label>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={line.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">Línea {index + 1}</Badge>
                    <Badge variant={line.confidence >= 0.8 ? 'success' : 'warning'}>
                      Confianza {Math.round(line.confidence * 100)} %
                    </Badge>
                    {line.newProduct ? <Badge variant="brand">Producto nuevo</Badge> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    disabled={lines.length <= 1}
                    className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-30"
                    aria-label={`Eliminar línea ${index + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block sm:col-span-2">
                    <span className="field-label">Descripción</span>
                    <input
                      value={line.description}
                      onChange={(event) => updateLine(index, { description: event.target.value })}
                      className="field h-9 text-[11px]"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Cantidad</span>
                    <input
                      value={line.quantity}
                      onChange={(event) => updateLine(index, { quantity: event.target.value })}
                      inputMode="decimal"
                      className="field h-9 text-right text-[11px]"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Costo unitario</span>
                    <input
                      value={line.unitCost}
                      onChange={(event) => updateLine(index, { unitCost: event.target.value })}
                      inputMode="decimal"
                      className="field h-9 text-right text-[11px]"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">IVA %</span>
                    <input
                      value={line.ivaRate}
                      onChange={(event) => updateLine(index, { ivaRate: event.target.value })}
                      inputMode="decimal"
                      className="field h-9 text-right text-[11px]"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Producto en inventario</span>
                    <select
                      value={line.productId}
                      onChange={(event) => {
                        const product = products.find((item) => item.id === event.target.value)
                        updateLine(index, {
                          productId: event.target.value,
                          newProduct: null,
                          supplierSku: product?.supplierSku ?? line.supplierSku
                        })
                      }}
                      className="field h-9 text-[11px]"
                    >
                      <option value="">Sin producto asociado</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} · {product.sku}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      variant={line.newProduct ? 'secondary' : 'ghost'}
                      onClick={() => toggleNewProduct(index)}
                      leftIcon={<PackagePlus className="h-3.5 w-3.5" />}
                    >
                      {line.newProduct ? 'Quitar producto nuevo' : 'Crear producto'}
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">SKU / Ref. proveedor</span>
                    <input
                      value={line.supplierSku}
                      onChange={(event) => updateLine(index, { supplierSku: event.target.value })}
                      className="field h-9 font-mono text-[11px]"
                      placeholder="Opcional"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Seriales (texto)</span>
                    <input
                      value={line.serialText}
                      onChange={(event) => updateLine(index, { serialText: event.target.value })}
                      className="field h-9 text-[11px]"
                      placeholder="Opcional, separados por coma"
                    />
                  </label>
                </div>
                {line.skuWarning ? (
                  <p className="mt-1 text-[9px] text-warning-700">{line.skuWarning}</p>
                ) : null}
                {line.newProduct ? (
                  <div className="mt-3 grid gap-2 rounded-xl border border-brand-100 bg-brand-50/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block sm:col-span-2">
                      <span className="field-label">Nombre del producto nuevo</span>
                      <input
                        value={line.newProduct.name}
                        onChange={(event) => updateNewProduct(index, { name: event.target.value })}
                        className="field h-9 text-[11px]"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">SKU interno</span>
                      <input
                        value={line.newProduct.sku}
                        onChange={(event) => updateNewProduct(index, { sku: event.target.value })}
                        className="field h-9 font-mono text-[11px]"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">SKU / Ref. proveedor</span>
                      <input
                        value={line.newProduct.supplierSku}
                        onChange={(event) =>
                          updateNewProduct(index, { supplierSku: event.target.value })
                        }
                        className="field h-9 font-mono text-[11px]"
                        placeholder="Opcional"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Precio de venta</span>
                      <input
                        value={line.newProduct.price}
                        onChange={(event) => updateNewProduct(index, { price: event.target.value })}
                        inputMode="decimal"
                        className="field h-9 text-right text-[11px]"
                      />
                      <span className="mt-1 block text-[9px] text-slate-500">
                        Margen con IVA:{' '}
                        <span className="font-semibold text-ink">
                          {(() => {
                            const price = parseAmount(line.newProduct.price)
                            const costWithTax =
                              parseAmount(line.unitCost) * (1 + parseAmount(line.ivaRate) / 100)
                            return price > 0
                              ? `${Math.round(((price - costWithTax) / price) * 100)} %`
                              : '—'
                          })()}
                        </span>
                      </span>
                    </label>
                    <label className="block">
                      <span className="field-label">Categoría</span>
                      <select
                        value={line.newProduct.category}
                        onChange={(event) => updateNewProduct(index, { category: event.target.value })}
                        className="field h-9 text-[11px]"
                      >
                        {categoryOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Ubicación</span>
                      <select
                        value={line.newProduct.location}
                        onChange={(event) => updateNewProduct(index, { location: event.target.value })}
                        className="field h-9 text-[11px]"
                      >
                        {locationOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Condición</span>
                      <select
                        value={line.newProduct.condition}
                        onChange={(event) => updateNewProduct(index, { condition: event.target.value })}
                        className="field h-9 text-[11px]"
                      >
                        <option value="">Sin especificar</option>
                        {conditionOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Origen</span>
                      <select
                        value={line.newProduct.origin}
                        onChange={(event) => updateNewProduct(index, { origin: event.target.value })}
                        className="field h-9 text-[11px]"
                      >
                        <option value="">Sin especificar</option>
                        {originOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Garantía (días)</span>
                      <input
                        value={line.newProduct.warrantyDays}
                        onChange={(event) => updateNewProduct(index, { warrantyDays: event.target.value })}
                        inputMode="numeric"
                        className="field h-9 text-right text-[11px]"
                      />
                    </label>
                  </div>
                ) : null}
                {line.costChange ? (
                  <div className="mt-2 rounded-xl border border-warning-100 bg-warning-50/60 p-3">
                    <p className="text-[10px] font-semibold text-warning-800">
                      El costo subió de {formatCurrency(line.costChange.previousCost)} a{' '}
                      {formatCurrency(line.costChange.newCost)}.
                    </p>
                    <p className="mt-0.5 text-[9px] text-warning-700">
                      Margen sin IVA {line.costChange.marginPercent.toFixed(1)} % · con IVA{' '}
                      {line.costChange.previousPrice > 0
                        ? (
                            ((line.costChange.previousPrice -
                              line.costChange.previousCost *
                                (1 + parseAmount(line.ivaRate) / 100)) /
                              line.costChange.previousPrice) *
                            100
                          ).toFixed(1)
                        : '—'}{' '}
                      % · precio sugerido {formatCurrency(line.costChange.suggestedPrice)}
                    </p>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10px] text-warning-800">
                      <input
                        type="checkbox"
                        checked={line.updatePrice}
                        onChange={(event) => updateLine(index, { updatePrice: event.target.checked })}
                        className="h-3.5 w-3.5 rounded border-warning-300 text-warning-600 focus:ring-warning-200"
                      />
                      Actualizar el precio de venta
                    </label>
                    {line.updatePrice ? (
                      <input
                        value={line.sellPrice}
                        onChange={(event) => updateLine(index, { sellPrice: event.target.value })}
                        inputMode="decimal"
                        className="field mt-2 h-8 w-40 text-right text-[10px]"
                        placeholder="Precio nuevo"
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={addLine} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Añadir línea
            </Button>
          </div>

          <div className="rounded-xl border border-line bg-slate-50/70 p-4">
            <div className="ml-auto max-w-md space-y-2">
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span>Subtotal</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span>IVA</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(iva)}</span>
              </div>
              <label className="flex items-center justify-between gap-3 text-[10px] text-slate-500">
                <span>Descuento</span>
                <input
                  value={discountInput}
                  onChange={(event) => setDiscountInput(event.target.value)}
                  inputMode="decimal"
                  className="field h-8 w-32 text-right text-[10px]"
                />
              </label>
              <div className="flex items-center justify-between border-t border-line pt-2 text-[11px]">
                <span className="font-semibold text-slate-600">Total calculado</span>
                <span className="tabular font-bold text-ink">{formatCurrency(calculatedTotal)}</span>
              </div>
              <label className="flex items-center justify-between gap-3 text-[11px]">
                <span className="font-semibold text-slate-600">Total real de la factura</span>
                <input
                  value={realTotalInput}
                  onChange={(event) => {
                    setRealTotalInput(event.target.value)
                    setDifferenceConfirmed(false)
                  }}
                  inputMode="decimal"
                  className="field h-9 w-36 text-right text-[11px] font-semibold"
                />
              </label>
              {Math.abs(difference) >= 1 ? (
                <div className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2">
                  <p className="text-[10px] font-semibold text-warning-800">
                    Diferencia: {formatCurrency(difference)}
                  </p>
                  <p className="mt-0.5 text-[9px] text-warning-700">
                    {difference < 0
                      ? 'Se sumará al descuento de la compra.'
                      : 'Se registrará como ajuste positivo de la compra.'}
                  </p>
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10px] text-warning-800">
                    <input
                      type="checkbox"
                      checked={differenceConfirmed}
                      onChange={(event) => setDifferenceConfirmed(event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-warning-300 text-warning-600 focus:ring-warning-200"
                    />
                    Confirmo el total real y el ajuste.
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-line p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Forma de pago</span>
                <select
                  value={paymentCondition}
                  onChange={(event) =>
                    setPaymentCondition(event.target.value as 'contado' | 'credito')
                  }
                  className="field"
                >
                  <option value="contado">Contado</option>
                  <option value="credito">Crédito</option>
                </select>
              </label>
              <label className="block">
                <span className="field-label">Cuenta de pago</span>
                <select
                  value={paymentAccountId}
                  onChange={(event) => {
                    const account = purchaseAccounts.find((item) => item.id === event.target.value)
                    setPaymentAccountId(event.target.value)
                    setPaymentMethod(account?.channel ?? 'Transferencia')
                  }}
                  className="field"
                >
                  {purchaseAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.channel ?? 'Transferencia'}
                    </option>
                  ))}
                </select>
              </label>
              {paymentCondition === 'credito' ? (
                <>
                  <label className="block">
                    <span className="field-label">Abono inicial (opcional)</span>
                    <input
                      value={initialPayment}
                      onChange={(event) => setInitialPayment(event.target.value)}
                      inputMode="decimal"
                      className="field text-right tabular"
                      placeholder="0"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Vencimiento (opcional)</span>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      className="field"
                    />
                  </label>
                  <p className="text-[10px] text-slate-500 sm:col-span-2">
                    Saldo a deber:{' '}
                    <span className="font-semibold text-ink">
                      {formatCurrency(
                        Math.max(0, realTotal - parseAmount(initialPayment))
                      )}
                    </span>
                    . El saldo queda en cuentas por pagar con el proveedor.
                  </p>
                  {!paymentValid ? (
                    <p className="text-[9px] text-danger-600 sm:col-span-2">
                      El abono inicial no puede superar el total real de la factura.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
