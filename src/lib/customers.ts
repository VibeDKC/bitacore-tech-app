import type { Customer, CustomerPhone } from '@/types'

export function customerPhones(customer: Customer | null | undefined): CustomerPhone[] {
  if (!customer) return []
  if (customer.phones?.length) return customer.phones
  if (customer.phone && customer.phone !== '—') {
    return [{ phone: customer.phone, label: 'Principal', isPrimary: true }]
  }
  return []
}

export function customerPrimaryPhone(customer: Customer | null | undefined) {
  const phones = customerPhones(customer)
  return phones.find((item) => item.isPrimary)?.phone ?? phones[0]?.phone ?? customer?.phone ?? '—'
}

export function customerDocumentLabel(customer: Customer | null | undefined) {
  if (!customer) return 'Sin documento'
  if (customer.documentMissing) return 'Sin documento'
  const dv =
    customer.documentType === 'NIT' && customer.documentDv ? `-${customer.documentDv}` : ''
  return `${customer.documentType} ${customer.document}${dv}`
}

export function customerSearchText(customer: Customer) {
  return [
    customer.name,
    customer.documentMissing ? '' : customer.document,
    customer.email,
    ...customerPhones(customer).map((item) => item.phone)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
