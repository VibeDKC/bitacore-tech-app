import { useEffect, useState } from 'react'
import { Copy, MessageCircle, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_MESSAGES, MESSAGE_VARIABLES, renderMessageTemplate, type MessageTemplates } from '@/types'
import { Button } from '@/components/ui/Button'

const sample = {
  cliente: 'Camila Ríos',
  equipo: 'portátil',
  marca: 'Lenovo',
  modelo: 'ThinkPad T14',
  serial: 'PF-3A7K21',
  ot: 'OT-002341',
  estado: 'En diagnóstico',
  diagnostico: 'Falla en el módulo de carga; requiere cambio del conector USB-C.',
  presupuesto: '$180.000',
  total: '$180.000',
  saldo: '$0',
  taller: 'BitacoreTech Taller & POS',
  telefono: '604 322 1188',
  fecha: '26 de octubre de 2026'
}

export function MessagesPanel({
  value,
  saving,
  onSave
}: {
  value: MessageTemplates
  saving?: boolean
  onSave: (value: MessageTemplates) => Promise<void>
}) {
  const [draft, setDraft] = useState<MessageTemplates>(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  async function copyVariable(variable: string) {
    try {
      await navigator.clipboard.writeText(variable)
      toast.success('Variable copiada', { description: variable })
    } catch {
      toast.error('No se pudo copiar la variable')
    }
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink">Mensajes para clientes</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Se usan en WhatsApp y en los reportes de diagnóstico.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDraft(DEFAULT_MESSAGES)}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              Restaurar
            </Button>
            <Button size="sm" onClick={() => void onSave(draft)} loading={saving} leftIcon={<Save className="h-3.5 w-3.5" />}>
              Guardar mensajes
            </Button>
          </div>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-2 lg:p-6">
          <div className="rounded-xl border border-line p-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <MessageCircle className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[11px] font-bold text-ink">Ingreso / diagnóstico inicial</p>
                <p className="text-[9px] text-slate-400">Estado del equipo y cotización inicial.</p>
              </div>
            </div>
            <textarea
              value={draft.initial}
              onChange={(event) => setDraft({ ...draft, initial: event.target.value })}
              rows={6}
              maxLength={4000}
              className="field mt-3 resize-none text-[11px] leading-relaxed"
            />
            <div className="mt-2 rounded-xl border border-brand-100 bg-brand-50/50 px-3 py-2.5">
              <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-brand-500">Vista previa</p>
              <p className="mt-1 text-[10px] leading-relaxed text-brand-900">
                {renderMessageTemplate(draft.initial, sample)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-line p-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-success-50 text-success-600">
                <MessageCircle className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[11px] font-bold text-ink">Equipo listo / entrega</p>
                <p className="text-[9px] text-slate-400">Aviso de retiro, total y saldo.</p>
              </div>
            </div>
            <textarea
              value={draft.ready}
              onChange={(event) => setDraft({ ...draft, ready: event.target.value })}
              rows={6}
              maxLength={4000}
              className="field mt-3 resize-none text-[11px] leading-relaxed"
            />
            <div className="mt-2 rounded-xl border border-success-100 bg-success-50/50 px-3 py-2.5">
              <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-success-600">Vista previa</p>
              <p className="mt-1 text-[10px] leading-relaxed text-success-900">
                {renderMessageTemplate(draft.ready, sample)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-5 lg:p-6">
        <p className="text-[11px] font-bold text-ink">Variables disponibles</p>
        <p className="mt-0.5 text-[10px] text-slate-400">
          Haz clic para copiar una variable y pégala dentro del mensaje. Los valores se reemplazan al generar el reporte.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {MESSAGE_VARIABLES.map((variable) => (
            <button
              key={variable}
              type="button"
              onClick={() => void copyVariable(variable)}
              className="focus-ring inline-flex items-center gap-1 rounded-lg border border-line bg-slate-50 px-2 py-1 font-mono text-[9px] text-slate-500 transition hover:border-brand-200 hover:text-brand-600"
            >
              <Copy className="h-2.5 w-2.5" />
              {variable}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
