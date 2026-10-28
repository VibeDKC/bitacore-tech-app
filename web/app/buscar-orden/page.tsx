import type { Metadata } from 'next'
import { QrCode, ShieldCheck } from 'lucide-react'
import { OrderSearch } from '@/components/order-search'

export const revalidate = 60

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
          Ingresa el número de OT y el código de seguimiento que aparece en tu orden o
          comprobante. El código se valida de forma segura y no se publica en el catálogo.
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
          <strong>QR de seguimiento</strong>
          <p>
            El QR impreso abre esta página con el código de la orden. El QR sigue
            inactivo por defecto y se activa desde Configuración cuando lo decidas.
          </p>
        </div>
      </div>
    </div>
  )
}
