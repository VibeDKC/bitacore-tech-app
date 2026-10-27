import { Fragment, useEffect, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  CloudUpload,
  Copy,
  DatabaseBackup,
  Eye,
  EyeOff,
  FileText,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  Minus,
  Printer,
  ReceiptText,
  RefreshCcw,
  Save,
  Server,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type { AppUser, BackupRecord, LegalConfig, Role } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can, capabilityLabels, allCapabilities, permissionMatrix, roleCan, roleDescriptions, roleLabels, rootOnlyCapabilities } from '@/lib/permissions'
import { defaultLegalConfig } from '@/lib/legalConfig'
import { formatDateTime } from '@/lib/format'
import { calculateNitDv, normalizeNit } from '@/lib/nit'
import { api, errorMessage } from '@/lib/backend'
import { useApi } from '@/lib/useApi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { Modal } from '@/components/ui/Modal'
import { DictionariesPanel } from '@/components/settings/DictionariesPanel'
import { MessagesPanel } from '@/components/settings/MessagesPanel'
import { DEFAULT_MESSAGES, type MessageTemplates } from '@/types'
import { cn } from '@/lib/utils'

type SettingsTab = 'negocio' | 'usuarios' | 'diccionarios' | 'impresion' | 'mensajes' | 'respaldos' | 'ia' | 'seguridad'
type PrintFormat = 'a4' | '80mm' | '58mm'

const tabs: Array<{ value: SettingsTab; label: string; description: string; icon: typeof Store }> = [
  { value: 'negocio', label: 'Negocio', description: 'Identidad y sucursal', icon: Store },
  { value: 'usuarios', label: 'Usuarios y roles', description: 'Equipo y permisos', icon: Users },
  { value: 'diccionarios', label: 'Diccionarios', description: 'Catálogos y desplegables', icon: BookOpen },
  { value: 'impresion', label: 'Impresión', description: 'Formatos y comprobantes', icon: Printer },
  { value: 'mensajes', label: 'Mensajes', description: 'WhatsApp y reportes', icon: MessageCircle },
  { value: 'respaldos', label: 'Respaldos', description: 'Backup y restauración', icon: DatabaseBackup },
  { value: 'ia', label: 'IA y API', description: 'Claves y asistentes', icon: Sparkles },
  { value: 'seguridad', label: 'Seguridad', description: 'Acceso y protección', icon: ShieldCheck }
]

const roleTone: Record<Role, 'warning' | 'brand' | 'success' | 'sky'> = {
  superadmin: 'warning',
  admin: 'brand',
  tecnico: 'success',
  cajero: 'sky'
}

type LegalDraft = LegalConfig & { shortText: string; fullText: string }

interface BusinessDraft {
  businessName: string
  nit: string
  nitDv: string
  foreignNit: string
  phone: string
  email: string
  address: string
  city: string
  currency: string
  timezone: string
}

interface PrintDraft {
  defaultFormat: PrintFormat
  autoPrint: boolean
  showLogo: boolean
  showTerms: boolean
}

interface AiDraft {
  enabled: boolean
  diagnosis: boolean
  summary: boolean
  anomalies: boolean
  provider: string
  model: string
  apiKey: string
}

interface SecurityDraft {
  sessionHours: number
}

function toLegalDraft(config: LegalConfig): LegalDraft {
  return {
    ...config,
    shortText: config.shortClauses.join('\n'),
    fullText: config.fullClauses.join('\n')
  }
}

