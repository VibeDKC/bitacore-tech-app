import { useRef, useState } from 'react'
import { FileText, Paperclip, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'

export interface ReceiptDraft {
  dataUrl: string
  name: string
  mimeType: string
  size: number
}

const MAX_BYTES = 8 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

async function prepareFile(file: File): Promise<ReceiptDraft> {
  if (file.size > MAX_BYTES) throw new Error('El comprobante supera el límite de 8 MB.')
  if (file.type === 'application/pdf') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('No se pudo leer el PDF.'))
      reader.readAsDataURL(file)
    })
    return { dataUrl, name: file.name, mimeType: file.type, size: file.size }
  }
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error('Usa una imagen PNG/JPEG/WebP o un PDF.')
  }
  const bitmap = await createImageBitmap(file)
  const maxSize = 1600
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo preparar la imagen.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
  const size = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
  return {
    dataUrl,
    name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
    mimeType: 'image/jpeg',
    size
  }
}

export function PaymentReceiptField({
  value,
  onChange,
  disabled
}: {
  value: ReceiptDraft | null
  onChange: (value: ReceiptDraft | null) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function accept(file: File) {
    setBusy(true)
    try {
      onChange(await prepareFile(file))
    } catch (error) {
      toast.error('No se pudo adjuntar el comprobante', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-ink">
            <Paperclip className="h-3 w-3" /> Comprobante de pago (opcional)
          </p>
          {value ? (
            <p className="mt-1 truncate text-[9px] text-slate-500">
              {value.mimeType === 'application/pdf' ? (
                <FileText className="mr-1 inline h-3 w-3" />
              ) : null}
              {value.name} · {(value.size / 1024).toFixed(0)} KB
            </p>
          ) : (
            <p className="mt-0.5 text-[9px] text-slate-400">Imagen o PDF, máximo 8 MB.</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            loading={busy}
          >
            {value ? 'Cambiar' : 'Adjuntar'}
          </Button>
          {value ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange(null)}
              disabled={disabled || busy}
              leftIcon={<Trash2 className="h-3 w-3" />}
            >
              Quitar
            </Button>
          ) : null}
        </div>
      </div>
      {value && value.mimeType.startsWith('image/') ? (
        <img
          src={value.dataUrl}
          alt="Comprobante de pago"
          className="mt-2 max-h-28 rounded-lg border border-line bg-white object-contain"
        />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void accept(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}
