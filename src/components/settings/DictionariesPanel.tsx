import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronRight,
  CornerDownRight,
  LockKeyhole,
  Pencil,
  Plus,
  Power,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { DICTIONARY_TYPES, type DictionaryNode, type DictionaryType } from '@/types'
import { api, errorMessage } from '@/lib/backend'
import { dictionaryChildren, dictionaryTypeLabel, flattenDictionaryTree } from '@/lib/dictionaries'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

interface NodeEditor {
  node?: DictionaryNode
  parentId?: string | null
}

export function DictionariesPanel({ canManage }: { canManage: boolean }) {
  const [nodes, setNodes] = useState<DictionaryNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [type, setType] = useState<DictionaryType>('os')
  const [editor, setEditor] = useState<NodeEditor | null>(null)
  const [form, setForm] = useState({
    name: '',
    code: '',
    parentId: '',
    sortOrder: '0',
    active: true
  })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DictionaryNode | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setNodes(await api.dictionaries.list())
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const typeNodes = useMemo(() => nodes.filter((node) => node.type === type), [nodes, type])
  const rows = useMemo(() => flattenDictionaryTree(nodes, type), [nodes, type])
  const typeInfo = DICTIONARY_TYPES.find((item) => item.value === type)

  function descendantsOf(id: string) {
    const ids = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const node of typeNodes) {
        if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
          ids.add(node.id)
          changed = true
        }
      }
    }
    return ids
  }

  function openCreate(parentId: string | null = null) {
    const siblings = typeNodes.filter((node) => (node.parentId ?? null) === parentId)
    setForm({
      name: '',
      code: '',
      parentId: parentId ?? '',
      sortOrder: String(siblings.length + 1),
      active: true
    })
    setEditor({ parentId })
  }

  function openEdit(node: DictionaryNode) {
    setForm({
      name: node.name,
      code: node.code ?? '',
      parentId: node.parentId ?? '',
      sortOrder: String(node.sortOrder),
      active: node.active
    })
    setEditor({ node })
  }

  async function save() {
    if (!editor || saving) return
    if (!form.name.trim()) {
      toast.error('Escribe el nombre del valor')
      return
    }
    setSaving(true)
    try {
      if (editor.node) {
        const payload: Record<string, unknown> = {
          name: form.name.trim(),
          sortOrder: Number(form.sortOrder) || 0,
          active: form.active
        }
        if (!editor.node.system) {
          payload.code = form.code.trim() || null
          payload.parentId = form.parentId || null
        }
        await api.dictionaries.update(editor.node.id, payload)
        toast.success('Diccionario actualizado', { description: form.name.trim() })
      } else {
        await api.dictionaries.create({
          type,
          name: form.name.trim(),
          code: form.code.trim() || null,
          parentId: form.parentId || null,
          sortOrder: Number(form.sortOrder) || 0,
          active: form.active
        })
        toast.success('Valor creado', { description: `${typeInfo?.label ?? type} · ${form.name.trim()}` })
      }
      setEditor(null)
      await load()
    } catch (failure) {
      toast.error('No se pudo guardar el diccionario', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  async function toggle(node: DictionaryNode) {
    try {
      await api.dictionaries.update(node.id, { active: !node.active })
      setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, active: !node.active } : item)))
      toast.success(node.active ? 'Valor desactivado' : 'Valor activado', { description: node.name })
    } catch (failure) {
      toast.error('No se pudo cambiar el estado', { description: errorMessage(failure) })
    }
  }

  async function move(node: DictionaryNode, direction: -1 | 1) {
    const siblings = dictionaryChildren(nodes, type, node.parentId ?? null)
    const index = siblings.findIndex((item) => item.id === node.id)
    const target = siblings[index + direction]
    if (index < 0 || !target) return
    try {
      await Promise.all([
        api.dictionaries.update(node.id, { sortOrder: target.sortOrder }),
        api.dictionaries.update(target.id, { sortOrder: node.sortOrder })
      ])
      await load()
    } catch (failure) {
      toast.error('No se pudo reordenar', { description: errorMessage(failure) })
    }
  }

  async function remove() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await api.dictionaries.remove(deleteTarget.id)
      setNodes((current) => current.filter((node) => node.id !== deleteTarget.id))
      toast.success('Valor eliminado', { description: deleteTarget.name })
      setDeleteTarget(null)
    } catch (failure) {
      toast.error('No se pudo eliminar', { description: errorMessage(failure) })
    } finally {
      setDeleting(false)
    }
  }

  const editorDescendants = editor?.node ? descendantsOf(editor.node.id) : new Set<string>()
  const parentOptions = flattenDictionaryTree(nodes, type).filter(
    (row) => !editorDescendants.has(row.node.id)
  )
  const editorIsSystem = Boolean(editor?.node?.system)

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink">Diccionarios</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Valores seleccionables de la ficha técnica, el inventario y los proveedores.
            </p>
          </div>
          <Badge variant="brand">
            <BookOpen className="mr-1 h-3 w-3" /> {nodes.length} valores
          </Badge>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 px-5 py-14 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            Cargando diccionarios…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-14 text-center">
            <p className="text-sm font-semibold text-ink">No se pudieron cargar los diccionarios</p>
            <p className="max-w-md text-[12px] text-slate-500">{error}</p>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="grid gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="border-b border-line p-3 lg:border-b-0 lg:border-r">
              <p className="px-2 pb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                Tipo de diccionario
              </p>
              <div className="space-y-1">
                {DICTIONARY_TYPES.map((item) => {
                  const count = nodes.filter((node) => node.type === item.value).length
                  const active = item.value === type
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setType(item.value)}
                      className={cn(
                        'focus-ring flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition',
                        active ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50'
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-semibold">{item.label}</span>
                        <span className="mt-0.5 block truncate text-[9px] text-slate-400">{item.description}</span>
                      </span>
                      <span className={cn('rounded-md px-1.5 py-0.5 text-[9px] font-semibold tabular', active ? 'bg-white text-brand-700' : 'bg-slate-100 text-slate-400')}>
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div>
                  <p className="text-[12px] font-bold text-ink">{typeInfo?.label ?? type}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {typeNodes.length} valores · los inactivos no aparecen en los formularios.
                  </p>
                </div>
                {canManage ? (
                  <Button size="sm" onClick={() => openCreate()} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                    Añadir valor
                  </Button>
                ) : null}
              </div>

              {rows.length ? (
                <div className="divide-y divide-line">
                  {rows.map(({ node, depth }) => (
                    <div
                      key={node.id}
                      className={cn('flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between', !node.active && 'opacity-55')}
                    >
                      <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 18 }}>
                        {depth > 0 ? (
                          <CornerDownRight className="h-3 w-3 shrink-0 text-slate-300" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-ink">{node.name}</p>
                          <p className="mt-0.5 truncate text-[9px] text-slate-400">
                            {node.code ? `Código ${node.code} · ` : ''}
                            {node.usageCount > 0 ? `${node.usageCount} usos · ` : ''}
                            {node.active ? 'Activo' : 'Inactivo'}
                          </p>
                        </div>
                        {node.system ? (
                          <Badge variant="neutral">
                            <LockKeyhole className="mr-1 h-2.5 w-2.5" /> Sistema
                          </Badge>
                        ) : null}
                      </div>

                      {canManage ? (
                        <div className="flex shrink-0 items-center gap-1 sm:pl-2">
                          <button
                            type="button"
                            onClick={() => openCreate(node.id)}
                            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                            aria-label={`Añadir hijo a ${node.name}`}
                            title="Añadir hijo"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void move(node, -1)}
                            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-ink"
                            aria-label={`Subir ${node.name}`}
                            title="Subir"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void move(node, 1)}
                            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-ink"
                            aria-label={`Bajar ${node.name}`}
                            title="Bajar"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(node)}
                            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-ink"
                            aria-label={`Editar ${node.name}`}
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggle(node)}
                            className={cn(
                              'focus-ring flex h-7 w-7 items-center justify-center rounded-lg',
                              node.active ? 'text-success-600 hover:bg-warning-50' : 'text-slate-400 hover:bg-success-50 hover:text-success-600'
                            )}
                            aria-label={node.active ? `Desactivar ${node.name}` : `Activar ${node.name}`}
                            title={node.active ? 'Desactivar' : 'Activar'}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                          {!node.system ? (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(node)}
                              className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-danger-50 hover:text-danger-600"
                              aria-label={`Eliminar ${node.name}`}
                              title="Eliminar"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
                  <BookOpen className="h-6 w-6 text-slate-300" />
                  <p className="mt-2 text-[12px] font-semibold text-ink">Este diccionario está vacío</p>
                  <p className="mt-1 text-[10px] text-slate-400">Crea el primer valor para usarlo en los formularios.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor?.node ? 'Editar valor' : 'Nuevo valor'}
        description={typeInfo?.label ?? type}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditor(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void save()} loading={saving} leftIcon={<Plus className="h-4 w-4" />}>
              Guardar
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="field"
              placeholder="Ej. Windows 11"
            />
          </label>
          <label className="block">
            <span className="field-label">Padre</span>
            <select
              value={form.parentId}
              onChange={(event) => setForm({ ...form, parentId: event.target.value })}
              disabled={editorIsSystem}
              className="field disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Sin padre (raíz)</option>
              {parentOptions.map(({ node, depth }) => (
                <option key={node.id} value={node.id}>
                  {'— '.repeat(depth)}
                  {node.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[9px] text-slate-400">Permite jerarquías como Intel → Core i7.</span>
          </label>
          <label className="block">
            <span className="field-label">Código interno (opcional)</span>
            <input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              disabled={editorIsSystem}
              className="field font-mono text-[11px] disabled:bg-slate-50 disabled:text-slate-400"
              placeholder="windows_11"
            />
          </label>
          <label className="block">
            <span className="field-label">Orden</span>
            <input
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
              className="field text-right tabular"
              inputMode="numeric"
            />
          </label>
          <label className="flex items-end">
            <span className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
              />
              <span className="text-[11px] font-semibold text-ink">Valor activo</span>
            </span>
          </label>
          {editorIsSystem ? (
            <div className="rounded-xl border border-line bg-slate-50 px-3.5 py-2.5 text-[10px] leading-relaxed text-slate-500 sm:col-span-2">
              Este valor viene del sistema. Puedes cambiar su nombre, orden o estado; el código y el nivel quedan protegidos para no romper datos existentes.
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar valor"
        description={deleteTarget ? `${deleteTarget.name} · ${typeInfo?.label ?? type}` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void remove()} loading={deleting} leftIcon={<Trash2 className="h-4 w-4" />}>
              Eliminar
            </Button>
          </div>
        }
      >
        <p className="text-[11px] leading-relaxed text-slate-600">
          El valor desaparecerá de los formularios. Si está en uso o tiene hijos, el sistema pedirá desactivarlo o mover sus hijos primero.
        </p>
      </Modal>
    </div>
  )
}
