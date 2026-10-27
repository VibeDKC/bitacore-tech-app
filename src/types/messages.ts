export const MESSAGE_VARIABLES = [
  '{{cliente}}',
  '{{equipo}}',
  '{{marca}}',
  '{{modelo}}',
  '{{serial}}',
  '{{ot}}',
  '{{estado}}',
  '{{diagnostico}}',
  '{{presupuesto}}',
  '{{total}}',
  '{{saldo}}',
  '{{taller}}',
  '{{telefono}}',
  '{{fecha}}'
] as const

export const DEFAULT_MESSAGES = {
  initial:
    'Hola {{cliente}}, recibimos tu {{equipo}} {{marca}} {{modelo}} en {{taller}}. OT {{ot}}. Estado actual: {{estado}}. Diagnóstico inicial: {{diagnostico}}. Presupuesto estimado: {{presupuesto}}. Quedamos atentos.',
  ready:
    'Hola {{cliente}}, tu {{equipo}} {{marca}} {{modelo}} (OT {{ot}}) ya está listo para entrega. Total: {{total}}. Saldo: {{saldo}}. Te esperamos en {{taller}}.'
}

export type MessageTemplates = typeof DEFAULT_MESSAGES

export function renderMessageTemplate(template: string, values: Record<string, string | number | null | undefined>) {
  return String(template ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) => {
    const value = values[key.toLowerCase()]
    return value === null || value === undefined ? '' : String(value)
  })
}
