import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  Check,
  ChevronDown,
  Eye,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserRound
} from 'lucide-react'
import type { NotificationItem, Role } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { can, canAccessModule, roleDescriptions, roleLabels, roleShortLabels } from '@/lib/permissions'
import { api, errorMessage } from '@/lib/backend'
import { Avatar } from '@/components/ui/Avatar'
import { SearchInput } from '@/components/ui/Input'
import { DropdownDivider, DropdownItem, DropdownLabel, DropdownMenu } from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const roleOrder: Role[] = ['superadmin', 'admin', 'tecnico', 'cajero']

const notificationTone: Record<string, string> = {
  warning: 'bg-warning-50 text-warning-600',
  success: 'bg-success-50 text-success-600',
  info: 'bg-sky-50 text-sky-600',
  danger: 'bg-danger-50 text-danger-600'
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { displayUser, role, canPreviewRoles, setPreviewRole, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState('')
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [switching, setSwitching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const isDashboard = location.pathname === '/'

  useEffect(() => {
    let active = true
    api.notifications
      .list()
      .then((items) => {
        if (active) setNotifications(items)
      })
      .catch(() => {
        if (active) setNotifications([])
      })
    return () => {
      active = false
    }
  }, [location.pathname])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === '/' && !isTyping) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function submitSearch() {
    const value = search.trim()
    if (!value) return
    navigate(`/inventario?q=${encodeURIComponent(value)}`)
    setSearch('')
  }

  async function chooseRole(nextRole: Role) {
    if (!canPreviewRoles || nextRole === role || switching) return
    setSwitching(true)
    try {
      await setPreviewRole(nextRole)
      toast(`Vista previa: ${roleLabels[nextRole]}`, {
        description: roleDescriptions[nextRole]
      })
    } catch (error) {
      toast.error('No fue posible cambiar la vista', { description: errorMessage(error) })
    } finally {
      setSwitching(false)
    }
  }

  return (
    <header className="flex shrink-0 flex-col gap-4 px-4 pb-4 pt-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-7 lg:pb-5 lg:pt-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenu}
          className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-slate-500 shadow-sm transition hover:text-ink lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </button>
        {isDashboard ? (
          <div className="min-w-0">
            <h1 className="truncate font-display text-[21px] font-bold tracking-[-0.02em] text-ink sm:text-[24px] lg:text-[26px]">
              Hola, {displayUser.name.split(' ')[0]} 👋
            </h1>
            <p className="mt-0.5 hidden truncate text-[12px] text-slate-500 sm:block">
              Esto es lo que está pasando en tu taller hoy.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {canPreviewRoles ? (
          <DropdownMenu
            align="right"
            panelClassName="w-[290px]"
            trigger={
              <button
                type="button"
                disabled={switching}
                className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink disabled:opacity-60"
              >
                <Eye className="h-3.5 w-3.5 text-brand-500" />
                <span className="hidden sm:inline">Vista:</span>
                <span className="text-ink">{roleLabels[role]}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
            }
          >
            <DropdownLabel>Vista previa de rol · propietario</DropdownLabel>
            {roleOrder.map((item) => (
              <DropdownItem
                key={item}
                label={roleLabels[item]}
                description={roleDescriptions[item]}
                active={role === item}
                onClick={() => void chooseRole(item)}
                icon={role === item ? <Check className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
              />
            ))}
          </DropdownMenu>
        ) : null}

        <div className="relative hidden md:block lg:w-[260px] xl:w-[320px]">
          <SearchInput
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitSearch()
            }}
            placeholder="Buscar producto, SKU o serial..."
            rightSlot={<kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-[9px] font-semibold text-slate-400 xl:inline">⌘K</kbd>}
          />
        </div>

        <DropdownMenu
          align="right"
          panelClassName="w-[340px]"
          trigger={
            <button
              type="button"
              className="focus-ring relative flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-ink"
              aria-label="Notificaciones"
            >
              <Bell className="h-[18px] w-[18px]" />
              <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-danger-500 ring-2 ring-white" />
            </button>
          }
        >
          <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Notificaciones</p>
            <span className="rounded-full bg-danger-50 px-1.5 py-0.5 text-[10px] font-semibold text-danger-600">
              {notifications.length} {notifications.length === 1 ? 'nueva' : 'nuevas'}
            </span>
          </div>
          <div className="space-y-1">
            {notifications.length ? (
              notifications.map((item) => (
                <div key={item.id} className="flex gap-2.5 rounded-xl px-2.5 py-2.5 transition hover:bg-slate-50">
                  <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', notificationTone[item.tone])}>
                    <Bell className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{item.description}</p>
                    <p className="mt-1 text-[10px] text-slate-400">{item.time}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-2.5 py-4 text-[11px] text-slate-400">No hay alertas pendientes.</p>
            )}
          </div>
        </DropdownMenu>

        <DropdownMenu
          align="right"
          panelClassName="w-[250px]"
          trigger={
            <button type="button" className="focus-ring rounded-full transition hover:opacity-90" aria-label="Cuenta">
              <Avatar name={displayUser.name} size="md" status="online" />
            </button>
          }
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar name={displayUser.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-ink">{displayUser.name}</p>
              <p className="text-[10px] text-slate-400">
                {roleLabels[role]} · {roleShortLabels[role]}
              </p>
            </div>
          </div>
          <DropdownDivider />
          <DropdownLabel>Cuenta</DropdownLabel>
          <DropdownItem icon={<UserRound className="h-3.5 w-3.5" />} label="Mi perfil" description="Datos de la cuenta" onClick={() => navigate('/configuracion')} />
          {canAccessModule(role, 'settings') ? (
            <DropdownItem icon={<Settings className="h-3.5 w-3.5" />} label="Configuración" onClick={() => navigate('/configuracion')} />
          ) : null}
          {can(role, 'viewAudit') ? (
            <DropdownItem icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Auditoría" onClick={() => navigate('/auditoria')} />
          ) : null}
          <DropdownDivider />
          <DropdownItem icon={<LogOut className="h-3.5 w-3.5" />} label="Cerrar sesión" danger onClick={() => void logout()} />
        </DropdownMenu>
      </div>

    </header>
  )
}
