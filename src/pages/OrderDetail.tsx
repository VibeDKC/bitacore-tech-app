import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  CreditCard,
  FileText,
  Landmark,
  LockKeyhole,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Tag,
  UserRound,
  Wallet,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import type { LegalConfig, LockType, PaymentMethod, PowerState, Product, TechnicianOption, WorkOrderStatus } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { canCancelWorkOrder, nextWorkOrderStatus, workOrderStatusConfig, workOrderStatusOrder } from '@/lib/status'
import { lineTotal } from '@/lib/orders'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { defaultLegalConfig } from '@/lib/legalConfig'
import { technicalSheetEntries } from '@/lib/technicalSheet'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Modal } from '@/components/ui/Modal'
import { WorkOrderStatusBadge } from '@/components/ui/StatusBadge'
import { DocumentPreviewModal } from '@/components/orders/DocumentPreview'
import { EvidenceGallery } from '@/components/evidence/EvidenceGallery'
import { EvidenceCapture } from '@/components/evidence/EvidenceCapture'
import type { EvidenceDraft } from '@/lib/evidence'
import { cn } from '@/lib/utils'

const paymentMethods: PaymentMethod[] = ['Efectivo', 'Tarjeta', 'Transferencia', 'Mixto']

const powerLabels: Record<PowerState, string> = {
  enciende: 'Enciende',
  no_enciende: 'No enciende',
  enciende_se_apaga: 'Enciende y se apaga',
  sin_prueba: 'Sin prueba inicial'
}

const lockLabels: Record<LockType, string> = {
  sin_bloqueo: 'Sin bloqueo',
  patron: 'Patrón',
  pin: 'PIN',
  contrasena: 'Contraseña',
  cuenta: 'Cuenta del equipo',
  otro: 'Otro'
}

const conditionLabels: Record<string, string> = {
  screenDamage: 'Rayones o fisuras en pantalla',
  caseDamage: 'Golpes en la carcasa',
  hingeDamage: 'Bisagras con juego',
  missingScrews: 'Tornillos faltantes',
  liquidDamage: 'Humedad o derrame',
  previousRepair: 'Reparación previa'
}

const timelineTone = {
  done: 'border-success-200 bg-success-500 text-white',
  current: 'border-brand-200 bg-brand-500 text-white',
  pending: 'border-slate-200 bg-white text-slate-300'
}

const paymentIcon = (method: PaymentMethod) =>
  method === 'Efectivo' ? Banknote : method === 'Tarjeta' ? CreditCard : method === 'Transferencia' ? Landmark : Wallet

