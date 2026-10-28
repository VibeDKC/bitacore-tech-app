'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { OrderStatusCard } from '@/components/order-status-card'
import type { DemoOrder } from '@/lib/orders-demo'
import { normalizeOrderNumber, normalizeTrackingCode } from '@/lib/order-format'

export function OrderSearch() {
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [result, setResult] = useState<DemoOrder | null>(null)
  const [submittedCode, setSubmittedCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const normalizedNumber = normalizeOrderNumber(number)
    const normalizedCode = normalizeTrackingCode(code)
    if (!normalizedNumber || !normalizedCode) {
      setError('Escribe el número de la OT y la clave de seguimiento.')
      return
    }
    setLoading(true)
    try {
      const response = await fetch(
        `/api/seguimiento?numero=${encodeURIComponent(
          normalizedNumber
        )}&codigo=${encodeURIComponent(normalizedCode)}`,
        { cache: 'no-store' }
      )
      if (!response.ok) {
        setResult(null)
        setError(
          'No encontramos una orden con ese número y clave. Verifica los datos impresos en tu OT.'
        )
        return
      }
      const order = (await response.json()) as DemoOrder
      setResult(order)
      setSubmittedCode(normalizedCode)
    } catch {
      setResult(null)
      setError('No se pudo consultar la orden. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="order-search">
      <form className="order-search-form" onSubmit={submit}>
        <label>
          <span className="field-label">Número de OT (solo números)</span>
          <input
            value={number}
            onChange={(event) =>
              setNumber(event.target.value.replace(/\D/g, '').slice(0, 12))
            }
            placeholder="Ej. 002332"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span className="field-label">Clave de seguimiento</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Ej. SG-AB12CD34EF56"
            autoComplete="off"
            required
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          <Search aria-hidden="true" />
          {loading ? 'Consultando…' : 'Consultar estado'}
        </button>
      </form>

      <div className="order-demo-box">
        <p className="order-demo-title">¿Dónde están mis datos?</p>
        <p className="order-demo-help">
          El número de OT está impreso sin el prefijo #OT-, por ejemplo 002332. La clave
          de seguimiento comienza con SG- y aparece en tu orden y en el comprobante de
          ingreso. Por seguridad necesitamos ambos datos.
        </p>
      </div>

      {error ? <p className="order-error">{error}</p> : null}
      {result ? <OrderStatusCard order={result} code={submittedCode} /> : null}
    </div>
  )
}
