import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Banknote, CreditCard, Landmark, ReceiptText, Wallet } from 'lucide-react'
import type { CashSession } from '@/types'
import { formatCurrency } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'

export function CashSummary({ session }: { session: CashSession | null }) {
  const navigate = useNavigate()
  if (!session) {
    return (
      <div className="card flex flex-col items-center justify-center p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <Wallet className="h-5 w-5" />
        </span>
        <h2 className="mt-4 font-display text-[16px] font-bold text-ink">Caja cerrada</h2>
        <p className="mt-1 max-w-xs text-[11px] text-slate-500">Abre un turno desde Caja para ver el resumen del efectivo y los movimientos.</p>
        <button
          type="button"
          onClick={() => navigate('/caja')}
          className="focus-ring mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-[11px] font-semibold text-white"
        >
          Abrir control de caja
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  const rows = [
    { label: 'Base inicial', value: session.initialAmount, icon: Wallet, tone: 'bg-slate-100 text-slate-500' },
    { label: 'Ventas en efectivo', value: session.cashSales, icon: Banknote, tone: 'bg-success-50 text-success-600' },
    { label: 'Ventas digitales', value: session.digitalSales, icon: CreditCard, tone: 'bg-sky-50 text-sky-600' },
    { label: 'Egresos del turno', value: -session.expenses, icon: ReceiptText, tone: 'bg-danger-50 text-danger-600' }
  ]

  return (
    <div className="card flex flex-col p-5 lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[16px] font-bold text-ink">Resumen de caja</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">Turno #{session.id} · {session.user}</p>
        </div>
        <Badge variant="success" dot>
          Abierto
        </Badge>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {rows.map((row) => {
          const Icon = row.icon
          return (
            <div key={row.label} className="rounded-xl border border-line bg-slate-50/60 p-3">
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${row.tone}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <p className="mt-2 text-[10px] font-medium text-slate-400">{row.label}</p>
              <p className={`tabular mt-0.5 text-[13px] font-bold ${row.value < 0 ? 'text-danger-600' : 'text-ink'}`}>
                {formatCurrency(row.value)}
              </p>
            </div>
          )
        })}
      </div>

      <div className="mt-4 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-600">Efectivo esperado</p>
            <p className="tabular mt-1 font-display text-[24px] font-bold leading-none tracking-[-0.02em] text-brand-900">
              {formatCurrency(session.expected)}
            </p>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm">
            <Landmark className="h-[18px] w-[18px]" />
          </span>
        </div>
        <p className="mt-2 text-[10px] text-brand-700/60">Base + ventas en efectivo − egresos del turno.</p>
      </div>

      <button
        type="button"
        onClick={() => navigate('/caja')}
        className="focus-ring mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-white text-[11px] font-semibold text-slate-600 shadow-sm transition hover:text-ink"
      >
        Abrir control de caja
        <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
