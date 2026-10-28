import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Printer,
  ReceiptText,
  FileText,
  Scissors,
  Wrench,
  X
} from 'lucide-react'
import type { Customer, IntakeConditionKey, LegalConfig, LockType, PowerState, TechnicalSheet, WorkOrder } from '@/types'
import { defaultLegalConfig, resolveLegalClause } from '@/lib/legalConfig'
import { customerDocumentLabel, customerPrimaryPhone } from '@/lib/customers'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { technicalSheetEntries } from '@/lib/technicalSheet'
import { cn } from '@/lib/utils'
import { Barcode } from '@/components/orders/Barcode'
import { Button } from '@/components/ui/Button'

export type DocumentFormat = '80mm' | '58mm' | 'a4'

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

const conditionLabels: Record<IntakeConditionKey, string> = {
  screenDamage: 'Rayones o fisuras en pantalla',
  caseDamage: 'Golpes en la carcasa',
  hingeDamage: 'Bisagras con juego',
  missingScrews: 'Tornillos faltantes',
  liquidDamage: 'Humedad o derrame',
  previousRepair: 'Reparación previa'
}

const formatOptions: Array<{ value: DocumentFormat; label: string; hint: string; icon: typeof ReceiptText }> = [
  { value: '80mm', label: 'Ticket 80 mm', hint: 'Altura dinámica', icon: ReceiptText },
  { value: '58mm', label: 'Ticket 58 mm', hint: 'Tirilla compacta', icon: ReceiptText },
  { value: 'a4', label: 'A4 · dos copias', hint: 'Cliente y taller', icon: FileText }
]

interface DocumentData {
  businessName: string
  nit: string
  phone: string
  address: string
  city: string
  email: string
  customerName: string
  customerDocument: string
  customerPhone: string
  serial: string
  accessories: string
  conditionSummary: string
  powerState: string
  lockSummary: string
  receivedBy: string
  receivedAt: string
  estimate: number
  diagnosticFee: number
  shortClauses: string[]
  fullClauses: string[]
  legalVersion: string
  abandonmentDays: number
  warrantyDays: number
  evidenceCount: number
  internalComponents?: string
  includesExternalDrives?: boolean
  customBuild?: boolean
  alias?: string
  technicalSheet?: TechnicalSheet
}

function buildData(order: WorkOrder, customer: Customer | null, legal: LegalConfig): DocumentData {
  const config = legal
  const intake = order.intake
  const snapshot = intake?.legal
  const conditions = intake
    ? (Object.entries(intake.conditions) as Array<[IntakeConditionKey, boolean | undefined]>)
        .filter(([, active]) => active)
        .map(([key]) => conditionLabels[key])
    : []
  const normalizedPhysicalCondition = order.physicalCondition.toLowerCase()
  const conditionParts = [
    order.physicalCondition,
    ...conditions
      .filter((item) => item && !normalizedPhysicalCondition.includes(item.toLowerCase()))
      .map((item) => `✔ ${item}`)
  ]
  if (intake?.screenCondition && !order.physicalCondition.toLowerCase().includes('pantalla:')) {
    conditionParts.push(`Pantalla: ${intake.screenCondition}`)
  }
  const lockParts = intake
    ? [
        `Bloqueo: ${lockLabels[intake.lockType]}`,
        intake.customerWithheldCredentials
          ? 'El cliente no suministra credenciales'
          : intake.customerAuthorizesAccess
            ? 'Cliente autoriza el acceso'
            : 'Acceso no confirmado'
      ]
    : []

  return {
    businessName: config.businessName,
    nit: config.nit,
    phone: config.phone,
    address: config.address,
    city: config.city,
    email: config.email,
    customerName: order.customerName,
    customerDocument: customer ? customerDocumentLabel(customer) : '—',
    customerPhone: customerPrimaryPhone(customer) || '—',
    serial: order.serial,
    accessories: intake?.accessories.length
      ? intake.accessories.join(', ')
      : order.accessories || 'Sin accesorios',
    conditionSummary: conditionParts.filter(Boolean).join(' · ') || 'Sin observaciones',
    powerState: intake ? powerLabels[intake.powerState] : 'No registrado',
    lockSummary: lockParts.join(' · ') || 'Sin bloqueo registrado',
    receivedBy: intake?.receivedBy ?? order.technician,
    receivedAt: intake?.receivedAt ?? order.createdAt,
    estimate: intake?.estimate ?? 0,
    diagnosticFee: intake?.diagnosticFee ?? 0,
    shortClauses:
      snapshot?.shortClauses ??
      config.shortClauses.map((clause) => resolveLegalClause(clause, config)),
    fullClauses:
      snapshot?.fullClauses ?? config.fullClauses.map((clause) => resolveLegalClause(clause, config)),
    legalVersion: snapshot?.version ?? config.version,
    abandonmentDays: snapshot?.abandonmentDays ?? config.abandonmentDays,
    warrantyDays: snapshot?.warrantyDays ?? config.warrantyDays,
    evidenceCount: order.evidenceCount ?? 0,
    internalComponents: intake?.internalComponents,
    includesExternalDrives: intake?.includesExternalDrives,
    customBuild: Boolean(intake?.customBuild),
    alias: intake?.alias,
    technicalSheet: intake?.technicalSheet
  }
}

