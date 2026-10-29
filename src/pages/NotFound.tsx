import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Compass, LayoutDashboard } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'

export function NotFoundPage() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0b1020] via-[#11152c] to-[#1b2140] p-5">
      <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#11152c] p-8 text-center shadow-shell">
        <div className="flex justify-center">
          <Logo full invert className="h-12" />
        </div>
        <span className="mx-auto mt-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-300">
          <Compass className="h-7 w-7" />
        </span>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Error 404</p>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">Esta página no existe</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-white/55">
          La ruta que buscas no existe en BitacoreTech. Vuelve al dashboard para continuar.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => navigate(-1)} leftIcon={<ArrowLeft className="h-4 w-4" />}>
            Regresar
          </Button>
          <Button
            onClick={() => navigate(isAuthenticated ? '/' : '/login', { replace: true })}
            leftIcon={<LayoutDashboard className="h-4 w-4" />}
          >
            {isAuthenticated ? 'Ir al dashboard' : 'Iniciar sesión'}
          </Button>
        </div>
      </div>
    </div>
  )
}
