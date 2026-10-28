import { MapPin, PackageCheck, ShieldCheck, Wrench } from 'lucide-react'

const items = [
  {
    title: 'Garantía 30 días',
    text: 'En todos los productos',
    icon: ShieldCheck
  },
  {
    title: 'Atención local',
    text: 'Medellín',
    icon: MapPin
  },
  {
    title: 'Servicio técnico',
    text: 'Diagnóstico y reparación',
    icon: Wrench
  },
  {
    title: 'Disponibilidad',
    text: 'Stock del catálogo',
    icon: PackageCheck
  }
]

export function TrustBar() {
  return (
    <section className="trust-bar" aria-label="Beneficios de compra">
      <div className="container trust-grid">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <div className="trust-item" key={item.title}>
              <span className="trust-icon">
                <Icon aria-hidden="true" />
              </span>
              <div>
                <p className="trust-title">{item.title}</p>
                <p className="trust-text">{item.text}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
