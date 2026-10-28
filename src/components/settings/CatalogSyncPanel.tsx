import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  FolderOpen,
  Globe2,
  KeyRound,
  RefreshCw,
  Save,
  Trash2,
  Wifi
} from 'lucide-react'
import { toast } from 'sonner'
import type { CatalogConnectionResult, CatalogSyncStatus } from '@/types'
import { api, errorMessage } from '@/lib/backend'
import { formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

function statusBadge(status: CatalogSyncStatus['lastStatus']) {
  if (status === 'success') return { variant: 'success' as const, label: 'Publicado' }
  if (status === 'error') return { variant: 'danger' as const, label: 'Error' }
  if (status === 'pending') return { variant: 'warning' as const, label: 'Publicando' }
  return { variant: 'neutral' as const, label: 'Sin publicar' }
}

function formatBytes(value: number) {
  if (!value) return '0 KB'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function CatalogSyncPanel() {
  const [status, setStatus] = useState<CatalogSyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [publishingRemote, setPublishingRemote] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [savingRemote, setSavingRemote] = useState(false)
  const [savingSecret, setSavingSecret] = useState(false)
  const [clearingSecret, setClearingSecret] = useState(false)
  const [secret, setSecret] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteBucket, setRemoteBucket] = useState('')
  const [remoteEnabled, setRemoteEnabled] = useState(false)
  const [stockVisibility, setStockVisibility] = useState<'always' | 'outOnly'>('outOnly')
  const [connection, setConnection] = useState<CatalogConnectionResult | null>(null)

  function applyStatus(next: CatalogSyncStatus) {
    setStatus(next)
    setRemoteUrl(next.remote.supabaseUrl)
    setRemoteBucket(next.remote.bucket)
    setRemoteEnabled(next.remote.enabled)
    setStockVisibility(next.stockVisibility === 'always' ? 'always' : 'outOnly')
  }

  function load() {
    setLoading(true)
    api.catalog
      .status()
      .then(applyStatus)
      .catch((failure) =>
        toast.error('No se pudo leer el estado del catálogo', {
          description: errorMessage(failure)
        })
      )
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  async function saveRemoteConfig() {
    setSavingRemote(true)
    try {
      const next = await api.catalog.configureRemote({
        enabled: remoteEnabled,
        supabaseUrl: remoteUrl,
        bucket: remoteBucket
      })
      applyStatus(next)
      toast.success('Configuración de Supabase guardada')
      return next
    } catch (failure) {
      toast.error('No se pudo guardar la configuración', {
        description: errorMessage(failure)
      })
      return null
    } finally {
      setSavingRemote(false)
    }
  }

  async function updateRemoteEnabled(enabled: boolean) {
    const previous = remoteEnabled
    setRemoteEnabled(enabled)
    try {
      const next = await api.catalog.configureRemote({
        enabled,
        supabaseUrl: remoteUrl,
        bucket: remoteBucket
      })
      applyStatus(next)
    } catch (failure) {
      setRemoteEnabled(previous)
      toast.error('No se pudo actualizar el destino del catálogo', {
        description: errorMessage(failure)
      })
    }
  }

  async function testConnection() {
    setTesting(true)
    setConnection(null)
    try {
      const saved = await api.catalog.configureRemote({
        enabled: remoteEnabled,
        supabaseUrl: remoteUrl,
        bucket: remoteBucket
      })
      applyStatus(saved)
      const result = await api.catalog.testConnection()
      setConnection(result)
      if (result.ok) {
        toast.success('Conexión con Supabase correcta')
      } else {
        toast.error('No se pudo conectar con Supabase', { description: result.message })
      }
    } catch (failure) {
      toast.error('No se pudo probar la conexión', { description: errorMessage(failure) })
    } finally {
      setTesting(false)
    }
  }

  async function saveSecret() {
    if (!secret.trim()) return
    setSavingSecret(true)
    try {
      const next = await api.catalog.saveSecret(secret.trim())
      applyStatus(next)
      setSecret('')
      setConnection(null)
      toast.success('Clave de Supabase guardada cifrada')
    } catch (failure) {
      toast.error('No se pudo guardar la clave', { description: errorMessage(failure) })
    } finally {
      setSavingSecret(false)
    }
  }

  async function clearSecret() {
    if (!window.confirm('¿Eliminar la clave de Supabase guardada en este equipo?')) return
    setClearingSecret(true)
    try {
      const next = await api.catalog.clearSecret()
      applyStatus(next)
      setConnection(null)
      toast.success('Clave de Supabase eliminada')
    } catch (failure) {
      toast.error('No se pudo eliminar la clave', { description: errorMessage(failure) })
    } finally {
      setClearingSecret(false)
    }
  }

  async function chooseFolder() {
    setChoosing(true)
    try {
      const result = await api.catalog.chooseFolder()
      if (result.canceled) return
      if (result.status) applyStatus(result.status)
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
      applyStatus(updated.catalog)
    } catch (failure) {
      toast.error('No se pudo actualizar la publicación automática', {
        description: errorMessage(failure)
      })
    }
  }

  async function updateStockVisibility(value: 'always' | 'outOnly') {
    const previous = stockVisibility
    setStockVisibility(value)
    try {
      const updated = await api.settings.updateSection('catalog', { stockVisibility: value })
      applyStatus(updated.catalog)
      toast.success(
        value === 'always'
          ? 'La web mostrará las cantidades disponibles'
          : 'La web solo mostrará “Agotado” cuando no haya unidades'
      )
    } catch (failure) {
      setStockVisibility(previous)
      toast.error('No se pudo actualizar la visibilidad del stock', {
        description: errorMessage(failure)
      })
    }
  }

  async function publish() {
    setPublishing(true)
    try {
      const result = await api.catalog.publish()
      applyStatus(result.status)
      if (result.ok) {
        toast.success('Catálogo publicado', {
          description: result.status.remote.enabled
            ? `${result.status.remote.lastProductCount} productos en Supabase`
            : `${result.status.lastProductCount} productos en la carpeta local`
        })
      } else {
        toast.error('No se pudo publicar el catálogo', {
          description: result.error ?? result.status.lastMessage
        })
      }
    } catch (failure) {
      toast.error('No se pudo publicar el catálogo', { description: errorMessage(failure) })
    } finally {
      setPublishing(false)
    }
  }

  async function publishRemote() {
    setPublishingRemote(true)
    try {
      const saved = await api.catalog.configureRemote({
        enabled: remoteEnabled,
        supabaseUrl: remoteUrl,
        bucket: remoteBucket
      })
      applyStatus(saved)
      const result = await api.catalog.publishRemote()
      applyStatus(result.status)
      if (result.ok) {
        toast.success('Catálogo publicado en Supabase', {
          description: `${result.status.remote.lastProductCount} productos y ${result.status.remote.lastImageCount} imágenes`
        })
      } else {
        toast.error('No se pudo publicar en Supabase', {
          description: result.error ?? result.status.remote.lastMessage
        })
      }
    } catch (failure) {
      toast.error('No se pudo publicar en Supabase', {
        description: errorMessage(failure)
      })
    } finally {
      setPublishingRemote(false)
    }
  }

  const localBadge = statusBadge(status?.lastStatus ?? 'idle')
  const remoteBadge = statusBadge(status?.remote.lastStatus ?? 'idle')
  const remoteReady = Boolean(status?.remote.hasSecret)

  return (
    <div className="space-y-4">
      <div className="card p-5 lg:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink">Catálogo web</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-500">
              La app publica el catálogo y las imágenes. La web solo lee: no puede modificar
              productos, precios ni promociones.
            </p>
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Globe2 className="h-4 w-4" />
          </span>
        </div>

        {loading ? (
          <p className="mt-5 text-xs text-slate-400">Leyendo estado…</p>
        ) : status ? (
          <div className="mt-5 space-y-5">
            <div className="rounded-2xl border border-line bg-slate-50/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-600 shadow-soft">
                    <CloudUpload className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold text-ink">Supabase Storage</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      Destino de la web en Vercel · bucket {status.remote.bucket}
                    </p>
                  </div>
                </div>
                <Badge variant={remoteBadge.variant} dot>
                  {remoteBadge.label}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">URL del proyecto</span>
                  <input
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    className="field"
                    placeholder="https://xxxx.supabase.co"
                    spellCheck={false}
                  />
                </label>
                <label className="block">
                  <span className="field-label">Bucket</span>
                  <input
                    value={remoteBucket}
                    onChange={(event) => setRemoteBucket(event.target.value)}
                    className="field"
                    placeholder="catalogo-web"
                    spellCheck={false}
                  />
                </label>
              </div>

              <div className="mt-3 rounded-xl border border-line bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold text-ink">
                    <KeyRound className="h-3.5 w-3.5 text-slate-400" />
                    Clave secreta (solo escritura)
                  </span>
                  {status.remote.hasSecret ? (
                    <Badge variant="success" dot>
                      Guardada cifrada
                    </Badge>
                  ) : (
                    <Badge variant="warning" dot>
                      Sin configurar
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    className="field flex-1"
                    placeholder={
                      status.remote.hasSecret
                        ? 'Escribe una nueva clave para reemplazarla'
                        : 'sb_secret_…'
                    }
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  <Button
                    variant="secondary"
                    loading={savingSecret}
                    disabled={!secret.trim()}
                    leftIcon={<Save className="h-4 w-4" />}
                    onClick={() => void saveSecret()}
                  >
                    Guardar clave
                  </Button>
                  {status.remote.hasSecret ? (
                    <Button
                      variant="ghost"
                      loading={clearingSecret}
                      leftIcon={<Trash2 className="h-4 w-4 text-danger-500" />}
                      onClick={() => void clearSecret()}
                    >
                      Quitar
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[9px] leading-relaxed text-slate-400">
                  Se cifra con el almacén seguro de Windows. Nunca se envía a la web ni se
                  muestra en la interfaz.
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  loading={savingRemote}
                  leftIcon={<Save className="h-4 w-4" />}
                  onClick={() => void saveRemoteConfig()}
                >
                  Guardar configuración
                </Button>
                <Button
                  variant="secondary"
                  loading={testing}
                  leftIcon={<Wifi className="h-4 w-4" />}
                  onClick={() => void testConnection()}
                >
                  Probar conexión
                </Button>
                <Button
                  variant="success"
                  loading={publishingRemote}
                  disabled={!remoteReady}
                  leftIcon={<CloudUpload className="h-4 w-4" />}
                  onClick={() => void publishRemote()}
                >
                  Publicar en Supabase
                </Button>
              </div>

              <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5">
                <input
                  type="checkbox"
                  checked={remoteEnabled}
                  onChange={(event) => void updateRemoteEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                <span className="text-[11px] font-semibold text-ink">
                  Usar Supabase como destino de la web
                </span>
              </label>

              {connection ? (
                <div
                  className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-[10px] leading-relaxed ${
                    connection.ok
                      ? 'border-success-200 bg-success-50 text-success-700'
                      : 'border-danger-200 bg-danger-50 text-danger-700'
                  }`}
                >
                  {connection.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <div>
                    <p className="font-semibold">{connection.message}</p>
                    {connection.ok && connection.publicBucket === false ? (
                      <p className="mt-1">
                        Cambia el bucket a público de lectura en Supabase para que la web pueda
                        leer el catálogo y las imágenes.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line bg-white p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    Última publicación
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-ink">
                    {status.remote.lastPublishedAt
                      ? formatDateTime(status.remote.lastPublishedAt)
                      : 'Nunca'}
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-white p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    Productos / imágenes
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-ink">
                    {status.remote.lastProductCount} / {status.remote.lastImageCount}
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-white p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    Promociones / tamaño
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-ink">
                    {status.remote.lastPromotionCount} / {formatBytes(status.remote.lastBytes)}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {status.remote.lastMessage || 'Aún no se ha publicado en Supabase.'}
              </p>
            </div>

            <div className="rounded-2xl border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <FolderOpen className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold text-ink">Respaldo local</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      Copia del snapshot en este equipo para desarrollo o contingencia.
                    </p>
                  </div>
                </div>
                <Badge variant={localBadge.variant} dot>
                  {localBadge.label}
                </Badge>
              </div>

              <label className="mt-3 block">
                <span className="field-label">Carpeta de destino</span>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={status.targetPath}
                    readOnly
                    className="field flex-1 bg-slate-50 text-slate-500"
                  />
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

              <p className="mt-2 text-[10px] text-slate-500">
                {status.lastMessage || 'Aún no se ha publicado localmente.'}
              </p>
            </div>

            <div className="rounded-2xl border border-line p-4">
              <div>
                <h3 className="text-[12px] font-semibold text-ink">Stock en la web</h3>
                <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                  Controla si la web muestra las cantidades disponibles o solo avisa cuando
                  una referencia está agotada.
                </p>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    stockVisibility === 'always'
                      ? 'border-brand-300 bg-brand-50/70'
                      : 'border-line bg-white hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="stock-visibility"
                    checked={stockVisibility === 'always'}
                    onChange={() => void updateStockVisibility('always')}
                    className="h-4 w-4 border-slate-300 text-brand-600"
                  />
                  <span className="ml-2 text-[11px] font-semibold text-ink">
                    Mostrar cantidades disponibles
                  </span>
                  <span className="mt-1 block pl-6 text-[9px] leading-relaxed text-slate-500">
                    La web muestra “Disponible”, “Última unidad” o “Pocas unidades”.
                  </span>
                </label>
                <label
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    stockVisibility === 'outOnly'
                      ? 'border-brand-300 bg-brand-50/70'
                      : 'border-line bg-white hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="stock-visibility"
                    checked={stockVisibility === 'outOnly'}
                    onChange={() => void updateStockVisibility('outOnly')}
                    className="h-4 w-4 border-slate-300 text-brand-600"
                  />
                  <span className="ml-2 text-[11px] font-semibold text-ink">
                    Mostrar solo “Agotado”
                  </span>
                  <span className="mt-1 block pl-6 text-[9px] leading-relaxed text-slate-500">
                    Las referencias con stock no muestran cantidad; las agotadas sí se marcan.
                  </span>
                </label>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-3">
              <input
                type="checkbox"
                checked={status.autoPublish}
                onChange={(event) => void updateAutoPublish(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              <span className="text-[11px] font-semibold text-ink">
                Publicar automáticamente después de cambios de inventario, ventas u OT
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="success"
                loading={publishing}
                leftIcon={<RefreshCw className="h-4 w-4" />}
                onClick={() => void publish()}
              >
                Publicar catálogo ahora
              </Button>
              <span className="text-[9px] text-slate-400">
                {status.remote.enabled
                  ? 'Publica el respaldo local y Supabase.'
                  : 'Publica solo el respaldo local.'}
              </span>
            </div>

            <p className="text-[9px] leading-relaxed text-slate-400">
              Para la web pública, la app sube <code>catalog.json</code>,{' '}
              <code>orders-demo.json</code> y las imágenes al bucket. La web no recibe la clave
              secreta ni puede escribir en Supabase.
            </p>
          </div>
        ) : (
          <p className="mt-5 text-xs text-slate-400">No se pudo cargar el estado.</p>
        )}
      </div>
    </div>
  )
}
