'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { OrderStatusCard } from '@/components/order-status-card'
import type { DemoOrder } from '@/lib/orders-demo'
import { findDemoOrder, ordersDemo } from '@/lib/orders-demo'

export function OrderSearch() {
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [result, setResult] = useState<DemoOrder | null>(null)
  const [error, setError] = useState('')

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const order = findDemoOrder(number, code)
    if (!order) {
      setResult(null)
      setError('No encontramos una orden con esos datos. Verifica el número y el código.')
      return
    }
    setResult(order)
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
            placeholder="Ej. DEMO-01"
            autoComplete="off"
            required
          />
        </label>
        <button className="btn btn-primary" type="submit">
          <Search aria-hidden="true" />
          Consultar estado
        </button>
      </form>

      <div className="order-demo-box">
        <p className="order-demo-title">Datos de prueba para esta demo</p>
        <div className="order-demo-list">
          {ordersDemo.orders.map((order) => (
            <button
              key={order.number}
              type="button"
              onClick={() => {
                setNumber(order.number)
                setCode(order.code)
                setResult(order)
                setError('')
              }}
            >
              <strong>{order.number}</strong>
              <span>{order.code}</span>
            </button>
          ))}
        </div>
        <p className="order-demo-help">
          En producción, el código se imprime en la OT o factura y se envía por
          WhatsApp. No se puede consultar solo con el número de orden.
        </p>
      </div>

      {error ? <p className="order-error">{error}</p> : null}
      {result ? <OrderStatusCard order={result} /> : null}
    </div>
  )
}
