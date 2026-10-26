import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  FileText,
  Gamepad2,
  Laptop,
  LockKeyhole,
  Monitor,
  Package,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Smartphone,
  UserPlus,
  UserRound,
  Wrench,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  Customer,
  DeviceCategory,
  Equipment,
  IntakeConditionKey,
  LegalConfig,
  LockType,
  PowerState,
  TechnicalSheet,
  TechnicianOption,
  WorkOrder,
  WorkOrderIntake
} from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { workOrderStatusConfig } from '@/lib/status'
import { formatCurrency, formatDate } from '@/lib/format'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { defaultLegalConfig, resolveLegalClause } from '@/lib/legalConfig'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EvidenceCapture } from '@/components/evidence/EvidenceCapture'
import type { EvidenceDraft } from '@/lib/evidence'
import { SearchInput, Select } from '@/components/ui/Input'
import { DocumentPreviewModal } from '@/components/orders/DocumentPreview'
import { cn } from '@/lib/utils'

const deviceOptions: Array<{
  value: DeviceCategory
  label: string
  equipmentType: string
  hint: string
  icon: typeof Laptop
}> = [
  { value: 'laptop', label: 'Laptop', equipmentType: 'Laptop', hint: 'Portátil o MacBook', icon: Laptop },
  { value: 'pc_torre', label: 'PC Torre', equipmentType: 'PC de escritorio', hint: 'Escritorio o servidor', icon: Monitor },
  { value: 'celular', label: 'Celular', equipmentType: 'Celular', hint: 'Smartphone o tablet', icon: Smartphone },
  { value: 'consola', label: 'Consola', equipmentType: 'Consola', hint: 'PlayStation, Xbox, Switch', icon: Gamepad2 },
  { value: 'impresora', label: 'Impresora', equipmentType: 'Impresora', hint: 'Láser, tinta o térmica', icon: Printer },
  { value: 'otro', label: 'Otro', equipmentType: 'Otro', hint: 'Equipo especial', icon: Package }
]

const accessoryOptions: Record<DeviceCategory, string[]> = {
  laptop: ['Cargador', 'Funda o bolso', 'Mouse', 'Base refrigerante', 'Adaptador USB-C', 'Memoria externa'],
  pc_torre: ['Cable de poder', 'Teclado', 'Mouse', 'Monitor', 'Disco externo', 'Adaptador Wi-Fi'],
  celular: ['Cargador', 'Cable USB', 'Funda', 'SIM card', 'Memoria externa', 'Audífonos'],
  consola: ['Control', 'Cable HDMI', 'Cable de poder', 'Juego físico', 'Base de carga'],
  impresora: ['Cable de poder', 'Cable USB', 'Tóner o tinta', 'Bandeja de papel', 'Cable de red'],
  otro: ['Cable de poder', 'Cable de datos', 'Control remoto', 'Funda o estuche']
}

const baseConditions: Array<{ key: IntakeConditionKey; label: string }> = [
  { key: 'screenDamage', label: 'Rayones o fisuras en pantalla' },
  { key: 'caseDamage', label: 'Golpes en la carcasa' },
  { key: 'hingeDamage', label: 'Bisagras con juego' },
  { key: 'missingScrews', label: 'Tornillos faltantes' },
  { key: 'liquidDamage', label: 'Humedad o derrame' },
  { key: 'previousRepair', label: 'Reparación previa' }
]

const powerOptions: Array<{ value: PowerState; label: string; hint: string }> = [
  { value: 'enciende', label: 'Enciende', hint: 'Arranca con normalidad' },
  { value: 'no_enciende', label: 'No enciende', hint: 'Sin respuesta al encender' },
  { value: 'enciende_se_apaga', label: 'Enciende y se apaga', hint: 'Se corta solo' },
  { value: 'sin_prueba', label: 'Sin prueba', hint: 'No se probó en recepción' }
]

const lockOptions: Array<{ value: LockType; label: string }> = [
  { value: 'sin_bloqueo', label: 'Sin bloqueo' },
  { value: 'patron', label: 'Patrón' },
  { value: 'pin', label: 'PIN' },
  { value: 'contrasena', label: 'Contraseña' },
  { value: 'cuenta', label: 'Cuenta del equipo' },
  { value: 'otro', label: 'Otro' }
]

const screenConditions = ['Sin rayones', 'Rayones leves', 'Fisura visible', 'Pantalla quebrada', 'No aplica']

const emptyCustomerForm = {
  documentType: 'CC' as Customer['documentType'],
  document: '',
  name: '',
  phone: '',
  email: '',
  address: ''
}

const emptyTechnicalSheet: TechnicalSheet = {
  os: '',
  cpu: '',
  gpu: '',
  ram: '',
  storage: '',
  battery: ''
}

function defaultPromiseDate() {
  const date = new Date()
  date.setDate(date.getDate() + 3)
  return date.toISOString().slice(0, 10)
}

