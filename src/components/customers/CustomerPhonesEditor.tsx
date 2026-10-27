import { useId } from 'react'
import { Phone, Plus, Trash2 } from 'lucide-react'
import type { CustomerPhone } from '@/types'
import { Button } from '@/components/ui/Button'

export type CustomerPhoneDraft = Pick<CustomerPhone, 'phone' | 'label' | 'isPrimary'>

const labels = ['Principal', 'WhatsApp', 'Trabajo', 'Casa', 'Otro']

export function CustomerPhonesEditor({
  value,
  onChange,
  disabled
}: {
  value: CustomerPhoneDraft[]
  onChange: (value: CustomerPhoneDraft[]) => void
  disabled?: boolean
}) {
  const groupName = useId()

  function makePrimary(index: number) {
    onChange(value.map((item, itemIndex) => ({ ...item, isPrimary: itemIndex === index })))
  }

  function updatePhone(index: number, phone: string) {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, phone } : item)))
  }

  function updateLabel(index: number, label: string) {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, label } : item)))
  }

  function removePhone(index: number) {
    if (value.length <= 1) return
    const next = value.filter((_, itemIndex) => itemIndex !== index).map((item) => ({ ...item }))
    if (!next.some((item) => item.isPrimary)) next[0].isPrimary = true
    onChange(next)
  }

  function addPhone() {
    onChange([...value, { phone: '', label: 'Otro', isPrimary: false }])
  }

  return (
    <div className="space-y-2">
      {value.map((row, index) => (
        <div key={`${index}-${row.label}`} className="flex flex-col gap-1.5 rounded-xl border border-line bg-slate-50/50 p-2.5 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Phone className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={row.phone}
              onChange={(event) => updatePhone(index, event.target.value)}
              disabled={disabled}
              className="field h-9 pl-9 text-[11px]"
              placeholder="310 000 0000"
              aria-label={`Teléfono ${index + 1}`}
            />
          </div>
          <select
            value={row.label}
            onChange={(event) => updateLabel(index, event.target.value)}
            disabled={disabled}
            className="field h-9 w-full text-[10px] sm:w-28"
            aria-label={`Etiqueta del teléfono ${index + 1}`}
          >
            {[...new Set([...labels, row.label].filter(Boolean))].map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 px-1 text-[10px] font-semibold text-slate-500">
            <input
              type="radio"
              name={groupName}
              checked={row.isPrimary}
              onChange={() => makePrimary(index)}
              disabled={disabled}
              className="h-3.5 w-3.5 border-slate-300 text-brand-600 focus:ring-brand-200"
            />
            Principal
          </label>
          <button
            type="button"
            onClick={() => removePhone(index)}
            disabled={disabled || value.length <= 1}
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-danger-50 hover:text-danger-600 disabled:opacity-30"
            aria-label={`Eliminar teléfono ${index + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={addPhone}
        disabled={disabled}
        leftIcon={<Plus className="h-3.5 w-3.5" />}
      >
        Añadir teléfono
      </Button>
    </div>
  )
}
