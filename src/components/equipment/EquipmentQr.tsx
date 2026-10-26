import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function EquipmentQr({ value, size = 180 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    let active = true
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#11152c', light: '#ffffff' }
    })
      .then((url) => {
        if (active) setDataUrl(url)
      })
      .catch(() => {
        if (active) setDataUrl('')
      })
    return () => {
      active = false
    }
  }, [value, size])

  if (!dataUrl) {
    return <div className="animate-pulse rounded-lg bg-slate-100" style={{ width: size, height: size }} />
  }

  return <img src={dataUrl} width={size} height={size} alt={`QR ${value}`} className="rounded-lg" />
}
