import { useEffect, useState } from 'react'
import { FolderOpen, Globe2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { CatalogSyncStatus } from '@/types'
import { api, errorMessage } from '@/lib/backend'
import { formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

export function CatalogSyncPanel() {
  const [status, setStatus] = useState<CatalogSyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [choosing, setChoosing] = useState(false)

  function load() {
    setLoading(true)
    api.catalog
      .status()
      .then(setStatus)
      .catch((failure) => toast.error('No se pudo leer el estado del catálogo', { description: errorMessage(failure) }))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  async function publish() {
    setPublishing(true)
    try {
      const result = await api.catalog.publish()
      setStatus(result.status)
      if (result.ok) toast.success('Catálogo web publicado')
      else toast.error('No se pudo publicar el catálogo', { description: result.error })
    } catch (failure) {
      toast.error('No se pudo publicar el catálogo', { description: errorMessage(failure) })
    } finally {
      setPublishing(false)
    }
  }

  async function chooseFolder() {
    setChoosing(true)
    try {
      const result = await api.catalog.chooseFolder()
      if (result.canceled) return
      if (result.status) setStatus(result.status)
      toast.success('Carpeta de publicación actualizada')
    } catch (failure) {
      toast.error('No se pudo cambiar la carpeta', { description: errorMessage(failure) })
    } finally {
      setChoosing(false)
    }
  }

  async function updateAutoPublish(autoPublish: boolean) {
    try {
      const updated = await api.settings.updateSection('catalog', { autoPublish })
      setStatus(updated.catalog)
    } catch (failure) {
      toast.error('No se pudo actualizar la publicación automática', { description: errorMessage(failure) })
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5 lg:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink">Catálogo web local</h2>
            <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-slate-500">
              Publica el snapshot que consume la web de Next.js. En 1.12 es local; Supabase y Vercel se configuran en 1.13.
            </p>
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Globe2 className="h-4 w-4" />
          </span>
        </div>

        {loading ? (
          <p className="mt-5 text-xs text-slate-400">Leyendo estado…</p>
        ) : status ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-slate-50/60 p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Última publicación</p>
                <p className="mt-1 text-[12px] font-semibold text-ink">
                  {status.lastPublishedAt ? formatDateTime(status.lastPublishedAt) : 'Nunca'}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-slate-50/60 p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Productos / imágenes</p>
                <p className="mt-1 text-[12px] font-semibold text-ink">
                  {status.lastProductCount} / {status.lastImageCount}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-slate-50/60 p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Con promoción</p>
                <p className="mt-1 text-[12px] font-semibold text-ink">{status.lastPromotionCount}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  status.lastStatus === 'success'
                    ? 'success'
                    : status.lastStatus === 'error'
                      ? 'danger'
                      : status.lastStatus === 'pending'
                        ? 'warning'
                        : 'neutral'
                }
                dot
              >
                {status.lastStatus === 'success'
                  ? 'Publicado'
                  : status.lastStatus === 'error'
                    ? 'Error'
                    : status.lastStatus === 'pending'
                      ? 'Publicando'
                      : 'Sin publicar'}
              </Badge>
              <span className="text-[10px] text-slate-500">{status.lastMessage || 'Aún no se ha publicado.'}</span>
            </div>

            <label className="block">
              <span className="field-label">Carpeta de destino</span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={status.targetPath} readOnly className="field flex-1 bg-slate-50 text-slate-500" />
                <Button
                  variant="secondary"
                  loading={choosing}
                  leftIcon={<FolderOpen className="h-4 w-4" />}
                  onClick={() => void chooseFolder()}
                >
                  Elegir carpeta
                </Button>
              </div>
            </label>

            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-3">
              <input
                type="checkbox"
                checked={status.autoPublish}
                onChange={(event) => void updateAutoPublish(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              <span className="text-[11px] font-semibold text-ink">
                Publicar automáticamente después de cambios de inventario o promociones
              </span>
            </label>

            <Button
              variant="success"
              loading={publishing}
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void publish()}
            >
              Publicar catálogo ahora
            </Button>
            <p className="text-[9px] leading-relaxed text-slate-400">
              La carpeta debe ser la raíz de la web (`...\OCTESTR\web`) para que Next.js lea `data/catalog.json` y `public/products`.
            </p>
          </div>
        ) : (
          <p className="mt-5 text-xs text-slate-400">No se pudo cargar el estado.</p>
        )}
      </div>
    </div>
  )
}