function splitClauses(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function normalizeFormat(value: string): PrintFormat {
  const normalized = String(value).toLowerCase()
  if (normalized === 'a4') return 'a4'
  if (normalized === '58mm') return '58mm'
  return '80mm'
}

function formatBytes(size: number | string) {
  if (typeof size === 'string') return size
  if (!Number.isFinite(size)) return '—'
  const megabytes = size / (1024 * 1024)
  if (megabytes < 0.1) return `${Math.max(Math.round(size / 1024), 1)} KB`
  return `${megabytes.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
}

function formatLastAccess(value: string) {
  if (!value || value === 'Sin acceso') return 'Sin acceso'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : formatDateTime(date)
}

const accessMeta = {
  full: { label: 'Completo', icon: Check, className: 'bg-success-50 text-success-600' },
  partial: { label: 'Parcial', icon: Minus, className: 'bg-warning-50 text-warning-600' },
  readonly: { label: 'Lectura', icon: Eye, className: 'bg-sky-50 text-sky-600' },
  none: { label: 'Sin acceso', icon: X, className: 'bg-slate-100 text-slate-300' }
} as const

export function SettingsPage() {
  const { role, actualRole, displayUser, user, refreshProfile } = useAuth()
  const { data, loading, error, reload, setData } = useApi(async () => {
    const settings = await api.settings.get()
    const [users, backups] = await Promise.all([
      api.users.list().catch(() => [] as AppUser[]),
      api.backups.list().catch(() => [] as BackupRecord[])
    ])
    return { settings, users, backups }
  }, [])

  const [tab, setTab] = useState<SettingsTab>('negocio')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editUser, setEditUser] = useState<AppUser | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupRecord | null>(null)
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [purgeText, setPurgeText] = useState('')
  const [purgePassword, setPurgePassword] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [userSaving, setUserSaving] = useState(false)
  const [photoMember, setPhotoMember] = useState<AppUser | null>(null)
  const [photoDraft, setPhotoDraft] = useState<string | null>(null)
  const [photoSaving, setPhotoSaving] = useState(false)
  const [backupSaving, setBackupSaving] = useState(false)
  const [backupPasswordOpen, setBackupPasswordOpen] = useState(false)
  const [backupPasswordForm, setBackupPasswordForm] = useState({ password: '', confirm: '' })
  const [backupPasswordSaving, setBackupPasswordSaving] = useState(false)
  const [backupTransferSaving, setBackupTransferSaving] = useState<'export' | 'import' | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [invite, setInvite] = useState({ name: '', username: '', email: '', role: 'tecnico' as Role, password: '', document: '', phone: '', address: '' })
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    role: 'tecnico' as Role,
    active: true,
    password: '',
    document: '',
    phone: '',
    address: '',
    photoDataUrl: null as string | null,
    permissions: [] as Array<{ capability: (typeof allCapabilities)[number]; allowed: boolean }>
  })
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [legalDraft, setLegalDraft] = useState<LegalDraft>(() => toLegalDraft(defaultLegalConfig))
  const [businessDraft, setBusinessDraft] = useState<BusinessDraft>({
    businessName: defaultLegalConfig.businessName,
    nit: defaultLegalConfig.nit,
    nitDv: defaultLegalConfig.nitDv ?? '',
    foreignNit: defaultLegalConfig.foreignNit ?? '',
    phone: defaultLegalConfig.phone,
    email: defaultLegalConfig.email,
    address: defaultLegalConfig.address,
    city: defaultLegalConfig.city,
    currency: 'COP',
    timezone: 'America/Bogota'
  })
  const [printDraft, setPrintDraft] = useState<PrintDraft>({
    defaultFormat: '80mm',
    autoPrint: false,
    showLogo: true,
    showTerms: true
  })
  const [aiDraft, setAiDraft] = useState<AiDraft>({
    enabled: false,
    diagnosis: false,
    summary: false,
    anomalies: false,
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    apiKey: ''
  })
  const [messagesDraft, setMessagesDraft] = useState<MessageTemplates>(DEFAULT_MESSAGES)
  const [securityDraft, setSecurityDraft] = useState<SecurityDraft>({ sessionHours: 12 })
  const [rolePermissionsDraft, setRolePermissionsDraft] = useState<Record<string, boolean>>({})

  const canManageStaff = can(role, 'manageStaff')
  const canDictionaries = can(role, 'manageDictionaries')
  const canManageAdmins = can(role, 'manageAdmins')
  const canCreateBackup = can(role, 'createBackup')
  const canRestore = can(role, 'restoreBackup')
  const canPurge = can(role, 'purgeData')
  const canLegal = can(role, 'configureLegal')
  const canAI = can(role, 'configureAI')
  const isSuperadmin = role === 'superadmin'

  const settings = data?.settings ?? null
  const staff = data?.users ?? []
  const backups = data?.backups ?? []

  useEffect(() => {
    if (!data) return
    const current = data.settings
    setLegalDraft(toLegalDraft(current.legal))
    setBusinessDraft({
      businessName: current.legal.businessName,
      nit: current.legal.nit,
      nitDv: current.legal.nitDv ?? calculateNitDv(current.legal.nit),
      foreignNit: current.legal.foreignNit ?? '',
      phone: current.legal.phone,
      email: current.legal.email,
      address: current.legal.address,
      city: current.legal.city,
      currency: current.business.currency,
      timezone: current.business.timezone
    })
    setPrintDraft({
      defaultFormat: normalizeFormat(current.print.defaultFormat),
      autoPrint: current.print.autoPrint,
      showLogo: current.print.showLogo,
      showTerms: current.print.showTermsOnReceipt
    })
    setAiDraft({
      enabled: current.ai.enabled,
      diagnosis: current.ai.diagnosis,
      summary: current.ai.summary,
      anomalies: current.ai.anomalies,
      model: current.ai.model,
      provider: current.ai.provider ?? 'gemini',
      apiKey: ''
    })
    setMessagesDraft(current.messages ?? DEFAULT_MESSAGES)
    setSecurityDraft({
      sessionHours: current.security.sessionHours
    })
    const permissions: Record<string, boolean> = {}
    for (const role of ['admin', 'tecnico', 'cajero'] as const) {
      for (const capability of allCapabilities) {
        const row = current.rolePermissions?.find(
          (item) => item.role === role && item.capability === capability
        )
        permissions[`${role}:${capability}`] = row ? row.allowed : roleCan(role, capability)
      }
    }
    setRolePermissionsDraft(permissions)
  }, [data])

  const visibleStaff = isSuperadmin ? staff : staff.filter((member) => member.role !== 'superadmin')
  const visibleMatrix = permissionMatrix
    .map((group) => ({
      ...group,
      items: isSuperadmin
        ? group.items
        : group.items.filter((item) => item.label !== 'Cuenta raíz' && item.label !== 'Auditoría')
    }))
    .filter((group) => group.items.length > 0)

  const inviteRoles: Role[] = canManageAdmins ? ['admin', 'tecnico', 'cajero'] : ['tecnico', 'cajero']

  function applySettings(updated: typeof settings) {
    if (!updated) return
    setData((current) => (current ? { ...current, settings: updated } : current))
  }

  async function saveBusiness() {    if (saving) return
    setSaving('negocio')
    try {
      let legalConfig = settings?.legal ?? defaultLegalConfig
      if (canLegal) {
        legalConfig = await api.legal.update({
          businessName: businessDraft.businessName.trim(),
          nit: normalizeNit(businessDraft.nit),
          nitDv: businessDraft.nitDv,
          foreignNit: businessDraft.foreignNit.trim(),
          phone: businessDraft.phone.trim(),
          email: businessDraft.email.trim(),
          address: businessDraft.address.trim(),
          city: businessDraft.city.trim()
        })
      }
      const updated = await api.settings.updateSection('business', {
        currency: businessDraft.currency,
        timezone: businessDraft.timezone
      })
      applySettings({ ...updated, legal: legalConfig })
      setLegalDraft(toLegalDraft(legalConfig))
      toast.success('Datos del negocio actualizados', {
        description: canLegal
          ? 'La identidad se guardó en la configuración legal versionada.'
          : 'La configuración regional se guardó. La identidad legal es editable solo por el propietario.'
      })
    } catch (failure) {
      toast.error('No se pudieron guardar los datos del negocio', { description: errorMessage(failure) })
    } finally {
      setSaving(null)
    }
  }

  async function saveEquipmentSettings(enabled: boolean) {
    if (saving) return
    setSaving('equipment')
    try {
      const updated = await api.settings.updateSection('equipment', { qrEnabled: enabled })
      applySettings(updated)
      toast.success(enabled ? 'Etiquetas QR habilitadas' : 'Etiquetas QR deshabilitadas', {
        description: enabled
          ? 'Puedes generar una etiqueta desde la ficha del equipo del cliente.'
          : 'El catálogo de equipos sigue activo, solo se ocultan las etiquetas QR.'
      })
    } catch (failure) {
      toast.error('No se pudo actualizar la configuración de equipos', { description: errorMessage(failure) })
    } finally {
      setSaving(null)
    }
  }

  async function savePrint() {
    if (saving) return
    setSaving('impresion')
    try {
      const paperWidth = printDraft.defaultFormat === 'a4' ? 210 : printDraft.defaultFormat === '58mm' ? 58 : 80
      const updated = await api.settings.updateSection('print', {
        defaultFormat: printDraft.defaultFormat,
        autoPrint: printDraft.autoPrint,
        showLogo: printDraft.showLogo,
        showTermsOnReceipt: printDraft.showTerms,
        paperWidth
      })
      applySettings(updated)
      toast.success('Preferencias de impresión guardadas', {
        description: 'Se aplican a los comprobantes de OT y de ventas.'
      })
    } catch (failure) {
      toast.error('No se pudieron guardar las preferencias', { description: errorMessage(failure) })
    } finally {
      setSaving(null)
    }
  }

  async function saveAi() {
    if (!canAI || saving) return
    setSaving('ia')
    try {
      const payload: Record<string, unknown> = {
        enabled: aiDraft.enabled,
        diagnosis: aiDraft.diagnosis,
        summary: aiDraft.summary,
        anomalies: aiDraft.anomalies,
        provider: aiDraft.provider,
        model: aiDraft.model.trim() || 'Sin configurar'
      }
      if (aiDraft.apiKey.trim()) payload.apiKey = aiDraft.apiKey.trim()
      const updated = await api.settings.updateSection('ai', payload)
      applySettings(updated)
      setAiDraft({
        enabled: updated.ai.enabled,
        diagnosis: updated.ai.diagnosis,
        summary: updated.ai.summary,
        anomalies: updated.ai.anomalies,
        provider: updated.ai.provider ?? 'gemini',
        model: updated.ai.model,
        apiKey: ''
      })
      toast.success('Configuración de IA guardada', {
        description: 'La clave no se devuelve al renderer; solo se conserva su huella de verificación.'
      })
    } catch (failure) {
      toast.error('No se pudo guardar la configuración de IA', { description: errorMessage(failure) })
    } finally {
      setSaving(null)
    }
  }

  async function saveRolePermissions() {
    if (actualRole !== 'superadmin' || saving) return
    setSaving('permisos')
    try {
      let updated = null as Awaited<ReturnType<typeof api.permissions.updateRole>> | null
      for (const role of ['admin', 'tecnico', 'cajero'] as const) {
        const items = allCapabilities.map((capability) => ({
          capability,
          allowed: rootOnlyCapabilities.includes(capability)
            ? false
            : Boolean(rolePermissionsDraft[`${role}:${capability}`])
        }))
        updated = await api.permissions.updateRole(role, items)
      }
      if (updated) applySettings(updated)
      toast.success('Matriz de permisos actualizada', {
        description: 'Los cambios aplican a las sesiones nuevas y a las acciones del proceso principal.'
      })
    } catch (failure) {
      toast.error('No se pudo guardar la matriz', { description: errorMessage(failure) })
    } finally {
      setSaving(null)
    }
  }

  async function saveMessages() {
    if (saving) return
    if (!messagesDraft.initial.trim() || !messagesDraft.ready.trim()) {
      toast.error('Completa los dos mensajes antes de guardar')
      return
    }
    setSaving('messages')
    try {
      const updated = await api.settings.updateSection('messages', messagesDraft)
      applySettings(updated)
      setMessagesDraft(updated.messages ?? messagesDraft)
      toast.success('Mensajes actualizados', {
        description: 'Se usarán en los reportes y en WhatsApp.'
      })
    } catch (failure) {
      toast.error('No se pudieron guardar los mensajes', { description: errorMessage(failure) })
    } finally {
      setSaving(null)
    }
  }

  async function saveSecurity() {    if (saving) return
    setSaving('seguridad')
    try {
      const updated = await api.settings.updateSection('security', {
        strictSessions: settings?.security.strictSessions ?? true,
        sessionHours: Math.min(Math.max(Math.round(securityDraft.sessionHours) || 12, 1), 168)
      })
      applySettings(updated)
      toast.success('Política de sesión actualizada', {
        description: `La sesión dura ${updated.security.sessionHours} h y se cierra al cerrar la aplicación.`
      })
    } catch (failure) {
      toast.error('No se pudo guardar la política de sesión', { description: errorMessage(failure) })
    } finally {
      setSaving(null)
    }
  }

  async function saveLegal() {
    if (!canLegal) {
      toast.error('Solo el propietario puede modificar las cláusulas legales')
      return
    }
    if (!legalDraft.abandonmentDays || legalDraft.abandonmentDays < 1) {
      toast.error('Define los días de abandono')
      return
    }
    if (!legalDraft.warrantyDays || legalDraft.warrantyDays < 1) {
      toast.error('Define los días de garantía')
      return
    }
    if (!splitClauses(legalDraft.shortText).length || !splitClauses(legalDraft.fullText).length) {
      toast.error('Debe existir al menos una cláusula corta y una completa')
      return
    }
    setSaving('legal')
    try {
      const saved = await api.legal.update({
        businessName: legalDraft.businessName,
        nit: normalizeNit(legalDraft.nit),
        nitDv: legalDraft.nitDv,
        foreignNit: legalDraft.foreignNit ?? '',
        phone: legalDraft.phone,
        address: legalDraft.address,
        city: legalDraft.city,
        email: legalDraft.email,
        abandonmentDays: legalDraft.abandonmentDays,
        warrantyDays: legalDraft.warrantyDays,
        shortClauses: splitClauses(legalDraft.shortText),
        fullClauses: splitClauses(legalDraft.fullText)
      })
      setLegalDraft(toLegalDraft(saved))
      setBusinessDraft((current) => ({
        ...current,
        businessName: saved.businessName,
        nit: saved.nit,
        nitDv: saved.nitDv ?? calculateNitDv(saved.nit),
        foreignNit: saved.foreignNit ?? '',
        phone: saved.phone,
        email: saved.email,
        address: saved.address,
        city: saved.city
      }))
      if (settings) applySettings({ ...settings, legal: saved })
      toast.success(`Cláusulas legales actualizadas · ${saved.version}`, {
        description: `Abandono a los ${saved.abandonmentDays} días y garantía de ${saved.warrantyDays} días. Las OTs nuevas guardarán un snapshot inmutable.`
      })
    } catch (failure) {
      toast.error('No se pudo guardar la configuración legal', { description: errorMessage(failure) })
    } finally {
      setSaving(null)
    }
  }

  async function changePassword() {
    if (passwordSaving) return
    if (!passwordForm.current) {
      toast.error('Ingresa tu contraseña actual')
      return
    }
    if (passwordForm.next.length < 8) {
      toast.error('La nueva contraseña debe tener al menos 8 caracteres')
      return
    }
    if (passwordForm.next !== passwordForm.confirm) {
      toast.error('La confirmación no coincide con la nueva contraseña')
      return
    }
    setPasswordSaving(true)
    try {
      await api.auth.changePassword(passwordForm.current, passwordForm.next)
      setPasswordForm({ current: '', next: '', confirm: '' })
      toast.success('Contraseña actualizada', {
        description: 'El cambio quedó registrado en la auditoría.'
      })
    } catch (failure) {
      toast.error('No se pudo cambiar la contraseña', { description: errorMessage(failure) })
    } finally {
      setPasswordSaving(false)
    }
  }

  async function createBackup() {
    if (backupSaving) return
    setBackupSaving(true)
    try {
      const result = await api.backups.create()
      setData((current) => (current ? { ...current, backups: result.backups } : current))
      toast.success('Respaldo completo creado', {
        description: `${result.backup.name} · ${formatBytes(result.backup.size)} · base, evidencias y manifiesto verificados.`
      })
    } catch (failure) {
      toast.error('No se pudo crear el respaldo', { description: errorMessage(failure) })
    } finally {
      setBackupSaving(false)
    }
  }

  function copyBackupPath(backup: BackupRecord) {
    navigator.clipboard
      ?.writeText(backup.path)
      .then(() => toast.success('Ruta copiada', { description: backup.path }))
      .catch(() => toast.error('No se pudo copiar la ruta'))
  }

  async function saveBackupPassword() {
    if (backupPasswordSaving) return
    if (backupPasswordForm.password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (backupPasswordForm.password !== backupPasswordForm.confirm) {
      toast.error('Las contraseñas no coinciden')
      return
    }
    setBackupPasswordSaving(true)
    try {
      await api.backups.setPassword(backupPasswordForm.password)
      setBackupPasswordOpen(false)
      setBackupPasswordForm({ password: '', confirm: '' })
      setData((current) =>
        current ? { ...current, settings: { ...current.settings, backup: { passwordConfigured: true } } } : current
      )
      toast.success('Contraseña de respaldo configurada', {
        description: 'Los respaldos nuevos se exportarán cifrados con esta contraseña.'
      })
    } catch (failure) {
      toast.error('No se pudo guardar la contraseña', { description: errorMessage(failure) })
    } finally {
      setBackupPasswordSaving(false)
    }
  }

  async function copyBackupPassword() {
    try {
      const result = await api.backups.revealPassword()
      await navigator.clipboard.writeText(result.password)
      toast.success('Contraseña copiada', { description: 'Compártela solo con el administrador autorizado.' })
    } catch (failure) {
      toast.error('No se pudo copiar la contraseña', { description: errorMessage(failure) })
    }
  }

  async function exportBackup() {
    if (backupTransferSaving) return
    setBackupTransferSaving('export')
    try {
      const result = await api.backups.exportBackup()
      if (!result.exported) return
      toast.success('Respaldo exportado', {
        description: `${result.path} · ${formatBytes(result.size ?? 0)}`
      })
      reload()
    } catch (failure) {
      toast.error('No se pudo exportar el respaldo', { description: errorMessage(failure) })
    } finally {
      setBackupTransferSaving(null)
    }
  }

  async function importBackup() {
    if (backupTransferSaving) return
    setBackupTransferSaving('import')
    try {
      const result = await api.backups.importBackup()
      if (!result.imported) return
      toast.success('Respaldo importado y restaurado', {
        description: `Copia previa: ${result.safetyBackup}. La aplicación se recargará.`
      })
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (failure) {
      toast.error('No se pudo importar el respaldo', { description: errorMessage(failure) })
    } finally {
      setBackupTransferSaving(null)
    }
  }

  async function restoreBackup() {
    if (!restoreTarget || backupSaving) return
    setBackupSaving(true)
    try {
      const result = await api.backups.restore(restoreTarget.id)
      setRestoreTarget(null)
      toast.success('Respaldo restaurado', {
        description: `Copia previa creada: ${result.safetyBackup}. La aplicación se recargará.`
      })
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (failure) {
      toast.error('No se pudo restaurar el respaldo', { description: errorMessage(failure) })
    } finally {
      setBackupSaving(false)
    }
  }

  async function purgeData() {
    if (purgeText.trim().toUpperCase() !== 'PURGAR') {
      toast.error('Escribe PURGAR para confirmar')
      return
    }
    if (!purgePassword) {
      toast.error('Ingresa la contraseña del propietario')
      return
    }
    if (backupSaving) return
    setBackupSaving(true)
    try {
      const result = await api.backups.purge('PURGAR', purgePassword)
      setPurgeOpen(false)
      setPurgeText('')
      setPurgePassword('')
      toast.success('Purga completada', {
        description: `Se conservó el respaldo completo ${result.backup.name}, incluidas las fotos. La operación quedó auditada.`
      })
      reload()
    } catch (failure) {
      toast.error('No se pudo purgar la operación', { description: errorMessage(failure) })
    } finally {
      setBackupSaving(false)
    }
  }

  async function inviteUser() {
    if (userSaving) return
    if (invite.name.trim().length < 3) {
      toast.error('Escribe el nombre completo')
      return
    }
    if (!/^[a-z0-9._-]{3,}$/i.test(invite.username.trim())) {
      toast.error('El usuario debe tener al menos 3 caracteres: letras, números, punto, guion o guion bajo')
      return
    }
    if (!invite.email.trim()) {
      toast.error('Ingresa el correo del colaborador')
      return
    }
    if (invite.password.length < 8) {
      toast.error('La clave temporal debe tener al menos 8 caracteres')
      return
    }
    setUserSaving(true)
    try {
      const created = await api.users.create({
        name: invite.name.trim(),
        username: invite.username.trim().toLowerCase(),
        email: invite.email.trim(),
        role: invite.role,
        password: invite.password,
        document: invite.document.trim(),
        phone: invite.phone.trim(),
        address: invite.address.trim()
      })
      setData((current) => (current ? { ...current, users: [...current.users, created] } : current))
      setInviteOpen(false)
      setInvite({ name: '', username: '', email: '', role: 'tecnico', password: '', document: '', phone: '', address: '' })
      toast.success('Usuario creado', { description: `${created.name} · ${roleLabels[created.role]}` })
    } catch (failure) {
      toast.error('No se pudo crear el usuario', { description: errorMessage(failure) })
    } finally {
      setUserSaving(false)
    }
  }

  function openUserEditor(member: AppUser) {
    setEditUser(member)
    setUserForm({
      name: member.name,
      email: member.email,
      role: member.role,
      active: member.active,
      password: '',
      document: member.document ?? '',
      phone: member.phone ?? '',
      address: member.address ?? '',
      photoDataUrl: member.photoUrl ?? null,
      permissions: (member.permissionOverrides ?? []).map((item) => ({
        capability: item.capability,
        allowed: item.allowed
      }))
    })
  }

  async function saveUser() {
    if (!editUser || userSaving) return
    if (userForm.name.trim().length < 3) {
      toast.error('Escribe el nombre completo')
      return
    }
    if (userForm.password && userForm.password.length < 8) {
      toast.error('La nueva clave debe tener al menos 8 caracteres')
      return
    }
    setUserSaving(true)
    try {
      const updated = await api.users.update(editUser.id, {
        name: userForm.name.trim(),
        email: userForm.email.trim(),
        role: userForm.role,
        active: userForm.active,
        document: userForm.document.trim(),
        phone: userForm.phone.trim(),
        address: userForm.address.trim(),
        photoDataUrl: userForm.photoDataUrl,
        permissions: userForm.permissions,
        ...(userForm.password ? { password: userForm.password } : {})
      })
      setData((current) =>
        current ? { ...current, users: current.users.map((member) => (member.id === updated.id ? updated : member)) } : current
      )
      if (user?.id === updated.id) await refreshProfile()
      setEditUser(null)
      toast.success('Usuario actualizado', { description: `${updated.name} · ${roleLabels[updated.role]}` })
    } catch (failure) {
      toast.error('No se pudo actualizar el usuario', { description: errorMessage(failure) })
    } finally {
      setUserSaving(false)
    }
  }

  function updateUserPermission(capability: (typeof allCapabilities)[number], value: 'inherit' | 'allow' | 'deny') {
    setUserForm((current) => {
      const rest = current.permissions.filter((item) => item.capability !== capability)
      if (value === 'inherit') return { ...current, permissions: rest }
      return { ...current, permissions: [...rest, { capability, allowed: value === 'allow' }] }
    })
  }

  function permissionValue(capability: (typeof allCapabilities)[number]) {
    const override = userForm.permissions.find((item) => item.capability === capability)
    if (override) return override.allowed ? 'allow' : 'deny'
    return 'inherit'
  }

  function processUserPhoto(file: File | null, onReady: (dataUrl: string) => void) {
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
        onReady(canvas.toDataURL('image/jpeg', 0.82))
      }
      image.src = String(reader.result ?? '')
    }
    reader.readAsDataURL(file)
  }

  function handleUserPhoto(file: File | null) {
    processUserPhoto(file, (photoDataUrl) => setUserForm((current) => ({ ...current, photoDataUrl })))
  }

  function openPhotoEditor(member: AppUser) {
    setPhotoMember(member)
    setPhotoDraft(member.photoUrl ?? null)
  }

  async function saveUserPhoto() {
    if (!photoMember || photoSaving) return
    setPhotoSaving(true)
    try {
      const updated = await api.users.updatePhoto(photoMember.id, photoDraft)
      setData((current) =>
        current ? { ...current, users: current.users.map((member) => (member.id === updated.id ? updated : member)) } : current
      )
      if (user?.id === updated.id) await refreshProfile()
      setPhotoMember(null)
      setPhotoDraft(null)
      toast.success('Foto de perfil actualizada', { description: updated.name })
    } catch (failure) {
      toast.error('No se pudo guardar la foto', { description: errorMessage(failure) })
    } finally {
      setPhotoSaving(false)
    }
  }

  const switchClass = (active: boolean) =>
    cn('relative h-6 w-11 shrink-0 rounded-full transition', active ? 'bg-brand-500' : 'bg-slate-200')

  function Switch({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={label}
        onClick={onClick}
        className={cn('focus-ring', switchClass(active))}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all',
            active ? 'left-[22px]' : 'left-0.5'
          )}
        />
      </button>
    )
  }

  if (loading && !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-slate-500 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Cargando configuración…
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-ink">No se pudo cargar la configuración</p>
        <p className="max-w-md text-[12px] text-slate-500">{error}</p>
        <Button size="sm" variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    )
  }

  if (!settings) return null

  return (
    <div className="space-y-5">
      <PageHeader
        title="Configuración"
        description={
          isSuperadmin
            ? 'Identidad del negocio, equipo, impresión, respaldos y parámetros exclusivos del propietario.'
            : 'Identidad del negocio, equipo, impresión y respaldos operativos.'
        }
        actions={
          <Badge variant={isSuperadmin ? 'warning' : 'brand'} dot>
            Sesión: {roleLabels[role]}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[238px_minmax(0,1fr)]">
        <div className="card h-fit p-2 lg:sticky lg:top-0">
          <div className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col">
            {tabs.map((item) => {
              const Icon = item.icon
              const active = tab === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTab(item.value)}
                  className={cn(
                    'focus-ring flex min-w-[160px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition lg:min-w-0',
                    active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-ink'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                      active ? 'bg-white text-brand-600 shadow-sm' : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold">{item.label}</span>
                    <span className="block truncate text-[9px] text-slate-400">{item.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          {tab === 'negocio' ? (
            <>
              <div className="card p-5 lg:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Datos del negocio</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">Aparecen en facturas internas, comprobantes y reportes.</p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Building2 className="h-4 w-4" />
                  </span>
                </div>

                <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 shadow-[0_14px_30px_-16px_rgba(108,92,231,0.9)]">
                    <Wrench className="h-7 w-7 text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12px] font-semibold text-ink">Identidad del negocio</p>
                      <Badge variant={canLegal ? 'warning' : 'neutral'}>{canLegal ? 'Editable' : 'Solo lectura'}</Badge>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      La razón social, el NIT y los datos de contacto se versionan junto con las cláusulas legales.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    { key: 'businessName' as const, label: 'Nombre comercial' },
                    { key: 'nit' as const, label: 'NIT' },
                    { key: 'phone' as const, label: 'Teléfono' },
                    { key: 'email' as const, label: 'Correo' },
                    { key: 'address' as const, label: 'Dirección' },
                    { key: 'city' as const, label: 'Ciudad' }
                  ].map((field) => (
                    <label key={field.key} className="block">
                      <span className="field-label">{field.label}</span>
                      <input
                        value={businessDraft[field.key]}
                        onChange={(event) => {
                          if (field.key === 'nit') {
                            const digits = normalizeNit(event.target.value)
                            setBusinessDraft({
                              ...businessDraft,
                              nit: digits,
                              nitDv: calculateNitDv(digits)
                            })
                          } else {
                            setBusinessDraft({ ...businessDraft, [field.key]: event.target.value })
                          }
                        }}
                        disabled={!canLegal}
                        className="field disabled:bg-slate-50 disabled:text-slate-500"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Dígito de verificación (DV)</span>
                    <input value={businessDraft.nitDv} readOnly className="field bg-slate-50 text-slate-500" />
                  </label>
                  <label className="block">
                    <span className="field-label">NIT extranjero (opcional)</span>
                    <input
                      value={businessDraft.foreignNit}
                      onChange={(event) => setBusinessDraft({ ...businessDraft, foreignNit: event.target.value })}
                      disabled={!canLegal}
                      className="field disabled:bg-slate-50 disabled:text-slate-500"
                      placeholder="Solo si el negocio factura con NIT extranjero"
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Moneda</span>
                    <div className="relative">
                      <select
                        value={businessDraft.currency}
                        onChange={(event) => setBusinessDraft({ ...businessDraft, currency: event.target.value })}
                        className="field pr-9"
                      >
                        <option value="COP">COP · Peso colombiano</option>
                        <option value="USD">USD · Dólar</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    </div>
                  </label>
                  <label className="block">
                    <span className="field-label">Zona horaria</span>
                    <div className="relative">
                      <select
                        value={businessDraft.timezone}
                        onChange={(event) => setBusinessDraft({ ...businessDraft, timezone: event.target.value })}
                        className="field pr-9"
                      >
                        <option value="America/Bogota">América/Bogotá (GMT−5)</option>
                        <option value="America/Panama">América/Panamá (GMT−5)</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    </div>
                  </label>
                </div>

                <div className="mt-5 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                  {!canLegal ? (
                    <p className="flex items-center gap-1.5 text-[9px] text-slate-400">
                      <LockKeyhole className="h-3 w-3" />
                      La identidad legal es editable solo por el propietario.
                    </p>
                  ) : (
                    <span className="text-[9px] text-slate-400">Configuración legal vigente: {legalDraft.version}</span>
                  )}
                  <Button onClick={() => void saveBusiness()} loading={saving === 'negocio'} leftIcon={<Save className="h-4 w-4" />}>
                    Guardar cambios
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <div className="flex items-start gap-2.5">
                  <Server className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <div>
                    <p className="text-[11px] font-semibold text-brand-900">Instalación local, datos portables</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-brand-700/70">
                      La app corre en este PC. Los respaldos se pueden copiar al equipo personal del propietario y restaurar sin depender de internet.
                    </p>
                  </div>
                </div>
              </div>

              <div className="card p-5 lg:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Cláusulas de recepción y abandono</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Se guardan en un snapshot inmutable en cada OT nueva. Los cambios no alteran comprobantes anteriores.
                    </p>
                  </div>
                  <Badge variant="brand">{legalDraft.version}</Badge>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Días para declarar abandono *</span>
                    <input
                      type="number"
                      min={1}
                      value={legalDraft.abandonmentDays}
                      onChange={(event) => setLegalDraft({ ...legalDraft, abandonmentDays: Number(event.target.value) })}
                      disabled={!canLegal}
                      className="field text-right tabular"
                    />
                    <span className="mt-1 block text-[9px] text-slate-400">
                      Se usa en el ticket, el A4 y la cláusula con {'{{dias}}'}.
                    </span>
                  </label>
                  <label className="block">
                    <span className="field-label">Días de garantía *</span>
                    <input
                      type="number"
                      min={1}
                      value={legalDraft.warrantyDays}
                      onChange={(event) => setLegalDraft({ ...legalDraft, warrantyDays: Number(event.target.value) })}
                      disabled={!canLegal}
                      className="field text-right tabular"
                    />
                    <span className="mt-1 block text-[9px] text-slate-400">
                      Mano de obra y repuestos suministrados por el taller.
                    </span>
                  </label>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Cláusulas cortas del ticket · una por línea</span>
                    <textarea
                      value={legalDraft.shortText}
                      onChange={(event) => setLegalDraft({ ...legalDraft, shortText: event.target.value })}
                      disabled={!canLegal}
                      rows={5}
                      className="field resize-y font-mono text-[10px] leading-relaxed"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Cláusulas completas del A4 · una por línea</span>
                    <textarea
                      value={legalDraft.fullText}
                      onChange={(event) => setLegalDraft({ ...legalDraft, fullText: event.target.value })}
                      disabled={!canLegal}
                      rows={9}
                      className="field resize-y font-mono text-[10px] leading-relaxed"
                    />
                  </label>
                </div>

                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[10px] leading-relaxed text-brand-800">
                    Usa <span className="font-mono font-semibold">{'{{dias}}'}</span> para los días de abandono y{' '}
                    <span className="font-mono font-semibold">{'{{garantia}}'}</span> para los días de garantía. Se resuelven al imprimir.
                  </p>
                  <span className="text-[9px] text-brand-700/70">Actualizado {formatDateTime(legalDraft.updatedAt)}</span>
                </div>

                {canLegal ? (
                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="secondary" onClick={() => setLegalDraft(toLegalDraft(settings?.legal ?? defaultLegalConfig))}>
                      Descartar cambios
                    </Button>
                    <Button onClick={() => void saveLegal()} loading={saving === 'legal'} leftIcon={<Save className="h-4 w-4" />}>
                      Guardar y versionar
                    </Button>
                  </div>
                ) : (
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-slate-50 px-3.5 py-2.5">
                    <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      La configuración legal es administrada por el propietario. Este rol puede consultarla en modo lectura.
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <div className="flex items-start gap-2.5">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <p className="text-[10px] leading-relaxed text-brand-800">
                    Estado fiscal: <span className="font-semibold">factura interna, sin IVA en ventas</span>. El IVA del 19 % se registra únicamente en compras a proveedores. La facturación electrónica DIAN queda para una fase posterior.
                  </p>
                </div>
              </div>

              <div className="card p-5 lg:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Catálogo de equipos</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Ficha por cliente, historial de OT y etiquetas QR opcionales.
                    </p>
                  </div>
                  <Badge variant={settings?.equipment.qrEnabled ? 'success' : 'neutral'}>
                    QR {settings?.equipment.qrEnabled ? 'activo' : 'inactivo'}
                  </Badge>
                </div>
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-slate-50/60 p-3.5">
                  <input
                    type="checkbox"
                    checked={Boolean(settings?.equipment.qrEnabled)}
                    disabled={!canManageStaff || saving === 'equipment'}
                    onChange={(event) => void saveEquipmentSettings(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                  />
                  <span>
                    <span className="block text-[11px] font-semibold text-ink">Habilitar etiquetas QR</span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">
                      Inactivo por defecto. Al activarlo aparece el botón de etiqueta en la ficha del equipo; el QR se imprime con el serial y no se envía a ningún servicio externo.
                    </span>
                  </span>
                </label>
              </div>
            </>
          ) : null}

          {tab === 'usuarios' ? (
            <>
              <div className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Equipo del taller</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {visibleStaff.length} cuentas
                      {isSuperadmin ? ' · la cuenta raíz está protegida y se edita desde Mi perfil' : ' · gestión de técnicos, cajeros y admins según permisos'}
                    </p>
                  </div>
                  {canManageStaff ? (
                    <Button size="sm" onClick={() => setInviteOpen(true)} leftIcon={<UserPlus className="h-3.5 w-3.5" />}>
                      Añadir usuario
                    </Button>
                  ) : null}
                </div>
                <div className="divide-y divide-line">
                  {visibleStaff.map((member) => {
                    const editable = canManageStaff && (member.role !== 'admin' || canManageAdmins)
                    return (
                      <div key={member.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={member.name} src={member.photoUrl} size="sm" status={member.active ? 'online' : 'offline'} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-[12px] font-semibold text-ink">{member.name}</p>
                              {member.protected ? (
                                <span className="flex items-center gap-0.5 rounded-full bg-warning-50 px-1.5 py-0.5 text-[9px] font-semibold text-warning-700">
                                  <LockKeyhole className="h-2.5 w-2.5" /> Protegida
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate text-[10px] text-slate-400">
                              @{member.username} · {member.email}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:justify-end">
                          <Badge variant={roleTone[member.role]}>{roleLabels[member.role]}</Badge>
                          <Badge variant={member.active ? 'success' : 'neutral'} dot>
                            {member.active ? 'Activa' : 'Inactiva'}
                          </Badge>
                          <span className="hidden w-[130px] text-right text-[9px] text-slate-400 lg:block">
                            {formatLastAccess(member.lastAccess)}
                          </span>
                          {canManageStaff && member.role !== 'superadmin' ? (
                            <button
                              type="button"
                              onClick={() => openPhotoEditor(member)}
                              className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-brand-50 hover:text-brand-600"
                              aria-label={`Cambiar foto de ${member.name}`}
                              title="Cambiar foto de perfil"
                            >
                              <Camera className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          {member.role === 'superadmin' || !editable ? (
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-300" title="Solo el propietario puede editar la ficha completa de esta cuenta">
                              <LockKeyhole className="h-3.5 w-3.5" />
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openUserEditor(member)}
                              className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-ink"
                              aria-label={`Editar ${member.name}`}
                            >
                              <Settings2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {!visibleStaff.length ? (
                    <p className="px-5 py-10 text-center text-[11px] text-slate-400">No hay usuarios para mostrar.</p>
                  ) : null}
                </div>
              </div>

              {false ? (
              <div className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Matriz de permisos</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">Reglas base del sistema, independientes de la vista previa.</p>
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-slate-400">
                    {(['full', 'partial', 'readonly', 'none'] as const).map((key) => (
                      <span key={key} className="flex items-center gap-1">
                        <span className={cn('flex h-4 w-4 items-center justify-center rounded', accessMeta[key].className)}>
                          {(() => {
                            const Icon = accessMeta[key].icon
                            return <Icon className="h-2.5 w-2.5" />
                          })()}
                        </span>
                        {accessMeta[key].label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[660px]">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="table-th pl-3">Permiso</th>
                        {(['superadmin', 'admin', 'tecnico', 'cajero'] as Role[]).map((item) => (
                          <th key={item} className="table-th text-center">
                            {roleLabels[item]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleMatrix.map((group) => (
                        <Fragment key={group.group}>
                          <tr className="bg-slate-50/70">
                            <td colSpan={5} className="px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">
                              {group.group}
                            </td>
                          </tr>
                          {group.items.map((item) => (
                            <tr key={item.label} className="border-b border-line/70 last:border-0">
                              <td className="table-td pl-3 text-[11px] text-slate-600">{item.label}</td>
                              {(['superadmin', 'admin', 'tecnico', 'cajero'] as Role[]).map((itemRole) => {
                                const meta = accessMeta[item.roles[itemRole]]
                                const Icon = meta.icon
                                return (
                                  <td key={itemRole} className="table-td text-center">
                                    <span className={cn('mx-auto flex h-5 w-5 items-center justify-center rounded-md', meta.className)} title={meta.label}>
                                      <Icon className="h-3 w-3" />
                                    </span>
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-[9px] text-slate-400">
                  La cuenta raíz nunca puede ser creada, restaurada, purgada ni administrada por otro rol. La auditoría es exclusiva del propietario.
                </p>
              </div>
              ) : null}

              <div className="card p-5 lg:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Matriz configurable por rol</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Estos son los permisos base de cada rol. Luego puedes permitir o denegar acciones a un usuario específico desde su ficha.
                    </p>
                  </div>
                  <Badge variant={actualRole === 'superadmin' ? 'warning' : 'neutral'}>
                    {actualRole === 'superadmin' ? 'Editable' : 'Solo propietario'}
                  </Badge>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[620px]">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="table-th pl-3">Permiso</th>
                        {(['admin', 'tecnico', 'cajero'] as Role[]).map((roleItem) => (
                          <th key={roleItem} className="table-th text-center">
                            {roleLabels[roleItem]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allCapabilities.map((capability) => {
                        const rootOnly = rootOnlyCapabilities.includes(capability)
                        return (
                          <tr key={capability} className="border-b border-line/70 last:border-0">
                            <td className="table-td pl-3">
                              <p className="text-[11px] text-slate-600">{capabilityLabels[capability]}</p>
                              {rootOnly ? <p className="text-[8px] text-slate-400">Exclusivo del propietario</p> : null}
                            </td>
                            {(['admin', 'tecnico', 'cajero'] as Role[]).map((roleItem) => (
                              <td key={roleItem} className="table-td text-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(rolePermissionsDraft[`${roleItem}:${capability}`])}
                                  disabled={actualRole !== 'superadmin' || rootOnly || saving === 'permisos'}
                                  onChange={(event) =>
                                    setRolePermissionsDraft((current) => ({
                                      ...current,
                                      [`${roleItem}:${capability}`]: event.target.checked
                                    }))
                                  }
                                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200 disabled:opacity-40"
                                />
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[9px] leading-relaxed text-slate-400">
                    Los permisos exclusivos del propietario no se pueden delegar. Los cambios quedan auditados.
                  </p>
                  {actualRole === 'superadmin' ? (
                    <Button
                      variant="secondary"
                      onClick={() => void saveRolePermissions()}
                      loading={saving === 'permisos'}
                      leftIcon={<Save className="h-4 w-4" />}
                    >
                      Guardar matriz
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {tab === 'diccionarios' ? <DictionariesPanel canManage={canDictionaries} /> : null}

          {tab === 'mensajes' ? (
            <MessagesPanel
              value={messagesDraft}
              saving={saving === 'messages'}
              onSave={saveMessages}
            />
          ) : null}

          {tab === 'impresion' ? (
            <>
              <div className="card p-5 lg:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Formato de impresión</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Los tres formatos están disponibles al imprimir una OT o una venta.
                    </p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Printer className="h-4 w-4" />
                  </span>
                </div>

                <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
                  {[
                    { value: 'a4' as const, label: 'A4 · Carta', hint: 'Dos copias y línea de corte', icon: FileText },
                    { value: '80mm' as const, label: '80 mm', hint: 'Tirilla térmica', icon: ReceiptText },
                    { value: '58mm' as const, label: '58 mm', hint: 'Tirilla compacta', icon: ReceiptText }
                  ].map((option) => {
                    const Icon = option.icon
                    const active = printDraft.defaultFormat === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setPrintDraft({ ...printDraft, defaultFormat: option.value })}
                        className={cn(
                          'focus-ring relative rounded-xl border p-3.5 text-left transition',
                          active ? 'border-brand-300 bg-brand-50 ring-4 ring-brand-100/60' : 'border-line bg-white hover:border-slate-300'
                        )}
                      >
                        <Icon className={cn('h-4 w-4', active ? 'text-brand-600' : 'text-slate-400')} />
                        <p className={cn('mt-2 text-[11px] font-semibold', active ? 'text-brand-900' : 'text-ink')}>{option.label}</p>
                        <p className="mt-0.5 text-[9px] text-slate-400">{option.hint}</p>
                        <Badge variant={active ? 'success' : 'neutral'} className="mt-2">
                          {active ? 'Predeterminado' : 'Disponible'}
                        </Badge>
                      </button>
                    )
                  })}
                </div>

                <div className="mt-5 divide-y divide-line rounded-xl border border-line">
                  {[
                    { key: 'autoPrint' as const, label: 'Imprimir comprobante automáticamente', hint: 'Al confirmar una venta o entregar una OT.' },
                    { key: 'showLogo' as const, label: 'Incluir logo en los comprobantes', hint: 'Se usa la identidad visual del negocio.' },
                    { key: 'showTerms' as const, label: 'Incluir términos y garantía', hint: 'Texto legal abreviado al pie del comprobante.' }
                  ].map((option) => (
                    <div key={option.key} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <p className="text-[11px] font-semibold text-ink">{option.label}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{option.hint}</p>
                      </div>
                      <Switch
                        active={printDraft[option.key]}
                        onClick={() => setPrintDraft({ ...printDraft, [option.key]: !printDraft[option.key] })}
                        label={option.label}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-xl border border-line bg-slate-50/60 p-4 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
                    <div>
                      <p className="text-[11px] font-semibold text-ink">Impresión mediante el diálogo del sistema</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        Antes de imprimir se elige el formato: A4, 80 mm o 58 mm. El alto del ticket se ajusta al contenido.
                      </p>
                    </div>
                  </div>
                  <Button onClick={() => void savePrint()} loading={saving === 'impresion'} leftIcon={<Save className="h-4 w-4" />}>
                    Guardar preferencias
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <p className="text-[10px] leading-relaxed text-brand-800">
                  Las ventas y las órdenes usan comprobantes internos sin IVA. El formato predeterminado solo preselecciona
                  la vista; el selector de formatos permanece visible en cada impresión.
                </p>
              </div>
            </>
          ) : null}

          {tab === 'respaldos' ? (
            <>
              <div className="card p-5 lg:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Contraseña y transferencia</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Protege la exportación e importación del respaldo. Solo el propietario y el administrador pueden verla o copiarla.
                    </p>
                  </div>
                  <Badge variant={settings?.backup.passwordConfigured ? 'success' : 'warning'}>
                    {settings?.backup.passwordConfigured ? 'Configurada' : 'Sin configurar'}
                  </Badge>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <label className="block">
                    <span className="field-label">Contraseña de respaldo</span>
                    <input
                      type="password"
                      readOnly
                      value={settings?.backup.passwordConfigured ? '••••••••••••' : ''}
                      placeholder="Sin configurar"
                      className="field bg-slate-50 text-slate-500"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => void copyBackupPassword()}
                      disabled={!settings?.backup.passwordConfigured}
                      leftIcon={<Copy className="h-4 w-4" />}
                    >
                      Copiar
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setBackupPasswordForm({ password: '', confirm: '' })
                        setBackupPasswordOpen(true)
                      }}
                      leftIcon={<KeyRound className="h-4 w-4" />}
                    >
                      {settings?.backup.passwordConfigured ? 'Cambiar' : 'Configurar'}
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  <Button
                    onClick={() => void exportBackup()}
                    loading={backupTransferSaving === 'export'}
                    disabled={!settings?.backup.passwordConfigured || !canCreateBackup}
                    leftIcon={<CloudUpload className="h-4 w-4" />}
                  >
                    Exportar respaldo
                  </Button>
                  {canRestore ? (
                    <Button
                      variant="secondary"
                      onClick={() => void importBackup()}
                      loading={backupTransferSaving === 'import'}
                      disabled={!settings?.backup.passwordConfigured}
                      leftIcon={<RefreshCcw className="h-4 w-4" />}
                    >
                      Importar respaldo
                    </Button>
                  ) : null}
                  <span className="text-[9px] text-slate-400">
                    El archivo .bctbackup se cifra con AES-256-GCM. Si cambias la contraseña, los respaldos anteriores requieren la anterior.
                  </span>
                </div>
              </div>

              <div className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Respaldos locales</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {backups.length} copia{backups.length === 1 ? '' : 's'} · base + evidencias + manifiesto
                    </p>
                  </div>
                  {canCreateBackup ? (
                    <Button size="sm" loading={backupSaving} onClick={() => void createBackup()} leftIcon={<CloudUpload className="h-3.5 w-3.5" />}>
                      Crear respaldo
                    </Button>
                  ) : (
                    <Badge variant="neutral">Solo administradores</Badge>
                  )}
                </div>

                <div className="divide-y divide-line">
                  {backups.map((backup) => {
                    const complete = backup.format !== 'db'
                    return (
                      <div key={backup.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                              complete ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-500'
                            )}
                          >
                            <DatabaseBackup className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-[11px] font-semibold text-ink">{backup.name}</p>
                              <Badge variant={complete ? 'brand' : 'neutral'}>{complete ? 'Completo' : 'Solo base'}</Badge>
                              {complete && backup.version ? <Badge variant="outline">v{backup.version}</Badge> : null}
                            </div>
                            <p className="mt-0.5 truncate text-[10px] text-slate-400">
                              {formatDateTime(backup.date)} · {formatBytes(backup.size)} · {backup.author}
                            </p>
                            <p className="mt-0.5 truncate text-[9.5px] text-slate-500">
                              {complete
                                ? `${backup.orders ?? 0} OT · ${backup.evidenceCount ?? 0} evidencia${
                                    (backup.evidenceCount ?? 0) === 1 ? '' : 's'
                                  } · ${formatBytes(backup.evidenceBytes ?? 0)} en fotos · manifest.json`
                                : 'Respaldo legado solo de base de datos, sin evidencias fotográficas.'}
                            </p>
                            <p className="mt-0.5 truncate font-mono text-[8.5px] text-slate-300" title={backup.sha256}>
                              SHA-256 {backup.sha256.slice(0, 16)}…
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            leftIcon={<Copy className="h-3 w-3" />}
                            onClick={() => copyBackupPath(backup)}
                          >
                            Copiar ruta
                          </Button>
                          {canRestore ? (
                            <Button variant="ghost" size="sm" leftIcon={<RefreshCcw className="h-3 w-3" />} onClick={() => setRestoreTarget(backup)}>
                              Restaurar
                            </Button>
                          ) : (
                            <span className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[9px] text-slate-400">
                              <LockKeyhole className="h-3 w-3" /> Cuenta raíz
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {!backups.length ? (
                    <p className="px-5 py-10 text-center text-[11px] text-slate-400">
                      Aún no hay respaldos. Crea el primero para proteger la operación y las evidencias.
                    </p>
                  ) : null}
                </div>
                <div className="border-t border-line bg-slate-50/60 px-5 py-3 text-[10px] leading-relaxed text-slate-400">
                  Cada respaldo completo es una carpeta con <code className="font-mono">database.db</code>, <code className="font-mono">evidence/</code> y{' '}
                  <code className="font-mono">manifest.json</code> con hashes SHA-256. Se puede copiar a otro PC sin conexión. Los
                  respaldos legados <code className="font-mono">.db</code> siguen siendo restaurables solo para la base.
                </div>
              </div>

              <div className="rounded-2xl border border-danger-100 bg-danger-50/50 p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" />
                    <div>
                      <p className="text-[11px] font-semibold text-danger-800">Zona de riesgo · purga de datos</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-danger-700/80">
                        Borra ventas, órdenes, movimientos y las fotos de esas OT para iniciar de cero. Antes crea un
                        respaldo completo. Exclusivo del propietario y con doble confirmación.
                      </p>
                    </div>
                  </div>
                  {canPurge ? (
                    <Button variant="danger" size="sm" onClick={() => setPurgeOpen(true)} leftIcon={<Trash2 className="h-3.5 w-3.5" />}>
                      Purgar datos
                    </Button>
                  ) : (
                    <Badge variant="danger">
                      <LockKeyhole className="h-3 w-3" /> Cuenta raíz
                    </Badge>
                  )}
                </div>
              </div>
            </>
          ) : null}

          {false ? (
            <>
              <div className="card p-5 lg:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Datos legales y fiscales</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {canLegal ? 'Cláusulas, garantía y abandono configurables por el propietario' : 'Consulta de la configuración vigente'}
                    </p>
                  </div>
                  <Badge variant={canLegal ? 'warning' : 'neutral'} dot>
                    {canLegal ? 'Editable' : 'Solo lectura'}
                  </Badge>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    ['Razón social', legalDraft.businessName],
                    ['NIT', legalDraft.nit],
                    ['Correo', legalDraft.email],
                    ['Ciudad', legalDraft.city],
                    ['Teléfono', legalDraft.phone],
                    ['Dirección', legalDraft.address]
                  ].map(([label, value]) => (
                    <label key={label} className="block">
                      <span className="field-label">{label}</span>
                      <input value={value} readOnly className="field bg-slate-50 text-slate-500" />
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[9px] text-slate-400">
                  La identidad del negocio se edita en la pestaña Negocio y queda versionada con las cláusulas.
                </p>

                <div className="mt-5 divide-y divide-line rounded-xl border border-line">
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-semibold text-ink">IVA en ventas</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">Desactivado por decisión del negocio en esta etapa.</p>
                    </div>
                    <Badge variant="neutral">Apagado</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-semibold text-ink">Facturación electrónica DIAN</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">Facturas internas por ahora. Integración futura.</p>
                    </div>
                    <Badge variant="warning">Próximamente</Badge>
                  </div>
                </div>
              </div>

              <div className="card p-5 lg:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Cláusulas de recepción y abandono</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Se guardan en un snapshot inmutable en cada OT nueva. Los cambios no alteran comprobantes anteriores.
                    </p>
                  </div>
                  <Badge variant="brand">{legalDraft.version}</Badge>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Días para declarar abandono *</span>
                    <input
                      type="number"
                      min={1}
                      value={legalDraft.abandonmentDays}
                      onChange={(event) => setLegalDraft({ ...legalDraft, abandonmentDays: Number(event.target.value) })}
                      disabled={!canLegal}
                      className="field text-right tabular"
                    />
                    <span className="mt-1 block text-[9px] text-slate-400">
                      Se usa en el ticket, el A4 y la cláusula con {'{{dias}}'}.
                    </span>
                  </label>
                  <label className="block">
                    <span className="field-label">Días de garantía *</span>
                    <input
                      type="number"
                      min={1}
                      value={legalDraft.warrantyDays}
                      onChange={(event) => setLegalDraft({ ...legalDraft, warrantyDays: Number(event.target.value) })}
                      disabled={!canLegal}
                      className="field text-right tabular"
                    />
                    <span className="mt-1 block text-[9px] text-slate-400">
                      Mano de obra y repuestos suministrados por el taller.
                    </span>
                  </label>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Cláusulas cortas del ticket · una por línea</span>
                    <textarea
                      value={legalDraft.shortText}
                      onChange={(event) => setLegalDraft({ ...legalDraft, shortText: event.target.value })}
                      disabled={!canLegal}
                      rows={5}
                      className="field resize-y font-mono text-[10px] leading-relaxed"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Cláusulas completas del A4 · una por línea</span>
                    <textarea
                      value={legalDraft.fullText}
                      onChange={(event) => setLegalDraft({ ...legalDraft, fullText: event.target.value })}
                      disabled={!canLegal}
                      rows={9}
                      className="field resize-y font-mono text-[10px] leading-relaxed"
                    />
                  </label>
                </div>

                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[10px] leading-relaxed text-brand-800">
                    Usa <span className="font-mono font-semibold">{'{{dias}}'}</span> para los días de abandono y{' '}
                    <span className="font-mono font-semibold">{'{{garantia}}'}</span> para los días de garantía. Se resuelven al imprimir.
                  </p>
                  <span className="text-[9px] text-brand-700/70">Actualizado {formatDateTime(legalDraft.updatedAt)}</span>
                </div>

                {canLegal ? (
                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="secondary" onClick={() => setLegalDraft(toLegalDraft(settings?.legal ?? defaultLegalConfig))}>
                      Descartar cambios
                    </Button>
                    <Button onClick={() => void saveLegal()} loading={saving === 'legal'} leftIcon={<Save className="h-4 w-4" />}>
                      Guardar y versionar
                    </Button>
                  </div>
                ) : (
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-slate-50 px-3.5 py-2.5">
                    <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      La configuración legal es administrada por el propietario. Este rol puede consultarla en modo lectura.
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
                <div className="flex items-start gap-2.5">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <p className="text-[10px] leading-relaxed text-brand-800">
                    Estado actual: <span className="font-semibold">factura interna, sin IVA en ventas</span>. El IVA del 19% se registra únicamente en las compras a proveedores, para control de costos y contabilidad.
                  </p>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'ia' ? (
            <>
              <div className="card p-5 lg:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-[16px] font-bold text-ink">Asistente de IA</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">Sugerencias de diagnóstico y resúmenes operativos</p>
                  </div>
                  <Badge variant={canAI ? 'brand' : 'neutral'}>
                    <Sparkles className="h-3 w-3" />
                    {canAI ? (settings.ai.configured ? 'Configurada' : 'Sin configurar') : 'Solo propietario'}
                  </Badge>
                </div>

                <div className={cn('mt-4 divide-y divide-line rounded-xl border border-line', !canAI && 'pointer-events-none opacity-60')}>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-semibold text-ink">Activar asistente</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">Habilita las sugerencias en las órdenes de trabajo.</p>
                    </div>
                    <Switch active={aiDraft.enabled} onClick={() => setAiDraft({ ...aiDraft, enabled: !aiDraft.enabled })} label="Activar asistente" />
                  </div>
                </div>

                <div className={cn('mt-4 grid gap-3 sm:grid-cols-2', !canAI && 'pointer-events-none opacity-60')}>
                  <label className="block sm:col-span-2">
                    <span className="field-label">Modelo</span>
                    <input
                      value={aiDraft.model}
                      onChange={(event) => setAiDraft({ ...aiDraft, model: event.target.value })}
                      disabled={!canAI}
                      placeholder="Ej. gpt-4.1-mini"
                      className="field font-mono text-[11px]"
                    />
                    <span className="mt-1 block text-[9px] text-slate-400">Identificador del modelo configurado con el proveedor.</span>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="field-label">Clave de API</span>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={aiDraft.apiKey}
                        onChange={(event) => setAiDraft({ ...aiDraft, apiKey: event.target.value })}
                        disabled={!canAI}
                        placeholder={
                          settings.ai.configured && settings.ai.keyFingerprint
                            ? `Configurada · huella ${settings.ai.keyFingerprint}`
                            : 'Pega la clave del proveedor'
                        }
                        className="field pl-9 pr-11 font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((value) => !value)}
                        disabled={!canAI}
                        className="focus-ring absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100"
                        aria-label={showKey ? 'Ocultar clave' : 'Mostrar clave'}
                      >
                        {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <span className="mt-1.5 block text-[9px] text-slate-400">
                      La clave no se devuelve al renderer; solo se conserva su huella de verificación.
                    </span>
                  </label>
                </div>

                <div className={cn('mt-4 divide-y divide-line rounded-xl border border-line', !canAI && 'pointer-events-none opacity-60')}>
                  {[
                    { key: 'diagnosis' as const, label: 'Sugerir diagnóstico técnico', hint: 'Analiza la falla reportada y el historial del equipo.' },
                    { key: 'summary' as const, label: 'Resumir órdenes y turnos', hint: 'Genera resúmenes para el propietario.' },
                    { key: 'anomalies' as const, label: 'Detectar anomalías de caja', hint: 'Alertas de diferencias y patrones inusuales.' }
                  ].map((option) => (
                    <div key={option.key} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <p className="text-[11px] font-semibold text-ink">{option.label}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{option.hint}</p>
                      </div>
                      <Switch
                        active={aiDraft[option.key]}
                        onClick={() => canAI && setAiDraft({ ...aiDraft, [option.key]: !aiDraft[option.key] })}
                        label={option.label}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex justify-end">
                  <Button disabled={!canAI} onClick={() => void saveAi()} loading={saving === 'ia'} leftIcon={<Save className="h-4 w-4" />}>
                    Guardar
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-warning-100 bg-warning-50/70 p-4">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" />
                  <p className="text-[10px] leading-relaxed text-warning-800">
                    La IA es una ayuda opcional. No reemplaza el diagnóstico del técnico y no tiene acceso a costos ni utilidad si el rol no lo permite.
                  </p>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'seguridad' ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-[15px] font-bold text-ink">Cambiar contraseña</h2>
                      <p className="mt-0.5 text-[10px] text-slate-400">Se almacena con hash scrypt en la base local.</p>
                    </div>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <KeyRound className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {[
                      { key: 'current' as const, label: 'Contraseña actual', autoComplete: 'current-password' },
                      { key: 'next' as const, label: 'Nueva contraseña', autoComplete: 'new-password' },
                      { key: 'confirm' as const, label: 'Confirmar contraseña', autoComplete: 'new-password' }
                    ].map((field) => (
                      <label key={field.key} className="block">
                        <span className="field-label">{field.label}</span>
                        <input
                          type="password"
                          value={passwordForm[field.key]}
                          onChange={(event) => setPasswordForm({ ...passwordForm, [field.key]: event.target.value })}
                          placeholder="••••••••"
                          className="field"
                          autoComplete={field.autoComplete}
                        />
                      </label>
                    ))}
                    <Button className="w-full" onClick={() => void changePassword()} loading={passwordSaving} leftIcon={<Save className="h-4 w-4" />}>
                      Actualizar contraseña
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  {isSuperadmin ? (
                    <div className="card p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="font-display text-[15px] font-bold text-ink">Protección de la cuenta raíz</h2>
                          <p className="mt-0.5 text-[10px] text-slate-400">Cuenta del propietario</p>
                        </div>
                        <Badge variant="warning">
                          <LockKeyhole className="h-3 w-3" /> Protegida
                        </Badge>
                      </div>
                      <div className="mt-4 flex items-center gap-3 rounded-xl border border-warning-100 bg-warning-50/60 p-3">
                        <Avatar name={displayUser.name} src={displayUser.photoUrl} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold text-ink">Cuenta raíz</p>
                          <p className="text-[9px] text-slate-400">No puede ser eliminada ni desactivada por un Administrador.</p>
                        </div>
                      </div>
                      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                        Solo el propietario puede rotar su clave o código de recuperación. Los intentos de acceso quedan auditados.
                      </p>
                    </div>
                  ) : null}

                  <div className="card p-5">
                    <h2 className="font-display text-[15px] font-bold text-ink">Política de sesión</h2>
                    <div className="mt-3 space-y-3">
                      <label className="block">
                        <span className="field-label">Duración de la sesión normal (horas)</span>
                        <input
                          type="number"
                          min={1}
                          max={168}
                          value={securityDraft.sessionHours}
                          onChange={(event) => setSecurityDraft({ ...securityDraft, sessionHours: Number(event.target.value) })}
                          className="field text-right tabular"
                        />
                      </label>
                      <p className="text-[9px] leading-relaxed text-slate-400">
                        La sesión se cierra al cerrar la aplicación. La duración en horas es el máximo de la sesión activa.
                      </p>
                      <Button variant="secondary" className="w-full" onClick={() => void saveSecurity()} loading={saving === 'seguridad'} leftIcon={<Save className="h-4 w-4" />}>
                        Guardar política
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
                <div className="flex items-start gap-2.5">
                  <Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <div>
                    <p className="text-[11px] font-semibold text-ink">Auditoría de seguridad</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                      Inicios de sesión, intentos fallidos, cambios de clave y accesos a configuración sensible quedan registrados con usuario, equipo y hora.
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Crear usuario"
        description="Crea una cuenta para el equipo con rol y clave temporal."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void inviteUser()} loading={userSaving} leftIcon={<UserPlus className="h-4 w-4" />}>
              Crear usuario
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre completo</span>
            <input value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} className="field" placeholder="Nombre del colaborador" />
          </label>
          <label className="block">
            <span className="field-label">Usuario</span>
            <input value={invite.username} onChange={(event) => setInvite({ ...invite, username: event.target.value })} className="field" placeholder="usuario" />
          </label>
          <label className="block">
            <span className="field-label">Correo</span>
            <input value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} className="field" placeholder="correo@bitacoretech.co" type="email" />
          </label>
          <label className="block">
            <span className="field-label">Documento (opcional)</span>
            <input value={invite.document} onChange={(event) => setInvite({ ...invite, document: event.target.value })} className="field" placeholder="CC o NIT" />
          </label>
          <label className="block">
            <span className="field-label">Teléfono (opcional)</span>
            <input value={invite.phone} onChange={(event) => setInvite({ ...invite, phone: event.target.value })} className="field" placeholder="310 000 0000" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Dirección (opcional)</span>
            <input value={invite.address} onChange={(event) => setInvite({ ...invite, address: event.target.value })} className="field" placeholder="Dirección de contacto" />
          </label>
          <label className="block">
            <span className="field-label">Rol</span>
            <select
              value={invite.role}
              onChange={(event) => setInvite({ ...invite, role: event.target.value as Role })}
              className="field"
            >
              {inviteRoles.map((item) => (
                <option key={item} value={item}>
                  {roleLabels[item]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[9px] text-slate-400">{roleDescriptions[invite.role]}</span>
          </label>
          <label className="block">
            <span className="field-label">Clave temporal</span>
            <input
              value={invite.password}
              onChange={(event) => setInvite({ ...invite, password: event.target.value })}
              className="field"
              placeholder="Mínimo 8 caracteres"
              type="password"
              autoComplete="new-password"
            />
          </label>
          <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-brand-800 sm:col-span-2">
            {canManageAdmins
              ? 'Como propietario puedes crear administradores. Comparte la clave temporal por un canal seguro.'
              : 'Como Administrador solo puedes crear técnicos y cajeros. Los administradores y la cuenta raíz están reservados al propietario.'}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(editUser)}
        onClose={() => setEditUser(null)}
        title="Editar usuario"
        description={editUser ? `${editUser.name} · @${editUser.username}` : ''}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditUser(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void saveUser()} loading={userSaving} leftIcon={<Save className="h-4 w-4" />}>
              Guardar cambios
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="field-label">Nombre completo</span>
            <input value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} className="field" />
          </label>
          <label className="block">
            <span className="field-label">Correo</span>
            <input value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} className="field" type="email" />
          </label>
          <label className="block">
            <span className="field-label">Rol</span>
            <select
              value={userForm.role}
              onChange={(event) => setUserForm({ ...userForm, role: event.target.value as Role })}
              className="field"
            >
              {inviteRoles.map((item) => (
                <option key={item} value={item}>
                  {roleLabels[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Nueva clave (opcional)</span>
            <input
              value={userForm.password}
              onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
              className="field"
              placeholder="Dejar en blanco para conservarla"
              type="password"
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="field-label">Documento</span>
            <input value={userForm.document} onChange={(event) => setUserForm({ ...userForm, document: event.target.value })} className="field" placeholder="CC o NIT" />
          </label>
          <label className="block">
            <span className="field-label">Teléfono</span>
            <input value={userForm.phone} onChange={(event) => setUserForm({ ...userForm, phone: event.target.value })} className="field" placeholder="310 000 0000" />
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Dirección</span>
            <input value={userForm.address} onChange={(event) => setUserForm({ ...userForm, address: event.target.value })} className="field" placeholder="Dirección de contacto" />
          </label>
          <div className="sm:col-span-2">
            <span className="field-label">Foto de perfil</span>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-slate-50/60 p-3">
              {userForm.photoDataUrl ? (
                <img src={userForm.photoDataUrl} alt="Foto de perfil" className="h-14 w-14 rounded-2xl object-cover" />
              ) : (
                <Avatar name={userForm.name || 'Usuario'} size="md" />
              )}
              <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300">
                <Camera className="h-3.5 w-3.5" />
                Cambiar foto
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => handleUserPhoto(event.target.files?.[0] ?? null)}
                />
              </label>
              {userForm.photoDataUrl ? (
                <Button variant="ghost" size="sm" onClick={() => setUserForm({ ...userForm, photoDataUrl: null })}>
                  Quitar
                </Button>
              ) : null}
              <p className="text-[9px] leading-relaxed text-slate-400 sm:max-w-[240px]">
                Opcional. Se recorta a 256 px y se guarda dentro de la base local.
              </p>
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <span className="field-label mb-0">Permisos especiales</span>
              <span className="text-[9px] text-slate-400">Heredar usa el rol seleccionado</span>
            </div>
            <div className="mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-line">
              {allCapabilities.map((capability) => {
                const rootOnly = rootOnlyCapabilities.includes(capability)
                const disabled = rootOnly && actualRole !== 'superadmin'
                return (
                  <div
                    key={capability}
                    className="flex items-center justify-between gap-3 border-b border-line/70 px-3.5 py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[11px] text-slate-600">{capabilityLabels[capability]}</p>
                      <p className="text-[9px] text-slate-400">
                        Rol: {roleCan(userForm.role, capability) ? 'sí' : 'no'}
                        {rootOnly ? ' · exclusivo del propietario' : ''}
                      </p>
                    </div>
                    <select
                      value={permissionValue(capability)}
                      disabled={disabled}
                      onChange={(event) =>
                        updateUserPermission(capability, event.target.value as 'inherit' | 'allow' | 'deny')
                      }
                      className="field h-8 w-28 text-[10px] disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="inherit">Heredar</option>
                      <option value="allow">Permitir</option>
                      <option value="deny">Denegar</option>
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={userForm.active}
                onChange={(event) => setUserForm({ ...userForm, active: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
              />
              <span className="text-[11px] font-semibold text-ink">Cuenta activa</span>
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(photoMember)}
        onClose={() => {
          setPhotoMember(null)
          setPhotoDraft(null)
        }}
        title="Foto de perfil"
        description={photoMember ? `${photoMember.name} · @${photoMember.username}` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPhotoMember(null)
                setPhotoDraft(null)
              }}
            >
              Cancelar
            </Button>
            <Button onClick={() => void saveUserPhoto()} loading={photoSaving} leftIcon={<Save className="h-4 w-4" />}>
              Guardar foto
            </Button>
          </div>
        }
      >
        {photoMember ? (
          <div className="flex flex-col items-center gap-4 text-center">
            {photoDraft ? (
              <img src={photoDraft} alt={`Foto de ${photoMember.name}`} className="h-24 w-24 rounded-full object-cover ring-4 ring-brand-50" />
            ) : (
              <Avatar name={photoMember.name} size="xl" />
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <label className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300">
                <Camera className="h-3.5 w-3.5" />
                Cambiar foto
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) =>
                    processUserPhoto(event.target.files?.[0] ?? null, (dataUrl) => setPhotoDraft(dataUrl))
                  }
                />
              </label>
              {photoDraft ? (
                <Button variant="ghost" size="sm" onClick={() => setPhotoDraft(null)} leftIcon={<Trash2 className="h-3.5 w-3.5" />}>
                  Quitar
                </Button>
              ) : null}
            </div>
            <p className="max-w-[260px] text-[10px] leading-relaxed text-slate-400">
              Se recorta a 256 px y se guarda en la base local. Solo cambia la foto; no concede acceso al resto de la ficha.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={backupPasswordOpen}
        onClose={() => setBackupPasswordOpen(false)}
        title={settings?.backup.passwordConfigured ? 'Cambiar contraseña de respaldo' : 'Configurar contraseña de respaldo'}
        description="Se guarda cifrada con el almacén seguro de Windows y se usa para exportar e importar."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setBackupPasswordOpen(false)} disabled={backupPasswordSaving}>
              Cancelar
            </Button>
            <Button onClick={() => void saveBackupPassword()} loading={backupPasswordSaving} leftIcon={<Save className="h-4 w-4" />}>
              Guardar contraseña
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="field-label">Nueva contraseña</span>
            <input
              type="password"
              value={backupPasswordForm.password}
              onChange={(event) => setBackupPasswordForm({ ...backupPasswordForm, password: event.target.value })}
              className="field"
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className="field-label">Confirmar contraseña</span>
            <input
              type="password"
              value={backupPasswordForm.confirm}
              onChange={(event) => setBackupPasswordForm({ ...backupPasswordForm, confirm: event.target.value })}
              className="field"
              placeholder="Repite la contraseña"
              autoComplete="new-password"
            />
          </label>
          <div className="rounded-xl border border-warning-100 bg-warning-50/60 px-3.5 py-2.5 text-[10px] leading-relaxed text-warning-800">
            Si cambias la contraseña, los respaldos exportados antes seguirán necesitando la contraseña anterior. Consérvala en un lugar seguro.
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        title="Restaurar respaldo"
        description={restoreTarget ? `${restoreTarget.name} · ${formatDateTime(restoreTarget.date)}` : ''}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRestoreTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void restoreBackup()} loading={backupSaving} leftIcon={<RefreshCcw className="h-4 w-4" />}>
              Restaurar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-warning-100 bg-warning-50/70 p-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" />
            <p className="text-[10px] leading-relaxed text-warning-800">
              La restauración reemplaza los datos actuales por los del respaldo. Se crea automáticamente una copia de seguridad previa.
            </p>
          </div>
          {restoreTarget?.format === 'db' ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-danger-100 bg-danger-50/70 p-3.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" />
              <p className="text-[10px] leading-relaxed text-danger-800">
                Respaldo legado <b>solo de base</b>. Al restaurarlo se eliminan las evidencias fotográficas actuales y no se
                recupera ninguna foto. Usa esta opción solo si no necesitas el archivo digital de reclamos.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-success-100 bg-success-50/70 p-3.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
              <p className="text-[10px] leading-relaxed text-success-800">
                Respaldo completo: base de datos, evidencias fotográficas y <code className="font-mono">manifest.json</code> con
                hashes SHA-256. Las fotos se restauran junto con la operación.
              </p>
            </div>
          )}
          <div className="rounded-xl border border-line p-3">
            <p className="text-[10px] text-slate-400">Contenido</p>
            <p className="mt-1 text-[11px] text-slate-600">
              {restoreTarget?.format === 'db'
                ? 'Ventas, órdenes, inventario, clientes, caja y auditoría. Sin evidencias.'
                : `Ventas, órdenes, inventario, clientes, caja, auditoría y ${
                    restoreTarget?.evidenceCount ?? 0
                  } evidencia${(restoreTarget?.evidenceCount ?? 0) === 1 ? '' : 's'} fotográfica${
                    (restoreTarget?.evidenceCount ?? 0) === 1 ? '' : 's'
                  }.`}
            </p>
          </div>
          <p className="text-[9px] leading-relaxed text-slate-400">
            Acción exclusiva del propietario. Queda registrada en la auditoría con fecha, usuario y hash del respaldo.
          </p>
        </div>
      </Modal>

      <Modal
        open={purgeOpen}
        onClose={() => {
          setPurgeOpen(false)
          setPurgeText('')
          setPurgePassword('')
        }}
        title="Purgar datos operativos"
        description="Esta acción elimina la operación y deja el sistema listo para iniciar de cero."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPurgeOpen(false)
                setPurgeText('')
                setPurgePassword('')
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => void purgeData()}
              loading={backupSaving}
              disabled={purgeText.trim().toUpperCase() !== 'PURGAR' || !purgePassword}
              leftIcon={<Trash2 className="h-4 w-4" />}
            >
              Purgar definitivamente
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-danger-100 bg-danger-50/60 p-3.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" />
            <div>
              <p className="text-[11px] font-semibold text-danger-800">Se eliminarán</p>
              <ul className="mt-1.5 space-y-0.5 text-[10px] text-danger-700">
                <li>· Ventas, facturas y movimientos de caja</li>
                <li>· Órdenes de trabajo e historial de equipos</li>
                <li>· Fotografías de las OT purgadas (quedan en el respaldo previo)</li>
                <li>· Inventario, clientes y proveedores</li>
              </ul>
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">
            Se creará automáticamente un respaldo completo antes de borrar. Se conservarán la cuenta raíz, la
            configuración, los respaldos y la auditoría. Escribe <span className="font-bold text-ink">PURGAR</span> y
            confirma con tu contraseña.
          </p>
          <input
            value={purgeText}
            onChange={(event) => setPurgeText(event.target.value)}
            placeholder="PURGAR"
            className="field text-center font-semibold uppercase tracking-widest"
          />
          <label className="block">
            <span className="field-label">Contraseña del propietario</span>
            <input
              type="password"
              value={purgePassword}
              onChange={(event) => setPurgePassword(event.target.value)}
              placeholder="••••••••"
              className="field"
              autoComplete="current-password"
            />
          </label>
        </div>
      </Modal>
    </div>
  )
}
