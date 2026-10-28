import type { Metadata } from 'next'
import { QrCode, ShieldCheck } from 'lucide-react'
import { OrderSearch } from '@/components/order-search'

export const metadata: Metadata = {
  title: 'Buscar orden',
  description:
    'Consulta el estado de tu orden de trabajo con el número de OT y el código de seguimiento.'
}

export default function OrderSearchPage() {
  return (
    <div className="container order-page">
      <section className="order-hero">
        <p className="eyebrow">Seguimiento</p>
        <h1 className="order-title">Consulta el estado de tu equipo</h1>
        <p className="order-subtitle">
          Ingresa el número de OT y el código de seguimiento que aparece en tu
          orden o factura. En esta demo el QR no está activo: usa los datos de
          prueba.
        </p>
        <div className="order-privacy">
          <ShieldCheck aria-hidden="true" />
          Por seguridad no mostramos nombre, teléfono, serial, credenciales ni
          notas internas.
        </div>
      </section>

      <OrderSearch />

      <div className="order-qr-note">
        <QrCode aria-hidden="true" />
        <div>
          <strong>QR de seguimiento (demo)</strong>
          <p>
            En la versión final, el QR impreso abrirá esta página. Por ahora
            queda inactivo por defecto: el acceso es con número de OT y código.
          </p>
        </div>
      </div>
    </div>
  )
}
