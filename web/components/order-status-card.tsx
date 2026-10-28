import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Clock, ShieldCheck } from 'lucide-react'
import type { DemoOrder } from '@/lib/orders-demo'
import { formatOrderDate, statusInfo, statusSteps } from '@/lib/orders-demo'

export function OrderStatusCard({ order }: { order: DemoOrder }) {
  const info = statusInfo(order.status)
  const steps = statusSteps(order.status)

  return (
    <article className="order-status-card">
      <div className="order-status-top">
        <div>
          <p className="eyebrow">Orden de trabajo</p>
          <h2 className="order-number">{order.number}</h2>
          <p className="order-equipment">
            {order.equipmentType} · {order.brand} {order.model}
          </p>
        </div>
        <span className={`order-status-pill ${order.status}`}>
          {info.label}
        </span>
      </div>

      <p className="order-status-description">{info.description}</p>

      <ol className="order-steps" aria-label="Avance de la orden">
        {steps.map((step) => (
          <li key={step.key} className={`order-step ${step.state}`}>
            <span className="order-step-dot">
              {step.state === 'done' ? <CheckCircle2 aria-hidden="true" /> : null}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>

      <div className="order-facts">
        <div>
          <span className="fact-label">Fecha prometida</span>
          <p>{formatOrderDate(order.promisedAt)}</p>
        </div>
        <div>
          <span className="fact-label">Última actualización</span>
          <p>{formatOrderDate(order.updatedAt)}</p>
        </div>
        <div>
          <span className="fact-label">Código de seguimiento</span>
          <p>{order.code}</p>
        </div>
      </div>

      <div className="order-security-note">
        <ShieldCheck aria-hidden="true" />
        Por seguridad, esta consulta no muestra nombre, teléfono, serial,
        credenciales ni notas internas. Para retirar el equipo, presenta la orden
        y tu documento de identidad.
      </div>

      <div className="order-status-footer">
        <Link className="btn btn-outline" href="/buscar-orden">
          <ArrowLeft aria-hidden="true" />
          Consultar otra orden
        </Link>
        <span className="order-demo-note">
          <Clock aria-hidden="true" /> Datos de demostración
        </span>
      </div>
    </article>
  )
}