function Header({ data, compact = false }: { data: DocumentData; compact?: boolean }) {
  return (
    <div className={cn('flex items-start gap-3 border-b border-black/20 pb-2', compact && 'gap-2 pb-1.5')}>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg border border-black/40',
          compact ? 'h-8 w-8' : 'h-10 w-10'
        )}
      >
        <Wrench className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('font-display font-bold uppercase leading-tight', compact ? 'text-[11px]' : 'text-[13px]')}>
          {data.businessName}
        </p>
        <p className={cn('mt-0.5 leading-snug', compact ? 'text-[7px]' : 'text-[8px]')}>
          NIT {data.nit} · Tel. {data.phone}
        </p>
        <p className={cn('leading-snug', compact ? 'text-[7px]' : 'text-[8px]')}>
          {data.address} · {data.city}
        </p>
      </div>
    </div>
  )
}

function SignatureRow({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('grid grid-cols-2 gap-4', compact ? 'mt-4 gap-2' : 'mt-4')}>
      {['Firma del cliente · recibido conforme', 'Recibió en el taller'].map((label) => (
        <div key={label}>
          <div className={cn('border-t border-black/50', compact ? 'mt-8' : 'mt-14')} />
          <p className={cn('mt-0.5 text-center leading-tight', compact ? 'text-[7px]' : 'text-[8px]')}>{label}</p>
        </div>
      ))}
    </div>
  )
}

function TicketSheet({ order, data, variant }: { order: WorkOrder; data: DocumentData; variant: '80mm' | '58mm' }) {
  const narrow = variant === '58mm'
  return (
    <div
      className={cn(
        'order-print-sheet order-print-ticket bg-white text-black',
        narrow ? 'w-[58mm] px-[3mm] py-[4mm] text-[8px]' : 'w-[80mm] px-[4mm] py-[5mm] text-[9px]'
      )}
    >
      <Header data={data} compact={narrow} />

      <div className="mt-3 text-center">
        <p className={cn('font-semibold uppercase tracking-[0.16em]', narrow ? 'text-[7px]' : 'text-[8px]')}>
          Comprobante de ingreso
        </p>
        <p className={cn('mt-1 font-display font-black tracking-tight', narrow ? 'text-[22px]' : 'text-[28px]')}>
          {order.number}
        </p>
        {order.trackingCode ? (
          <p className="mt-1 text-[8px] font-semibold tracking-[0.08em]">
            Seguimiento: {order.trackingCode}
          </p>
        ) : null}
        <Barcode value={order.number} height={narrow ? 34 : 44} className="mt-2" />
      </div>

      <div className={cn('mt-3 grid grid-cols-2 gap-x-2 gap-y-1 border-y border-dashed border-black/35 py-2', narrow && 'grid-cols-1')}>
        <Info label="Fecha" value={formatDateTime(data.receivedAt)} />
        <Info label="Recibió" value={data.receivedBy} />
        <Info label="Cliente" value={data.customerName} />
        <Info label="Documento" value={data.customerDocument} />
        <Info label="Teléfono" value={data.customerPhone} />
        <Info label="Equipo" value={order.equipmentType} />
        <Info label="Marca / modelo" value={`${order.brand} ${order.model}`} />
        <Info label="Serial" value={data.serial} />
      </div>

      <div className="mt-2.5 space-y-1.5">
        <Block label="Accesorios" value={data.accessories} />
        <Block label="Estado inicial" value={`${data.powerState}. ${data.conditionSummary}`} />
        <Block label="Seguridad" value={data.lockSummary} />
        <Block
          label={order.intake?.serviceKind === 'mantenimiento' ? 'Servicio solicitado' : 'Falla reportada'}
          value={order.reportedIssue}
          strong
        />
      </div>

      {data.estimate > 0 || data.diagnosticFee > 0 ? (
        <div className="mt-2.5 rounded border border-black/30 px-2 py-1.5">
          {data.estimate > 0 ? <Info label="Presupuesto estimado" value={formatCurrency(data.estimate)} /> : null}
          {data.diagnosticFee > 0 ? <Info label="Revisión / diagnóstico" value={formatCurrency(data.diagnosticFee)} /> : null}
          <p className="mt-1 text-[7px] leading-snug">Valores informativos. El cobro se realiza al entregar el equipo.</p>
        </div>
      ) : null}

      <div className="mt-2.5 border-t border-black/30 pt-2">
        <p className={cn('font-bold uppercase tracking-[0.1em]', narrow ? 'text-[6.5px]' : 'text-[7px]')}>
          Términos esenciales
        </p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-3">
          {data.shortClauses.slice(0, 3).map((clause) => (
            <li key={clause} className={cn('leading-snug', narrow ? 'text-[6.5px]' : 'text-[7px]')}>
              {clause}
            </li>
          ))}
        </ol>
        <p className={cn('mt-1 leading-snug', narrow ? 'text-[6.5px]' : 'text-[7px]')}>
          Garantía de mano de obra: {data.warrantyDays} días. Abandono: {data.abandonmentDays} días.
        </p>
      </div>

      <SignatureRow compact={narrow} />

      {data.evidenceCount > 0 ? (
        <p className={cn('mt-1.5 text-center leading-snug', narrow ? 'text-[6px]' : 'text-[6.5px]')}>
          Evidencias: {data.evidenceCount} foto{data.evidenceCount === 1 ? '' : 's'} registrada
          {data.evidenceCount === 1 ? '' : 's'} en el sistema digital. No se imprimen.
        </p>
      ) : null}

      <p className={cn('mt-3 border-t border-black/20 pt-1.5 text-center leading-snug', narrow ? 'text-[6px]' : 'text-[6.5px]')}>
        Conserve este comprobante para reclamar su equipo. Documento interno sin valor fiscal DIAN.
      </p>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[6.5px] font-semibold uppercase tracking-[0.08em] opacity-60">{label}</p>
      <p className="break-words text-[8px] font-medium leading-snug">{value}</p>
    </div>
  )
}

