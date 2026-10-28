import Link from 'next/link'
import { Clock, CreditCard, MapPin, MessageCircle, Phone, QrCode, UserRound } from 'lucide-react'
import type { Category } from '@/lib/catalog'
import { business, generalWhatsAppUrl } from '@/lib/catalog'

export function SiteFooter({ categories }: { categories: Category[] }) {
  return (
    <footer className="site-footer" id="contacto">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Link className="footer-brand" href="/" aria-label="BitacoreTech inicio">
              <img src="/brand/logo.png" alt="BitacoreTech" />
            </Link>
            <p className="footer-text">
              Catálogo de tecnología, accesorios y servicio técnico en Medellín.
              Consulta disponibilidad y recibe asesoría directa por WhatsApp.
            </p>
            <div className="footer-contact">
              <a href={`tel:+${business.whatsapp}`}>
                <Phone aria-hidden="true" />
                {business.phone}
              </a>
              <a href={generalWhatsAppUrl} target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden="true" />
                Escribir por WhatsApp
              </a>
              <span>
                <MapPin aria-hidden="true" />
                {business.city}
              </span>
              <span>
                <Clock aria-hidden="true" />
                {business.hours}
              </span>
            </div>
          </div>

          <div>
            <h2 className="footer-title">Catálogo</h2>
            <div className="footer-links">
              <Link href="/catalogo">Todos los productos</Link>
              {categories.map((category) => (
                <Link key={category.slug} href={`/catalogo?categoria=${category.slug}`}>
                  {category.name}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h2 className="footer-title">BitacoreTech</h2>
            <div className="footer-links">
              <Link href="/">Inicio</Link>
              <Link href="/catalogo">Catálogo</Link>
              <Link href="/servicios">Servicios</Link>
              <Link href="/buscar-orden">Buscar orden</Link>
              <a href={generalWhatsAppUrl} target="_blank" rel="noreferrer">
                Contacto por WhatsApp
              </a>
            </div>
          </div>

          <div>
            <h2 className="footer-title">Próximamente</h2>
            <div className="footer-future">
              <span className="future-pill">
                <QrCode aria-hidden="true" />
                Portal de OT con datos reales
              </span>
              <span className="future-pill">
                <CreditCard aria-hidden="true" />
                Pagos en línea
              </span>
              <span className="future-pill">
                <UserRound aria-hidden="true" />
                Cuentas de cliente
              </span>
            </div>
            <p className="footer-text" style={{ marginTop: 12, fontSize: 10 }}>
              El catálogo y la compra por WhatsApp están disponibles. Las demás
              funciones se irán habilitando por etapas.
            </p>
          </div>
        </div>

        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} <strong>BitacoreTech</strong>. Todos los
            derechos reservados.
          </span>
          <span>Precios en COP · Disponibilidad sujeta a confirmación.</span>
        </div>
      </div>
    </footer>
  )
}
