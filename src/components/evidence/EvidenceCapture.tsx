import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { AlertTriangle, Camera, ImagePlus, ShieldCheck, Trash2, Video } from 'lucide-react'
import { toast } from 'sonner'
import type { EvidenceCategory, EvidenceSource, EvidenceStage } from '@/types'
import {
  MAX_EVIDENCE_PER_BATCH,
  captureVideoFrame,
  evidenceCategories,
  evidenceStageLabels,
  fileToEvidence,
  formatBytes,
  type EvidenceDraft
} from '@/lib/evidence'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

export function EvidenceCapture({
  items,
  onChange,
  stage = 'ingreso',
  disabled = false,
  bare = false,
  description
}: {
  items: EvidenceDraft[]
  onChange: (items: EvidenceDraft[]) => void
  stage?: EvidenceStage
  disabled?: boolean
  bare?: boolean
  description?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(true)
  const [busy, setBusy] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const remaining = Math.max(0, MAX_EVIDENCE_PER_BATCH - items.length)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!cameraOpen) return
    let cancelled = false
    setCameraReady(false)
    setCameraError('')

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Este equipo no expone una cámara al sistema. Puedes cargar las fotos desde archivos.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
          setCameraReady(true)
        }
      } catch {
        setCameraError(
          'No fue posible acceder a la cámara. Revisa los permisos del sistema o usa la carga de archivos, que sigue disponible.'
        )
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen])

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  function closeCamera() {
    stopCamera()
    setCameraOpen(false)
    setCameraReady(false)
    setCameraError('')
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length || disabled) return
    if (remaining <= 0) {
      toast.error(`Máximo ${MAX_EVIDENCE_PER_BATCH} fotografías por operación`)
      return
    }
    const batch = files.slice(0, remaining)
    if (files.length > remaining) {
      toast(`Solo se agregarán ${remaining} fotos`, {
        description: `El límite es ${MAX_EVIDENCE_PER_BATCH} por operación.`
      })
    }
    setBusy(true)
    const next = [...items]
    let failed = 0
    for (const file of batch) {
      try {
        next.push(await fileToEvidence(file))
      } catch (error) {
        failed += 1
        toast.error('No se pudo procesar una foto', {
          description: error instanceof Error ? error.message : file.name
        })
      }
    }
    if (mountedRef.current) onChange(next)
    setBusy(false)
    if (next.length > items.length) {
      toast.success(`${next.length - items.length} foto${next.length - items.length === 1 ? '' : 's'} lista${next.length - items.length === 1 ? '' : 's'} para guardar`, {
        description: 'Se optimizaron a JPEG de hasta 1600 px y se generó una miniatura.'
      })
    }
    if (failed === batch.length) {
      toast.error('No se agregó ninguna fotografía')
    }
  }

  async function takePhoto() {
    const video = videoRef.current
    if (!video || !cameraReady || busy) return
    if (remaining <= 0) {
      toast.error(`Máximo ${MAX_EVIDENCE_PER_BATCH} fotografías por operación`)
      return
    }
    setBusy(true)
    try {
      const draft = await captureVideoFrame(video)
      onChange([...items, draft])
      closeCamera()
      toast.success('Foto capturada', { description: 'Revisa la categoría y agrega una nota si hace falta.' })
    } catch (error) {
      toast.error('No se pudo capturar la foto', {
        description: error instanceof Error ? error.message : 'Intenta de nuevo.'
      })
    } finally {
      setBusy(false)
    }
  }

  function updateItem(id: string, patch: Partial<EvidenceDraft>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeItem(id: string) {
    onChange(items.filter((item) => item.id !== id))
  }

  const content = (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event)}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || busy || remaining <= 0}
          loading={busy}
          leftIcon={<ImagePlus className="h-3.5 w-3.5" />}
          onClick={() => fileRef.current?.click()}
        >
          Cargar fotos
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || busy || remaining <= 0}
          leftIcon={<Camera className="h-3.5 w-3.5" />}
          onClick={() => setCameraOpen(true)}
        >
          Usar cámara
        </Button>
        <Badge variant={items.length ? 'brand' : 'neutral'}>
          {items.length}/{MAX_EVIDENCE_PER_BATCH} · {evidenceStageLabels[stage]}
        </Badge>
        {items.length ? (
          <span className="text-[10px] text-slate-400">
            {formatBytes(items.reduce((sum, item) => sum + item.size, 0))} en total
          </span>
        ) : null}
      </div>

      <p className="text-[10px] leading-relaxed text-slate-500">
        {description ??
          'Documenta el estado del equipo antes de intervenirlo. Las fotos son opcionales; si no las registras, el ingreso quedará marcado sin evidencia. Se guardan como archivos digitales y nunca se imprimen.'}
      </p>

      {items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <div key={item.id} className="overflow-hidden rounded-xl border border-line bg-white">
              <div className="relative aspect-[4/3] bg-slate-100">
                <img src={item.thumbnailDataUrl} alt={`Evidencia ${index + 1}`} className="h-full w-full object-cover" />
                <span className="absolute left-2 top-2 rounded-full bg-slate-950/70 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-white">
                  {item.source === 'camara' ? 'Cámara' : 'Archivo'}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={disabled}
                  className="focus-ring absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/65 text-white transition hover:bg-danger-600 disabled:opacity-50"
                  aria-label={`Quitar foto ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-2 p-2.5">
                <select
                  value={item.category}
                  onChange={(event) => updateItem(item.id, { category: event.target.value as EvidenceCategory })}
                  disabled={disabled}
                  className="field h-8 py-1 text-[10px]"
                >
                  {evidenceCategories.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
                <input
                  value={item.note}
                  onChange={(event) => updateItem(item.id, { note: event.target.value.slice(0, 500) })}
                  disabled={disabled}
                  placeholder="Nota opcional del estado visible"
                  className="field h-8 py-1 text-[10px]"
                />
                <div className="flex items-center justify-between text-[8.5px] text-slate-400">
                  <span>{item.width} × {item.height} px</span>
                  <span>{formatBytes(item.size)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-slate-50/50 px-4 py-7 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
            <ImagePlus className="h-5 w-5" />
          </span>
          <p className="text-[11px] font-semibold text-slate-600">Sin fotografías todavía</p>
          <p className="max-w-sm text-[9.5px] leading-relaxed text-slate-400">
            Puedes cargar imágenes del equipo o tomarlas con la cámara. Si el equipo no tiene cámara, la carga de archivos sigue disponible.
          </p>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-warning-100 bg-warning-50/70 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-600" />
        <p className="text-[9.5px] leading-relaxed text-warning-800">
          La evidencia es opcional. Al guardar sin fotos se registrará una advertencia en la bitácora. No se almacenan contraseñas, PIN ni patrones en las imágenes.
        </p>
      </div>

      <Modal
        open={cameraOpen}
        onClose={closeCamera}
        title="Tomar foto con la cámara"
        description="La captura se comprime y se agrega al ingreso. Puedes repetirla si no se ve bien."
        size="lg"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <span className="flex items-center gap-1.5 text-[9px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" /> Sin audio · sin datos EXIF/GPS
            </span>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={closeCamera}>
                Cerrar
              </Button>
              <Button
                onClick={() => void takePhoto()}
                loading={busy}
                disabled={!cameraReady || Boolean(cameraError)}
                leftIcon={<Video className="h-4 w-4" />}
              >
                Capturar foto
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-2xl bg-slate-950">
            <video ref={videoRef} autoPlay playsInline muted className="max-h-[55vh] w-full object-contain" />
            {!cameraReady && !cameraError ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-[11px] font-medium text-white/70">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Preparando cámara…
              </div>
            ) : null}
          </div>
          {cameraError ? (
            <div className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3.5 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" />
              <div>
                <p className="text-[10px] font-semibold text-warning-900">Cámara no disponible</p>
                <p className="mt-0.5 text-[9.5px] leading-relaxed text-warning-800">{cameraError}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  leftIcon={<ImagePlus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    closeCamera()
                    fileRef.current?.click()
                  }}
                >
                  Cargar desde archivos
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )

  if (bare) return content

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 lg:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Camera className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[13px] font-bold text-ink">Evidencias fotográficas</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">
              Estado del equipo al ingreso · soporte digital para reclamos
            </p>
          </div>
        </div>
        <Badge variant={items.length ? 'brand' : 'neutral'} dot>
          {items.length ? `${items.length} foto${items.length === 1 ? '' : 's'}` : 'Opcional'}
        </Badge>
      </div>
      <div className="p-5 lg:p-6">{content}</div>
    </section>
  )
}
