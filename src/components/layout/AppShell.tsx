import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-panel">
      <div className="flex h-screen w-full overflow-hidden bg-panel">
        <div className="hidden lg:flex">
          <Sidebar />
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-panel">
          <Topbar onMenu={() => setMobileOpen(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6 lg:px-7 lg:pb-8">
            <Outlet />
          </main>
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[70] flex lg:hidden">
          <div className="absolute inset-0 bg-ink/35 backdrop-blur-[2px] animate-fade-in" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full animate-slide-in-left shadow-pop">
            <Sidebar mobile onClose={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
