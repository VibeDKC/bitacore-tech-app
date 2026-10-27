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

function geminiError(status: number, detail: string) {
  if (status === 400) {
    return new RpcError(`Gemini rechazó la solicitud: ${detail}`, 'AI_BAD_REQUEST')
  }
  if (status === 401 || status === 403) {
    return new RpcError('La clave de Gemini no es válida o no tiene permisos.', 'AI_AUTH')
  }
  if (status === 404) {
    return new RpcError('El modelo configurado no existe o no está disponible para esta clave.', 'AI_MODEL_NOT_FOUND')
  }
  if (status === 429) {
    return new RpcError('Se agotó la cuota de Gemini. Revisa el plan o espera unos minutos.', 'AI_QUOTA')
  }
  if (status >= 500) {
    return new RpcError('Gemini no está disponible en este momento. Intenta de nuevo.', 'AI_UNAVAILABLE')
  }
  return new RpcError(`Gemini respondió con error ${status}: ${detail}`, 'AI_ERROR')
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
      throw geminiError(response.status, String(detail))
    }
    if (!parsed) {
      throw new RpcError('Gemini devolvió una respuesta vacía o ilegible.', 'AI_INVALID_RESPONSE')
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
        'AI_EMPTY_RESPONSE'
      )
    }
    return output
  } catch (error) {
    if (error instanceof RpcError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RpcError('Gemini tardó demasiado en responder. Intenta de nuevo.', 'AI_TIMEOUT')
    }
    throw new RpcError(
      `No se pudo conectar con Gemini: ${error instanceof Error ? error.message : String(error)}`,
      'AI_NETWORK'
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
