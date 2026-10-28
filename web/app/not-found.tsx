import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="container" style={{ padding: '80px 0 100px' }}>
      <div className="empty-state">
        <span className="empty-state-icon">
          <ArrowLeft aria-hidden="true" />
        </span>
        <h1>No encontramos esa página</h1>
        <p>La referencia puede haber cambiado. Vuelve al catálogo para seguir explorando.</p>
        <Link className="btn btn-primary" href="/catalogo" style={{ marginTop: 18 }}>
          Ir al catálogo
        </Link>
      </div>
    </div>
  )
}
