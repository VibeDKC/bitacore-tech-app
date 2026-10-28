import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { ServiceCard } from '@/components/service-card'
import { ServiceQuoteForm } from '@/components/service-quote-form'
import { serviceGroups } from '@/lib/services'

export const metadata: Metadata = {
  title: 'Servicios',
  description:
    'Reparación, mantenimiento, recuperación de datos, software, redes y asesoría técnica en Medellín. Solicita tu cotización.'
}

export default function ServicesPage() {
  return (
    <div className="container services-page">
      <section className="services-hero">
        <div>
          <p className="eyebrow">Servicios</p>
          <h1 className="services-title">Soporte técnico para tus equipos</h1>
          <p className="services-text">
            Reparación, mantenimiento, software, datos, redes y asesoría. Revisamos
            tu caso y te entregamos una cotización clara antes de intervenir el
            equipo.
          </p>
          <div className="services-actions">
            <a className="btn btn-primary" href="#cotizacion">
              Solicitar cotización
              <ArrowRight aria-hidden="true" />
            </a>
            <Link className="btn btn-outline" href="/catalogo">
              Ver catálogo
            </Link>
          </div>
          <div className="services-note">
            <ShieldCheck aria-hidden="true" />
            <span>
              <strong>Revisión inicial:</strong> se cotiza según el equipo y el
              diagnóstico. No se muestra un valor por hora.
            </span>
          </div>
        </div>
        <div className="services-highlight">
          <p className="service-card-label">Cómo funciona</p>
          <ol>
            <li>Nos cuentas qué necesita el equipo.</li>
            <li>Revisamos y preparamos la cotización.</li>
            <li>Apruebas el valor y comenzamos.</li>
          </ol>
        </div>
      </section>

      <div className="service-groups">
        {serviceGroups.map((group) => (
          <section className="service-group" key={group.title}>
            <div className="service-group-head">
              <div>
                <h2>{group.title}</h2>
                <p>{group.description}</p>
              </div>
            </div>
            <div className="service-grid">
              {group.items.map((service) => (
                <ServiceCard key={service.title} service={service} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <ServiceQuoteForm />
    </div>
  )
}
