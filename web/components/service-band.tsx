import Link from 'next/link'
import { ArrowRight, Wrench } from 'lucide-react'

export function ServiceBand() {
  return (
    <section className="service-band" id="servicio-tecnico">
      <div className="service-inner">
        <div>
          <p className="service-kicker">
            <Wrench aria-hidden="true" />
            Servicios
          </p>
          <h2 className="service-title">Soporte técnico para tus equipos</h2>
          <p className="service-text">
            Revisión inicial, reparación, mantenimiento, recuperación de datos,
            software, redes y asesoría. El valor se confirma en la cotización.
          </p>
          <div className="service-actions">
            <Link className="btn btn-dark" href="/servicios">
              Conocer servicios
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="service-card">
          <p className="service-card-label">Punto de partida</p>
          <p className="service-card-value">Revisión inicial</p>
          <p className="service-card-note">
            Evaluamos el equipo y preparamos la cotización. El valor se confirma
            según el caso y el diagnóstico.
          </p>
        </div>
      </div>
    </section>
  )
}
