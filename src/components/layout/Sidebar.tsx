import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  ChartNoAxesCombined,
  ChevronDown,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  Wrench,
  LogOut,
  UserRound,
  X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ModuleKey, Role } from '@/types'
import { canAccessModule, roleLabels, roleShortLabels } from '@/lib/permissions'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/backend'
import { Avatar } from '@/components/ui/Avatar'
import { Logo } from '@/components/ui/Logo'
import { DropdownDivider, DropdownItem, DropdownLabel, DropdownMenu } from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'

interface NavItem {
  key: ModuleKey
  label: string
  path: string
  icon: LucideIcon
  badge?: string
}

const navItems: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { key: 'pos', label: 'Punto de venta', path: '/pos', icon: ShoppingCart },
  { key: 'orders', label: 'Órdenes de trabajo', path: '/ordenes', icon: Wrench },
  { key: 'inventory', label: 'Inventario', path: '/inventario', icon: Package },
  { key: 'customers', label: 'Clientes', path: '/clientes', icon: Users },
  { key: 'purchases', label: 'Compras', path: '/compras', icon: Truck },
  { key: 'cash', label: 'Caja', path: '/caja', icon: Wallet },
  { key: 'reports', label: 'Reportes', path: '/reportes', icon: ChartNoAxesCombined },
  { key: 'audit', label: 'Auditoría', path: '/auditoria', icon: ShieldCheck },
  { key: 'settings', label: 'Configuración', path: '/configuracion', icon: Settings }
]

export function Sidebar({
  onNavigate,
  onClose,
  mobile = false
}: {
  onNavigate?: () => void
  onClose?: () => void
  mobile?: boolean
}) {
  const { displayUser, role, logout } = useAuth()
  const navigate = useNavigate()
  const [badges, setBadges] = useState<{ openOrders: number; lowStock: number } | null>(null)
  useEffect(() => {
    let active = true
    api.dashboard
      .badges()
      .then((data) => {
        if (active) setBadges(data)
      })
      .catch(() => {
        // Los contadores son informativos; no bloquean la navegación.
      })
    return () => {
      active = false
    }
  }, [])
  const items = navItems.filter((item) => canAccessModule(role, item.key))
  const canOpenSettings = canAccessModule(role, 'settings')

  function goToSettings() {
    navigate('/configuracion')
    onNavigate?.()
  }

  return (
    <aside className={cn('flex h-full w-[258px] shrink-0 flex-col bg-white', mobile ? 'w-[280px]' : 'border-r border-line/80')}>
      <div className="flex items-center justify-between px-5 pb-6 pt-6">
        <div className="flex items-center gap-2.5">
          <Logo />
        </div>
        {mobile ? (
          <button
            type="button"
            onClick={onClose}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Cerrar menú"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3">
        {items.map((item) => {
          const Icon = item.icon
          const badge = item.key === 'orders' ? badges?.openOrders : item.key === 'inventory' ? badges?.lowStock : undefined
          return (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition',
                  isActive
                    ? 'border border-slate-200 bg-white text-ink shadow-[0_5px_16px_-12px_rgba(16,24,40,0.35)]'
                    : 'border border-transparent text-slate-500 hover:bg-slate-50 hover:text-ink'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0 transition',
                      isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'
                    )}
                    strokeWidth={isActive ? 2.2 : 1.9}
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {badge ? (
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular',
                        isActive ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'
                      )}
                    >
                      {badge}
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      <div className="px-3 pb-4 pt-4">
        <div className="rounded-2xl border border-line bg-slate-50/70 p-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar name={displayUser.name} src={displayUser.photoUrl} size="sm" status="online" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-ink">{displayUser.name}</p>
              <p className="truncate text-[10px] text-slate-400">
                {role === 'superadmin' ? 'Propietario · Cuenta raíz' : roleLabels[role]}
              </p>
            </div>
            <DropdownMenu
              align="left"
              side="top"
              panelClassName="w-[240px]"
              trigger={
                <button
                  type="button"
                  className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-600"
                  aria-label="Opciones de cuenta"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              }
            >
              <DropdownLabel>Cuenta</DropdownLabel>
              {canOpenSettings ? (
                <>
                  <DropdownItem icon={<UserRound className="h-3.5 w-3.5" />} label="Mi perfil" description={roleShortLabels[role]} onClick={goToSettings} />
                  <DropdownItem icon={<Settings className="h-3.5 w-3.5" />} label="Configuración" onClick={goToSettings} />
                  <DropdownDivider />
                </>
              ) : null}
              <DropdownItem icon={<LogOut className="h-3.5 w-3.5" />} label="Cerrar sesión" danger onClick={logout} />
            </DropdownMenu>
          </div>
        </div>
        <p className="mt-3 px-1 text-center text-[9px] font-medium uppercase tracking-[0.14em] text-slate-300">
          BitacoreTech Taller & POS · v1.10.3
        </p>
      </div>
    </aside>
  )
}
