import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Copy,
  Download,
  Eye,
  Fingerprint,
  KeyRound,
  Link2,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound
} from 'lucide-react'
import { toast } from 'sonner'
import type { AuditEvent } from '@/types'
import { formatDateTime } from '@/lib/format'
import { downloadCsv } from '@/lib/download'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { SearchInput, Select } from '@/components/ui/Input'
import { Drawer } from '@/components/ui/Drawer'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

type BadgeTone = 'danger' | 'warning' | 'brand' | 'sky' | 'success' | 'neutral'

function actionTone(action: string): BadgeTone {
  const value = action.toLowerCase()
  if (value.includes('anul') || value.includes('sin cobro') || value.includes('purga') || value.includes('restaur')) return 'danger'
  if (value.includes('precio') || value.includes('descuento') || value.includes('excep')) return 'warning'
  if (value.includes('sesión') || value.includes('usuario')) return 'neutral'
  if (value.includes('estado') || value.includes('ot') || value.includes('orden')) return 'sky'
  if (value.includes('caja')) return 'success'
  return 'brand'
}

export function AuditPage() {
  const { data, loading, error, reload, setData } = useApi(async () => {
    const [events, verification] = await Promise.all([api.audit.list(), api.audit.verify()])
    return { events, verification }
  }, [])
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('Todas las acciones')
  const [selected, setSelected] = useState<AuditEvent | null>(null)
  const [integrityOpen, setIntegrityOpen] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null)

  const events = useMemo(() => data?.events ?? [], [data?.events])
  const verification = data?.verification ?? null

  useEffect(() => {
    if (data) setVerifiedAt(new Date().toISOString())
  }, [data])

  const actionOptions = useMemo(
    () => ['Todas las acciones', ...Array.from(new Set(events.map((event) => event.action)))],
    [events]
  )

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return events.filter((event) => {
      const matchesQuery =
        !term ||
        event.user.toLowerCase().includes(term) ||
        event.entity.toLowerCase().includes(term) ||
        event.detail.toLowerCase().includes(term) ||
        event.hash.toLowerCase().includes(term)
      const matchesAction = action === 'Todas las acciones' || event.action === action
      return matchesQuery && matchesAction
    })
  }, [events, query, action])

  function exportAudit() {
    downloadCsv('bitacoretech-auditoria.csv', [
      ['Fecha', 'Usuario', 'Rol', 'Acción', 'Entidad', 'Detalle', 'Hash', 'Hash anterior'],
      ...filtered.map((event) => [
        formatDateTime(event.time),
        event.user,
        event.role,
        event.action,
        event.entity,
        event.detail,
        event.hash,
        event.prevHash
      ])
    ])
    toast.success('Auditoría exportada', { description: 'CSV con los eventos visibles y su cadena de hashes.' })
  }

  async function verifyChain() {
    if (verifying) return
    setVerifying(true)
    try {
      const result = await api.audit.verify()
      setData((current) => (current ? { ...current, verification: result } : current))
      setVerifiedAt(new Date().toISOString())
      if (result.valid) {
        toast.success('Cadena de integridad verificada', {
          description: `${result.checked} eventos comprobados · sin alteraciones detectadas.`
        })
      } else {
        toast.error('La cadena de auditoría está rota', {
          description: `Evento inconsistente: ${result.brokenAt ?? 'desconocido'}. Revisa el registro.`
        })
      }
    } catch (failure) {
      toast.error('No se pudo verificar la cadena', { description: errorMessage(failure) })
    } finally {
      setVerifying(false)
    }
  }

  function copyHash(hash: string) {
    navigator.clipboard
      ?.writeText(hash)
      .then(() => toast.success('Hash copiado'))
      .catch(() => toast.error('No se pudo copiar el hash'))
  }

  const integrityOk = verification?.valid ?? false
  const stats = [
    {
      label: 'Eventos registrados',
      value: String(events.length),
      icon: ShieldCheck,
      tone: 'bg-brand-50 text-brand-600',
      hint: 'en el registro local'
    },
    {
      label: 'Usuarios en el registro',
      value: String(new Set(events.map((event) => event.user)).size),
      icon: UserRound,
      tone: 'bg-sky-50 text-sky-600',
      hint: 'con actividad'
    },
    {
      label: 'Integridad de la cadena',
      value: verification ? (integrityOk ? 'Válida' : 'Rota') : 'Sin verificar',
      icon: Link2,
      tone: integrityOk ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600',
      hint: verification ? `${verification.checked} eventos verificados` : 'ejecuta la verificación'
    },
    {
      label: 'Última verificación',
      value: verifiedAt ? formatDateTime(verifiedAt) : 'Pendiente',
      icon: ClipboardCheck,
      tone: 'bg-warning-50 text-warning-600',
      hint: 'cadena SHA-256'
    }
  ]

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando auditoría…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudo cargar la auditoría</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Auditoría"
        description="Registro inmutable de las operaciones críticas. Cada evento encadena el hash del anterior."
        actions={
          <>
            <Button variant="secondary" onClick={() => setIntegrityOpen(true)} leftIcon={<Fingerprint className="h-4 w-4" />}>
              Verificar integridad
            </Button>
            <Button onClick={exportAudit} leftIcon={<Download className="h-4 w-4" />}>
              Exportar
            </Button>
          </>
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card flex items-center gap-3.5 p-4">
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', stat.tone)}>
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className={cn('truncate font-display font-bold leading-none text-ink', stat.label === 'Última verificación' ? 'text-[13px]' : 'text-[22px]')}>
                  {stat.value}
                </p>
                <p className="mt-1.5 text-[10px] text-slate-500">{stat.label}</p>
                <p className="mt-0.5 text-[9px] text-slate-400">{stat.hint}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-col justify-between gap-2 rounded-2xl border border-brand-100 bg-brand-50/60 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex items-start gap-2.5">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <p className="text-[11px] leading-relaxed text-brand-900">
            <span className="font-semibold">Módulo exclusivo del propietario.</span> Admin, Técnico y Cajero no ven este módulo ni pueden abrirlo por URL. Las acciones del propietario también se registran aquí.
          </p>
        </div>
        <Badge variant="brand">Acceso total</Badge>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink">Registro de eventos</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {filtered.length} eventos visibles · ordenados del más reciente al más antiguo
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              placeholder="Buscar usuario, entidad, hash..."
              wrapClassName="w-full sm:w-[280px]"
            />
            <div className="relative">
              <Select
                value={action}
                onChange={(event) => setAction(event.target.value)}
                className="h-10 w-full pl-3 pr-8 text-[10px] font-semibold sm:w-[230px]"
              >
                {actionOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed">
            <thead>
              <tr className="border-b border-line bg-slate-50/60">
                <th className="table-th w-[16%] pl-5 lg:pl-6">Fecha / hora</th>
                <th className="table-th w-[15%]">Usuario</th>
                <th className="table-th w-[20%]">Acción</th>
                <th className="table-th w-[12%]">Entidad</th>
                <th className="table-th w-[19%]">Detalle</th>
                <th className="table-th w-[10%]">Hash</th>
                <th className="table-th w-[8%] pr-5 text-right lg:pr-6"> </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr
                  key={event.id}
                  onClick={() => setSelected(event)}
                  className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-slate-50/60"
                >
                  <td className="table-td pl-5 lg:pl-6">
                    <p className="text-[11px] font-medium text-ink">{formatDateTime(event.time)}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">{event.id}</p>
                  </td>
                  <td className="table-td">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                          event.role === 'Propietario' || event.role === 'Superadmin'
                            ? 'bg-warning-50 text-warning-600'
                            : 'bg-brand-50 text-brand-600'
                        )}
                      >
                        {event.role === 'Propietario' || event.role === 'Superadmin' ? (
                          <KeyRound className="h-3 w-3" />
                        ) : (
                          <UserRound className="h-3 w-3" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-ink">{event.user}</p>
                        <p className="truncate text-[9px] text-slate-400">{event.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="table-td">
                    <Badge variant={actionTone(event.action)}>{event.action}</Badge>
                  </td>
                  <td className="table-td truncate text-[11px] font-medium text-slate-600">{event.entityName ?? event.entity}</td>
                  <td className="table-td">
                    <p className="truncate text-[10px] text-slate-500">{event.detail}</p>
                  </td>
                  <td className="table-td">
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-[9px] text-slate-500">
                      <Link2 className="h-2.5 w-2.5" />
                      {event.hash.slice(0, 8)}
                    </span>
                  </td>
                  <td className="table-td pr-5 text-right lg:pr-6">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400">
                      <Eye className="h-3.5 w-3.5" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!filtered.length ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <Search className="h-6 w-6 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-ink">Sin eventos</p>
            <p className="mt-1 text-xs text-slate-500">Ajusta la búsqueda o el tipo de acción.</p>
          </div>
        ) : null}

        <div className="flex flex-col items-start justify-between gap-2 border-t border-line px-5 py-3.5 text-[10px] text-slate-400 sm:flex-row sm:items-center lg:px-6">
          <span>Registro encadenado · {filtered.length} eventos · hash SHA-256.</span>
          {integrityOk ? (
            <span className="flex items-center gap-1.5 text-success-700">
              <CheckCircle2 className="h-3 w-3" />
              Integridad verificada
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-danger-600">
              <AlertTriangle className="h-3 w-3" />
              {verification ? 'Cadena inconsistente' : 'Sin verificar'}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3.5 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <KeyRound className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold text-ink">Registro no desactivable</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                Las acciones del propietario se registran siempre. La cuenta raíz no puede desactivar este registro, solo consultarlo.
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-50 text-warning-600">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold text-ink">Acciones sensibles protegidas</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                Anulaciones, restauración de backups y purgas exigen clave adicional y quedan vinculadas al usuario.
              </p>
            </div>
          </div>
        </div>
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Detalle del evento"
        description={selected ? `${selected.action} · ${selected.entityName ?? selected.entity}` : ''}
        width="md"
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[12px] font-bold text-ink">{selected.user}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge variant={selected.role === 'Propietario' || selected.role === 'Superadmin' ? 'warning' : 'brand'}>
                    {selected.role}
                  </Badge>
                  <Badge variant={actionTone(selected.action)}>{selected.action}</Badge>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-slate-50/60 px-3.5 py-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Descripción</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{selected.detail}</p>
            </div>

            <div className="divide-y divide-line rounded-xl border border-line">
              {[
                ['Fecha y hora', formatDateTime(selected.time)],
                ['Entidad afectada', selected.entity],
                ['Rol', selected.role]
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="text-[10px] text-slate-400">{label}</span>
                  <span className="text-[11px] font-medium text-ink">{value}</span>
                </div>
              ))}
            </div>

            <div>
              <p className="field-label">Cadena de integridad</p>
              <div className="space-y-2">
                <div className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      <Link2 className="h-3 w-3" /> Hash del evento
                    </span>
                    <button
                      type="button"
                      onClick={() => copyHash(selected.hash)}
                      className="focus-ring flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-ink"
                      aria-label="Copiar hash"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="mt-1.5 break-all font-mono text-[10px] text-ink">{selected.hash}</p>
                </div>
                <div className="rounded-xl border border-line p-3">
                  <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    <Link2 className="h-3 w-3" /> Hash anterior
                  </span>
                  <p className="mt-1.5 break-all font-mono text-[10px] text-slate-500">{selected.prevHash}</p>
                </div>
              </div>
            </div>

            {verification?.valid ? (
              <div className="flex items-center gap-2 rounded-xl border border-success-100 bg-success-50 px-3.5 py-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" />
                <p className="text-[10px] leading-relaxed text-success-700">
                  Evento encadenado correctamente. El hash coincide con la verificación de integridad.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-danger-100 bg-danger-50 px-3.5 py-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 text-danger-600" />
                <p className="text-[10px] leading-relaxed text-danger-700">
                  {verification
                    ? `La cadena no es válida. Primer evento inconsistente: ${verification.brokenAt ?? 'desconocido'}.`
                    : 'Ejecuta la verificación de integridad para comprobar este evento.'}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={integrityOpen}
        onClose={() => setIntegrityOpen(false)}
        title="Verificación de integridad"
        description="Comprobación de la cadena de hashes de la auditoría."
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] text-slate-400">
              {verifiedAt ? `Última verificación: ${formatDateTime(verifiedAt)}` : 'Sin verificar'}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setIntegrityOpen(false)}>
                Cerrar
              </Button>
              <Button onClick={() => void verifyChain()} loading={verifying} leftIcon={<Fingerprint className="h-4 w-4" />}>
                Verificar ahora
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div
            className={cn(
              'flex items-center gap-3 rounded-2xl border p-4',
              integrityOk ? 'border-success-100 bg-success-50/70' : 'border-danger-100 bg-danger-50/70'
            )}
          >
            <span
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm',
                integrityOk ? 'text-success-600' : 'text-danger-600'
              )}
            >
              {integrityOk ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            </span>
            <div>
              <p className={cn('text-[12px] font-semibold', integrityOk ? 'text-success-800' : 'text-danger-800')}>
                {verification ? (integrityOk ? 'Cadena íntegra' : 'Cadena inconsistente') : 'Sin verificar'}
              </p>
              <p className={cn('mt-0.5 text-[10px]', integrityOk ? 'text-success-700/80' : 'text-danger-700/80')}>
                {verification
                  ? integrityOk
                    ? `${verification.checked} eventos comprobados sin alteraciones.`
                    : `Primer evento inconsistente: ${verification.brokenAt ?? 'desconocido'}.`
                  : 'Pulsa verificar ahora para comprobar la cadena completa.'}
              </p>
            </div>
            <Badge variant={integrityOk ? 'success' : 'danger'} dot className="ml-auto">
              {integrityOk ? 'Válida' : 'Rota'}
            </Badge>
          </div>

          <div className="rounded-xl border border-line p-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Cómo funciona</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              Cada evento guarda el hash SHA-256 del evento anterior. Si alguien modifica un registro, la cadena se rompe y la
              verificación lo detecta. El registro solo se puede consultar y exportar.
            </p>
          </div>

          <div className="space-y-2">
            {events.slice(0, 3).map((event, index) => {
              const broken = verification ? !verification.valid && verification.brokenAt === event.id : false
              return (
                <div key={event.id} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5">
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                      broken ? 'bg-danger-50 text-danger-600' : 'bg-success-50 text-success-600'
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold text-ink">{event.action}</p>
                    <p className="font-mono text-[9px] text-slate-400">{event.hash}</p>
                  </div>
                  {broken ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-danger-500" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success-500" />
                  )}
                </div>
              )
            })}
            {!events.length ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-[10px] text-slate-400">
                El registro está vacío.
              </p>
            ) : null}
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-warning-100 bg-warning-50/70 px-3.5 py-2.5">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-600" />
            <p className="text-[10px] leading-relaxed text-warning-800">
              Como propietario puedes exportar el registro completo para auditoría externa.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
