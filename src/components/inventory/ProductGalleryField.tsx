import { useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  Plus,
  Star,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import type { ProductImage } from '@/types'
import { Button } from '@/components/ui/Button'
import { prepareProductImageFile } from '@/components/inventory/ProductImageField'
import { cn } from '@/lib/utils'

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp']
const MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX = 8

export function ProductGalleryField({
  images,
  disabled,
  max = DEFAULT_MAX,
  onAdd,
  onRemove,
  onCover,
  onMove
}: {
  images: ProductImage[]
  disabled?: boolean
  max?: number
  onAdd: (dataUrl: string, thumbnailDataUrl: string) => void | Promise<void>
  onRemove: (id: string) => void | Promise<void>
  onCover: (id: string) => void | Promise<void>
  onMove: (id: string, direction: -1 | 1) => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const ordered = [...images].sort((a, b) => {
    if (a.isCover !== b.isCover) return a.isCover ? -1 : 1
    return a.sortOrder - b.sortOrder
  })

  async function acceptFile(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Formato de imagen no compatible', {
        description: 'Usa PNG, JPEG, WebP o BMP.'
      })
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('La imagen es demasiado grande', { description: 'El límite es 8 MB.' })
      return
    }
    if (ordered.length >= max) {
      toast.error(`Máximo ${max} imágenes por producto`)
      return
    }
    setBusy(true)
    try {
      const result = await prepareProductImageFile(file)
      await onAdd(result.dataUrl, result.thumbnailDataUrl)
    } catch (error) {
      toast.error('No se pudo procesar la imagen', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-slate-50/60 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-ink">Galería del producto</p>
          <p className="mt-0.5 text-[9px] leading-relaxed text-slate-400">
            Hasta {max} imágenes. La portada se publica en el catálogo y en el POS. Puedes
            arrastrar o seleccionar un archivo.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy || ordered.length >= max}
          loading={busy}
          leftIcon={<Plus className="h-3.5 w-3.5" />}
        >
          Agregar imagen
        </Button>
      </div>

      <div
        className={cn(
          'mt-3 grid gap-2.5 sm:grid-cols-3',
          !ordered.length && 'rounded-xl border border-dashed border-line bg-white/70 px-4 py-8 text-center'
        )}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          if (disabled || busy) return
          const file = event.dataTransfer.files?.[0]
          if (file) void acceptFile(file)
        }}
      >
        {ordered.length ? (
          ordered.map((image, index) => (
            <div
              key={image.id}
              className={cn(
                'group overflow-hidden rounded-xl border bg-white',
                image.isCover ? 'border-brand-300 ring-2 ring-brand-100' : 'border-line'
              )}
            >
              <div className="relative h-28 bg-slate-50">
                <img
                  src={image.thumbnailUrl || image.url}
                  alt={image.alt || 'Imagen del producto'}
                  className="h-full w-full object-cover"
                />
                {image.isCover ? (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                    <Star className="h-2.5 w-2.5" /> Portada
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-1 border-t border-line px-1.5 py-1.5">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={
                      disabled ||
                      image.isCover ||
                      ordered.filter((item) => !item.isCover).findIndex((item) => item.id === image.id) <= 0
                    }
                    onClick={() => void onMove(image.id, -1)}
                    className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-ink disabled:opacity-30"
                    aria-label="Mover imagen a la izquierda"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={
                      disabled ||
                      image.isCover ||
                      index === ordered.length - 1 ||
                      ordered.filter((item) => !item.isCover).findIndex((item) => item.id === image.id) ===
                        ordered.filter((item) => !item.isCover).length - 1
                    }
                    onClick={() => void onMove(image.id, 1)}
                    className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-ink disabled:opacity-30"
                    aria-label="Mover imagen a la derecha"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-0.5">
                  {!image.isCover ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void onCover(image.id)}
                      className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
                      aria-label="Usar como portada"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void onRemove(image.id)}
                    className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-danger-50 hover:text-danger-600"
                    aria-label="Eliminar imagen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="sm:col-span-3">
            <ImageIcon className="mx-auto h-7 w-7 text-slate-300" />
            <p className="mt-2 text-[10px] text-slate-400">
              Sin imágenes. Agrega la primera para usarla como portada.
            </p>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void acceptFile(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}
