import { Clock, MapPin, Phone } from 'lucide-react'
import { business, generalWhatsAppUrl } from '@/lib/catalog'

export function SiteTopBar() {
  return (
    <div className="topbar">
      <div className="container topbar-inner">
        <div className="topbar-group">
          <span className="topbar-item topbar-city">
            <MapPin aria-hidden="true" />
            {business.city}
          </span>
          <span className="topbar-item topbar-hours">
            <Clock aria-hidden="true" />
            {business.hours}
          </span>
          <a className="topbar-item" href={`tel:+${business.whatsapp}`}>
            <Phone aria-hidden="true" />
            {business.phone}
          </a>
        </div>
        <a
          className="topbar-link"
          href={generalWhatsAppUrl}
          target="_blank"
          rel="noreferrer"
        >
          Compra y asesoría por WhatsApp
        </a>
      </div>
    </div>
  )
}
