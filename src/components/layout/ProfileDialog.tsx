import { useEffect, useState } from 'react'
import { Camera, KeyRound, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AppUser } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { api, errorMessage } from '@/lib/backend'
import { roleLabels } from '@/lib/permissions'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshProfile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [profile, setProfile] = useState<AppUser | null>(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    documentType: 'CC',
    document: '',
    photoDataUrl: null as string | null
  })
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' })

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    api.profile
      .get()
      .then((data) => {
        if (!active) return
        setProfile(data)
        setForm({
          name: data.name,
          email: data.email ?? '',
          phone: data.phone ?? '',
          address: data.address ?? '',
          documentType: data.documentType ?? 'CC',
          document: data.document ?? '',
          photoDataUrl: data.photoUrl ?? null
        })
        setPassword({ current: '', next: '', confirm: '' })
      })
      .catch((failure) => {
        if (active) toast.error('No se pudo cargar tu perfil', { description: errorMessage(failure) })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open])

  function handlePhoto(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Selecciona una imagen PNG, JPEG o WebP')
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error('La imagen es demasiado grande; usa una de máximo 3 MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const size = 256
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d')
        if (!context) return
        const scale = Math.max(size / image.width, size / image.height)
        const width = image.width * scale
        const height = image.height * scale
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
        setForm((current) => ({ ...current, photoDataUrl: canvas.toDataURL('image/jpeg', 0.82) }))
      }
      image.src = String(reader.result ?? '')
    }
    reader.readAsDataURL(file)
  }

  async function saveProfile() {
    if (saving) return
    if (form.name.trim().length < 3) {
      toast.error('Escribe tu nombre completo')
      return
    }
    setSaving(true)
    try {
      await api.profile.update({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        documentType: form.documentType,
        document: form.document.trim(),
        photoDataUrl: form.photoDataUrl
      })
      await refreshProfile()
      toast.success('Perfil actualizado')
      onClose()
    } catch (failure) {
      toast.error('No se pudo actualizar el perfil', { description: errorMessage(failure) })
    } finally {
      setSaving(false)
    }
  }

  async function changePassword() {
    if (passwordSaving) return
    if (!password.current || password.next.length < 8) {
      toast.error('Ingresa la contraseña actual y una nueva de al menos 8 caracteres')
      return
    }
    if (password.next !== password.confirm) {
      toast.error('La confirmación de la contraseña no coincide')
      return
    }
    setPasswordSaving(true)
    try {
      await api.auth.changePassword(password.current, password.next)
      setPassword({ current: '', next: '', confirm: '' })
      toast.success('Contraseña actualizada')
    } catch (failure) {
      toast.error('No se pudo cambiar la contraseña', { description: errorMessage(failure) })
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mi perfil"
      description="Tus datos personales y el acceso a tu cuenta."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void saveProfile()} loading={saving} leftIcon={<Save className="h-4 w-4" />}>
            Guardar cambios
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando perfil…
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-slate-50/60 p-3">
            {form.photoDataUrl ? (
              <img src={form.photoDataUrl} alt="Foto de perfil" className="h-16 w-16 rounded-full object-cover ring-4 ring-white" />
            ) : (
              <Avatar name={form.name || 'Usuario'} size="lg" />
            )}
            <div className="flex flex-wrap gap-2">
              <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300">
                <Camera className="h-3.5 w-3.5" />
                Cambiar foto
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => handlePhoto(event.target.files?.[0] ?? null)}
                />
              </label>
              {form.photoDataUrl ? (
                <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, photoDataUrl: null })} leftIcon={<Trash2 className="h-3.5 w-3.5" />}>
                  Quitar
                </Button>
              ) : null}
            </div>
            <p className="w-full text-[9px] leading-relaxed text-slate-400 sm:w-auto">
              Se recorta a 256 px y se guarda localmente. Solo tú puedes cambiar estos datos.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">Usuario</span>
              <input value={profile?.username ?? ''} disabled className="field bg-slate-50 text-slate-400" />
            </label>
            <label className="block">
              <span className="field-label">Rol</span>
              <input value={profile ? roleLabels[profile.role] : ''} disabled className="field bg-slate-50 text-slate-400" />
            </label>
            <label className="block sm:col-span-2">
              <span className="field-label">Nombre completo</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" />
            </label>
            <label className="block">
              <span className="field-label">Correo</span>
              <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" type="email" />
            </label>
            <label className="block">
              <span className="field-label">Teléfono</span>
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="field" />
            </label>
            <label className="block">
              <span className="field-label">Tipo de documento</span>
              <select value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value })} className="field">
                {['CC', 'NIT', 'Pasaporte'].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Documento</span>
              <input value={form.document} onChange={(event) => setForm({ ...form, document: event.target.value })} className="field" />
            </label>
            <label className="block sm:col-span-2">
              <span className="field-label">Dirección</span>
              <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="field" />
            </label>
          </div>

          <div className="rounded-xl border border-line p-3.5">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-brand-600" />
              <div>
                <p className="text-[11px] font-semibold text-ink">Cambiar contraseña</p>
                <p className="text-[9px] text-slate-400">Opcional. Se aplica a tu propia cuenta.</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <input
                type="password"
                value={password.current}
                onChange={(event) => setPassword({ ...password, current: event.target.value })}
                placeholder="Contraseña actual"
                className="field"
                autoComplete="current-password"
              />
              <input
                type="password"
                value={password.next}
                onChange={(event) => setPassword({ ...password, next: event.target.value })}
                placeholder="Nueva contraseña"
                className="field"
                autoComplete="new-password"
              />
              <input
                type="password"
                value={password.confirm}
                onChange={(event) => setPassword({ ...password, confirm: event.target.value })}
                placeholder="Repetir nueva"
                className="field"
                autoComplete="new-password"
              />
            </div>
            <div className="mt-2 flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => void changePassword()} loading={passwordSaving}>
                Actualizar contraseña
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
