import { Clock } from 'lucide-react'
import type { ServiceItem } from '@/lib/services'

export function ServiceCard({ service }: { service: ServiceItem }) {
  const Icon = service.icon
  return (
    <article className="service-item">
      <span className="service-item-icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <div className="service-item-heading">
          <h3>{service.title}</h3>
          {service.comingSoon ? (
            <span className="service-coming">
              <Clock aria-hidden="true" />
              Próximamente
            </span>
          ) : null}
        </div>
        <p>{service.description}</p>
      </div>
    </article>
  )
}
