import { useMemo, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Calculator,
  CheckCircle2,
  CreditCard,
  Landmark,
  LockKeyhole,
  Minus,
  Plus,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet
} from 'lucide-react'
import { toast } from 'sonner'
import type { CashMovement, PaymentMethod } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { formatCurrency, formatDateTime, formatTime } from '@/lib/format'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { SegmentedTabs } from '@/components/ui/Tabs'
import { cn } from '@/lib/utils'

const denominations = [100000, 50000, 20000, 10000, 5000, 1000, 500]

const movementTone: Record<CashMovement['type'], { label: string; tone: 'success' | 'danger' | 'brand'; icon: typeof ArrowUpRight }> = {
  venta: { label: 'Venta', tone: 'brand', icon: ReceiptText },
  ingreso: { label: 'Ingreso', tone: 'success', icon: ArrowUpRight },
  egreso: { label: 'Egreso', tone: 'danger', icon: ArrowDownLeft }
}

const manualMethods: PaymentMethod[] = ['Efectivo', 'Transferencia', 'Tarjeta']

function parseMoney(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

export function CashPage() {
  const { role } = useAuth()
  const { data, loading, error, reload, setData } = useApi(() => api.cash.current(), [])
  const [filter, setFilter] = useState<'todos' | 'ventas' | 'ingresos' | 'egresos'>('todos')
  const [movementOpen, setMovementOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [openTurnOpen, setOpenTurnOpen] = useState(false)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [baseAmount, setBaseAmount] = useState('200000')
  const [saving, setSaving] = useState(false)
  const [movementForm, setMovementForm] = useState({
    type: 'ingreso' as 'ingreso' | 'egreso',
    method: 'Efectivo' as PaymentMethod,
    amount: '',
    reason: ''
  })

  const canClose = can(role, 'closeCash')
  const current = data?.current ?? null
  const lastClosed = data?.lastClosed ?? null
  const session = current ?? lastClosed
  const movements = current?.movements ?? []

  const summary = useMemo(() => {
    if (!session) {
      return { cashSales: 0, digitalSales: 0, income: 0, expenses: 0, expected: 0, totalSales: 0 }
    }
    return {
      cashSales: session.cashSales,
      digitalSales: session.digitalSales,
      income: session.income,
      expenses: session.expenses,
      expected: session.expected,
      totalSales: session.sales
    }
  }, [session])

  const counted = denominations.reduce((sum, denomination) => sum + denomination * (Number(counts[denomination]) || 0), 0)
  const difference = counted - summary.expected

  const filteredMovements = movements.filter((movement) => {
    if (filter === 'todos') return true
    if (filter === 'ventas') return movement.type === 'venta'
    if (filter === 'ingresos') return movement.type === 'ingreso'
    return movement.type === 'egreso'
  })

  async function addMovement() {
    if (saving) return
    if (!movementForm.reason.trim() || parseMoney(movementForm.amount) <= 0) {
      toast.error('Completa el motivo y un valor válido')
      return
    }
    setSaving(true)
    try {
      const updated = await api.cash.addMovement({
        type: movementForm.type,
        method: movementForm.method,
        amount: parseMoney(movementForm.amount),
        reason: movementForm.reason.trim()
      })
      setData({ current: updated, lastClosed: null, movements: updated.movements })
      setMovementOpen(false)
      setMovementForm({ type: 'ingreso', method: 'Efectivo', amount: '', reason: '' })
      toast.success('Movimiento registrado', {
        description: `${movementForm.type === 'ingreso' ? 'Ingreso' : 'Egreso'} de ${formatCurrency(parseMoney(movementForm.amount))}`
      })
    } catch (failure) {
      toast.error('No se pudo registrar el movimiento', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  async function openCash() {
    if (saving) return
    setSaving(true)
    try {
      const session = await api.cash.open(parseMoney(baseAmount))
      setData({ current: session, lastClosed: null, movements: session.movements })
      setOpenTurnOpen(false)
      setBaseAmount('200000')
      toast.success(`Turno #${session.id} abierto`, {
        description: `Base inicial ${formatCurrency(session.initialAmount)} · ${session.user}`
      })
    } catch (failure) {
      toast.error('No se pudo abrir la caja', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  async function closeCash() {
    if (saving) return
    if (!counted) {
      toast.error('Ingresa el efectivo contado')
      return
    }
    setSaving(true)
    try {
      const closed = await api.cash.close(counted)
      setData({ current: null, lastClosed: closed, movements: [] })
      setCloseOpen(false)
      setCounts({})
      toast.success('Turno cerrado correctamente', {
        description: `Contado ${formatCurrency(counted)} · Diferencia ${formatCurrency(closed.difference ?? 0)}`
      })
      reload()
    } catch (failure) {
      toast.error('No se pudo cerrar la caja', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  const statCards = [
    { label: 'Base inicial', value: session?.initialAmount ?? 0, icon: Wallet, tone: 'bg-slate-100 text-slate-500' },
    { label: 'Ventas en efectivo', value: summary.cashSales, icon: Banknote, tone: 'bg-success-50 text-success-600' },
    { label: 'Ventas digitales', value: summary.digitalSales, icon: CreditCard, tone: 'bg-sky-50 text-sky-600' },
    { label: 'Ingresos extra', value: summary.income, icon: TrendingUp, tone: 'bg-brand-50 text-brand-600' },
    { label: 'Egresos', value: summary.expenses, icon: TrendingDown, tone: 'bg-danger-50 text-danger-600' }
  ]

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando caja…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudo cargar la caja</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>Reintentar</Button>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Control de caja"
          description="Apertura, movimientos y arqueo del turno con trazabilidad por usuario."
        />
        <div className="card flex flex-col items-center justify-center p-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Wallet className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink">No hay turno de caja</h2>
          <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-slate-500">
            Abre un turno con la base inicial para registrar ventas, anticipos y movimientos del día.
          </p>
          {canClose ? (
            <Button className="mt-4" onClick={() => setOpenTurnOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
              Abrir turno de caja
            </Button>
          ) : null}
        </div>

        <Modal
          open={openTurnOpen}
          onClose={() => setOpenTurnOpen(false)}
          title="Abrir turno de caja"
          description="Registra la base inicial en efectivo."
          size="sm"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpenTurnOpen(false)}>Cancelar</Button>
              <Button onClick={() => void openCash()} loading={saving}>Abrir turno</Button>
            </div>
          }
        >
          <label className="block">
            <span className="field-label">Base inicial</span>
            <input
              value={baseAmount}
              onChange={(event) => setBaseAmount(event.target.value)}
              inputMode="numeric"
              className="field text-right text-base font-semibold tabular"
            />
          </label>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            La base inicial se suma al efectivo esperado y queda registrada en la auditoría.
          </p>
        </Modal>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Control de caja"
        description="Apertura, movimientos y arqueo del turno con trazabilidad por usuario."
        actions={
          <>
            {!current ? (
              <Button variant="secondary" onClick={() => setOpenTurnOpen(true)} leftIcon={<RotateCcw className="h-4 w-4" />}>
                Abrir nuevo turno
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setMovementOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
                  Nuevo movimiento
                </Button>
                {canClose ? (
                  <Button onClick={() => setCloseOpen(true)} leftIcon={<Calculator className="h-4 w-4" />}>
                    Cerrar caja
                  </Button>
                ) : null}
              </>
            )}
          </>
        }
      />

      <div className="card flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
        <div className="flex items-center gap-3">
          <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', !current ? 'bg-slate-100 text-slate-500' : 'bg-success-50 text-success-600')}>
            {!current ? <LockKeyhole className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-bold text-ink">Turno #{session.id}</p>
              <Badge variant={current ? 'success' : 'neutral'} dot>
                {current ? 'Abierto' : 'Cerrado'}
              </Badge>
            </div>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {session.user} · {session.role} · apertura {formatDateTime(session.openedAt)}
            </p>
            {!current && session.closedAt ? (
              <p className="mt-0.5 text-[10px] text-slate-400">Cierre {formatDateTime(session.closedAt)}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              {current ? 'Efectivo esperado' : 'Diferencia del cierre'}
            </p>
            <p className="tabular font-display text-[20px] font-bold text-ink">
              {formatCurrency(current ? summary.expected : session.difference ?? 0)}
            </p>
          </div>
          <span className="h-9 w-px bg-line" />
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Ventas del turno</p>
            <p className="tabular font-display text-[20px] font-bold text-ink">{formatCurrency(summary.totalSales)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card p-4">
              <div className="flex items-center justify-between">
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', stat.tone)}>
                  <Icon className="h-4 w-4" />
                </span>
                {stat.label === 'Egresos' ? <Minus className="h-3 w-3 text-slate-300" /> : null}
              </div>
              <p className="tabular mt-3 font-display text-[20px] font-bold leading-none text-ink">{formatCurrency(stat.value)}</p>
              <p className="mt-1.5 text-[10px] text-slate-500">{stat.label}</p>
            </div>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,1fr)]">
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-[16px] font-bold text-ink">Movimientos del turno</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">{filteredMovements.length} registros</p>
            </div>
            <SegmentedTabs
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todos', label: 'Todos' },
                { value: 'ventas', label: 'Ventas' },
                { value: 'ingresos', label: 'Ingresos' },
                { value: 'egresos', label: 'Egresos' }
              ]}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[580px] table-fixed">
              <thead>
                <tr className="border-b border-line bg-slate-50/60">
                  <th className="table-th w-[44%] pl-5">Movimiento</th>
                  <th className="table-th w-[18%]">Método</th>
                  <th className="table-th w-[18%]">Usuario</th>
                  <th className="table-th w-[20%] pr-5 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filteredMovements.map((movement) => {
                  const meta = movementTone[movement.type]
                  const Icon = meta.icon
                  return (
                    <tr key={movement.id} className="border-b border-line/70 last:border-0 hover:bg-slate-50/50">
                      <td className="table-td pl-5">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                              movement.type === 'egreso' ? 'bg-danger-50 text-danger-600' : movement.type === 'ingreso' ? 'bg-success-50 text-success-600' : 'bg-brand-50 text-brand-600'
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="max-w-full truncate text-[11px] font-semibold text-ink">{movement.reason}</p>
                            <Badge variant={meta.tone} className="mt-1">
                              {meta.label}
                            </Badge>
                          </div>
                        </div>
                      </td>
                      <td className="table-td">
                        <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                          {movement.method === 'Efectivo' ? <Banknote className="h-3 w-3 text-slate-400" /> : movement.method === 'Tarjeta' ? <CreditCard className="h-3 w-3 text-slate-400" /> : <Landmark className="h-3 w-3 text-slate-400" />}
                          {movement.method}
                        </span>
                      </td>
                      <td className="table-td">
                        <p className="truncate text-[10px] font-medium text-ink">{movement.user}</p>
                        <p className="mt-0.5 text-[9px] text-slate-400">{formatTime(movement.time)}</p>
                      </td>
                      <td className={cn('table-td pr-5 text-right text-[12px] font-bold tabular', movement.type === 'egreso' ? 'text-danger-600' : 'text-ink')}>
                        {movement.type === 'egreso' ? '−' : ''}
                        {formatCurrency(movement.amount)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!filteredMovements.length ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <ReceiptText className="h-6 w-6 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-ink">Sin movimientos</p>
              <p className="mt-1 text-xs text-slate-500">
                {current ? 'No hay registros para este filtro.' : 'Este turno cerrado no tiene movimientos asociados.'}
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-[15px] font-bold text-ink">Arqueo del turno</h2>
              <Badge variant={current ? 'success' : 'neutral'} dot>
                {current ? 'En curso' : 'Cerrado'}
              </Badge>
            </div>

            <div className="mt-4 space-y-2.5 text-[11px]">
              <div className="flex items-center justify-between text-slate-500">
                <span>Base inicial</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(session.initialAmount)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>+ Ventas en efectivo</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(summary.cashSales)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>+ Ingresos extra</span>
                <span className="tabular font-semibold text-ink">{formatCurrency(summary.income)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>− Egresos</span>
                <span className="tabular font-semibold text-danger-600">{formatCurrency(summary.expenses)}</span>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-brand-600">Efectivo esperado en caja</p>
              <p className="tabular mt-1 font-display text-[26px] font-bold leading-none tracking-[-0.02em] text-brand-900">
                {formatCurrency(summary.expected)}
              </p>
              <p className="mt-2 text-[10px] text-brand-700/60">Base + ventas en efectivo + ingresos − egresos.</p>
            </div>

            {!current && session.counted !== null && session.counted !== undefined ? (
              <div className="mt-3 rounded-xl border border-line bg-slate-50 px-3 py-2.5 text-[10px] text-slate-500">
                <div className="flex items-center justify-between">
                  <span>Efectivo contado</span>
                  <span className="tabular font-semibold text-ink">{formatCurrency(session.counted)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span>Diferencia</span>
                  <span className={cn('tabular font-semibold', (session.difference ?? 0) === 0 ? 'text-success-600' : 'text-danger-600')}>
                    {formatCurrency(session.difference ?? 0)}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[10px] text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              Turno asociado a {session.user}
            </div>

            {current && canClose ? (
              <Button className="mt-3 w-full" variant="secondary" onClick={() => setCloseOpen(true)} leftIcon={<Calculator className="h-4 w-4" />}>
                Hacer arqueo y cerrar
              </Button>
            ) : null}
            {!current ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-success-100 bg-success-50 px-3 py-2.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" />
                <p className="text-[10px] leading-snug text-success-700">
                  Turno cerrado y registrado en auditoría. El siguiente turno inicia con una nueva base.
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-warning-100 bg-warning-50/60 p-4">
            <div className="flex items-start gap-2.5">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" />
              <div>
                <p className="text-[10px] font-semibold text-warning-900">Cierre con clave</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-warning-800/80">
                  El administrador puede cerrar el turno. La anulación de facturas exige una clave adicional y queda auditada.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={movementOpen}
        onClose={() => setMovementOpen(false)}
        title="Nuevo movimiento de caja"
        description="Registra un ingreso o egreso manual del turno."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMovementOpen(false)}>Cancelar</Button>
            <Button onClick={() => void addMovement()} loading={saving}>Registrar movimiento</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <span className="field-label">Tipo</span>
            <div className="grid grid-cols-2 gap-2">
              {(['ingreso', 'egreso'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMovementForm({ ...movementForm, type })}
                  className={cn(
                    'focus-ring flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[11px] font-semibold transition',
                    movementForm.type === type
                      ? type === 'ingreso'
                        ? 'border-success-200 bg-success-50 text-success-700'
                        : 'border-danger-200 bg-danger-50 text-danger-700'
                      : 'border-line bg-white text-slate-500'
                  )}
                >
                  {type === 'ingreso' ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                  {type === 'ingreso' ? 'Ingreso' : 'Egreso'}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="field-label">Método</span>
            <select
              value={movementForm.method}
              onChange={(event) => setMovementForm({ ...movementForm, method: event.target.value as PaymentMethod })}
              className="field"
            >
              {manualMethods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Valor</span>
            <input
              value={movementForm.amount}
              onChange={(event) => setMovementForm({ ...movementForm, amount: event.target.value })}
              className="field text-right text-base font-semibold tabular"
              inputMode="numeric"
              placeholder="0"
            />
          </label>
          <label className="block">
            <span className="field-label">Motivo</span>
            <input
              value={movementForm.reason}
              onChange={(event) => setMovementForm({ ...movementForm, reason: event.target.value })}
              className="field"
              placeholder="Ej. Compra de insumos"
            />
          </label>
          <div className="rounded-xl border border-line bg-slate-50 px-3.5 py-2.5 text-[10px] leading-relaxed text-slate-500">
            Todo movimiento manual queda vinculado al usuario y al turno activo.
          </div>
        </div>
      </Modal>

      <Modal
        open={openTurnOpen}
        onClose={() => setOpenTurnOpen(false)}
        title="Abrir turno de caja"
        description="Registra la base inicial en efectivo."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpenTurnOpen(false)}>Cancelar</Button>
            <Button onClick={() => void openCash()} loading={saving}>Abrir turno</Button>
          </div>
        }
      >
        <label className="block">
          <span className="field-label">Base inicial</span>
          <input
            value={baseAmount}
            onChange={(event) => setBaseAmount(event.target.value)}
            inputMode="numeric"
            className="field text-right text-base font-semibold tabular"
          />
        </label>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          La base inicial se suma al efectivo esperado y queda registrada en la auditoría.
        </p>
      </Modal>

      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Cerrar caja y hacer arqueo"
        description={`Turno #${session.id} · ${session.user}`}
        size="md"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[9px] uppercase tracking-[0.1em] text-slate-400">Diferencia</p>
              <p className={cn('tabular font-display text-lg font-bold', !counted ? 'text-slate-400' : difference === 0 ? 'text-success-600' : 'text-danger-600')}>
                {counted ? formatCurrency(difference) : '—'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setCloseOpen(false)}>Cancelar</Button>
              <Button onClick={() => void closeCash()} loading={saving} disabled={!counted} leftIcon={<CheckCircle2 className="h-4 w-4" />}>
                Confirmar cierre
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3.5">
            <div className="flex items-center justify-between text-[11px] text-brand-700">
              <span>Efectivo esperado</span>
              <span className="tabular font-bold text-brand-900">{formatCurrency(summary.expected)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-brand-700">
              <span>Efectivo contado</span>
              <span className="tabular font-bold text-brand-900">{formatCurrency(counted)}</span>
            </div>
          </div>

          <div>
            <p className="field-label">Conteo por denominación</p>
            <div className="divide-y divide-line rounded-xl border border-line">
              {denominations.map((denomination) => (
                <div key={denomination} className="flex items-center gap-3 px-3.5 py-2">
                  <span className="flex-1 text-[11px] text-slate-600">{formatCurrency(denomination)}</span>
                  <input
                    value={counts[denomination] ?? ''}
                    onChange={(event) => setCounts({ ...counts, [denomination]: event.target.value })}
                    inputMode="numeric"
                    placeholder="0"
                    className="h-8 w-16 rounded-lg border border-line bg-white px-2 text-right text-[11px] tabular outline-none focus:border-brand-300 focus:ring-4 focus:ring-brand-100/60"
                  />
                  <span className="tabular w-24 text-right text-[11px] font-semibold text-ink">
                    {formatCurrency(denomination * (Number(counts[denomination]) || 0))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-line bg-slate-50/60 px-3.5 py-3">
            <span className="text-[11px] font-semibold text-slate-600">Total contado</span>
            <span className="tabular font-display text-xl font-bold text-ink">{formatCurrency(counted)}</span>
          </div>
        </div>
      </Modal>
    </div>
  )
}
