import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardPaste, Image as ImageIcon, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp']
const MAX_BYTES = 8 * 1024 * 1024

export async function prepareProductImageFile(file: File) {
  const bitmap = await createImageBitmap(file)
  const mainSize = 1200
  const mainScale = Math.min(1, mainSize / Math.max(bitmap.width, bitmap.height))
  const mainCanvas = document.createElement('canvas')
  mainCanvas.width = Math.max(1, Math.round(bitmap.width * mainScale))
  mainCanvas.height = Math.max(1, Math.round(bitmap.height * mainScale))
  const mainContext = mainCanvas.getContext('2d')
  if (!mainContext) throw new Error('No se pudo preparar la imagen.')
  mainContext.fillStyle = '#ffffff'
  mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height)
  mainContext.drawImage(bitmap, 0, 0, mainCanvas.width, mainCanvas.height)

  const thumbSize = 300
  const thumbScale = Math.min(1, thumbSize / Math.max(bitmap.width, bitmap.height))
  const thumbCanvas = document.createElement('canvas')
  thumbCanvas.width = Math.max(1, Math.round(bitmap.width * thumbScale))
  thumbCanvas.height = Math.max(1, Math.round(bitmap.height * thumbScale))
  const thumbContext = thumbCanvas.getContext('2d')
  if (!thumbContext) throw new Error('No se pudo preparar la miniatura.')
  thumbContext.fillStyle = '#ffffff'
  thumbContext.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height)
  thumbContext.drawImage(bitmap, 0, 0, thumbCanvas.width, thumbCanvas.height)
  bitmap.close()

  return {
    dataUrl: mainCanvas.toDataURL('image/jpeg', 0.86),
    thumbnailDataUrl: thumbCanvas.toDataURL('image/jpeg', 0.78)
  }
}

export function ProductImageField({
  previewUrl,
  hasExisting,
  disabled,
  onChange,
  onRemove
}: {
  previewUrl: string | null
  hasExisting: boolean
  disabled?: boolean
  onChange: (dataUrl: string, thumbnailDataUrl: string) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const acceptFile = useCallback(
    async (file: File) => {
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
      setBusy(true)
      try {
        const result = await prepareProductImageFile(file)
        onChange(result.dataUrl, result.thumbnailDataUrl)
      } catch (error) {
        toast.error('No se pudo procesar la imagen', {
          description: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setBusy(false)
      }
    },
    [onChange]
  )

  useEffect(() => {
    if (disabled) return
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }
      const image = Array.from(event.clipboardData?.items ?? []).find(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      )
      const file = image?.getAsFile()
      if (!file) return
      event.preventDefault()
      void acceptFile(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [acceptFile, disabled])

  return (
    <div className="rounded-xl border border-line bg-slate-50/60 p-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            if (disabled) return
            const file = event.dataTransfer.files?.[0]
            if (file) void acceptFile(file)
          }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="Imagen del producto" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-slate-300">
              <ImageIcon className="h-7 w-7" />
              <span className="text-[9px]">Sin imagen</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-ink">Imagen principal</p>
          <p className="mt-0.5 text-[9px] leading-relaxed text-slate-400">
            Se usa como portada. Después de guardar la referencia puedes agregar más imágenes
            desde la galería. Se incluye en los respaldos completos. Puedes cargar un archivo,
            arrastrarlo o pegarlo con Ctrl+V.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || busy}
              loading={busy}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
            >
              Cargar imagen
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                toast.info('Pega una imagen con Ctrl+V', {
                  description: 'Copia una imagen desde el navegador o el explorador.'
                })
              }}
              disabled={disabled || busy}
              leftIcon={<ClipboardPaste className="h-3.5 w-3.5" />}
            >
              Ctrl+V
            </Button>
            {previewUrl || hasExisting ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onRemove}
                disabled={disabled || busy}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Quitar
              </Button>
            ) : null}
          </div>
        </div>
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
