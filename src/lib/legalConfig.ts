import type { LegalConfig } from '@/types'

export type { LegalConfig } from '@/types'

export const defaultLegalConfig: LegalConfig = {
  businessName: 'BitacoreTech Taller & POS',
  nit: '901.245.678-9',
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

export function resolveLegalClause(clause: string, config: Pick<LegalConfig, 'abandonmentDays' | 'warrantyDays'>) {
  return clause
    .replace(/\{\{dias\}\}/g, String(config.abandonmentDays))
    .replace(/\{\{garantia\}\}/g, String(config.warrantyDays))
}
