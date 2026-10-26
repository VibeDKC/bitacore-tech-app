import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { Logo } from '@/components/ui/Logo'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'

const features = [
  {
    icon: Wrench,
    title: 'Órdenes de trabajo',
    description: 'Recepción, diagnóstico, repuestos y entrega.'
  },
  {
    icon: ShoppingCart,
    title: 'Punto de venta',
    description: 'Cobra rápido con efectivo, tarjeta o mixto.'
  },
  {
    icon: PackageCheck,
    title: 'Inventario y seriales',
    description: 'Stock por ubicación, garantías y alertas.'
  },
  {
    icon: ShieldCheck,
    title: 'Caja y auditoría',
    description: 'Turnos, arqueo y trazabilidad de cada acción.'
  }
]

export function LoginPage() {
  const { isAuthenticated, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const session = await login(username, password, remember)
      toast.success('Bienvenido a BitacoreTech', {
        description: `Sesión iniciada como ${session.roleLabel}.`
      })

      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'No fue posible iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#eef0f7] via-[#e4e7f2] to-[#d9deee] p-3 sm:p-5 lg:p-8">
      <div className="pointer-events-none absolute -left-24 top-10 h-80 w-80 rounded-full bg-brand-300/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-[28rem] w-[28rem] rounded-full bg-sky-300/20 blur-3xl" />

      <div className="relative mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-[1180px] overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-shell lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[1.04fr_0.96fr]">
        <div className="relative hidden overflow-hidden bg-[#11152c] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-12">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-96 w-96 rounded-full bg-sky-500/15 blur-3xl" />

          <div className="relative">
            <Logo invert />
            <div className="mt-16 max-w-md">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/70 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-brand-300" />
                Gestión integral para talleres técnicos
              </div>
              <h1 className="mt-5 font-display text-[40px] font-bold leading-[1.08] tracking-[-0.04em] xl:text-[46px]">
                Todo tu taller,
                <br />
                en un solo lugar.
              </h1>
              <p className="mt-5 max-w-sm text-[14px] leading-relaxed text-white/60">
                Órdenes de trabajo, punto de venta, inventario y caja conectados en una operación clara y sin fricción.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-2 gap-2.5">
              {features.map((feature) => {
                const Icon = feature.icon
                return (
                  <div key={feature.title} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3.5 backdrop-blur-sm">
                    <Icon className="h-4 w-4 text-brand-300" />
                    <p className="mt-2.5 text-[12px] font-semibold">{feature.title}</p>
                    <p className="mt-1 text-[10px] leading-snug text-white/45">{feature.description}</p>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="relative mt-10">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3.5 backdrop-blur-sm">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/20 text-brand-200">
                <Wrench className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold text-white/90">OT-002341 · MacBook Pro</p>
                  <span className="rounded-full bg-brand-400/15 px-2 py-0.5 text-[9px] font-semibold text-brand-200">En reparación</span>
                </div>
                <p className="mt-1 text-[10px] text-white/40">Julián Vélez · Diagnóstico completado</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <div className="flex -space-x-2">
                {['Camila Ríos', 'Julián Vélez', 'Andrea Salazar'].map((name) => (
                  <Avatar key={name} name={name} size="xs" className="ring-2 ring-[#11152c]" />
                ))}
              </div>
              <p className="text-[10px] text-white/40">Un equipo, una sola fuente de verdad.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center p-6 sm:p-10 lg:p-12 xl:p-16">
          <div className="mx-auto w-full max-w-[400px]">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Logo />
              <span className="rounded-full border border-line bg-slate-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                v1.0
              </span>
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-slate-50 text-slate-500">
                <LockKeyhole className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Acceso privado</p>
                <p className="text-[11px] text-slate-500">Solo personal autorizado</p>
              </div>
            </div>

            <h2 className="mt-8 font-display text-[30px] font-bold tracking-[-0.03em] text-ink">Bienvenido de nuevo</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Ingresa con tu cuenta de propietario para administrar el taller y el punto de venta.
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4">
              <label className="block">
                <span className="field-label">Usuario</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="field h-11"
                  placeholder="superadmin"
                  autoComplete="username"
                  autoFocus
                />
              </label>

              <label className="block">
                <span className="field-label">Contraseña</span>
                <div className="relative">
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    className="field h-11 pr-11"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="focus-ring absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                  />
                  Mantener sesión en este equipo
                </label>
                <button
                  type="button"
                  onClick={() =>
                    toast('Recuperación de acceso', {
                      description: 'Solicita al propietario o a un administrador que restablezca tu contraseña desde Configuración → Usuarios.'
                    })
                  }
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  ¿Olvidaste tu clave?
                </button>
              </div>

              {error ? (
                <div className="rounded-xl border border-danger-100 bg-danger-50 px-3.5 py-2.5 text-xs font-medium text-danger-700">
                  {error}
                </div>
              ) : null}

              <Button type="submit" size="lg" className="w-full" loading={loading} rightIcon={<ArrowRight className="h-4 w-4" />}>
                Ingresar al taller
              </Button>
            </form>

            <div className="mt-6 rounded-2xl border border-line bg-slate-50/70 p-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold text-ink">Acceso protegido</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                    Las contraseñas se guardan con hash scrypt y cada inicio de sesión queda registrado en la auditoría.
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-8 text-center text-[10px] leading-relaxed text-slate-400">
              BitacoreTech Taller & POS · Instalación local. Tus datos permanecen en este equipo.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
