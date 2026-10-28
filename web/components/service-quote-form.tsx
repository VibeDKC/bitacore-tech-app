'use client'

import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { serviceOptions } from '@/lib/services'
import { whatsappUrl } from '@/lib/catalog'

export function ServiceQuoteForm() {
  const [service, setService] = useState(serviceOptions[0] ?? 'Revisión inicial')
  const [message, setMessage] = useState('')

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = [
      'Hola BitacoreTech, quiero solicitar una cotización.',
      '',
      `• Servicio: ${service}`,
      message.trim() ? `• Detalle: ${message.trim()}` : '',
      '',
      '¿Me pueden indicar disponibilidad y valor?'
    ]
      .filter(Boolean)
      .join('\n')
    window.open(whatsappUrl(text), '_blank', 'noopener,noreferrer')
  }

  return (
    <form className="quote-form" onSubmit={submit} id="cotizacion">
      <div>
        <p className="eyebrow">Cotización</p>
        <h2 className="section-title">Cuéntanos qué necesitas</h2>
        <p className="section-subtitle">
          Selecciona el servicio y te respondemos por WhatsApp con el valor y la
          disponibilidad.
        </p>
      </div>
      <div className="quote-fields">
        <label>
          <span className="field-label">Servicio</span>
          <select value={service} onChange={(event) => setService(event.target.value)}>
            {serviceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Detalle opcional</span>
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Equipo, marca o problema"
          />
        </label>
        <button className="btn btn-whatsapp" type="submit">
          <MessageCircle aria-hidden="true" />
          Solicitar cotización
        </button>
      </div>
    </form>
  )
}