function parseMoney(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

export function OrderDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useAuth()

  const { data, loading, error, reload, setData } = useApi(async () => {
    const order = await api.orders.get(id)
    const [detail, legal, products] = await Promise.all([
      api.customers.detail(order.customerId).catch(() => null),
      api.legal.get().catch((): LegalConfig => defaultLegalConfig),
      api.inventory.list().catch((): Product[] => [])
    ])
    return { order, customer: detail?.customer ?? null, legal, products }
  }, [id])

  const order = data?.order ?? null
  const customer = data?.customer ?? null
  const legal = data?.legal ?? defaultLegalConfig
  const products = data?.products ?? []

  const [diagnosis, setDiagnosis] = useState('')
  const [editingDiagnosis, setEditingDiagnosis] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [itemModal, setItemModal] = useState(false)
  const [invoiceModal, setInvoiceModal] = useState(false)
  const [paymentModal, setPaymentModal] = useState(false)
  const [cancelModal, setCancelModal] = useState(false)
  const [documentOpen, setDocumentOpen] = useState(false)
  const [evidenceModal, setEvidenceModal] = useState(false)
  const [techModal, setTechModal] = useState(false)
  const [techOptions, setTechOptions] = useState<TechnicianOption[]>([])
  const [techId, setTechId] = useState('')
  const [techReason, setTechReason] = useState('')
  const [techSaving, setTechSaving] = useState(false)
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidenceDraft[]>([])
  const [savingEvidence, setSavingEvidence] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Efectivo')
  const [received, setReceived] = useState('')
  const [noCharge, setNoCharge] = useState(false)
  const [exceptionReason, setExceptionReason] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [settleDiscountType, setSettleDiscountType] = useState<'percent' | 'amount'>('percent')
  const [settleDiscountInput, setSettleDiscountInput] = useState('')
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>('Efectivo')
  const [saving, setSaving] = useState(false)
  const [settling, setSettling] = useState(false)
  const [depositing, setDepositing] = useState(false)
  const [newItem, setNewItem] = useState<{
    type: 'servicio' | 'repuesto'
    description: string
    quantity: string
    unitPrice: string
    productId: string
  }>({
    type: 'servicio',
    description: '',
    quantity: '1',
    unitPrice: '',
    productId: ''
  })

  useEffect(() => {
    setDiagnosis(order?.diagnosis ?? '')
  }, [order?.id, order?.diagnosis])

  const status = order?.status ?? 'recibido'
  const items = order?.items ?? []
  const payments = order?.payments ?? []
  const intake = order?.intake
  const config = workOrderStatusConfig[status]
  const labor = items.filter((item) => item.type === 'servicio').reduce((sum, item) => sum + lineTotal(item.quantity, item.unitPrice), 0)
  const parts = items.filter((item) => item.type === 'repuesto').reduce((sum, item) => sum + lineTotal(item.quantity, item.unitPrice), 0)
  const total = order?.total ?? labor + parts
  const paid = order?.paidAmount ?? payments.reduce((sum, payment) => sum + payment.amount, 0)
  const balance = order?.balance ?? Math.max(total - paid, 0)
  const loyaltyActive = Boolean(
    customer?.loyaltyActive &&
      (!customer.loyaltyValidUntil || new Date(`${customer.loyaltyValidUntil}T23:59:59`).getTime() >= Date.now()) &&
      Number(customer.loyaltyDiscountValue ?? 0) > 0
  )
  const loyaltyType = customer?.loyaltyDiscountType === 'amount' ? 'amount' : 'percent'
  const loyaltyValue = Number(customer?.loyaltyDiscountValue ?? 0)
  const settleDiscountValue = loyaltyActive
    ? loyaltyType === 'percent'
      ? Math.round((total * loyaltyValue) / 100)
      : Math.min(loyaltyValue, total)
    : settleDiscountType === 'percent'
      ? Math.round((total * (Number(settleDiscountInput) || 0)) / 100)
      : Math.min(Number(settleDiscountInput) || 0, total)
  const settleTotal = Math.max(total - settleDiscountValue, 0)
  const settleBalance = Math.max(settleTotal - paid, 0)
  const canManualDiscount = can(role, 'applyDiscount')
  const next = nextWorkOrderStatus(status)
  const canAdvance = Boolean(next) && (next === 'entregado' ? can(role, 'settleOrder') : can(role, 'diagnoseOrder'))
  const canAddItem = can(role, 'diagnoseOrder') || can(role, 'createOrder')
  const canBill = status === 'listo' && can(role, 'settleOrder')
  const canDeposit = can(role, 'settleOrder') && !['entregado', 'no_reparado'].includes(status) && total > 0 && balance > 0
  const canAuthorizeNoCharge = can(role, 'authorizeNoCharge')
  const canReassignTechnician =
    can(role, 'assignTechnician') && !['entregado', 'no_reparado'].includes(status)
  const activeConditions = intake
    ? Object.entries(intake.conditions)
        .filter(([, active]) => active)
        .map(([key]) => conditionLabels[key] ?? key)
    : []
  const technicalEntries = intake?.technicalSheet ? technicalSheetEntries(intake.technicalSheet) : []
  const sortedTimeline = useMemo(
    () =>
      [...(order?.timeline ?? [])].sort(
        (a, b) => workOrderStatusOrder.indexOf(a.status) - workOrderStatusOrder.indexOf(b.status)
      ),
    [order?.timeline]
  )
  const repuestoProducts = useMemo(() => products.filter((product) => !product.service), [products])
  const receivedValue = parseMoney(received)
  const change = paymentMethod === 'Efectivo' && !noCharge ? Math.max(receivedValue - balance, 0) : 0

  function applyOrder(updated: typeof order) {
    if (!updated) return
    setData((current) => (current ? { ...current, order: updated } : current))
  }

  async function openTechModal() {
    if (!order) return
    try {
      const options = await api.orders.technicians()
      setTechOptions(options)
      setTechId(options.find((item) => item.id !== order.technicianId)?.id ?? '')
      setTechReason('')
      setTechModal(true)
    } catch (failure) {
      toast.error('No se pudieron cargar los técnicos', { description: errorMessage(failure) })
    }
  }

  async function reassignTechnician() {
    if (!order || techSaving) return
    if (!techId) {
      toast.error('Selecciona el técnico que recibirá la OT')
      return
    }
    if (techReason.trim().length < 3) {
      toast.error('Escribe el motivo de la reasignación')
      return
    }
    setTechSaving(true)
    try {
      const updated = await api.orders.reassignTechnician(order.id, techId, techReason.trim())
      applyOrder(updated)
      setTechModal(false)
      toast.success('Técnico reasignado', {
        description: `${order.number} quedó asignada a ${updated.technician}.`
      })
    } catch (failure) {
      toast.error('No se pudo reasignar la OT', { description: errorMessage(failure) })
    } finally {
      setTechSaving(false)
    }
  }

  function openSettlement() {
    setNoCharge(false)
    setExceptionReason('')
    setPaymentMethod('Efectivo')
    setSettleDiscountType('percent')
    setSettleDiscountInput('')
    setReceived(String(settleBalance))
    setInvoiceModal(true)
  }

  async function advanceStatus() {
    if (!order || !next || saving) return
    if (next === 'entregado') {
      openSettlement()
      return
    }
    setSaving(true)
    try {
      const updated = await api.orders.transition(order.id, next, { diagnosis })
      applyOrder(updated)
      toast.success(`OT actualizada: ${workOrderStatusConfig[next].label}`, {
        description: 'El cliente puede recibir la notificación por WhatsApp.'
      })
    } catch (failure) {
      toast.error('No se pudo actualizar la OT', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  async function saveDiagnosis() {
    if (!order || saving) return
    setSaving(true)
    try {
      const updated = await api.orders.update(order.id, { diagnosis })
      applyOrder(updated)
      setEditingDiagnosis(false)
      toast.success('Diagnóstico actualizado')
    } catch (failure) {
      toast.error('No se pudo guardar el diagnóstico', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  async function addItem() {
    if (!order || saving) return
    if (!newItem.description.trim() || parseMoney(newItem.unitPrice) <= 0) {
      toast.error('Completa la descripción y el precio')
      return
    }
    setSaving(true)
    try {
      const quantity = Number(newItem.quantity) || 1
      const updated = await api.orders.addItem(order.id, {
        type: newItem.type,
        description: newItem.description.trim(),
        quantity,
        unitPrice: parseMoney(newItem.unitPrice),
        productId: newItem.productId || null
      })
      applyOrder(updated)
      setNewItem({ type: 'servicio', description: '', quantity: '1', unitPrice: '', productId: '' })
      setItemModal(false)
      toast.success('Ítem agregado a la OT')
      reload()
    } catch (failure) {
      toast.error('No se pudo agregar el ítem', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  async function addDeposit() {
    if (!order || depositing) return
    const amount = parseMoney(paymentAmount)
    if (amount <= 0) {
      toast.error('Ingresa un valor de anticipo válido')
      return
    }
    if (amount > balance) {
      toast.error('El anticipo supera el saldo pendiente', {
        description: `Saldo actual: ${formatCurrency(balance)}`
      })
      return
    }
    setDepositing(true)
    try {
      const updated = await api.orders.addPayment(order.id, {
        amount,
        method: depositMethod,
        reference: paymentReference.trim() || undefined
      })
      applyOrder(updated)
      setPaymentAmount('')
      setPaymentReference('')
      setPaymentModal(false)
      toast.success('Anticipo registrado', {
        description: `${formatCurrency(amount)} · ${depositMethod}. El saldo se actualizó en la OT.`
      })
    } catch (failure) {
      toast.error('No se pudo registrar el anticipo', { description: errorMessage(failure) })
    } finally {
      setDepositing(false)
    }
  }

  async function saveRepairEvidence() {
    if (!order || savingEvidence) return
    if (!evidenceDrafts.length) {
      toast.error('Agrega al menos una fotografía')
      return
    }
    setSavingEvidence(true)
    try {
      const updated = await api.evidence.add(
        order.id,
        evidenceDrafts.map((item) => ({
          dataUrl: item.dataUrl,
          thumbnailDataUrl: item.thumbnailDataUrl,
          category: item.category,
          note: item.note,
          source: item.source,
          width: item.width,
          height: item.height
        })),
        'reparacion'
      )
      applyOrder(updated)
      setEvidenceModal(false)
      setEvidenceDrafts([])
      toast.success('Evidencias de reparación guardadas', {
        description: `${evidenceDrafts.length} foto${evidenceDrafts.length === 1 ? '' : 's'} agregada${evidenceDrafts.length === 1 ? '' : 's'} al expediente digital de la OT.`
      })
    } catch (failure) {
      toast.error('No se pudieron guardar las evidencias', { description: errorMessage(failure) })
    } finally {
      setSavingEvidence(false)
    }
  }

  async function confirmInvoice() {
    if (!order || settling) return
    if (!noCharge && settleBalance <= 0) {
      toast.error('No hay saldo pendiente por cobrar')
      return
    }
    if (!noCharge && settleTotal <= 0) {
      toast.error('No hay valores por cobrar', {
        description: 'Agrega mano de obra o repuestos, registra un presupuesto, o autoriza la entrega sin cobro.'
      })
      return
    }
    if (noCharge && !canAuthorizeNoCharge) {
      toast.error('Solo el propietario o un administrador pueden autorizar una entrega sin cobro')
      return
    }
    if (noCharge && exceptionReason.trim().length < 5) {
      toast.error('La entrega sin cobro requiere un motivo autorizado')
      return
    }
    if (!noCharge && paymentMethod === 'Efectivo' && receivedValue < settleBalance) {
      toast.error('El efectivo recibido es menor al saldo por cobrar')
      return
    }
    setSettling(true)
    try {
      const updated = await api.orders.settle({
        id: order.id,
        method: noCharge ? undefined : paymentMethod,
        received: noCharge || paymentMethod !== 'Efectivo' ? undefined : receivedValue,
        noCharge,
        exceptionReason: noCharge ? exceptionReason.trim() : undefined,
        discountType: noCharge ? undefined : loyaltyActive ? loyaltyType : settleDiscountType,
        discountValue: noCharge ? 0 : loyaltyActive ? loyaltyValue : Number(settleDiscountInput) || 0
      })
      applyOrder(updated)
      setInvoiceModal(false)
      setNoCharge(false)
      setExceptionReason('')
      if (noCharge) {
        toast.success('Equipo entregado sin cobro', {
          description: 'La excepción quedó registrada en la bitácora y en la auditoría.'
        })
      } else {
        toast.success('Factura interna generada', {
          description: `${updated.invoiceNumber ?? 'Factura'} · ${formatCurrency(balance)} · ${paymentMethod}`
        })
      }
    } catch (failure) {
      toast.error('No se pudo cerrar la OT', { description: errorMessage(failure) })
    } finally {
      setSettling(false)
    }
  }

  async function confirmCancel() {
    if (!order || saving) return
    if (cancelReason.trim().length < 3) {
      toast.error('Escribe el motivo del cierre')
      return
    }
    setSaving(true)
    try {
      const updated = await api.orders.transition(order.id, 'no_reparado', { reason: cancelReason.trim() })
      applyOrder(updated)
      setCancelModal(false)
      setCancelReason('')
      toast.success('OT cerrada como no reparada', {
        description: 'El motivo quedó registrado en el historial y la auditoría.'
      })
    } catch (failure) {
      toast.error('No se pudo cerrar la OT', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  function openWhatsApp() {
    if (!order) return
    if (!customer?.phone || customer.phone === '—') {
      toast.error('El cliente no tiene teléfono registrado')
      return
    }
    const text = `Hola ${customer.name}, te escribimos de BitacoreTech por tu orden ${order.number} (${order.brand} ${order.model}). Estado: ${workOrderStatusConfig[status].label}.`
    window.open(`https://wa.me/57${customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank')
  }

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando orden de trabajo…
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="card max-w-md p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <Wrench className="h-6 w-6" />
          </span>
          <h1 className="mt-4 font-display text-xl font-bold text-ink">Orden no disponible</h1>
          <p className="mt-2 text-sm text-slate-500">
            {error ?? 'La OT que buscas no existe o fue eliminada.'}
          </p>
          <Button className="mt-5" onClick={() => navigate('/ordenes')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
            Volver a órdenes
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/ordenes"
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-[11px] font-semibold text-slate-500 transition hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Órdenes de trabajo
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" leftIcon={<Printer className="h-3.5 w-3.5" />} onClick={() => setDocumentOpen(true)}>
            Imprimir
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<MessageCircle className="h-3.5 w-3.5" />} onClick={openWhatsApp}>
            WhatsApp
          </Button>
          {canBill ? (
            <Button size="sm" onClick={openSettlement} leftIcon={<FileText className="h-3.5 w-3.5" />}>
              Facturar y entregar
            </Button>
          ) : canAdvance && next ? (
            <Button size="sm" onClick={() => void advanceStatus()} loading={saving} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
              Pasar a {workOrderStatusConfig[next].shortLabel}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500/15 to-brand-500/5 text-brand-600">
              <Wrench className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl font-bold tracking-tight text-ink">
                  {order.brand} {order.model}
                </h1>
                <WorkOrderStatusBadge status={status} />
              </div>
              <p className="mt-1 text-[12px] text-slate-500">
                {order.number} · {order.equipmentType} · {order.customerName}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> Ingreso {formatDate(order.createdAt)}
                </span>
                <span className="flex items-center gap-1">
                  <UserRound className="h-3 w-3" /> {order.technician}
                  {canReassignTechnician ? (
                    <button
                      type="button"
                      onClick={() => void openTechModal()}
                      className="focus-ring ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold text-brand-600 transition hover:bg-brand-50"
                    >
                      <RefreshCw className="h-2.5 w-2.5" /> Reasignar
                    </button>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  <Package className="h-3 w-3" /> Serial {order.serial}
                </span>
                <span
                  className={cn(
                    'flex items-center gap-1',
                    (order.evidenceCount ?? 0) > 0 ? 'text-slate-500' : 'text-warning-600'
                  )}
                >
                  <Camera className="h-3 w-3" />
                  {order.evidenceCount ?? 0} evidencia{(order.evidenceCount ?? 0) === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-slate-50/70 px-4 py-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Total de la OT</p>
              <p className="tabular font-display text-xl font-bold text-ink">{formatCurrency(total)}</p>
            </div>
            <span className="h-8 w-px bg-line" />
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Saldo</p>
              <p className="tabular font-display text-xl font-bold text-ink">{formatCurrency(balance)}</p>
            </div>
            <span className="h-8 w-px bg-line" />
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Promesa</p>
              <p className="mt-0.5 text-[11px] font-semibold text-ink">{formatDate(order.promisedAt)}</p>
            </div>
          </div>
        </div>
        <div className="h-1 w-full bg-slate-100">
          <div
            className="h-full rounded-r-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500"
            style={{
              width: `${status === 'no_reparado' ? 100 : ((workOrderStatusOrder.indexOf(status) + 1) / workOrderStatusOrder.length) * 100}%`
            }}
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(330px,1fr)]">
        <div className="space-y-4">
          <div className="card p-5 lg:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[16px] font-bold text-ink">Equipo y recepción</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">Datos registrados al momento del ingreso</p>
              </div>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                <ClipboardList className="h-4 w-4" />
              </span>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {[
                ['Tipo de equipo', order.equipmentType],
                ['Marca / modelo', `${order.brand} ${order.model}`],
                ['Serial', order.serial],
                ['Técnico receptor', intake?.receivedBy ?? order.technician],
                ['Accesorios', order.accessories],
                ['Condición física', order.physicalCondition],
                ['Estado de encendido', intake ? powerLabels[intake.powerState] : 'No registrado'],
                [
                  'Bloqueo de seguridad',
                  intake
                    ? intake.lockType === 'sin_bloqueo'
                      ? 'Sin bloqueo'
                      : `${lockLabels[intake.lockType]} · ${
                          intake.customerWithheldCredentials
                            ? 'el cliente no suministra credenciales'
                            : intake.customerAuthorizesAccess
                              ? 'acceso autorizado'
                              : 'acceso no confirmado'
                        }`
                    : 'No registrado'
                ],
                ['Presupuesto estimado', intake?.estimate ? formatCurrency(intake.estimate) : 'No definido'],
                ['Términos legales', intake ? `Aceptados · abandono ${intake.legal.abandonmentDays} días` : 'No registrado']
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</dt>
                  <dd className="mt-1 text-[12px] text-slate-600">{value}</dd>
                </div>
              ))}
            </dl>

            {activeConditions.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {activeConditions.map((condition) => (
                  <span key={condition} className="inline-flex items-center gap-1 rounded-full border border-warning-200 bg-warning-50 px-2.5 py-1 text-[9px] font-semibold text-warning-800">
                    <ShieldAlert className="h-2.5 w-2.5" />
                    {condition}
                  </span>
                ))}
              </div>
            ) : null}

            {intake ? (
              <div className="mt-4 flex flex-col gap-2 rounded-xl border border-brand-100 bg-brand-50/50 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <div>
                    <p className="text-[10px] font-semibold text-brand-900">
                      Términos aceptados
                    </p>
                    <p className="mt-0.5 text-[9px] leading-relaxed text-brand-700/75">
                      Snapshot inmutable del {formatDateTime(intake.legal.acceptedAt)} · garantía {intake.legal.warrantyDays} días · abandono {intake.legal.abandonmentDays} días.
                    </p>
                  </div>
                </div>
                <Badge variant="brand">
                  <LockKeyhole className="h-3 w-3" /> Snapshot legal
                </Badge>
              </div>
            ) : null}

            {technicalEntries.length ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-line">
                <button
                  type="button"
                  onClick={() => setSheetOpen((value) => !value)}
                  className="focus-ring flex w-full items-center justify-between gap-2 bg-slate-50/70 px-3.5 py-2.5 text-left"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Ficha técnica avanzada</span>
                  {sheetOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                </button>
                {sheetOpen ? (
                  <div className="grid gap-2 px-3.5 py-3 sm:grid-cols-2 lg:grid-cols-3">
                    {technicalEntries.map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
                        <p className="mt-0.5 text-[10px] text-slate-600">{value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="card p-5 lg:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[16px] font-bold text-ink">Trazabilidad de técnico</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">Asignación actual e historial de cambios.</p>
              </div>
              {canReassignTechnician ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void openTechModal()}
                  leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                >
                  Reasignar
                </Button>
              ) : null}
            </div>
            <div className="mt-4 rounded-xl border border-line bg-slate-50/60 p-3.5">
              <div className="flex items-center gap-3">
                <Avatar name={order.technician} size="sm" />
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Técnico actual</p>
                  <p className="text-[12px] font-semibold text-ink">{order.technician}</p>
                </div>
              </div>
              {(order.assignments?.length ?? 0) ? (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  {order.assignments!.map((assignment) => (
                    <div
                      key={assignment.id}
                      className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between"
                    >
                      <p className="text-[10px] text-slate-600">
                        <span className="font-semibold">{assignment.fromName ?? 'Sin asignar'}</span> →{' '}
                        <span className="font-semibold">{assignment.toName}</span>
                        {assignment.reason ? <span className="text-slate-400"> · {assignment.reason}</span> : null}
                      </p>
                      <p className="text-[9px] text-slate-400">
                        {formatDateTime(assignment.createdAt)} · {assignment.assignedByName}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 border-t border-line pt-3 text-[10px] text-slate-400">
                  Sin historial de asignaciones.
                </p>
              )}
            </div>
          </div>

          <div className="card p-5 lg:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[16px] font-bold text-ink">Diagnóstico técnico</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">Falla reportada, hallazgos y solución propuesta</p>
              </div>
              <div className="flex items-center gap-2">
                {can(role, 'useAI') ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Sparkles className="h-3.5 w-3.5 text-brand-500" />}
                    onClick={() =>
                      toast('Sugerencia de IA', {
                        description: 'Configura un proveedor de IA en Configuración para analizar la falla y el historial del equipo.'
                      })
                    }
                  >
                    Sugerir diagnóstico
                  </Button>
                ) : null}
                {can(role, 'diagnoseOrder') ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Stethoscope className="h-3.5 w-3.5" />}
                    onClick={() => setEditingDiagnosis((value) => !value)}
                  >
                    {editingDiagnosis ? 'Cancelar' : 'Editar'}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-warning-100 bg-warning-50/60 p-3.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-warning-700">Reportado por el cliente</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-slate-700">{order.reportedIssue}</p>
            </div>

            <div className="mt-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Diagnóstico del técnico</p>
              {editingDiagnosis ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={diagnosis}
                    onChange={(event) => setDiagnosis(event.target.value)}
                    rows={4}
                    className="field resize-none"
                    placeholder="Describe el diagnóstico técnico..."
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditingDiagnosis(false)}>
                      Cancelar
                    </Button>
                    <Button size="sm" onClick={() => void saveDiagnosis()} loading={saving}>
                      Guardar diagnóstico
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
                  {diagnosis || 'Aún no hay diagnóstico registrado para este equipo.'}
                </p>
              )}
            </div>

            {order.notes ? (
              <div className="mt-4 rounded-xl border border-line bg-slate-50/70 px-3.5 py-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Nota interna</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{order.notes}</p>
              </div>
            ) : null}
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 lg:px-6">
              <div>
                <h2 className="font-display text-[16px] font-bold text-ink">Mano de obra y repuestos</h2>
                <p className="mt-0.5 text-[11px] text-slate-400">{items.length} ítems registrados en la OT</p>
              </div>
              {canAddItem ? (
                <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setItemModal(true)}>
                  Agregar ítem
                </Button>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead>
                  <tr className="border-b border-line bg-slate-50/60">
                    <th className="table-th pl-5 lg:pl-6">Descripción</th>
                    <th className="table-th">Tipo</th>
                    <th className="table-th text-right">Cant.</th>
                    <th className="table-th text-right">Valor unit.</th>
                    <th className="table-th pr-5 text-right lg:pr-6">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-line/70 last:border-0">
                      <td className="table-td pl-5 text-[12px] font-medium text-ink lg:pl-6">{item.description}</td>
                      <td className="table-td">
                        <Badge variant={item.type === 'servicio' ? 'brand' : 'sky'}>
                          {item.type === 'servicio' ? 'Servicio' : 'Repuesto'}
                        </Badge>
                      </td>
                      <td className="table-td text-right text-[11px] tabular">{item.quantity}</td>
                      <td className="table-td text-right text-[11px] tabular">{formatCurrency(item.unitPrice)}</td>
                      <td className="table-td pr-5 text-right text-[12px] font-semibold tabular text-ink lg:pr-6">
                        {formatCurrency(lineTotal(item.quantity, item.unitPrice))}
                      </td>
                    </tr>
                  ))}
                  {!items.length ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-[11px] text-slate-400">
                        Aún no se han agregado servicios ni repuestos a esta OT.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col items-end gap-1.5 border-t border-line bg-slate-50/50 px-5 py-4 lg:px-6">
              <div className="flex w-full max-w-[300px] items-center justify-between text-[11px] text-slate-500">
                <span>Mano de obra</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(labor)}</span>
              </div>
              <div className="flex w-full max-w-[300px] items-center justify-between text-[11px] text-slate-500">
                <span>Repuestos</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(parts)}</span>
              </div>
              <div className="mt-1 flex w-full max-w-[300px] items-center justify-between border-t border-line pt-2">
                <span className="text-[11px] font-semibold text-slate-600">Total</span>
                <span className="tabular font-display text-[20px] font-bold text-ink">{formatCurrency(total)}</span>
              </div>
              <div className="flex w-full max-w-[300px] items-center justify-between text-[11px] text-slate-500">
                <span>Abonado</span>
                <span className="tabular font-semibold text-success-600">{formatCurrency(paid)}</span>
              </div>
              <div className="flex w-full max-w-[300px] items-center justify-between text-[11px] text-slate-500">
                <span>Saldo pendiente</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(balance)}</span>
              </div>
              <p className="text-[9px] text-slate-400">Precios de venta · sin IVA (régimen interno actual)</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center gap-3">
              <Avatar name={order.customerName} size="md" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-ink">{order.customerName}</p>
                <p className="text-[10px] text-slate-400">
                  {customer?.documentType ?? 'CC'} {customer?.document ?? '—'}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <Phone className="h-3.5 w-3.5 text-slate-400" /> {customer?.phone ?? 'Sin teléfono'}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <Mail className="h-3.5 w-3.5 text-slate-400" /> {customer?.email ?? 'Sin correo'}
              </div>
              <div className="flex items-start gap-2 text-[11px] text-slate-500">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> {customer?.address ?? 'Sin dirección'}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" leftIcon={<MessageCircle className="h-3.5 w-3.5" />} onClick={openWhatsApp}>
                WhatsApp
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate('/clientes')}>
                Ver cliente
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-center">
              <div>
                <p className="tabular text-[15px] font-bold text-ink">{customer?.orders ?? 0}</p>
                <p className="text-[9px] text-slate-400">OTs históricas</p>
              </div>
              <div>
                <p className="tabular text-[15px] font-bold text-ink">{customer?.purchases ?? 0}</p>
                <p className="text-[9px] text-slate-400">compras</p>
              </div>
            </div>
          </div>

          <EvidenceGallery
            order={order}
            onUpdated={applyOrder}
            onAdd={
              can(role, 'manageEvidence')
                ? () => {
                    setEvidenceDrafts([])
                    setEvidenceModal(true)
                  }
                : undefined
            }
          />

          <div className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[15px] font-bold text-ink">Anticipos y pagos</h2>
                <p className="mt-0.5 text-[10px] text-slate-400">Libro de pagos de la OT</p>
              </div>
              {canDeposit ? (
                <Button variant="secondary" size="sm" onClick={() => setPaymentModal(true)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                  Anticipo
                </Button>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-slate-50/60 p-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">Total OT</p>
                <p className="tabular mt-0.5 text-[14px] font-bold text-ink">{formatCurrency(total)}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">Saldo</p>
                <p className="tabular mt-0.5 text-[14px] font-bold text-ink">{formatCurrency(balance)}</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {payments.length ? (
                payments.map((payment) => {
                  const Icon = paymentIcon(payment.method)
                  return (
                    <div key={payment.id} className="rounded-xl border border-line px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div>
                            <p className="text-[11px] font-semibold text-ink">
                              {payment.kind === 'anticipo' ? 'Anticipo' : payment.kind === 'saldo' ? 'Saldo final' : 'Venta'} · {payment.method}
                            </p>
                            <p className="text-[9px] text-slate-400">
                              {payment.number} · {formatDateTime(payment.createdAt)} · {payment.createdByName}
                            </p>
                            {payment.reference ? (
                              <p className="text-[9px] text-slate-400">Ref. {payment.reference}</p>
                            ) : null}
                          </div>
                        </div>
                        <span className="tabular text-[11px] font-bold text-success-600">{formatCurrency(payment.amount)}</span>
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[10px] text-slate-400">
                  Sin pagos registrados. Los anticipos se descuentan del saldo al entregar.
                </p>
              )}
            </div>
          </div>

          {order.settlement || status === 'entregado' ? (
            <div className="card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-[15px] font-bold text-ink">Cierre financiero</h2>
                <Badge variant={order.settlement?.status === 'exento' ? 'warning' : 'success'} dot>
                  {order.settlement?.status === 'exento' ? 'Sin cobro' : 'Pagado'}
                </Badge>
              </div>
              {order.settlement ? (
                <div className="mt-3 space-y-2.5">
                  <div className="rounded-xl border border-line bg-slate-50/60 px-3.5 py-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Monto cobrado</p>
                    <p className="tabular font-display text-xl font-bold text-ink">{formatCurrency(order.settlement.amount)}</p>
                    <p className="mt-1 text-[9px] text-slate-400">
                      {order.settlement.status === 'exento'
                        ? 'Entrega autorizada sin cobro'
                        : `${order.settlement.method ?? '—'} · ${order.settlement.invoiceNumber ?? 'Sin factura'}`}
                    </p>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span>Fecha de entrega</span>
                    <span className="font-semibold text-ink">{formatDateTime(order.deliveredAt ?? order.settlement.paidAt)}</span>
                  </div>
                  {order.settlement.exceptionReason ? (
                    <div className="rounded-xl border border-warning-100 bg-warning-50/70 px-3 py-2.5">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-warning-700">Motivo de la excepción</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-warning-800">{order.settlement.exceptionReason}</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                  Esta OT histórica no tiene el detalle de liquidación. Las entregas nuevas registran monto, método y factura.
                </p>
              )}
            </div>
          ) : null}

          <div className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-[15px] font-bold text-ink">Historial de la OT</h2>
              <Badge variant={config.tone} dot>
                {config.shortLabel}
              </Badge>
            </div>
            <div className="mt-4 space-y-0">
              {sortedTimeline.map((event, index) => {
                const last = index === sortedTimeline.length - 1
                return (
                  <div key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {!last ? <span className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-line" /> : null}
                    <span className={cn('relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2', timelineTone[event.state])}>
                      {event.state === 'done' ? <CheckCircle2 className="h-3 w-3" /> : event.state === 'current' ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />}
                    </span>
                    <div className="min-w-0">
                      <p className={cn('text-[11px] font-semibold', event.state === 'pending' ? 'text-slate-400' : 'text-ink')}>
                        {event.title}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-snug text-slate-400">{event.description}</p>
                      {event.date ? (
                        <p className="mt-1 text-[9px] text-slate-400">
                          {formatDateTime(event.date)} · {event.user}
                        </p>
                      ) : (
                        <p className="mt-1 text-[9px] text-slate-300">Pendiente</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {canCancelWorkOrder(status) && can(role, 'diagnoseOrder') ? (
              <button
                type="button"
                onClick={() => setCancelModal(true)}
                className="focus-ring mt-4 w-full rounded-lg border border-dashed border-line py-2 text-[10px] font-semibold text-slate-400 transition hover:border-danger-200 hover:text-danger-600"
              >
                Cerrar como no reparado
              </button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <div>
                <p className="text-[10px] font-semibold text-brand-900">Trazabilidad activa</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-brand-700/70">
                  Cada cambio de estado, repuesto, anticipo y valor queda registrado en la auditoría del sistema.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={itemModal}
        onClose={() => setItemModal(false)}
        title="Agregar ítem a la OT"
        description="Servicio de mano de obra o repuesto utilizado."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setItemModal(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void addItem()} loading={saving} leftIcon={<Plus className="h-4 w-4" />}>
              Agregar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="field-label">Tipo</span>
            <select
              value={newItem.type}
              onChange={(event) =>
                setNewItem({ ...newItem, type: event.target.value as 'servicio' | 'repuesto', productId: '', description: '', unitPrice: '' })
              }
              className="field"
            >
              <option value="servicio">Servicio / mano de obra</option>
              <option value="repuesto">Repuesto</option>
            </select>
          </label>
          {newItem.type === 'repuesto' && repuestoProducts.length ? (
            <label className="block">
              <span className="field-label">Producto del inventario (opcional)</span>
              <select
                value={newItem.productId}
                onChange={(event) => {
                  const product = repuestoProducts.find((item) => item.id === event.target.value)
                  setNewItem({
                    ...newItem,
                    productId: event.target.value,
                    description: product?.name ?? '',
                    unitPrice: product ? String(product.price) : ''
                  })
                }}
                className="field"
              >
                <option value="">Sin producto asociado</option>
                {repuestoProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · stock {product.stock}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[9px] text-slate-400">
                Al asociar un producto se descuenta del inventario y se registra el costo real.
              </p>
            </label>
          ) : null}
          <label className="block">
            <span className="field-label">Descripción</span>
            <input
              value={newItem.description}
              onChange={(event) => setNewItem({ ...newItem, description: event.target.value })}
              placeholder="Ej. Reparación de placa"
              className="field"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="field-label">Cantidad</span>
              <input
                value={newItem.quantity}
                onChange={(event) => setNewItem({ ...newItem, quantity: event.target.value })}
                inputMode="numeric"
                className="field"
              />
            </label>
            <label className="block">
              <span className="field-label">Valor unitario</span>
              <input
                value={newItem.unitPrice}
                onChange={(event) => setNewItem({ ...newItem, unitPrice: event.target.value })}
                inputMode="numeric"
                placeholder="0"
                className="field text-right tabular"
              />
            </label>
          </div>
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[10px] text-slate-500">
            El precio se registra sin IVA. La utilidad se calcula con el costo del repuesto al momento del consumo.
          </div>
        </div>
      </Modal>

      <Modal
        open={paymentModal}
        onClose={() => setPaymentModal(false)}
        title="Registrar anticipo"
        description={`${order.number} · saldo pendiente ${formatCurrency(balance)}`}
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setPaymentModal(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void addDeposit()} loading={depositing} leftIcon={<Wallet className="h-4 w-4" />}>
              Registrar anticipo
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="field-label">Valor del anticipo</span>
            <input
              value={paymentAmount}
              onChange={(event) => setPaymentAmount(event.target.value)}
              inputMode="numeric"
              placeholder="0"
              className="field text-right tabular"
            />
          </label>
          <div>
            <span className="field-label">Método de pago</span>
            <div className="grid grid-cols-2 gap-2">
              {paymentMethods.map((item) => {
                const Icon = paymentIcon(item)
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setDepositMethod(item)}
                    className={cn(
                      'focus-ring flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-semibold transition',
                      depositMethod === item
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-line bg-white text-slate-500 hover:border-slate-300'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item}
                  </button>
                )
              })}
            </div>
          </div>
          <label className="block">
            <span className="field-label">Referencia (opcional)</span>
            <input
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
              placeholder="Nro. de transferencia, voucher…"
              className="field"
            />
          </label>
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[10px] leading-relaxed text-slate-500">
            El anticipo se registra en caja y queda en el libro de pagos. No modifica el total de la OT: solo reduce el saldo.
          </div>
        </div>
      </Modal>

      <Modal
        open={invoiceModal}
        onClose={() => setInvoiceModal(false)}
        title="Cobro y entrega"
        description={`${order.number} · ${order.customerName} · sin IVA`}
        size="md"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <span className="text-[9px] leading-relaxed text-slate-400">
              La entrega cierra la OT y queda en la auditoría.
            </span>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => setInvoiceModal(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => void confirmInvoice()}
                loading={settling}
                disabled={(!noCharge && settleBalance <= 0) || (noCharge && !canAuthorizeNoCharge)}
                leftIcon={<CheckCircle2 className="h-4 w-4" />}
                variant={noCharge ? 'danger' : 'primary'}
              >
                {noCharge ? 'Entregar sin cobro' : 'Cobrar y entregar'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-slate-50/60 p-4">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Mano de obra</span>
              <span className="tabular font-semibold text-ink">{formatCurrency(labor)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>Repuestos</span>
              <span className="tabular font-semibold text-ink">{formatCurrency(parts)}</span>
            </div>
            {total <= 0 && intake?.estimate ? (
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                <span>Presupuesto de ingreso</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(intake.estimate)}</span>
              </div>
            ) : null}
            <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5">
              <span className="text-[11px] text-slate-500">Total de la OT</span>
              <span className="tabular text-[12px] font-semibold text-ink">{formatCurrency(total)}</span>
            </div>

            {!noCharge ? (
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Tag className="h-3 w-3" /> Descuento
                </span>
                {loyaltyActive ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="warning">
                      Fidelidad {loyaltyType === 'percent' ? `${loyaltyValue}%` : formatCurrency(loyaltyValue)}
                    </Badge>
                    <span className="tabular font-semibold text-ink">-{formatCurrency(settleDiscountValue)}</span>
                  </div>
                ) : canManualDiscount ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-line bg-white">
                      <button
                        type="button"
                        onClick={() => setSettleDiscountType('percent')}
                        className={cn(
                          'focus-ring h-7 px-2 text-[10px] font-semibold transition first:rounded-l-lg',
                          settleDiscountType === 'percent' ? 'bg-brand-50 text-brand-700' : 'text-slate-400'
                        )}
                      >
                        %
                      </button>
                      <button
                        type="button"
                        onClick={() => setSettleDiscountType('amount')}
                        className={cn(
                          'focus-ring h-7 px-2 text-[10px] font-semibold transition last:rounded-r-lg',
                          settleDiscountType === 'amount' ? 'bg-brand-50 text-brand-700' : 'text-slate-400'
                        )}
                      >
                        $
                      </button>
                    </div>
                    <input
                      value={settleDiscountInput}
                      onChange={(event) => setSettleDiscountInput(event.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      className="field h-7 w-20 text-right text-[10px] tabular"
                    />
                    <span className="tabular w-16 text-right font-semibold text-ink">-{formatCurrency(settleDiscountValue)}</span>
                  </div>
                ) : (
                  <span className="text-[10px] text-slate-400">Sin permiso</span>
                )}
              </div>
            ) : null}

            {settleDiscountValue > 0 ? (
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>Total con descuento</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(settleTotal)}</span>
              </div>
            ) : null}

            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>Anticipos aplicados</span>
              <span className="tabular font-semibold text-success-600">- {formatCurrency(paid)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2.5">
              <span className="text-[12px] font-semibold text-slate-600">Saldo a cobrar</span>
              <span className="tabular font-display text-2xl font-bold text-ink">{formatCurrency(noCharge ? 0 : settleBalance)}</span>
            </div>
          </div>

          {!noCharge ? (
            <div>
              <span className="field-label">Método de pago</span>
              <div className="grid grid-cols-2 gap-2">
                {paymentMethods.map((item) => {
                  const Icon = paymentIcon(item)
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setPaymentMethod(item)
                        if (item !== 'Efectivo') setReceived('')
                        else setReceived(String(settleBalance))
                      }}
                      className={cn(
                        'focus-ring flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-semibold transition',
                        paymentMethod === item
                          ? 'border-brand-300 bg-brand-50 text-brand-700'
                          : 'border-line bg-white text-slate-500 hover:border-slate-300'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {!noCharge && paymentMethod === 'Efectivo' ? (
            <div className="rounded-xl border border-line bg-white p-3.5">
              <label className="block">
                <span className="field-label">Efectivo recibido</span>
                <input
                  value={received}
                  onChange={(event) => setReceived(event.target.value)}
                  inputMode="numeric"
                  className="field text-right tabular"
                />
              </label>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>Cambio</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(change)}</span>
              </div>
            </div>
          ) : null}

          <div className={cn('rounded-xl border p-3.5', noCharge ? 'border-danger-200 bg-danger-50/60' : 'border-line bg-white')}>
            <label className={cn('flex items-start gap-2', canAuthorizeNoCharge ? 'cursor-pointer' : 'cursor-not-allowed opacity-70')}>
              <input
                type="checkbox"
                checked={noCharge}
                disabled={!canAuthorizeNoCharge}
                onChange={(event) => setNoCharge(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-danger-600 focus:ring-danger-200"
              />
              <span>
                <span className="block text-[11px] font-semibold text-ink">Entregar sin cobro</span>
                <span className="mt-0.5 block text-[9.5px] leading-relaxed text-slate-500">
                  Excepción autorizada y auditada. Solo el propietario o un administrador pueden usarla. No aplica si ya hay anticipos.
                </span>
              </span>
            </label>
            {noCharge ? (
              <label className="mt-3 block">
                <span className="field-label">Motivo de la excepción *</span>
                <textarea
                  value={exceptionReason}
                  onChange={(event) => setExceptionReason(event.target.value)}
                  rows={2}
                  placeholder="Ej. garantía por reparación anterior, autorizado por el propietario..."
                  className="field resize-none bg-white"
                />
              </label>
            ) : null}
          </div>

          <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-brand-800">
            {noCharge
              ? 'La OT quedará Entregada como excepción sin cobro. El motivo y el usuario se guardan en la bitácora y la auditoría.'
              : 'Se generará la factura interna, se registrará el pago restante en caja y la OT pasará a Entregado. El cobro se registra ahora, no al recibir el equipo.'}
          </div>
        </div>
      </Modal>

      <Modal
        open={cancelModal}
        onClose={() => setCancelModal(false)}
        title="Cerrar OT como no reparada"
        description={`${order.number} · ${order.customerName}`}
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setCancelModal(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmCancel()} loading={saving} variant="danger">
              Cerrar OT
            </Button>
          </div>
        }
      >
        <label className="block">
          <span className="field-label">Motivo del cierre *</span>
          <textarea
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            rows={3}
            placeholder="Ej. el cliente no aprueba el presupuesto, equipo sin reparación posible…"
            className="field resize-none"
          />
        </label>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          La OT se cerrará sin cobro de reparación. Si hay anticipos registrados, gestiónalos antes de continuar.
        </p>
      </Modal>

      <Modal
        open={evidenceModal}
        onClose={() => {
          if (savingEvidence) return
          setEvidenceModal(false)
          setEvidenceDrafts([])
        }}
        title="Agregar evidencias de reparación"
        description={`${order.number} · ${order.brand} ${order.model} · quedan vinculadas al expediente digital`}
        size="lg"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <span className="text-[9px] leading-relaxed text-slate-400">
              Las fotos no se imprimen ni se anexan al A4.
            </span>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="secondary"
                disabled={savingEvidence}
                onClick={() => {
                  setEvidenceModal(false)
                  setEvidenceDrafts([])
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => void saveRepairEvidence()}
                loading={savingEvidence}
                disabled={!evidenceDrafts.length}
                leftIcon={<ShieldCheck className="h-4 w-4" />}
              >
                Guardar {evidenceDrafts.length || ''} evidencia{evidenceDrafts.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        }
      >
        <EvidenceCapture
          items={evidenceDrafts}
          onChange={setEvidenceDrafts}
          stage="reparacion"
          disabled={savingEvidence}
          bare
          description="Documenta el estado después de la reparación o detalles adicionales que sustenten el trabajo realizado. Puedes cargar archivos aunque el equipo no tenga cámara."
        />
      </Modal>

      <Modal
        open={techModal}
        onClose={() => setTechModal(false)}
        title="Reasignar técnico"
        description={order ? `${order.number} · ${order.brand} ${order.model}` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTechModal(false)} disabled={techSaving}>
              Cancelar
            </Button>
            <Button onClick={() => void reassignTechnician()} loading={techSaving} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Reasignar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="field-label">Nuevo técnico</span>
            <select value={techId} onChange={(event) => setTechId(event.target.value)} className="field">
              <option value="">Selecciona un técnico</option>
              {techOptions.map((technician) => (
                <option key={technician.id} value={technician.id} disabled={technician.id === order?.technicianId}>
                  {technician.name}
                  {technician.id === order?.technicianId ? ' (actual)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Motivo de la reasignación</span>
            <textarea
              value={techReason}
              onChange={(event) => setTechReason(event.target.value)}
              rows={3}
              className="field resize-none"
              placeholder="Ej. el técnico anterior quedó sin disponibilidad, el cliente pidió otro especialista…"
            />
          </label>
          <div className="rounded-xl border border-warning-100 bg-warning-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-warning-800">
            La asignación anterior y el motivo quedan en la auditoría y en la trazabilidad de la OT. No se permite reasignar una OT entregada o cerrada.
          </div>
        </div>
      </Modal>

      <DocumentPreviewModal
        order={order}
        customer={customer}
        legal={legal}
        open={documentOpen}
        onClose={() => setDocumentOpen(false)}
        initialFormat="80mm"
      />
    </div>
  )
}
