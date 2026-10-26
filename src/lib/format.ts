const currencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
})

const compactCurrencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  notation: 'compact',
  maximumFractionDigits: 1
})

const numberFormatter = new Intl.NumberFormat('es-CO')

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric'
})

const shortDateFormatter = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'short'
})

const dateTimeFormatter = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

const timeFormatter = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit'
})

const percentFormatter = new Intl.NumberFormat('es-CO', {
  style: 'percent',
  maximumFractionDigits: 1
})

export function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

export function formatCompactCurrency(value: number) {
  return compactCurrencyFormatter.format(value)
}

export function formatNumber(value: number) {
  return numberFormatter.format(value)
}

export function formatDate(value: string | Date) {
  return dateFormatter.format(new Date(value))
}

export function formatShortDate(value: string | Date) {
  return shortDateFormatter.format(new Date(value))
}

export function formatDateTime(value: string | Date) {
  return dateTimeFormatter.format(new Date(value))
}

export function formatTime(value: string | Date) {
  return timeFormatter.format(new Date(value))
}

export function formatPercent(value: number) {
  return percentFormatter.format(value / 100)
}
