import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { LockKeyhole, RotateCcw } from 'lucide-react'
import type { ModuleKey } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { canAccessModule, roleLabels } from '@/lib/permissions'
import { Button } from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, restoring } = useAuth()
  const location = useLocation()

  if (restoring) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-slate-500">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 shadow-soft">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          Restaurando sesión…
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}

export function ModuleGuard({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { role } = useAuth()

  if (!canAccessModule(role, module)) {
    return <AccessDenied />
  }

  return <>{children}</>
}

export function AccessDenied() {
  const { role } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[60vh] items-center justify-center py-10">
      <div className="w-full max-w-lg rounded-[26px] border border-line bg-white p-8 text-center shadow-card">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <LockKeyhole className="h-6 w-6" />
        </span>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Permisos insuficientes</p>
        <h2 className="mt-2 font-display text-2xl font-bold text-ink">Esta sección no está disponible</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          El rol <span className="font-semibold text-ink">{roleLabels[role]}</span> no tiene acceso a este módulo. Solicita permisos al propietario si necesitas operar esta sección.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => navigate('/')} leftIcon={<RotateCcw className="h-4 w-4" />}>
            Volver al dashboard
          </Button>
          <Button onClick={() => navigate(-1)}>Regresar</Button>
        </div>
      </div>
    </div>
  )
}