function parseMoney(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

export function NewOrderPage() {
  const navigate = useNavigate()
  const { role, displayUser } = useAuth()
  const canCreate = can(role, 'createOrder')
  const { data: bootstrap, loading: bootLoading, error: bootError } = useApi(
    async () => {
      const [customers, legal, technicians] = await Promise.all([
        api.customers.list(),
        api.legal.get(),
        api.orders.technicians()
      ])
      return { customers, legal, technicians }
    },
    []
  )

  const [customerList, setCustomerList] = useState<Customer[]>([])
  const [legalConfig, setLegalConfig] = useState<LegalConfig>(defaultLegalConfig)
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([])
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([])
  const [equipmentId, setEquipmentId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerDropdown, setCustomerDropdown] = useState(false)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm)
  const [customerSaving, setCustomerSaving] = useState(false)

  useEffect(() => {
    if (!bootstrap) return
    setCustomerList(bootstrap.customers)
    setLegalConfig(bootstrap.legal)
    setTechnicians(bootstrap.technicians)
    setTechnicianId((current) => current || bootstrap.technicians[0]?.id || '')
  }, [bootstrap])

  useEffect(() => {
    let active = true
    if (!customerId) {
      setEquipmentList([])
      setEquipmentId('')
      return
    }
    api.equipment
      .list(customerId)
      .then((list) => {
        if (!active) return
        setEquipmentList(list)
        setEquipmentId(list[0]?.id ?? '')
        if (list[0]) applyEquipment(list[0])
      })
      .catch(() => {
        if (active) setEquipmentList([])
      })
    return () => {
      active = false
    }
  }, [customerId])

  function applyEquipment(equipment: Equipment) {
    setCategory((equipment.category as DeviceCategory) || 'otro')
    setBrand(equipment.brand)
    setModel(equipment.model)
    setSerial(equipment.serial)
    setSerialUnknown(equipment.serial === 'Sin serial' || equipment.serial === 'Serial no visible')
    setAccessories(
      equipment.accessories && equipment.accessories !== 'Sin accesorios'
        ? equipment.accessories.split(',').map((item) => item.trim()).filter(Boolean)
        : []
    )
    setTechnicalSheet(
      equipment.technicalSheet
        ? { ...emptyTechnicalSheet, ...(equipment.technicalSheet as Partial<TechnicalSheet>) }
        : emptyTechnicalSheet
    )
  }

  function selectEquipment(id: string) {
    setEquipmentId(id)
    if (!id) {
      setBrand('')
      setModel('')
      setSerial('')
      setAccessories([])
      setTechnicalSheet(emptyTechnicalSheet)
      return
    }
    const equipment = equipmentList.find((item) => item.id === id)
    if (equipment) applyEquipment(equipment)
  }

  const [category, setCategory] = useState<DeviceCategory>('laptop')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [serial, setSerial] = useState('')
  const [serialUnknown, setSerialUnknown] = useState(false)
  const [accessories, setAccessories] = useState<string[]>([])
  const [customAccessory, setCustomAccessory] = useState('')
  const [powerState, setPowerState] = useState<PowerState>('enciende')
  const [conditions, setConditions] = useState<Partial<Record<IntakeConditionKey, boolean>>>({})
  const [conditionNotes, setConditionNotes] = useState('')
  const [screenCondition, setScreenCondition] = useState('Sin rayones')
  const [internalComponents, setInternalComponents] = useState('')
  const [includesExternalDrives, setIncludesExternalDrives] = useState(false)
  const [lockType, setLockType] = useState<LockType>('sin_bloqueo')
  const [lockNote, setLockNote] = useState('')
  const [customerAuthorizesAccess, setCustomerAuthorizesAccess] = useState(false)
  const [noCredentials, setNoCredentials] = useState(false)

  const [reportedIssue, setReportedIssue] = useState('')
  const [estimate, setEstimate] = useState('')
  const [diagnosticFee, setDiagnosticFee] = useState('')
  const [technicianId, setTechnicianId] = useState('')
  const [promisedAt, setPromisedAt] = useState(defaultPromiseDate)
  const [notes, setNotes] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [technicalSheet, setTechnicalSheet] = useState<TechnicalSheet>(emptyTechnicalSheet)

  const [legalAccepted, setLegalAccepted] = useState(false)
  const [legalOpen, setLegalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createdOrder, setCreatedOrder] = useState<WorkOrder | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidenceDraft[]>([])
  const [evidenceWarningOpen, setEvidenceWarningOpen] = useState(false)

  const selectedCustomer = customerList.find((item) => item.id === customerId) ?? null
  const selectedEquipment = equipmentList.find((item) => item.id === equipmentId) ?? null
  const selectedDevice = deviceOptions.find((item) => item.value === category) ?? deviceOptions[0]
  const SelectedDeviceIcon = selectedDevice.icon

  const customerMatches = useMemo(() => {
    const term = customerQuery.trim().toLowerCase()
    return customerList
      .filter((item) => !item.isFinalConsumer)
      .filter((item) => {
        if (!term) return item.purchases >= 5
        return (
          item.name.toLowerCase().includes(term) ||
          item.document.toLowerCase().includes(term) ||
          item.phone.replace(/\D/g, '').includes(term.replace(/\D/g, ''))
        )
      })
      .slice(0, 6)
  }, [customerList, customerQuery])

  const conditionOptions = useMemo(() => {
    if (category === 'pc_torre' || category === 'consola' || category === 'impresora') {
      return baseConditions.filter((item) => item.key !== 'screenDamage' && item.key !== 'hingeDamage')
    }
    if (category === 'celular') {
      return baseConditions.filter((item) => item.key !== 'hingeDamage')
    }
    return baseConditions
  }, [category])

  const showScreen = category === 'laptop' || category === 'celular'
  const showInternal = category === 'pc_torre'
  const showExternal = category === 'pc_torre' || category === 'consola' || category === 'impresora'
  const showLock = category !== 'impresora' && category !== 'otro'
  const needsLock = showLock && lockType !== 'sin_bloqueo'
  const categoryAccessories = accessoryOptions[category]
  const customAccessories = accessories.filter((item) => !categoryAccessories.includes(item))
  const estimateValue = parseMoney(estimate)
  const diagnosticValue = parseMoney(diagnosticFee)

  function selectCustomer(customer: Customer) {
    setCustomerId(customer.id)
    setCustomerQuery('')
    setCustomerDropdown(false)
  }

  function openNewCustomer() {
    const term = customerQuery.trim()
    setCustomerForm({
      ...emptyCustomerForm,
      document: /^\d/.test(term) ? term : '',
      name: /^\d/.test(term) ? '' : term
    })
    setCustomerDropdown(false)
    setNewCustomerOpen(true)
  }

  async function createCustomer() {
    if (!customerForm.name.trim() || !customerForm.document.trim()) {
      toast.error('El nombre y el documento son obligatorios')
      return
    }
    const existing = customerList.find(
      (item) =>
        item.document.replace(/\D/g, '') === customerForm.document.replace(/\D/g, '') && !item.isFinalConsumer
    )
    if (existing) {
      selectCustomer(existing)
      setNewCustomerOpen(false)
      toast('Cliente ya registrado', { description: `Se seleccionó a ${existing.name}.` })
      return
    }
    setCustomerSaving(true)
    try {
      const customer = await api.customers.create({
        name: customerForm.name.trim(),
        documentType: customerForm.documentType,
        document: customerForm.document.trim(),
        phone: customerForm.phone.trim() || '—',
        email: customerForm.email.trim() || '—',
        address: customerForm.address.trim() || 'Sin dirección'
      })
      setCustomerList((current) => [...current, customer])
      selectCustomer(customer)
      setNewCustomerOpen(false)
      setCustomerForm(emptyCustomerForm)
      toast.success('Cliente creado y seleccionado', {
        description: 'El equipo que estabas registrando se conserva.'
      })
    } catch (failure) {
      toast.error('No se pudo crear el cliente', { description: errorMessage(failure) })
    } finally {
      setCustomerSaving(false)
    }
  }

  function toggleAccessory(label: string) {
    setAccessories((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
    )
  }

  function addCustomAccessory() {
    const value = customAccessory.trim()
    if (!value) return
    if (!accessories.includes(value)) setAccessories((current) => [...current, value])
    setCustomAccessory('')
  }

  function toggleCondition(key: IntakeConditionKey) {
    setConditions((current) => ({ ...current, [key]: !current[key] }))
  }

  function resetForm() {
    setCreatedOrder(null)
    setCustomerId('')
    setCustomerQuery('')
    setCustomerDropdown(false)
    setCategory('laptop')
    setBrand('')
    setModel('')
    setSerial('')
    setSerialUnknown(false)
    setAccessories([])
    setCustomAccessory('')
    setPowerState('enciende')
    setConditions({})
    setConditionNotes('')
    setScreenCondition('Sin rayones')
    setInternalComponents('')
    setIncludesExternalDrives(false)
    setLockType('sin_bloqueo')
    setLockNote('')
    setCustomerAuthorizesAccess(false)
    setNoCredentials(false)
    setReportedIssue('')
    setEstimate('')
    setDiagnosticFee('')
    setTechnicianId(technicians[0]?.id ?? '')
    setPromisedAt(defaultPromiseDate())
    setNotes('')
    setAdvancedOpen(false)
    setTechnicalSheet(emptyTechnicalSheet)
    setLegalAccepted(false)
    setEvidenceDrafts([])
    setEvidenceWarningOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submitOrder(forceWithoutEvidence = false) {
    if (!canCreate) {
      toast.error('Tu rol no puede crear órdenes de trabajo')
      return
    }
    if (!selectedCustomer) {
      toast.error('Selecciona o crea el cliente')
      return
    }
    if (!brand.trim() || !model.trim()) {
      toast.error('Completa la marca y el modelo del equipo')
      return
    }
    if (!reportedIssue.trim()) {
      toast.error('Describe la falla con las palabras del cliente')
      return
    }
    if (needsLock && !customerAuthorizesAccess && !noCredentials) {
      toast.error('Indica si el cliente autoriza el acceso o si prefiere no suministrar credenciales')
      return
    }
    if (!legalAccepted) {
      toast.error('El cliente debe aceptar los términos del comprobante')
      return
    }
    if (!forceWithoutEvidence && evidenceDrafts.length === 0) {
      setEvidenceWarningOpen(true)
      return
    }

    setSaving(true)
    const now = new Date().toISOString()
    const visibleConditionKeys = new Set(conditionOptions.map((item) => item.key))
    const normalizedConditions = Object.fromEntries(
      Object.entries(conditions).filter(([key, active]) => active && visibleConditionKeys.has(key as IntakeConditionKey))
    ) as Partial<Record<IntakeConditionKey, boolean>>
    const conditionFlags = conditionOptions
      .filter((item) => normalizedConditions[item.key])
      .map((item) => item.label)
    const physicalCondition =
      [
        conditionFlags.join(', '),
        screenCondition && showScreen ? `Pantalla: ${screenCondition}` : '',
        internalComponents.trim() ? `Interior: ${internalComponents.trim()}` : '',
        includesExternalDrives ? 'Incluye discos o periféricos externos' : '',
        conditionNotes.trim()
      ]
        .filter(Boolean)
        .join('. ') || 'Sin observaciones'

    const intake: WorkOrderIntake = {
      category,
      categoryLabel: selectedDevice.label,
      powerState,
      conditions: normalizedConditions,
      conditionNotes: conditionNotes.trim(),
      screenCondition: showScreen ? screenCondition : undefined,
      internalComponents: showInternal ? internalComponents.trim() : undefined,
      includesExternalDrives: showExternal ? includesExternalDrives : undefined,
      accessories,
      accessoriesNote: customAccessories.join(', ') || undefined,
      lockType: showLock ? lockType : 'sin_bloqueo',
      lockNote: lockNote.trim() || undefined,
      customerAuthorizesAccess,
      customerWithheldCredentials: noCredentials,
      estimate: estimateValue,
      diagnosticFee: diagnosticValue,
      technicalSheet,
      receivedBy: displayUser.name,
      receivedAt: now,
      legal: {
        version: legalConfig.version,
        acceptedAt: now,
        abandonmentDays: legalConfig.abandonmentDays,
        warrantyDays: legalConfig.warrantyDays,
        shortClauses: legalConfig.shortClauses.map((clause) => resolveLegalClause(clause, legalConfig)),
        fullClauses: legalConfig.fullClauses.map((clause) => resolveLegalClause(clause, legalConfig))
      }
    }

    try {
      const order = await api.orders.create({
        customerId: selectedCustomer.id,
        deviceCategory: category,
        categoryLabel: selectedDevice.label,
        equipmentType: selectedDevice.equipmentType,
        brand: brand.trim(),
        model: model.trim(),
        serial: serialUnknown ? 'Serial no visible' : serial.trim() || 'Sin serial',
        accessories: accessories.join(', ') || 'Sin accesorios',
        physicalCondition,
        reportedIssue: reportedIssue.trim(),
        technicianId,
        equipmentId: equipmentId || undefined,
        promisedAt: new Date(`${promisedAt}T17:00:00`).toISOString(),
        notes: notes.trim(),
        intake: intake as unknown as Record<string, unknown>,
        evidence: evidenceDrafts.map((item) => ({
          dataUrl: item.dataUrl,
          thumbnailDataUrl: item.thumbnailDataUrl,
          category: item.category,
          note: item.note,
          source: item.source,
          width: item.width,
          height: item.height
        }))
      })
      setCreatedOrder(order)
      if (evidenceDrafts.length) {
        toast.success(`${order.number} creada`, {
          description: `${selectedCustomer.name} · ${order.brand} ${order.model}. ${evidenceDrafts.length} evidencia${evidenceDrafts.length === 1 ? '' : 's'} fotográfica${evidenceDrafts.length === 1 ? '' : 's'} guardada${evidenceDrafts.length === 1 ? '' : 's'}.`
        })
      } else {
        toast.warning(`${order.number} creada sin evidencia fotográfica`, {
          description: 'La advertencia quedó registrada. Puedes agregar fotos después desde el detalle de la OT.'
        })
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (failure) {
      toast.error('No se pudo crear la orden', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  function sendWhatsApp(order: WorkOrder) {
    const customer = customerList.find((item) => item.id === order.customerId)
    if (!customer?.phone || customer.phone === '—') {
      toast.error('El cliente no tiene teléfono registrado')
      return
    }
    const message = `Hola ${customer.name}, confirmamos el ingreso de tu ${order.equipmentType.toLowerCase()} al taller con la Orden de Servicio ${order.number}. Motivo: ${order.reportedIssue}. Puedes consultar el avance con este número. ¡Gracias por confiar en ${legalConfig.businessName}!`
    window.open(`https://wa.me/57${customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank')
  }

  if (bootLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando clientes y términos…
        </div>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudo preparar la recepción</p>
        <p className="max-w-md text-[12px] text-slate-500">{bootError}</p>
        <Button size="sm" variant="secondary" onClick={() => navigate('/ordenes')}>Volver a órdenes</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recepción de equipo"
        description="Ingreso dinámico según el tipo de dispositivo. El cobro se registra al entregar, no al recibir."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/ordenes')} leftIcon={<ArrowLeft className="h-4 w-4" />}>
              Volver
            </Button>
            <Button onClick={() => void submitOrder()} loading={saving} leftIcon={<ShieldCheck className="h-4 w-4" />}>
              Guardar OT
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <section className="card p-5 lg:p-6">
            <SectionTitle
              step="1"
              icon={UserRound}
              title="Cliente"
              description="Busca por cédula/NIT, teléfono o nombre. Si no existe, créalo sin perder lo escrito."
            />

            {selectedCustomer ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm">
                    <UserRound className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-[13px] font-bold text-ink">{selectedCustomer.name}</p>
                      <Badge variant="brand">{selectedCustomer.documentType}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">
                      {selectedCustomer.document} · {selectedCustomer.phone} · {selectedCustomer.email}
                    </p>
                    <p className="mt-0.5 truncate text-[9px] text-slate-400">
                      {selectedCustomer.address} · {selectedCustomer.orders} OTs históricas
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCustomerId('')
                    setCustomerQuery('')
                    setCustomerDropdown(true)
                  }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="relative mt-4">
                <SearchInput
                  value={customerQuery}
                  onChange={(event) => {
                    setCustomerQuery(event.target.value)
                    setCustomerDropdown(true)
                  }}
                  onFocus={() => setCustomerDropdown(true)}
                  onBlur={() => window.setTimeout(() => setCustomerDropdown(false), 160)}
                  placeholder="Cédula, NIT, teléfono o nombre del cliente..."
                />
                {customerDropdown ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-2xl border border-line bg-white shadow-pop">
                    <div className="max-h-[286px] overflow-y-auto p-1.5">
                      {customerMatches.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectCustomer(customer)}
                          className="focus-ring flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-slate-50"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                            <UserRound className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-semibold text-ink">{customer.name}</span>
                            <span className="block truncate text-[9px] text-slate-400">
                              {customer.documentType} {customer.document} · {customer.phone}
                            </span>
                          </span>
                          <span className="text-[9px] text-slate-400">{customer.orders} OTs</span>
                        </button>
                      ))}
                      {!customerMatches.length ? (
                        <div className="px-3 py-4 text-center">
                          <p className="text-[11px] font-semibold text-ink">Sin coincidencias</p>
                          <p className="mt-0.5 text-[10px] text-slate-400">Crea el cliente y sigue con el mismo formulario.</p>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={openNewCustomer}
                      className="focus-ring flex w-full items-center gap-2 border-t border-line bg-slate-50/70 px-3.5 py-3 text-left text-[11px] font-semibold text-brand-700 transition hover:bg-brand-50"
                    >
                      <UserPlus className="h-4 w-4" />
                      Crear cliente nuevo
                      {customerQuery.trim() ? <span className="truncate font-normal text-slate-400">· “{customerQuery.trim()}”</span> : null}
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            {!selectedCustomer ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                <Search className="h-3 w-3" />
                También puedes registrar un consumidor final sin datos.
                <button
                  type="button"
                  onClick={() => {
                    const finalConsumer = customerList.find((item) => item.isFinalConsumer)
                    if (finalConsumer) selectCustomer(finalConsumer)
                  }}
                  className="font-semibold text-brand-600 hover:text-brand-700"
                >
                  Usar consumidor final
                </button>
              </div>
            ) : null}
          </section>

          <section className="card p-5 lg:p-6">
            <SectionTitle
              step="2"
              icon={selectedDevice.icon}
              title="Equipo"
              description="El formulario cambia según el tipo de dispositivo seleccionado."
            />

            {selectedCustomer ? (
              <div className="mt-4 rounded-xl border border-line bg-slate-50/60 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="field-label mb-0" htmlFor="equipment-select">
                    Equipo registrado
                  </label>
                  <span className="text-[9px] text-slate-400">
                    {equipmentList.length} equipo{equipmentList.length === 1 ? '' : 's'} en el historial del cliente
                  </span>
                </div>
                <select
                  id="equipment-select"
                  value={equipmentId}
                  onChange={(event) => selectEquipment(event.target.value)}
                  className="field mt-1.5"
                >
                  <option value="">Nuevo equipo / no registrado</option>
                  {equipmentList.map((equipment) => (
                    <option key={equipment.id} value={equipment.id}>
                      {equipment.brand} {equipment.model} · {equipment.serial}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[9px] leading-relaxed text-slate-400">
                  {selectedEquipment
                    ? `Equipo registrado el ${formatDate(selectedEquipment.createdAt)}. Se reutiliza su ficha y se conserva el historial.`
                    : 'Se creará un equipo nuevo al guardar la OT. Si el serial ya existe para este cliente, se reutilizará.'}
                </p>
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {deviceOptions.map((option) => {
                const Icon = option.icon
                const active = category === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setCategory(option.value)}
                    className={cn(
                      'focus-ring rounded-xl border p-3 text-left transition',
                      active
                        ? 'border-brand-300 bg-brand-50 text-brand-700 ring-4 ring-brand-100/60'
                        : 'border-line bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    <Icon className={cn('h-5 w-5', active ? 'text-brand-600' : 'text-slate-400')} />
                    <p className="mt-2 text-[11px] font-semibold">{option.label}</p>
                    <p className="mt-0.5 text-[8.5px] leading-snug text-slate-400">{option.hint}</p>
                  </button>
                )
              })}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Marca *</span>
                <input
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  placeholder={category === 'laptop' ? 'Apple, HP, Lenovo...' : category === 'celular' ? 'Samsung, Apple, Xiaomi...' : 'Marca del equipo'}
                  className="field"
                />
              </label>
              <label className="block">
                <span className="field-label">Modelo *</span>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={category === 'laptop' ? 'MacBook Pro 13" 2020' : 'Modelo o referencia'}
                  className="field"
                />
              </label>
              <label className="block">
                <span className="field-label">Número de serie</span>
                <input
                  value={serialUnknown ? '' : serial}
                  onChange={(event) => setSerial(event.target.value)}
                  disabled={serialUnknown}
                  placeholder={serialUnknown ? 'No visible / no aplica' : 'Serial del equipo'}
                  className="field disabled:bg-slate-50 disabled:text-slate-400"
                />
              </label>
              <label className="flex items-end pb-2.5">
                <span className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={serialUnknown}
                    onChange={(event) => setSerialUnknown(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                  />
                  Serial ilegible, borrado o no disponible
                </span>
              </label>
            </div>

            <div className="mt-5">
              <p className="field-label">Estado de encendido al recibir</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {powerOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPowerState(option.value)}
                    className={cn(
                      'focus-ring rounded-xl border px-3 py-2.5 text-left transition',
                      powerState === option.value
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-line bg-white text-slate-500 hover:border-slate-300'
                    )}
                  >
                    <span className="flex items-center gap-2 text-[11px] font-semibold">
                      <span className={cn('h-2 w-2 rounded-full', powerState === option.value ? 'bg-brand-500' : 'bg-slate-300')} />
                      {option.label}
                    </span>
                    <span className="mt-1 block text-[9px] text-slate-400">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {showScreen ? (
              <div className="mt-5 rounded-xl border border-line bg-slate-50/60 p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Estado de la pantalla</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {screenConditions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setScreenCondition(option)}
                      className={cn(
                        'focus-ring rounded-full border px-2.5 py-1.5 text-[10px] font-semibold transition',
                        screenCondition === option
                          ? 'border-brand-300 bg-white text-brand-700 shadow-sm'
                          : 'border-transparent bg-white/70 text-slate-500 hover:text-ink'
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {showInternal ? (
              <div className="mt-5 grid gap-3 rounded-xl border border-line bg-slate-50/60 p-3.5 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Componentes internos visibles</span>
                  <input
                    value={internalComponents}
                    onChange={(event) => setInternalComponents(event.target.value)}
                    placeholder="GPU, RAM, fuente, estado del gabinete..."
                    className="field bg-white"
                  />
                </label>
                <label className="flex items-end pb-2.5">
                  <span className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      checked={includesExternalDrives}
                      onChange={(event) => setIncludesExternalDrives(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                    />
                    Incluye discos o periféricos externos
                  </span>
                </label>
              </div>
            ) : null}

            {showExternal && !showInternal ? (
              <label className="mt-4 flex cursor-pointer items-center gap-2 text-[11px] text-slate-500">
                <input
                  type="checkbox"
                  checked={includesExternalDrives}
                  onChange={(event) => setIncludesExternalDrives(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                />
                El cliente dejó discos, controles u otros periféricos adicionales
              </label>
            ) : null}

            <div className="mt-5">
              <p className="field-label">Checklist de estado físico y pruebas iniciales</p>
              <div className="flex flex-wrap gap-2">
                {conditionOptions.map((option) => {
                  const active = Boolean(conditions[option.key])
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => toggleCondition(option.key)}
                      className={cn(
                        'focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold transition',
                        active
                          ? 'border-warning-200 bg-warning-50 text-warning-800'
                          : 'border-line bg-white text-slate-500 hover:border-slate-300'
                      )}
                    >
                      <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded-full border', active ? 'border-warning-500 bg-warning-500 text-white' : 'border-slate-300')}>
                        {active ? <Check className="h-2.5 w-2.5" /> : null}
                      </span>
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <label className="mt-3 block">
                <span className="field-label">Observaciones del estado físico</span>
                <textarea
                  value={conditionNotes}
                  onChange={(event) => setConditionNotes(event.target.value)}
                  rows={2}
                  placeholder="Golpes en esquinas, detalles de bisagras, tornillos, humedad..."
                  className="field resize-none"
                />
              </label>
            </div>

            {showLock ? (
              <div className="mt-5 rounded-xl border border-warning-100 bg-warning-50/50 p-3.5">
                <div className="flex items-start gap-2.5">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-warning-900">Bloqueo de seguridad</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-warning-800/80">
                      Nunca escribas la contraseña, PIN, patrón ni código. Solo registra el tipo de bloqueo y la autorización.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="field-label">Tipo de bloqueo</span>
                        <div className="relative">
                          <Select value={lockType} onChange={(event) => setLockType(event.target.value as LockType)} className="bg-white">
                            {lockOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        </div>
                      </label>
                      <label className="block">
                        <span className="field-label">Nota operativa</span>
                        <input
                          value={lockNote}
                          onChange={(event) => setLockNote(event.target.value)}
                          placeholder="Ej. cliente desbloquea al recibir"
                          className="field bg-white"
                        />
                      </label>
                    </div>
                    {needsLock ? (
                      <div className="mt-3 space-y-2">
                        <label className="flex cursor-pointer items-start gap-2 text-[10px] leading-snug text-warning-900">
                          <input
                            type="checkbox"
                            checked={customerAuthorizesAccess}
                            onChange={(event) => {
                              setCustomerAuthorizesAccess(event.target.checked)
                              if (event.target.checked) setNoCredentials(false)
                            }}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-warning-300 text-brand-600 focus:ring-brand-200"
                          />
                          El cliente autoriza el acceso y desbloqueo del equipo para el diagnóstico.
                        </label>
                        <label className="flex cursor-pointer items-start gap-2 text-[10px] leading-snug text-warning-900">
                          <input
                            type="checkbox"
                            checked={noCredentials}
                            onChange={(event) => {
                              setNoCredentials(event.target.checked)
                              if (event.target.checked) setCustomerAuthorizesAccess(false)
                            }}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-warning-300 text-brand-600 focus:ring-brand-200"
                          />
                          El cliente prefiere no suministrar credenciales. Se trabajará sin acceso al sistema.
                        </label>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="card p-5 lg:p-6">
            <SectionTitle
              step="3"
              icon={Package}
              title="Accesorios dejados"
              description="Marca los accesorios recibidos y agrega texto libre si hace falta."
            />

            <div className="mt-4 flex flex-wrap gap-1.5">
              {categoryAccessories.map((option) => {
                const active = accessories.includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleAccessory(option)}
                    className={cn(
                      'focus-ring rounded-full border px-3 py-1.5 text-[10px] font-semibold transition',
                      active
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-line bg-white text-slate-500 hover:border-slate-300'
                    )}
                  >
                    {active ? <Check className="mr-1 inline h-3 w-3" /> : null}
                    {option}
                  </button>
                )
              })}
            </div>

            {customAccessories.length ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {customAccessories.map((option) => (
                  <span key={option} className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-[10px] font-semibold text-brand-700">
                    {option}
                    <button
                      type="button"
                      onClick={() => toggleAccessory(option)}
                      className="focus-ring rounded-full text-brand-400 hover:text-brand-700"
                      aria-label={`Quitar ${option}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={customAccessory}
                onChange={(event) => setCustomAccessory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addCustomAccessory()
                  }
                }}
                placeholder="Otro accesorio (texto libre)"
                className="field flex-1"
              />
              <Button variant="secondary" onClick={addCustomAccessory} leftIcon={<Plus className="h-4 w-4" />}>
                Agregar
              </Button>
            </div>
            <p className="mt-2 text-[9px] text-slate-400">
              {accessories.length ? `${accessories.length} accesorios registrados.` : 'Si no dejó accesorios, déjalo vacío.'} Se imprimen en el comprobante.
            </p>
          </section>

          <section className="card p-5 lg:p-6">
            <SectionTitle
              step="4"
              icon={Wrench}
              title="Falla y presupuesto"
              description="Usa las palabras exactas del cliente. El diagnóstico se completa después."
            />

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="field-label">Falla reportada por el cliente *</span>
                <textarea
                  value={reportedIssue}
                  onChange={(event) => setReportedIssue(event.target.value)}
                  rows={3}
                  placeholder="Ej. “Se apagó al derramar café y no volvió a encender...”"
                  className="field resize-none"
                />
              </label>
              <label className="block">
                <span className="field-label">Presupuesto estimado</span>
                <div className="relative">
                  <CircleDollarSign className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={estimate}
                    onChange={(event) => setEstimate(event.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    placeholder="0"
                    className="field pl-10 text-right tabular"
                  />
                </div>
                <span className="mt-1 block text-[9px] text-slate-400">
                  {estimateValue > 0 ? formatCurrency(estimateValue) : 'Informativo, no genera cobro al recibir.'}
                </span>
              </label>
              <label className="block">
                <span className="field-label">Revisión / diagnóstico</span>
                <div className="relative">
                  <CircleDollarSign className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={diagnosticFee}
                    onChange={(event) => setDiagnosticFee(event.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    placeholder="0"
                    className="field pl-10 text-right tabular"
                  />
                </div>
                <span className="mt-1 block text-[9px] text-slate-400">Opcional. Se cobra al entregar si aplica.</span>
              </label>
              <label className="block">
                <span className="field-label">Técnico asignado</span>
                <div className="relative">
                  <Select
                    value={technicianId}
                    onChange={(event) => setTechnicianId(event.target.value)}
                    disabled={!technicians.length}
                  >
                    {technicians.length ? (
                      technicians.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))
                    ) : (
                      <option value="">Sin técnicos activos</option>
                    )}
                  </Select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                </div>
                <span className="mt-1 block text-[9px] text-slate-400">
                  {technicians.length
                    ? 'La asignación queda registrada en la trazabilidad de la OT.'
                    : 'Crea un usuario con rol Técnico en Configuración → Usuarios para asignarlo.'}
                </span>
              </label>
              <label className="block">
                <span className="field-label">Fecha promesa</span>
                <input type="date" value={promisedAt} onChange={(event) => setPromisedAt(event.target.value)} className="field" />
              </label>
              <label className="block sm:col-span-2">
                <span className="field-label">Nota interna</span>
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Observaciones solo para el taller (no se imprimen en el comprobante)"
                  className="field"
                />
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-brand-800">
              <span className="font-semibold">Sin cobro en recepción.</span> El presupuesto y la revisión quedan registrados, pero el cobro y la factura interna se generan cuando la OT pasa a <span className="font-semibold">Entregado</span>.
            </div>
          </section>

          <section className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen((value) => !value)}
              className="focus-ring flex w-full items-center justify-between gap-3 px-5 py-4 text-left lg:px-6"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-slate-500">
                  <Monitor className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[13px] font-bold text-ink">Ficha técnica avanzada</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">Opcional. Conserva OS, CPU, GPU, RAM, almacenamiento y batería.</p>
                </div>
              </div>
              {advancedOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>
            {advancedOpen ? (
              <div className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-2 lg:grid-cols-3 lg:px-6">
                {[
                  ['Sistema operativo', 'os', 'Windows 11, macOS Sonoma...'],
                  ['Procesador', 'cpu', 'Intel Core i7, Ryzen 5...'],
                  ['Tarjeta gráfica', 'gpu', 'RTX 3060, integrada...'],
                  ['Memoria RAM', 'ram', '16 GB DDR4...'],
                  ['Almacenamiento', 'storage', 'SSD NVMe 1 TB...'],
                  ['Batería', 'battery', 'Estado o duración...']
                ].map(([label, key, placeholder]) => (
                  <label key={key} className="block">
                    <span className="field-label">{label}</span>
                    <input
                      value={technicalSheet[key as keyof TechnicalSheet] ?? ''}
                      onChange={(event) => setTechnicalSheet({ ...technicalSheet, [key]: event.target.value })}
                      placeholder={placeholder}
                      className="field"
                    />
                  </label>
                ))}
              </div>
            ) : null}
          </section>

          <EvidenceCapture
            items={evidenceDrafts}
            onChange={setEvidenceDrafts}
            stage="ingreso"
            disabled={saving}
          />
        </div>

        <aside className="space-y-4 xl:sticky xl:top-0">
          <div className="card overflow-hidden">
            <div className="border-b border-line bg-slate-50/60 px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">Resumen de ingreso</p>
                <Badge variant="brand">OT</Badge>
              </div>
            </div>
            <div className="space-y-3.5 p-4">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Cliente</p>
                {selectedCustomer ? (
                  <div className="mt-1.5">
                    <p className="text-[12px] font-bold text-ink">{selectedCustomer.name}</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {selectedCustomer.documentType} {selectedCustomer.document} · {selectedCustomer.phone}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-[10px] text-slate-400">
                    Sin cliente seleccionado
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <SelectedDeviceIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-ink">
                      {brand || model ? `${brand} ${model}`.trim() : selectedDevice.label}
                    </p>
                    <p className="text-[9px] text-slate-400">
                      {selectedDevice.label} · {serialUnknown ? 'Serial no visible' : serial || 'Sin serial'}
                    </p>
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-line pt-2.5">
                  <div>
                    <p className="text-[8px] uppercase tracking-[0.08em] text-slate-400">Accesorios</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-ink">{accessories.length || 'Sin accesorios'}</p>
                  </div>
                  <div>
                    <p className="text-[8px] uppercase tracking-[0.08em] text-slate-400">Presupuesto</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-ink">{estimateValue > 0 ? formatCurrency(estimateValue) : 'Por definir'}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <p className="text-[9.5px] leading-relaxed text-slate-500">
                  El comprobante incluye el estado físico, accesorios y bloqueo declarados. Se imprime con Code128 de la OT.
                </p>
              </div>

              <div className="rounded-xl border border-line p-3">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={legalAccepted}
                    onChange={(event) => setLegalAccepted(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                  />
                  <span className="text-[10px] leading-relaxed text-slate-600">
                    El cliente acepta los términos de recepción <span className="font-semibold">({legalConfig.version})</span>, incluido el abandono a los {legalConfig.abandonmentDays} días.
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setLegalOpen(true)}
                  className="focus-ring mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-brand-600 hover:text-brand-700"
                >
                  <FileText className="h-3 w-3" /> Leer cláusulas completas
                </button>
              </div>

              <Button className="w-full" size="lg" onClick={() => void submitOrder()} loading={saving} leftIcon={<ShieldCheck className="h-4 w-4" />}>
                Guardar y generar comprobante
              </Button>
              <p className="text-center text-[9px] leading-relaxed text-slate-400">
                No se cobra nada al recibir. El cierre financiero se realiza al entregar.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-warning-100 bg-warning-50/70 p-4">
            <div className="flex items-start gap-2.5">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" />
              <p className="text-[9.5px] leading-relaxed text-warning-800">
                No se almacenan contraseñas, PIN, patrones ni códigos. Solo el tipo de bloqueo y la autorización del cliente.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <Modal
        open={newCustomerOpen}
        onClose={() => setNewCustomerOpen(false)}
        title="Cliente nuevo"
        description="Alta rápida sin salir del ingreso. El formulario del equipo se conserva intacto."
        size="lg"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setNewCustomerOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={createCustomer} loading={customerSaving} leftIcon={<UserPlus className="h-4 w-4" />}>
              Crear y seleccionar
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Tipo de documento</span>
            <div className="relative">
              <Select
                value={customerForm.documentType}
                onChange={(event) => setCustomerForm({ ...customerForm, documentType: event.target.value as Customer['documentType'] })}
              >
                <option value="CC">Cédula de ciudadanía</option>
                <option value="NIT">NIT</option>
                <option value="Pasaporte">Pasaporte</option>
              </Select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          </label>
          <label className="block">
            <span className="field-label">Documento *</span>
            <input
              value={customerForm.document}
              onChange={(event) => setCustomerForm({ ...customerForm, document: event.target.value })}
              placeholder="Cédula o NIT"
              className="field"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre completo o razón social *</span>
            <input
              value={customerForm.name}
              onChange={(event) => setCustomerForm({ ...customerForm, name: event.target.value })}
              placeholder="Nombre del cliente"
              className="field"
            />
          </label>
          <label className="block">
            <span className="field-label">Teléfono</span>
            <input
              value={customerForm.phone}
              onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })}
              placeholder="310 000 0000"
              className="field"
            />
          </label>
          <label className="block">
            <span className="field-label">Correo</span>
            <input
              value={customerForm.email}
              onChange={(event) => setCustomerForm({ ...customerForm, email: event.target.value })}
              placeholder="cliente@correo.com"
              className="field"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Dirección</span>
            <input
              value={customerForm.address}
              onChange={(event) => setCustomerForm({ ...customerForm, address: event.target.value })}
              placeholder="Dirección de contacto"
              className="field"
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={legalOpen}
        onClose={() => setLegalOpen(false)}
        title="Términos de recepción"
        description={`${legalConfig.businessName} · versión ${legalConfig.version} · abandono a los ${legalConfig.abandonmentDays} días`}
        size="lg"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setLegalOpen(false)}>
              Cerrar
            </Button>
            <Button
              onClick={() => {
                setLegalAccepted(true)
                setLegalOpen(false)
                toast.success('Términos aceptados para esta recepción')
              }}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Aceptar y continuar
            </Button>
          </div>
        }
      >
        <div className="max-h-[54vh] space-y-3 overflow-y-auto pr-1">
          <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-3">
            <p className="text-[10px] leading-relaxed text-brand-900">
              Estas son las cláusulas completas que quedarán guardadas en un snapshot inmutable de esta OT. Cambios futuros en la configuración legal no alterarán este comprobante.
            </p>
          </div>
          <ol className="space-y-2.5">
            {legalConfig.fullClauses.map((clause, index) => (
              <li key={`${index}-${clause.slice(0, 16)}`} className="flex gap-2.5 rounded-xl border border-line px-3.5 py-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500">
                  {index + 1}
                </span>
                <p className="text-[10px] leading-relaxed text-slate-600">
                  {clause
                    .replace(/\{\{dias\}\}/g, String(legalConfig.abandonmentDays))
                    .replace(/\{\{garantia\}\}/g, String(legalConfig.warrantyDays))}
                </p>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 rounded-xl border border-warning-100 bg-warning-50/70 px-3.5 py-2.5">
            <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-warning-600" />
            <p className="text-[10px] leading-relaxed text-warning-800">
              La firma se estampa físicamente en el comprobante. No se captura firma digital ni credenciales del equipo.
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(createdOrder)}
        onClose={() => setCreatedOrder(null)}
        title="Comprobante de ingreso generado"
        description={createdOrder ? `${createdOrder.number} · ${createdOrder.customerName}` : undefined}
        size="lg"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={resetForm} leftIcon={<Plus className="h-4 w-4" />}>
              Nueva recepción
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={() => createdOrder && sendWhatsApp(createdOrder)} leftIcon={<Smartphone className="h-4 w-4" />}>
                WhatsApp
              </Button>
              <Button variant="secondary" onClick={() => setPreviewOpen(true)} leftIcon={<Printer className="h-4 w-4" />}>
                Imprimir
              </Button>
              <Button onClick={() => createdOrder && navigate(`/ordenes/${createdOrder.id}`)} leftIcon={<FileText className="h-4 w-4" />}>
                Ver la OT
              </Button>
            </div>
          </div>
        }
      >
        {createdOrder ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-success-100 bg-success-50/70 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-success-600 shadow-sm">
                  <BadgeCheck className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[12px] font-bold text-success-800">Recepción registrada sin cobro</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-success-700">
                    Se guardó el estado físico, los accesorios y la autorización. Imprime el ticket o el A4 de dos copias y solicita la firma física.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['Orden de servicio', createdOrder.number],
                ['Cliente', createdOrder.customerName],
                ['Equipo', `${createdOrder.brand} ${createdOrder.model}`],
                ['Serial', createdOrder.serial],
                ['Técnico asignado', createdOrder.technician],
                ['Presupuesto', createdOrder.intake?.estimate ? formatCurrency(createdOrder.intake.estimate) : 'Por definir']
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-line px-3.5 py-2.5">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
                  <p className="mt-1 text-[11px] font-semibold text-ink">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-center text-[9px] text-slate-400">
              El cliente puede consultar el avance con el número de OT. Sin QR ni portal público en esta etapa.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={evidenceWarningOpen}
        onClose={() => setEvidenceWarningOpen(false)}
        title="Guardar sin evidencia fotográfica"
        description="La foto es opcional, pero ayuda a sustentar reclamos por el estado del equipo."
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setEvidenceWarningOpen(false)}>
              Volver y agregar fotos
            </Button>
            <Button
              variant="dark"
              loading={saving}
              onClick={() => {
                setEvidenceWarningOpen(false)
                void submitOrder(true)
              }}
              leftIcon={<ShieldCheck className="h-4 w-4" />}
            >
              Guardar sin fotos
            </Button>
          </div>
        }
      >
        <div className="flex items-start gap-3 rounded-xl border border-warning-100 bg-warning-50/70 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" />
          <div className="text-[10px] leading-relaxed text-warning-800">
            <p className="font-semibold text-warning-900">Esta recepción quedará marcada como “sin evidencia”.</p>
            <p className="mt-1">
              La advertencia se registra en la bitácora de auditoría. Después del ingreso todavía puedes agregar
              fotografías desde el detalle de la OT, etiquetadas como reparación.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[9px] leading-relaxed text-slate-500">
          Las evidencias son digitales: no se imprimen ni se anexan al comprobante. Se guardan en el equipo y en cada
          respaldo completo.
        </p>
      </Modal>

      <DocumentPreviewModal
        order={createdOrder}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        initialFormat="80mm"
      />
    </div>
  )
}

function SectionTitle({
  step,
  icon: Icon,
  title,
  description
}: {
  step: string
  icon: typeof Wrench
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Icon className="h-4 w-4" />
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[8px] font-bold text-white">
          {step}
        </span>
      </span>
      <div>
        <h2 className="font-display text-[15px] font-bold text-ink">{title}</h2>
        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{description}</p>
      </div>
    </div>
  )
}