function Block({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[6.5px] font-semibold uppercase tracking-[0.08em] opacity-60">{label}</p>
      <p className={cn('mt-0.5 break-words leading-snug', strong ? 'text-[8px] font-semibold' : 'text-[7.5px]')}>{value}</p>
    </div>
  )
}

function A4Copy({
  order,
  data,
  copyLabel
}: {
  order: WorkOrder
  data: DocumentData
  copyLabel: string
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const measuredRef = useRef('')
  const [scale, setScale] = useState(1)
  const measureKey = `${order.id}|${copyLabel}|${data.legalVersion}`
  const technicalEntries = technicalSheetEntries(data.technicalSheet)

  // Cada copia dispone de media hoja. Si una OT trae más texto (cláusulas
  // ampliadas, fallas extensas), se reduce uniformemente para conservar todo el
  // contenido y las firmas antes de la línea de corte.
  useLayoutEffect(() => {
    if (measuredRef.current === measureKey) return
    let cancelled = false
    setScale(1)
    const raf = window.requestAnimationFrame(() => {
      if (cancelled) return
      const frame = frameRef.current
      const content = contentRef.current
      if (!frame || !content) return
      const available = frame.clientHeight
      const needed = content.scrollHeight
      if (available > 0 && needed > available + 1) {
        setScale(Math.max(0.6, Math.min(1, available / needed)))
      }
      measuredRef.current = measureKey
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
    }
  }, [measureKey])

  return (
    <div ref={frameRef} className="min-h-0 flex-1 overflow-hidden">
      <div
        className="h-full origin-top-left"
        style={scale < 1 ? { transform: `scale(${scale})`, width: `${100 / scale}%` } : undefined}
      >
        <div ref={contentRef} className="flex h-full min-h-0 flex-col text-[7px] leading-[1.35] text-black">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Header data={data} compact />
            </div>
            <div className="w-[55mm] shrink-0 border-l border-black/25 pl-3 text-right">
              <p className="text-[6.5px] font-semibold uppercase tracking-[0.14em] opacity-60">Comprobante de ingreso</p>
              <p className="font-display text-[22px] font-black leading-none tracking-tight">{order.number}</p>
              {order.trackingCode ? (
                <p className="mt-1 text-[8px] font-semibold tracking-[0.08em]">
                  Seguimiento: {order.trackingCode}
                </p>
              ) : null}
              <Barcode value={order.number} height={30} className="mt-1" />
            </div>
          </div>

          <div className="mt-1.5 flex items-center justify-between border-y border-black/30 bg-black/[0.03] px-2 py-1">
            <p className="text-[8px] font-bold uppercase tracking-[0.12em]">{copyLabel}</p>
            <p className="text-[7px]">Recepción: {formatDateTime(data.receivedAt)} · {data.receivedBy}</p>
          </div>

          <div className="mt-1.5 grid grid-cols-4 gap-x-3 gap-y-1.5">
            <Info label="Cliente" value={data.customerName} />
            <Info label="Documento" value={data.customerDocument} />
            <Info label="Teléfono" value={data.customerPhone} />
            <Info label="Equipo" value={order.equipmentType} />
            <Info label="Marca" value={data.customBuild ? 'Armado' : order.brand} />
            <Info label="Modelo" value={order.model} />
            <Info label={data.customBuild ? 'Código interno' : 'Serial'} value={data.serial} />
            <Info label="Técnico receptor" value={data.receivedBy} />
          </div>

          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <Block label="Accesorios dejados" value={data.accessories} />
            <Block label="Estado de encendido" value={data.powerState} />
            <Block
              label="Condición física"
              value={[
                data.conditionSummary,
                data.internalComponents && !data.conditionSummary.toLowerCase().includes('interior:')
                  ? `Interior: ${data.internalComponents}`
                  : '',
                data.includesExternalDrives ? 'Incluye discos o periféricos externos' : ''
              ]
                .filter(Boolean)
                .join(' · ')}
            />
            <Block label="Bloqueo y autorización" value={data.lockSummary} />
          </div>

          {technicalEntries.length ? (
            <div className="mt-1.5 rounded border border-black/25 px-2 py-1">
              <p className="text-[6.5px] font-semibold uppercase tracking-[0.08em] opacity-60">Ficha técnica registrada</p>
              <p className="mt-0.5 text-[7px] leading-snug">
                {technicalEntries.map(([label, value]) => `${label}: ${value}`).join(' · ')}
              </p>
            </div>
          ) : null}

          <div className="mt-1.5 rounded border border-black/30 px-2 py-1">
            <p className="text-[6.5px] font-semibold uppercase tracking-[0.08em] opacity-60">
              {order.intake?.serviceKind === 'mantenimiento' ? 'Servicio solicitado' : 'Falla reportada por el cliente'}
            </p>
            <p className="mt-0.5 text-[8px] font-semibold leading-snug">{order.reportedIssue}</p>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[7px]">
              {data.estimate > 0 ? <span>Presupuesto estimado: <b>{formatCurrency(data.estimate)}</b></span> : null}
              {data.diagnosticFee > 0 ? <span>Revisión / diagnóstico: <b>{formatCurrency(data.diagnosticFee)}</b></span> : null}
              <span className="opacity-70">El cobro definitivo se realiza al entregar el equipo.</span>
            </div>
          </div>

          <div className="mt-1.5">
            <p className="text-[6.5px] font-semibold uppercase tracking-[0.1em] opacity-60">
              Términos legales completos
            </p>
            <ol className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0 pl-3 text-[7px] leading-[1.3]">
              {data.fullClauses.map((clause, index) => (
                <li key={`${index}-${clause.slice(0, 20)}`} className="list-decimal">
                  {clause}
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-1.5 border-t border-black/30 pt-1.5">
            <div className="flex items-center justify-between text-[6.5px]">
              <span>Garantía de mano de obra y repuestos del taller: {data.warrantyDays} días.</span>
              <span>Abandono: {data.abandonmentDays} días calendario.</span>
            </div>
            {data.evidenceCount > 0 ? (
              <p className="mt-0.5 text-[6.5px]">
                Evidencias fotográficas: {data.evidenceCount} registrada{data.evidenceCount === 1 ? '' : 's'} en el sistema digital, sin anexo impreso.
              </p>
            ) : null}
            <SignatureRow />
            <p className="mt-1.5 text-center text-[6px] opacity-60">
              Documento interno de recepción sin valor fiscal DIAN. La firma del cliente acredita el estado y los accesorios aquí registrados.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function A4Sheet({ order, data }: { order: WorkOrder; data: DocumentData }) {
  return (
    <div className="order-print-sheet order-print-a4 flex h-[296mm] w-[210mm] flex-col bg-white px-[10mm] py-[7mm] text-black">
      <A4Copy order={order} data={data} copyLabel="Copia cliente" />
      <div className="my-[2mm] flex items-center gap-2 text-[6.5px] uppercase tracking-[0.12em] text-black/50">
        <span className="flex-1 border-t border-dashed border-black/40" />
        <Scissors className="h-3 w-3" />
        Cortar aquí · copia cliente / copia taller
        <span className="flex-1 border-t border-dashed border-black/40" />
      </div>
      <A4Copy order={order} data={data} copyLabel="Copia taller" />
    </div>
  )
}

export function DocumentPreviewModal({
  order,
  customer = null,
  legal = defaultLegalConfig,
  open,
  onClose,
  initialFormat = '80mm'
}: {
  order: WorkOrder | null
  customer?: Customer | null
  legal?: LegalConfig
  open: boolean
  onClose: () => void
  initialFormat?: DocumentFormat
}) {
  const [format, setFormat] = useState<DocumentFormat>(initialFormat)
  const [ticketHeightMm, setTicketHeightMm] = useState(0)

  useEffect(() => {
    if (open) setFormat(initialFormat)
  }, [open, initialFormat])

  // El alto del ticket es dinámico: se mide la tirilla real y se ajusta el
  // tamaño de página de impresión. Así el PDF térmico no agrega una página en
  // blanco ni recorta contenido cuando la OT trae más datos.
  useLayoutEffect(() => {
    if (!open || format === 'a4') return
    const sheet = document.querySelector<HTMLElement>('.order-print-root .order-print-ticket')
    if (!sheet) return
    const measure = () => {
      const height = sheet.getBoundingClientRect().height
      if (height <= 0) return
      const next = Math.ceil((height * 25.4) / 96 + 1)
      setTicketHeightMm((previous) => (previous === next ? previous : next))
    }
    measure()
    const raf = window.requestAnimationFrame(measure)
    return () => window.cancelAnimationFrame(raf)
  }, [open, format, order])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open || !order) return null

  const data = buildData(order, customer, legal)
  const pageSize =
    format === 'a4'
      ? 'A4 portrait'
      : format === '80mm'
        ? `80mm ${ticketHeightMm || 200}mm`
        : `58mm ${ticketHeightMm || 200}mm`

  return createPortal(
    <>
      <div className="no-print fixed inset-0 z-[95] flex flex-col bg-slate-950/45 backdrop-blur-sm">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-5">
          <div>
            <p className="text-[13px] font-bold text-white">Vista previa del comprobante</p>
            <p className="mt-0.5 text-[10px] text-white/55">{order.number} · {order.customerName} · sin IVA</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden rounded-xl bg-white/10 p-1 sm:flex">
              {formatOptions.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFormat(option.value)}
                    className={cn(
                      'focus-ring flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold transition',
                      format === option.value ? 'bg-white text-ink shadow-sm' : 'text-white/70 hover:bg-white/10'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                  </button>
                )
              })}
            </div>
            <Button size="sm" onClick={() => window.print()} leftIcon={<Printer className="h-3.5 w-3.5" />}>
              Imprimir
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/80 transition hover:bg-white/20"
              aria-label="Cerrar vista previa"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 px-3 pb-1 pt-2 sm:hidden">
          <div className="flex w-full gap-1 rounded-xl bg-white/10 p-1">
            {formatOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFormat(option.value)}
                className={cn(
                  'focus-ring flex-1 rounded-lg px-2 py-2 text-[9px] font-semibold transition',
                  format === option.value ? 'bg-white text-ink' : 'text-white/70'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6">
          <div className="mx-auto w-fit">
            {format === 'a4' ? (
              <A4Sheet order={order} data={data} />
            ) : (
              <TicketSheet order={order} data={data} variant={format} />
            )}
          </div>
          <p className="mx-auto mt-4 max-w-lg text-center text-[10px] leading-relaxed text-white/50">
            {format === 'a4'
              ? 'Dos copias en una hoja con línea de corte. El tamaño de impresión se ajusta a A4/Carta.'
              : 'El largo se calcula con el contenido real. No se agregan centímetros en blanco al final del ticket.'}
          </p>
        </div>
      </div>

      <style>{`@media print { @page { size: ${pageSize}; margin: 0; } }`}</style>
      <div
        aria-hidden="true"
        className="order-print-root pointer-events-none invisible fixed -left-[1000px] top-0 -z-50 print:visible print:static print:z-auto"
      >
        {format === 'a4' ? <A4Sheet order={order} data={data} /> : <TicketSheet order={order} data={data} variant={format} />}
      </div>
    </>,
    document.body
  )
}
