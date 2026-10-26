import { useState } from 'react'
import {
  Camera,
  CheckCircle2,
  Download,
  Eye,
  ImageOff,
  Plus,
  ShieldAlert,
  ShieldCheck,
  XCircle
} from 'lucide-react'
import { toast } from 'sonner'
import type { WorkOrder, WorkOrderEvidence } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can } from '@/lib/permissions'
import { api, errorMessage } from '@/lib/backend'
import {
  downloadBase64File,
  evidenceCategoryLabels,
  evidenceStageLabels,
  formatBytes
} from '@/lib/evidence'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

export function EvidenceGallery({
  order,
  onUpdated,
  onAdd
}: {
  order: WorkOrder
  onUpdated: (order: WorkOrder) => void
  onAdd?: () => void
}) {
  const { role } = useAuth()
  const evidence = order.evidence ?? []
  const active = evidence.filter((item) => item.status === 'activa')
  const voided = evidence.filter((item) => item.status === 'anulada')
  const totalBytes = active.reduce((sum, item) => sum + item.size, 0)
  const canManage = can(role, 'manageEvidence')
  const canVoid = can(role, 'voidEvidence')
  const canVerify = can(role, 'verifyEvidence')
  const canExport = can(role, 'exportEvidence')
  const [viewer, setViewer] = useState<WorkOrderEvidence | null>(null)
  const [voidTarget, setVoidTarget] = useState<WorkOrderEvidence | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function verifyEvidence(item: WorkOrderEvidence) {
    if (busy) return
    setBusy(true)
    try {
      const updated = await api.evidence.verify(item.id)
      onUpdated(updated)
      setViewer(null)
      toast.success('Evidencia verificada', {
        description: 'La integridad del archivo quedó confirmada en la auditoría.'
      })
    } catch (error) {
      toast.error('No se pudo verificar la evidencia', { description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function confirmVoid() {
    if (!voidTarget || busy) return
    if (voidReason.trim().length < 5) {
      toast.error('Escribe un motivo de al menos 5 caracteres')
      return
    }
    setBusy(true)
    try {
      const updated = await api.evidence.void(voidTarget.id, voidReason.trim())
      onUpdated(updated)
      setVoidTarget(null)
      setVoidReason('')
      toast.success('Evidencia anulada', {
        description: 'El archivo no se borra: queda auditado y fuera del conjunto activo.'
      })
    } catch (error) {
      toast.error('No se pudo anular la evidencia', { description: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function exportEvidence() {
    if (!active.length || exporting) return
    setExporting(true)
    try {
      const result = await api.evidence.export(order.id)
      downloadBase64File(result.filename, result.base64, result.mimeType)
      toast.success('Evidencias exportadas', {
        description: `${result.count} foto${result.count === 1 ? '' : 's'} · ZIP con manifiesto y hashes SHA-256.`
      })
    } catch (error) {
      toast.error('No se pudieron exportar las evidencias', { description: errorMessage(error) })
    } finally {
      setExporting(false)
    }
  }

  const allVerified = active.length > 0 && active.every((item) => Boolean(item.verifiedAt))

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 font-display text-[15px] font-bold text-ink">
            <Camera className="h-4 w-4 text-brand-500" />
            Evidencias
          </h2>
          <p className="mt-0.5 text-[10px] text-slate-400">Fotos digitales del estado del equipo</p>
        </div>
        <div className="flex items-center gap-1.5">
          {canManage && onAdd ? (
            <Button variant="secondary" size="sm" onClick={onAdd} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Agregar
            </Button>
          ) : null}
          {canExport && active.length ? (
            <Button
              variant="secondary"
              size="icon-sm"
              onClick={() => void exportEvidence()}
              loading={exporting}
              title="Exportar evidencias con manifiesto"
              aria-label="Exportar evidencias"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant={active.length ? 'brand' : 'neutral'}>
          {active.length} activa{active.length === 1 ? '' : 's'}
        </Badge>
        {active.length ? <span className="text-[9px] text-slate-400">{formatBytes(totalBytes)}</span> : null}
        {allVerified ? (
          <Badge variant="success">
            <ShieldCheck className="h-3 w-3" /> Verificado
          </Badge>
        ) : null}
        {voided.length ? <Badge variant="warning">{voided.length} anulada{voided.length === 1 ? '' : 's'}</Badge> : null}
      </div>

      {evidence.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[...active, ...voided].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setViewer(item)}
              className={cn(
                'focus-ring group relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-slate-100 text-left transition hover:border-brand-200',
                item.status === 'anulada' && 'opacity-60 grayscale'
              )}
            >
              <img
                src={item.thumbnailUrl}
                alt={`${evidenceCategoryLabels[item.category]} · ${item.filename}`}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              />
              <span className="absolute left-1.5 top-1.5 rounded-full bg-slate-950/65 px-2 py-0.5 text-[8px] font-semibold text-white">
                {evidenceCategoryLabels[item.category]}
              </span>
              {item.verifiedAt && item.status === 'activa' ? (
                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-success-500 text-white shadow">
                  <CheckCircle2 className="h-3 w-3" />
                </span>
              ) : null}
              {item.status === 'anulada' ? (
                <span className="absolute inset-x-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-full bg-danger-600/90 px-2 py-0.5 text-[8px] font-semibold text-white">
                  <XCircle className="h-2.5 w-2.5" /> Anulada
                </span>
              ) : (
                <span className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1 rounded-full bg-slate-950/65 px-2 py-0.5 text-[8px] font-medium text-white">
                  <span>{evidenceStageLabels[item.stage]}</span>
                  <Eye className="h-2.5 w-2.5 opacity-70" />
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-slate-50/50 px-3 py-5 text-center">
          <ImageOff className="h-5 w-5 text-slate-300" />
          <p className="text-[10px] font-semibold text-slate-500">Sin evidencias fotográficas</p>
          <p className="text-[9px] leading-relaxed text-slate-400">
            {canManage
              ? 'Puedes agregarlas ahora como evidencia de reparación.'
              : 'Esta OT se recibió sin evidencia digital.'}
          </p>
        </div>
      )}

      {order.evidenceSetHash ? (
        <p className="mt-3 truncate font-mono text-[8px] text-slate-300" title={order.evidenceSetHash}>
          SHA-256 conjunto · {order.evidenceSetHash}
        </p>
      ) : null}
      <p className="mt-2 text-[8.5px] leading-relaxed text-slate-400">
        Las evidencias son digitales: no se imprimen ni se anexan al comprobante A4. Cada archivo conserva su hash para auditoría.
      </p>

      <Modal
        open={Boolean(viewer)}
        onClose={() => setViewer(null)}
        title={viewer ? `${evidenceCategoryLabels[viewer.category]} · ${viewer.filename}` : 'Evidencia'}
        description={viewer ? `${formatDateTime(viewer.capturedAt)} · ${viewer.capturedByName}` : ''}
        size="xl"
        footer={
          viewer ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setViewer(null)}>
                Cerrar
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {viewer.status === 'activa' && canVoid ? (
                  <Button
                    variant="danger"
                    onClick={() => {
                      setVoidTarget(viewer)
                      setVoidReason('')
                      setViewer(null)
                    }}
                    leftIcon={<ShieldAlert className="h-4 w-4" />}
                  >
                    Anular evidencia
                  </Button>
                ) : null}
                {viewer.status === 'activa' && canVerify && !viewer.verifiedAt ? (
                  <Button
                    variant="success"
                    onClick={() => void verifyEvidence(viewer)}
                    loading={busy}
                    leftIcon={<ShieldCheck className="h-4 w-4" />}
                  >
                    Verificar integridad
                  </Button>
                ) : null}
                {viewer.verifiedAt ? (
                  <Badge variant="success" className="self-center">
                    <ShieldCheck className="h-3 w-3" /> Verificada
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : null
        }
      >
        {viewer ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,1fr)]">
            <div className="overflow-hidden rounded-2xl border border-line bg-slate-950">
              <img src={viewer.url} alt={viewer.filename} className="max-h-[58vh] w-full object-contain" />
            </div>
            <dl className="space-y-3 text-[10px]">
              <div>
                <dt className="text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">Categoría</dt>
                <dd className="mt-0.5 text-slate-600">{evidenceCategoryLabels[viewer.category]}</dd>
              </div>
              <div>
                <dt className="text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">Etapa</dt>
                <dd className="mt-0.5 text-slate-600">{evidenceStageLabels[viewer.stage]} · {viewer.source === 'camara' ? 'cámara' : 'archivo'}</dd>
              </div>
              <div>
                <dt className="text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">Archivo</dt>
                <dd className="mt-0.5 break-all text-slate-600">{viewer.filename}</dd>
              </div>
              <div>
                <dt className="text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">Tamaño / dimensiones</dt>
                <dd className="mt-0.5 text-slate-600">
                  {formatBytes(viewer.size)} · {viewer.width ?? '—'} × {viewer.height ?? '—'} px
                </dd>
              </div>
              <div>
                <dt className="text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">SHA-256</dt>
                <dd className="mt-0.5 break-all font-mono text-[8.5px] text-slate-500">{viewer.sha256}</dd>
              </div>
              {viewer.note ? (
                <div>
                  <dt className="text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">Nota</dt>
                  <dd className="mt-0.5 text-slate-600">{viewer.note}</dd>
                </div>
              ) : null}
              {viewer.verifiedAt ? (
                <div className="rounded-xl border border-success-100 bg-success-50/60 px-3 py-2">
                  <dt className="text-[8px] font-semibold uppercase tracking-[0.1em] text-success-700">Verificación</dt>
                  <dd className="mt-0.5 text-success-800">{formatDateTime(viewer.verifiedAt)} · {viewer.verifiedByName}</dd>
                </div>
              ) : null}
              {viewer.status === 'anulada' ? (
                <div className="rounded-xl border border-danger-100 bg-danger-50/60 px-3 py-2">
                  <dt className="text-[8px] font-semibold uppercase tracking-[0.1em] text-danger-700">Anulada</dt>
                  <dd className="mt-0.5 text-danger-800">
                    {formatDateTime(viewer.voidedAt ?? viewer.createdAt)} · {viewer.voidedByName}
                    <br />
                    {viewer.voidReason}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(voidTarget)}
        onClose={() => {
          setVoidTarget(null)
          setVoidReason('')
        }}
        title="Anular evidencia"
        description={voidTarget ? `${voidTarget.filename} · el archivo no se borra` : ''}
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setVoidTarget(null)
                setVoidReason('')
              }}
            >
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void confirmVoid()} loading={busy} leftIcon={<XCircle className="h-4 w-4" />}>
              Anular
            </Button>
          </div>
        }
      >
        <label className="block">
          <span className="field-label">Motivo de la anulación *</span>
          <textarea
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Ej. foto repetida, imagen borrosa, evidencia cargada por error…"
            className="field resize-none"
          />
        </label>
        <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
          La anulación queda en la auditoría. El archivo permanece en disco y se excluye del conjunto activo y de los conteos de impresión.
        </p>
      </Modal>
    </div>
  )
}
