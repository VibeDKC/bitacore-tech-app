import { DEFAULT_MESSAGES } from '@shared/index'

export interface LegalConfig {
  businessName: string
  nit: string
  nitDv?: string
  foreignNit?: string
  phone: string
  address: string
  city: string
  email: string
  version: string
  updatedAt: string
  abandonmentDays: number
  warrantyDays: number
  shortClauses: string[]
  fullClauses: string[]
}

export const DEFAULT_LEGAL: LegalConfig = {
  businessName: 'BitacoreTech Taller & POS',
  nit: '901245678',
  nitDv: '3',
  foreignNit: '',
  phone: '+57 604 322 1188',
  address: 'Cra. 43 # 25-18',
  city: 'Medellín, Antioquia',
  email: 'hola@bitacoretech.co',
  version: 'v1.0',
  updatedAt: '2026-10-01T08:00:00',
  abandonmentDays: 45,
  warrantyDays: 90,
  shortClauses: [
    'El diagnóstico no obliga a la reparación. El presupuesto se informa y aprueba antes de intervenir el equipo.',
    'El taller no responde por información que el cliente no haya respaldado antes del ingreso.',
    'Los equipos no reclamados después de {{dias}} días se consideran en abandono conforme a la ley.'
  ],
  fullClauses: [
    'El cliente autoriza la apertura del equipo y las pruebas necesarias para emitir el diagnóstico técnico. El desarmado se realiza con fines de revisión y reparación.',
    'El taller no se hace responsable por la pérdida de información, programas o licencias que el cliente no haya respaldado antes de entregar el equipo. El respaldo es responsabilidad del cliente.',
    'El diagnóstico y el presupuesto inicial no son vinculantes hasta que el cliente apruebe expresamente la reparación. Si el cliente rechaza la cotización, solo se cobrará el diagnóstico si fue informado previamente.',
    'El cliente declara conocer el estado físico y los accesorios registrados en este comprobante. El taller no responde por daños estéticos o faltantes no consignados al momento del ingreso.',
    'La garantía cubre exclusivamente la mano de obra y los repuestos suministrados por el taller durante {{garantia}} días, y no cubre daños por golpes, líquidos, mal uso, variaciones eléctricas o intervención de terceros.',
    'Transcurridos {{dias}} días calendario sin que el cliente reclame el equipo, este se considerará en abandono. El taller podrá cobrar almacenaje y disponer del equipo conforme a la normativa aplicable, dejando constancia del proceso.',
    'El retiro del equipo debe realizarse con el comprobante de ingreso o documento de identidad del titular. Al entregar, el cliente verificará el estado y funcionamiento del equipo, dejando constancia de recibido.'
  ]
}

export const DEFAULT_SETTINGS = {
  print: {
    defaultFormat: '80mm',
    autoPrint: false,
    showLogo: true,
    showTermsOnReceipt: true,
    paperWidth: 80
  },
  ai: {
    enabled: false,
    diagnosis: false,
    summary: false,
    anomalies: false,
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    fallbackModels: [] as string[],
    autoFallback: false,
    modelCatalog: [] as Array<{
      id: string
      displayName: string
      description?: string
      inputTokenLimit?: number
      outputTokenLimit?: number
    }>,
    catalogUpdatedAt: null as string | null
  },
  security: {
    strictSessions: true,
    sessionHours: 12
  },
  business: {
    timezone: 'America/Bogota',
    currency: 'COP',
    locale: 'es-CO',
    invoicePrefix: 'FV',
    orderPrefix: 'OT'
  },
  equipment: {
    qrEnabled: false
  },
  messages: DEFAULT_MESSAGES,
  tracking: {
    purchasesByUser: true
  }
}

export const STATUS_CONFIG = [
  {
    status: 'recibido',
    label: 'Recibido',
    shortLabel: 'Recibido',
    description: 'Equipo registrado y pendiente de diagnóstico.',
    tone: 'neutral',
    position: 0,
    isTerminal: 0,
    requiresPayment: 0,
    isCancel: 0
  },
  {
    status: 'diagnostico',
    label: 'En diagnóstico',
    shortLabel: 'Diagnóstico',
    description: 'El técnico está evaluando la falla.',
    tone: 'sky',
    position: 1,
    isTerminal: 0,
    requiresPayment: 0,
    isCancel: 0
  },
  {
    status: 'aprobacion',
    label: 'Esperando aprobación',
    shortLabel: 'Aprobación',
    description: 'Cotización enviada al cliente.',
    tone: 'warning',
    position: 2,
    isTerminal: 0,
    requiresPayment: 0,
    isCancel: 0
  },
  {
    status: 'reparacion',
    label: 'En reparación',
    shortLabel: 'Reparación',
    description: 'Mano de obra y repuestos en ejecución.',
    tone: 'brand',
    position: 3,
    isTerminal: 0,
    requiresPayment: 0,
    isCancel: 0
  },
  {
    status: 'pruebas',
    label: 'En pruebas',
    shortLabel: 'Pruebas',
    description: 'Control de calidad y verificación final.',
    tone: 'sky',
    position: 4,
    isTerminal: 0,
    requiresPayment: 0,
    isCancel: 0
  },
  {
    status: 'listo',
    label: 'Listo para entrega',
    shortLabel: 'Listo',
    description: 'Equipo reparado listo para retiro y facturación.',
    tone: 'success',
    position: 5,
    isTerminal: 0,
    requiresPayment: 0,
    isCancel: 0
  },
  {
    status: 'entregado',
    label: 'Entregado',
    shortLabel: 'Entregado',
    description: 'Cierre de la OT, pago y factura interna.',
    tone: 'success',
    position: 6,
    isTerminal: 1,
    requiresPayment: 1,
    isCancel: 0
  },
  {
    status: 'no_reparado',
    label: 'No reparado',
    shortLabel: 'No reparado',
    description: 'El equipo no pudo repararse o el cliente rechazó el trabajo.',
    tone: 'danger',
    position: 7,
    isTerminal: 1,
    requiresPayment: 0,
    isCancel: 1
  }
] as const
