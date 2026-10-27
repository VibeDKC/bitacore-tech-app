import { RpcError } from './permissions'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'

export interface InvoiceExtractionLine {
  description: string
  quantity: number
  unitCost: number
  ivaRate: number
  confidence?: number
}

export interface InvoiceExtraction {
  supplier: {
    name: string
    nit?: string
    confidence?: number
  }
  invoice: {
    number: string
    date?: string
    currency?: string
    confidence?: number
  }
  lines: InvoiceExtractionLine[]
  subtotal?: number
  discount?: number
  iva?: number
  total?: number
  confidence?: number
  warnings?: string[]
}

function baseUrl() {
  return (process.env.BITACORETECH_GEMINI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function modelPath(model: string) {
  const trimmed = model.trim()
  return trimmed.startsWith('models/') ? trimmed : `models/${trimmed}`
}

function retrySecondsFromDetails(details: unknown): number | undefined {
  if (!Array.isArray(details)) return undefined
  for (const item of details) {
    if (!item || typeof item !== 'object') continue
    const delay = (item as Record<string, unknown>).retryDelay
    if (typeof delay !== 'string') continue
    const match = delay.trim().match(/^(\d+(?:\.\d+)?)s$/)
    if (match) return Math.max(1, Math.ceil(Number(match[1])))
  }
  return undefined
}

function quotaFromDetails(details: unknown) {
  if (!Array.isArray(details)) return { scope: 'unknown' as const }
  for (const item of details) {
    if (!item || typeof item !== 'object') continue
    const violations = (item as Record<string, unknown>).violations
    if (!Array.isArray(violations) || !violations.length) continue
    const violation = violations[0] as Record<string, unknown>
    const quotaId = typeof violation.quotaId === 'string' ? violation.quotaId : ''
    const quotaMetric = typeof violation.quotaMetric === 'string' ? violation.quotaMetric : ''
    const scope = /per.?day|daily/i.test(quotaId)
      ? ('day' as const)
      : /per.?minute|rpm/i.test(quotaId)
        ? ('minute' as const)
        : ('unknown' as const)
    return { quotaId, quotaMetric, scope }
  }
  return { scope: 'unknown' as const }
}

function geminiError(status: number, detail: string, model = '', errorDetails?: unknown) {
  const retryAfterSeconds = retrySecondsFromDetails(errorDetails)
  const quota = quotaFromDetails(errorDetails)
  const modelLabel = model ? ` del modelo ${model}` : ''
  const waitText = retryAfterSeconds
    ? ` Reintenta en ${retryAfterSeconds} s.`
    : ' Espera un momento o cambia de modelo.'
  const rpcDetails: Record<string, unknown> = {
    ...(model ? { model } : {}),
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    ...(quota.quotaId ? { quotaId: quota.quotaId } : {}),
    ...(quota.quotaMetric ? { quotaMetric: quota.quotaMetric } : {}),
    ...(quota.scope !== 'unknown' ? { scope: quota.scope } : {})
  }
  if (status === 400) {
    return new RpcError(`Gemini rechazó la solicitud: ${detail}`, 'AI_BAD_REQUEST', rpcDetails)
  }
  if (status === 401 || status === 403) {
    return new RpcError('La clave de Gemini no es válida o no tiene permisos.', 'AI_AUTH', rpcDetails)
  }
  if (status === 404) {
    return new RpcError(
      `El modelo${modelLabel || ' configurado'} no existe o no está disponible para esta clave.`,
      'AI_MODEL_NOT_FOUND',
      rpcDetails
    )
  }
  if (status === 429) {
    if (quota.scope === 'day') {
      return new RpcError(
        `Se agotó la cuota diaria${modelLabel}. Cambia de modelo o espera al restablecimiento.`,
        'AI_QUOTA',
        rpcDetails
      )
    }
    if (quota.scope === 'minute') {
      return new RpcError(
        `Se alcanzó el límite por minuto${modelLabel}.${waitText}`,
        'AI_QUOTA',
        rpcDetails
      )
    }
    return new RpcError(`Se agotó la cuota${modelLabel}.${waitText}`, 'AI_QUOTA', rpcDetails)
  }
  if (status >= 500) {
    return new RpcError(
      `Gemini no está disponible en este momento${modelLabel}. Intenta de nuevo.`,
      'AI_UNAVAILABLE',
      rpcDetails
    )
  }
  return new RpcError(`Gemini respondió con error ${status}: ${detail}`, 'AI_ERROR', rpcDetails)
}

export interface GeminiModelOption {
  id: string
  displayName: string
  description?: string
  inputTokenLimit?: number
  outputTokenLimit?: number
}

export interface GeminiModelList {
  models: GeminiModelOption[]
  fetchedAt: string
}

async function callGemini({
  apiKey,
  model,
  body,
  timeoutMs
}: {
  apiKey: string
  model: string
  body: Record<string, unknown>
  timeoutMs: number
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl()}/v1beta/${modelPath(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await response.text()
    let parsed: any = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (!response.ok) {
      const detail =
        parsed?.error?.message ??
        parsed?.message ??
        text.slice(0, 300) ??
        `HTTP ${response.status}`
      throw geminiError(response.status, String(detail), model, parsed?.error?.details)
    }
    if (!parsed) {
      throw new RpcError('Gemini devolvió una respuesta vacía o ilegible.', 'AI_INVALID_RESPONSE', {
        model
      })
    }
    const candidate = parsed?.candidates?.[0]
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    const output = parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim()
    if (!output) {
      const block = parsed?.promptFeedback?.blockReason
      throw new RpcError(
        block
          ? `Gemini bloqueó la respuesta (${block}).`
          : 'Gemini no devolvió contenido para analizar.',
        'AI_EMPTY_RESPONSE',
        { model }
      )
    }
    return output
  } catch (error) {
    if (error instanceof RpcError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RpcError('Gemini tardó demasiado en responder. Intenta de nuevo.', 'AI_TIMEOUT', {
        model
      })
    }
    throw new RpcError(
      `No se pudo conectar con Gemini: ${error instanceof Error ? error.message : String(error)}`,
      'AI_NETWORK',
      { model }
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function testGeminiConnection({
  apiKey,
  model
}: {
  apiKey: string
  model: string
}) {
  const started = Date.now()
  const output = await callGemini({
    apiKey,
    model,
    body: {
      contents: [{ parts: [{ text: 'Responde únicamente con la palabra OK.' }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8
      }
    },
    timeoutMs: 25000
  })
  return {
    ok: true,
    model,
    latencyMs: Date.now() - started,
    message: output.slice(0, 120)
  }
}

export async function listGeminiModels({ apiKey }: { apiKey: string }): Promise<GeminiModelList> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    let pageToken = ''
    const collected = new Map<string, GeminiModelOption>()
    for (let page = 0; page < 5; page += 1) {
      const url = new URL(`${baseUrl()}/v1beta/models`)
      url.searchParams.set('pageSize', '1000')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const response = await fetch(url.toString(), {
        headers: { 'x-goog-api-key': apiKey },
        signal: controller.signal
      })
      const text = await response.text()
      let parsed: any = null
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = null
      }
      if (!response.ok) {
        const detail =
          parsed?.error?.message ??
          parsed?.message ??
          text.slice(0, 300) ??
          `HTTP ${response.status}`
        throw geminiError(response.status, String(detail), '', parsed?.error?.details)
      }
      if (!parsed) {
        throw new RpcError(
          'Gemini devolvió un catálogo de modelos vacío o ilegible.',
          'AI_INVALID_RESPONSE'
        )
      }
      const entries = Array.isArray(parsed.models) ? parsed.models : []
      for (const entry of entries) {
        const id = String(entry?.name ?? '').replace(/^models\//, '').trim()
        if (!id) continue
        const methods = Array.isArray(entry?.supportedGenerationMethods)
          ? entry.supportedGenerationMethods
          : []
        if (!methods.includes('generateContent')) continue
        const displayName = String(entry?.displayName ?? id).trim().slice(0, 120)
        const inputTokenLimit = Number(entry?.inputTokenLimit)
        const outputTokenLimit = Number(entry?.outputTokenLimit)
        collected.set(id, {
          id,
          displayName: displayName || id,
          ...(typeof entry?.description === 'string'
            ? { description: entry.description.slice(0, 300) }
            : {}),
          ...(Number.isFinite(inputTokenLimit) && inputTokenLimit > 0 ? { inputTokenLimit } : {}),
          ...(Number.isFinite(outputTokenLimit) && outputTokenLimit > 0 ? { outputTokenLimit } : {})
        })
      }
      pageToken = typeof parsed.nextPageToken === 'string' ? parsed.nextPageToken : ''
      if (!pageToken) break
    }
    return {
      models: [...collected.values()].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, 'es')
      ),
      fetchedAt: new Date().toISOString()
    }
  } catch (error) {
    if (error instanceof RpcError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RpcError('Gemini tardó demasiado en devolver el catálogo de modelos.', 'AI_TIMEOUT')
    }
    throw new RpcError(
      `No se pudo consultar el catálogo de Gemini: ${error instanceof Error ? error.message : String(error)}`,
      'AI_NETWORK'
    )
  } finally {
    clearTimeout(timeout)
  }
}

const invoiceSchema = {
  type: 'OBJECT',
  properties: {
    supplier: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        nit: { type: 'STRING' },
        confidence: { type: 'NUMBER' }
      },
      required: ['name']
    },
    invoice: {
      type: 'OBJECT',
      properties: {
        number: { type: 'STRING' },
        date: { type: 'STRING' },
        currency: { type: 'STRING' },
        confidence: { type: 'NUMBER' }
      },
      required: ['number']
    },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unitCost: { type: 'NUMBER' },
          ivaRate: { type: 'NUMBER' },
          confidence: { type: 'NUMBER' }
        },
        required: ['description', 'quantity', 'unitCost', 'ivaRate']
      }
    },
    subtotal: { type: 'NUMBER' },
    discount: { type: 'NUMBER' },
    iva: { type: 'NUMBER' },
    total: { type: 'NUMBER' },
    confidence: { type: 'NUMBER' },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    }
  },
  required: ['supplier', 'invoice', 'lines']
}

