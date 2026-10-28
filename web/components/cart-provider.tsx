'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

const CART_STORAGE_KEY = 'bitacoretech.cart.v1'

export type CartLine = {
  id: string
  quantity: number
}

type CartContextValue = {
  lines: CartLine[]
  ready: boolean
  count: number
  add: (productId: string, maxQuantity?: number) => void
  setQuantity: (productId: string, quantity: number, maxQuantity?: number) => void
  remove: (productId: string) => void
  clear: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

function clampQuantity(value: number, maxQuantity: number) {
  if (!Number.isFinite(value)) return 0
  const ceiling = Number.isFinite(maxQuantity) ? Math.max(0, Math.floor(maxQuantity)) : Infinity
  return Math.max(0, Math.min(Math.floor(value), ceiling))
}

function readCart(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    return parsed
      .filter(
        (item): item is { id: string; quantity: number } =>
          Boolean(item) &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          Number.isFinite(Number(item.quantity)) &&
          Number(item.quantity) > 0
      )
      .filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
      .map((item) => ({ id: item.id, quantity: Math.floor(Number(item.quantity)) }))
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setLines(readCart())
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines))
    } catch {
      // El carrito sigue funcionando en memoria si el navegador bloquea el almacenamiento.
    }
  }, [lines, ready])

  const add = useCallback((productId: string, maxQuantity = Infinity) => {
    if (!productId) return
    setLines((current) => {
      const existing = current.find((line) => line.id === productId)
      const nextQuantity = clampQuantity((existing?.quantity ?? 0) + 1, maxQuantity)
      if (nextQuantity <= 0) return current
      if (existing) {
        return current.map((line) =>
          line.id === productId ? { ...line, quantity: nextQuantity } : line
        )
      }
      return [...current, { id: productId, quantity: nextQuantity }]
    })
  }, [])

  const setQuantity = useCallback(
    (productId: string, quantity: number, maxQuantity = Infinity) => {
      setLines((current) => {
        const nextQuantity = clampQuantity(quantity, maxQuantity)
        if (nextQuantity <= 0) return current.filter((line) => line.id !== productId)
        if (!current.some((line) => line.id === productId)) {
          return [...current, { id: productId, quantity: nextQuantity }]
        }
        return current.map((line) =>
          line.id === productId ? { ...line, quantity: nextQuantity } : line
        )
      })
    },
    []
  )

  const remove = useCallback((productId: string) => {
    setLines((current) => current.filter((line) => line.id !== productId))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      ready,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      add,
      setQuantity,
      remove,
      clear
    }),
    [add, clear, lines, ready, remove, setQuantity]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart debe usarse dentro de CartProvider')
  return context
}
