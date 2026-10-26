import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BatteryCharging, Cpu as CpuIcon, HardDrive, MemoryStick, Monitor, Plus, Trash2 } from 'lucide-react'
import type {
  DictionaryNode,
  GpuKind,
  TechnicalSheet,
  TechnicalSheetGpu,
  TechnicalSheetRamModule,
  TechnicalSheetStorageDrive
} from '@/types'
import { activeDictionaryNodes, dictionaryChildren } from '@/lib/dictionaries'
import { newRamModule, newStorageDrive } from '@/lib/technicalSheet'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const gpuKinds: Array<{ value: GpuKind; label: string }> = [
  { value: '', label: 'Sin especificar' },
  { value: 'none', label: 'Sin GPU dedicada' },
  { value: 'integrated', label: 'Integrada' },
  { value: 'dedicated', label: 'Dedicada' }
]

const healthOptions = ['', 'Bueno', 'Regular', 'Crítico', 'No evaluado']

function SelectOrCustom({
  value,
  options,
  onChange,
  placeholder = 'Selecciona…',
  disabled,
  customLabel = 'Otro / escribir'
}: {
  value?: string
  options: string[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  customLabel?: string
}) {
  const current = value ?? ''
  const known = options.includes(current)
  const [custom, setCustom] = useState(Boolean(current) && !known)

  useEffect(() => {
    setCustom(Boolean(current) && !options.includes(current))
  }, [current, options])

  return (
    <div className="space-y-1.5">
      <select
        value={custom ? '__custom__' : current}
        onChange={(event) => {
          if (event.target.value === '__custom__') {
            setCustom(true)
            onChange('')
          } else {
            setCustom(false)
            onChange(event.target.value)
          }
        }}
        disabled={disabled}
        className="field h-9 text-[11px]"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value="__custom__">{customLabel}</option>
      </select>
      {custom ? (
        <input
          value={current}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="field h-9 text-[11px]"
          placeholder="Escribe el valor"
        />
      ) : null}
    </div>
  )
}

function DictionarySelect({
  value,
  options,
  onChange,
  disabled
}: {
  value?: string
  options: string[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const choices = value && !options.includes(value) ? [...options, value] : options
  return (
    <select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="field h-9 text-[11px]"
    >
      <option value="">Sin especificar</option>
      {choices.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

function RowShell({
  title,
  children,
  onRemove,
  disabled
}: {
  title: string
  children: ReactNode
  onRemove: () => void
  disabled?: boolean
}) {
  return (
    <div className="rounded-xl border border-line bg-slate-50/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">{title}</p>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:bg-danger-50 hover:text-danger-600 disabled:opacity-40"
          aria-label={`Eliminar ${title}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  )
}

export function TechnicalSheetForm({
  value,
  onChange,
  nodes,
  disabled
}: {
  value: TechnicalSheet
  onChange: (value: TechnicalSheet) => void
  nodes: DictionaryNode[]
  disabled?: boolean
}) {
  const osOptions = useMemo(() => activeDictionaryNodes(nodes, 'os').map((node) => node.name), [nodes])
  const cpuBrands = useMemo(() => activeDictionaryNodes(nodes, 'cpu_brand').map((node) => node.name), [nodes])
  const gpuBrands = useMemo(() => activeDictionaryNodes(nodes, 'gpu_brand').map((node) => node.name), [nodes])
  const ramTypes = useMemo(() => activeDictionaryNodes(nodes, 'ram_type').map((node) => node.name), [nodes])
  const storageTypes = useMemo(() => activeDictionaryNodes(nodes, 'storage_type').map((node) => node.name), [nodes])
  const cpuFamilyOptions = useMemo(() => {
    const brandNode = nodes.find((node) => node.type === 'cpu_brand' && node.name === value.cpu?.brand)
    return brandNode ? dictionaryChildren(nodes, 'cpu_brand', brandNode.id).filter((node) => node.active).map((node) => node.name) : []
  }, [nodes, value.cpu?.brand])

  const cpu = value.cpu ?? {}
  const gpu = value.gpu ?? {}
  const ramModules = value.ramModules ?? []
  const storageDrives = value.storageDrives ?? []

  function patchCpu(patch: Partial<typeof cpu>) {
    onChange({ ...value, cpu: { ...cpu, ...patch } })
  }

  function patchGpu(patch: Partial<TechnicalSheetGpu>) {
    onChange({ ...value, gpu: { ...gpu, ...patch } })
  }

  function patchRam(index: number, patch: Partial<TechnicalSheetRamModule>) {
    onChange({
      ...value,
      ramModules: ramModules.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    })
  }

  function patchStorage(index: number, patch: Partial<TechnicalSheetStorageDrive>) {
    onChange({
      ...value,
      storageDrives: storageDrives.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    })
  }

  const legacyEntries = value.legacy
    ? [
        ['CPU', value.legacy.cpu],
        ['GPU', value.legacy.gpu],
        ['RAM', value.legacy.ram],
        ['Almacenamiento', value.legacy.storage],
        ['SO', value.legacy.os],
        ['Batería', value.legacy.battery]
      ].filter(([, item]) => Boolean(item))
    : []

  return (
    <div className="space-y-5">
      {legacyEntries.length ? (
        <div className="rounded-xl border border-warning-100 bg-warning-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-warning-800">
          <p className="font-semibold">Ficha anterior conservada</p>
          <p className="mt-0.5 text-warning-700/80">
            {legacyEntries.map(([label, item]) => `${label}: ${item}`).join(' · ')}. Puedes transcribir estos datos a los campos nuevos.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="field-label">Sistema operativo</span>
          <SelectOrCustom value={value.os} options={osOptions} onChange={(os) => onChange({ ...value, os })} disabled={disabled} />
        </label>
        <label className="block sm:col-span-2">
          <span className="field-label">Batería</span>
          <input
            value={value.battery ?? ''}
            onChange={(event) => onChange({ ...value, battery: event.target.value })}
            disabled={disabled}
            className="field h-9 text-[11px]"
            placeholder="Estado, duración o número de celdas"
          />
        </label>
      </div>

      <div className="rounded-xl border border-line p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <CpuIcon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-bold text-ink">Procesador</p>
            <p className="text-[9px] text-slate-400">Marca y familia desde diccionario; modelo editable.</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="field-label">Marca</span>
            <SelectOrCustom
              value={cpu.brand}
              options={cpuBrands}
              onChange={(brand) => patchCpu({ brand, family: '' })}
              disabled={disabled}
            />
          </label>
          <label className="block">
            <span className="field-label">Familia</span>
            <SelectOrCustom
              value={cpu.family}
              options={cpuFamilyOptions}
              onChange={(family) => patchCpu({ family })}
              disabled={disabled}
              customLabel="Otra familia"
            />
          </label>
          <label className="block">
            <span className="field-label">Modelo</span>
            <input
              value={cpu.model ?? ''}
              onChange={(event) => patchCpu({ model: event.target.value })}
              disabled={disabled}
              className="field h-9 text-[11px]"
              placeholder="Ej. i7-12700H, Ryzen 7 5800X"
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-line p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <Monitor className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-bold text-ink">Tarjeta gráfica</p>
            <p className="text-[9px] text-slate-400">Tipo, marca, modelo y VRAM.</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="field-label">Tipo</span>
            <select
              value={gpu.type ?? ''}
              onChange={(event) => patchGpu({ type: event.target.value as GpuKind })}
              disabled={disabled}
              className="field h-9 text-[11px]"
            >
              {gpuKinds.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Marca</span>
            <SelectOrCustom value={gpu.brand} options={gpuBrands} onChange={(brand) => patchGpu({ brand })} disabled={disabled} />
          </label>
          <label className="block">
            <span className="field-label">Modelo</span>
            <input
              value={gpu.model ?? ''}
              onChange={(event) => patchGpu({ model: event.target.value })}
              disabled={disabled}
              className="field h-9 text-[11px]"
              placeholder="RTX 3060, RX 6700 XT..."
            />
          </label>
          <label className="block">
            <span className="field-label">VRAM</span>
            <input
              value={gpu.vram ?? ''}
              onChange={(event) => patchGpu({ vram: event.target.value })}
              disabled={disabled}
              className="field h-9 text-[11px]"
              placeholder="6 GB, 8 GB..."
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning-50 text-warning-600">
              <MemoryStick className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[11px] font-bold text-ink">Memoria RAM</p>
              <p className="text-[9px] text-slate-400">Añade un módulo por cada instalación.</p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onChange({ ...value, ramModules: [...ramModules, newRamModule()] })}
            disabled={disabled}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Añadir módulo
          </Button>
        </div>
        <div className={cn('mt-3 space-y-2', !ramModules.length && 'rounded-lg border border-dashed border-line px-3 py-3 text-center text-[10px] text-slate-400')}>
          {ramModules.length ? (
            ramModules.map((row, index) => (
              <RowShell
                key={row.id}
                title={`Módulo ${index + 1}`}
                onRemove={() => onChange({ ...value, ramModules: ramModules.filter((_, rowIndex) => rowIndex !== index) })}
                disabled={disabled}
              >
                <div className="grid gap-2 sm:grid-cols-5">
                  <label className="block">
                    <span className="field-label">Tipo</span>
                    <DictionarySelect value={row.type} options={ramTypes} onChange={(type) => patchRam(index, { type })} disabled={disabled} />
                  </label>
                  <label className="block">
                    <span className="field-label">Capacidad</span>
                    <input value={row.capacity ?? ''} onChange={(event) => patchRam(index, { capacity: event.target.value })} disabled={disabled} className="field h-9 text-[11px]" placeholder="16 GB" />
                  </label>
                  <label className="block">
                    <span className="field-label">Velocidad</span>
                    <input value={row.speed ?? ''} onChange={(event) => patchRam(index, { speed: event.target.value })} disabled={disabled} className="field h-9 text-[11px]" placeholder="3200 MHz" />
                  </label>
                  <label className="block">
                    <span className="field-label">Marca</span>
                    <input value={row.brand ?? ''} onChange={(event) => patchRam(index, { brand: event.target.value })} disabled={disabled} className="field h-9 text-[11px]" placeholder="Kingston" />
                  </label>
                  <label className="block">
                    <span className="field-label">Garantía</span>
                    <input value={row.warranty ?? ''} onChange={(event) => patchRam(index, { warranty: event.target.value })} disabled={disabled} className="field h-9 text-[11px]" placeholder="12 meses" />
                  </label>
                </div>
              </RowShell>
            ))
          ) : (
            'Sin módulos registrados.'
          )}
        </div>
      </div>

      <div className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-success-50 text-success-600">
              <HardDrive className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[11px] font-bold text-ink">Almacenamiento</p>
              <p className="text-[9px] text-slate-400">Añade un disco por cada unidad instalada.</p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onChange({ ...value, storageDrives: [...storageDrives, newStorageDrive()] })}
            disabled={disabled}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Añadir disco
          </Button>
        </div>
        <div className={cn('mt-3 space-y-2', !storageDrives.length && 'rounded-lg border border-dashed border-line px-3 py-3 text-center text-[10px] text-slate-400')}>
          {storageDrives.length ? (
            storageDrives.map((row, index) => (
              <RowShell
                key={row.id}
                title={`Disco ${index + 1}`}
                onRemove={() => onChange({ ...value, storageDrives: storageDrives.filter((_, rowIndex) => rowIndex !== index) })}
                disabled={disabled}
              >
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <label className="block">
                    <span className="field-label">Tipo</span>
                    <DictionarySelect value={row.type} options={storageTypes} onChange={(type) => patchStorage(index, { type })} disabled={disabled} />
                  </label>
                  <label className="block">
                    <span className="field-label">Capacidad</span>
                    <input value={row.capacity ?? ''} onChange={(event) => patchStorage(index, { capacity: event.target.value })} disabled={disabled} className="field h-9 text-[11px]" placeholder="1 TB" />
                  </label>
                  <label className="block">
                    <span className="field-label">Velocidad</span>
                    <input value={row.speed ?? ''} onChange={(event) => patchStorage(index, { speed: event.target.value })} disabled={disabled} className="field h-9 text-[11px]" placeholder="3500 MB/s" />
                  </label>
                  <label className="block">
                    <span className="field-label">Modelo</span>
                    <input value={row.model ?? ''} onChange={(event) => patchStorage(index, { model: event.target.value })} disabled={disabled} className="field h-9 text-[11px]" placeholder="Kingston NV2" />
                  </label>
                  <label className="block">
                    <span className="field-label">Salud</span>
                    <select value={row.health ?? ''} onChange={(event) => patchStorage(index, { health: event.target.value })} disabled={disabled} className="field h-9 text-[11px]">
                      {healthOptions.map((option) => (
                        <option key={option} value={option}>
                          {option || 'Sin especificar'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Garantía</span>
                    <input value={row.warranty ?? ''} onChange={(event) => patchStorage(index, { warranty: event.target.value })} disabled={disabled} className="field h-9 text-[11px]" placeholder="12 meses" />
                  </label>
                </div>
              </RowShell>
            ))
          ) : (
            'Sin discos registrados.'
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="field-label">Observaciones de la ficha</span>
          <textarea
            value={value.notes ?? ''}
            onChange={(event) => onChange({ ...value, notes: event.target.value })}
            disabled={disabled}
            rows={2}
            className="field resize-none text-[11px]"
            placeholder="Detalles de desarme, pruebas, componentes no listados…"
          />
        </label>
        <div className="flex items-end">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-slate-50/60 px-3 py-2 text-[9px] text-slate-400">
            <BatteryCharging className="h-3.5 w-3.5" />
            Los campos vacíos no se imprimen.
          </div>
        </div>
      </div>
    </div>
  )
}
