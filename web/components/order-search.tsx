'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { OrderStatusCard } from '@/components/order-status-card'
import type { DemoOrder } from '@/lib/orders-demo'

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
    setLoading(true)
    try {
      const response = await fetch(
        `/api/seguimiento?numero=${encodeURIComponent(number.trim())}&codigo=${encodeURIComponent(
          code.trim()
        )}`,
        { cache: 'no-store' }
      )
      if (!response.ok) {
        setResult(null)
        setError(
          'No encontramos una orden con esos datos. Verifica el número y el código impreso en tu OT.'
        )
        return
      }
      const order = (await response.json()) as DemoOrder
      setResult(order)
      setSubmittedCode(code.trim().toUpperCase())
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
          <span className="field-label">Número de OT</span>
          <input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="Ej. OT-002332"
            autoComplete="off"
            required
          />
        </label>
        <label>
          <span className="field-label">Código de seguimiento</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
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
        <p className="order-demo-title">¿Dónde está mi código?</p>
        <p className="order-demo-help">
          El código de seguimiento está impreso en tu orden de trabajo y en el comprobante
          de ingreso. Por seguridad no se puede consultar solo con el número de OT.
        </p>
      </div>

      {error ? <p className="order-error">{error}</p> : null}
      {result ? <OrderStatusCard order={result} code={submittedCode} /> : null}
    </div>
  )
}