const prompt = `Analiza esta factura de compra de un proveedor y devuelve solo JSON válido.
Extrae:
- Nombre y NIT del proveedor.
- Número y fecha de la factura en formato YYYY-MM-DD.
- Cada línea: descripción, cantidad, costo unitario antes de IVA, porcentaje de IVA y confianza entre 0 y 1.
- Subtotal, descuento global, IVA total y total real de la factura.
- Advertencias si algún dato no es legible o las matemáticas no coinciden.
No inventes valores. Si un dato no aparece, usa cadena vacía, 0 o una advertencia.
Los valores monetarios deben estar en la moneda de la factura, normalmente COP.
No incluyas markdown ni texto fuera del JSON.`

export async function scanInvoice({
  apiKey,
  model,
  mimeType,
  dataBase64
}: {
  apiKey: string
  model: string
  mimeType: string
  dataBase64: string
}): Promise<InvoiceExtraction> {
  const output = await callGemini({
    apiKey,
    model,
    body: {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: dataBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: invoiceSchema,
        maxOutputTokens: 8192
      }
    },
    timeoutMs: 90000
  })
  const cleaned = output
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new RpcError('La IA devolvió un JSON inválido. Intenta con una imagen más clara.', 'AI_INVALID_JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new RpcError('La IA no devolvió una factura válida.', 'AI_INVALID_JSON')
  }
  return parsed as InvoiceExtraction
}
