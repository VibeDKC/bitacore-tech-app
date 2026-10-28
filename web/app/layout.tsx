import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/inter'
import '@fontsource-variable/plus-jakarta-sans'
import './globals.css'
import { SiteTopBar } from '@/components/site-topbar'
import { SiteHeader } from '@/components/site-header'
import { SearchStrip } from '@/components/search-strip'
import { SiteFooter } from '@/components/site-footer'
import { catalog } from '@/lib/catalog'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'BitacoreTech | Tecnología y accesorios en Medellín',
    template: '%s | BitacoreTech'
  },
  description:
    'Catálogo de periféricos, almacenamiento y accesorios en Medellín. Compra por WhatsApp y agenda servicio técnico cuando lo necesites.',
  icons: {
    icon: '/brand/favicon.png'
  },
  openGraph: {
    title: 'BitacoreTech | Tecnología y accesorios',
    description:
      'Catálogo de tecnología y accesorios en Medellín. Compra por WhatsApp y agenda servicio técnico.',
    type: 'website',
    locale: 'es_CO',
    siteName: 'BitacoreTech'
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1220'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" data-scroll-behavior="smooth">
      <body>
        <SiteTopBar />
        <SiteHeader categories={catalog.categories} />
        <SearchStrip categories={catalog.categories} />
        <main className="site-main">{children}</main>
        <SiteFooter categories={catalog.categories} />
      </body>
    </html>
  )
}
