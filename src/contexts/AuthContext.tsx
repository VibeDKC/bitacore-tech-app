import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthSession, AuthUser, Role } from '@/types'
import { api, getAuthToken, setAuthToken, type SetupInput } from '@/lib/backend'

interface AuthContextValue {
  user: AuthUser | null
  /** Identidad visible según el rol previsualizado. Nunca expone al propietario. */
  displayUser: AuthUser
  role: Role
  actualRole: Role
  canPreviewRoles: boolean
  isAuthenticated: boolean
  restoring: boolean
  setupRequired: boolean
  setup: (input: SetupInput) => Promise<AuthSession>
  login: (username: string, password: string, remember?: boolean) => Promise<AuthSession>
  logout: () => Promise<void>
  setPreviewRole: (role: Role) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const guestUser: AuthUser = {
  id: 'guest',
  username: 'invitado',
  name: 'Invitado',
  email: '—',
  accountRole: 'admin'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)

  useEffect(() => {
    let active = true
    async function restore() {
      try {
        const status = await api.auth.status()
        if (!active) return
        if (status.setupRequired) {
          setAuthToken(null)
          setSetupRequired(true)
          setRestoring(false)
          return
        }
      } catch {
        // Si el estado falla, se intenta restaurar la sesión normal.
      }
      if (!getAuthToken()) {
        setRestoring(false)
        return
      }
      try {
        const info = await api.auth.session()
        if (!active) return
        setSession({
          token: getAuthToken() as string,
          user: info.user,
          displayUser: info.displayUser,
          role: info.role,
          actualRole: info.actualRole,
          canPreviewRoles: info.canPreviewRoles,
          expiresAt: info.expiresAt,
          roleLabel: info.roleLabel
        })
      } catch {
        setAuthToken(null)
        if (active) setSession(null)
      } finally {
        if (active) setRestoring(false)
      }
    }
    void restore()
    return () => {
      active = false
    }
  }, [])

  const setup = useCallback(async (input: SetupInput) => {
    const result = await api.auth.setup(input)
    setAuthToken(result.token, false)
    setSession(result)
    setSetupRequired(false)
    return result
  }, [])

  const login = useCallback(async (username: string, password: string, remember = true) => {
    const result = await api.auth.login(username, password, remember)
    setAuthToken(result.token, remember)
    setSession(result)
    setSetupRequired(false)
    return result
  }, [])

  const logout = useCallback(async () => {
    try {
      if (getAuthToken()) await api.auth.logout()
    } catch {
      // La sesión local se cierra incluso si el backend ya expiró el token.
    } finally {
      setAuthToken(null)
      setSession(null)
    }
  }, [])

  const setPreviewRole = useCallback(
    async (role: Role) => {
      if (!session?.canPreviewRoles) return
      const info = await api.auth.previewRole(role)
      setSession((current) =>
        current
          ? {
              ...current,
              user: info.user,
              displayUser: info.displayUser,
              role: info.role,
              actualRole: info.actualRole,
              canPreviewRoles: info.canPreviewRoles,
              expiresAt: info.expiresAt,
              roleLabel: info.roleLabel
            }
          : current
      )
    },
    [session?.canPreviewRoles]
  )

  const value = useMemo<AuthContextValue>(() => {
    return {
      user: session?.user ?? null,
      displayUser: session?.displayUser ?? guestUser,
      role: session?.role ?? 'superadmin',
      actualRole: session?.actualRole ?? 'superadmin',
      canPreviewRoles: Boolean(session?.canPreviewRoles),
      isAuthenticated: Boolean(session),
      restoring,
      setupRequired,
      setup,
      login,
      logout,
      setPreviewRole
    }
  }, [session, restoring, setupRequired, setup, login, logout, setPreviewRole])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return context
}
