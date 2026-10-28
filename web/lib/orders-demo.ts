import ordersJson from '@/data/orders-demo.json'

export type DemoOrder = {
  number: string
  code: string
  status: string
  equipmentType: string
  brand: string
  model: string
  promisedAt: string
  createdAt: string
  updatedAt: string
}

export type OrdersDemo = {
  generatedAt: string
  demo: boolean
  note: string
  orders: DemoOrder[]
}

export const ordersDemo = ordersJson as unknown as OrdersDemo

const statusOrder = [
  'recibido',
  'diagnostico',
  'aprobacion',
  'reparacion',
  'pruebas',
  'listo',
  'entregado'
] as const

const statusMeta: Record<
  string,
  { label: string; short: string; description: string }
> = {
  recibido: {
    label: 'Recibido',
    short: 'Recibido',
    description: 'El equipo ingresó al taller y está en cola de revisión.'
  },
  diagnostico: {
    label: 'En diagnóstico',
    short: 'Diagnóstico',
    description: 'Estamos revisando el equipo para preparar la cotización.'
  },
  aprobacion: {
    label: 'Esperando aprobación',
    short: 'Aprobación',
    description: 'La cotización está lista y esperamos tu aprobación.'
  },
  reparacion: {
    label: 'En reparación',
    short: 'Reparación',
    description: 'El equipo está en proceso de reparación.'
  },
  pruebas: {
    label: 'En pruebas',
    short: 'Pruebas',
    description: 'Estamos verificando el funcionamiento antes de entregar.'
  },
  listo: {
    label: 'Listo para entrega',
    short: 'Listo',
    description: 'El equipo está listo. Puedes coordinar la entrega.'
  },
  entregado: {
    label: 'Entregado',
    short: 'Entregado',
    description: 'El equipo fue entregado y la orden está cerrada.'
  },
  no_reparado: {
    label: 'No reparado',
    short: 'No reparado',
    description: 'El equipo está disponible para retirar.'
  }
}

export function statusInfo(status: string) {
  return statusMeta[status] ?? statusMeta.recibido
}

export function statusSteps(status: string) {
  const current = statusOrder.indexOf(status as (typeof statusOrder)[number])
  const terminal = status === 'entregado'
  return statusOrder.map((step, index) => {
    const state =
      terminal || (current >= 0 && index < current)
        ? 'done'
        : index === current
          ? 'current'
          : 'pending'
    return {
      key: step,
      label: statusMeta[step].short,
      state
    }
  })
}

export function findDemoOrder(orders: DemoOrder[], number: string, code: string) {
  const normalizedNumber = number.trim().toUpperCase()
  const normalizedCode = code.trim().toUpperCase()
  return orders.find(
    (order) =>
      order.number.toUpperCase() === normalizedNumber &&
      order.code.toUpperCase() === normalizedCode
  )
}

export function findDemoOrderByCode(orders: DemoOrder[], code: string) {
  return orders.find(
    (order) => order.code.toUpperCase() === code.trim().toUpperCase()
  )
}

export function formatOrderDate(value: string) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date(value))
}
