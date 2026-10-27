import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, shell } from 'electron'
import type { Database } from './database'
import { DEFAULT_LEGAL, DEFAULT_SETTINGS } from './defaults'
import { DEFAULT_MESSAGES, renderMessageTemplate } from '@shared/index'

export type ReportMode = 'initial' | 'delivery'

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function money(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Math.round(value))
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function normalizePhone(raw: unknown) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length < 7) return null
  if (digits.startsWith('57') && digits.length > 10) return digits
  if (digits.length === 10) return `57${digits}`
  return digits
}

function technicalEntries(sheet: any): Array<[string, string]> {
  if (!sheet || typeof sheet !== 'object') return []
  const entries: Array<[string, string]> = []
  if (sheet.osNotVisible) entries.push(['Sistema operativo', 'N/A'])
  else if (sheet.os) entries.push(['Sistema operativo', String(sheet.os)])
  const cpu = [sheet.cpu?.brand, sheet.cpu?.family, sheet.cpu?.model].filter(Boolean).join(' ')
  if (sheet.cpu?.notVisible) entries.push(['CPU', 'N/A'])
  else if (cpu) entries.push(['CPU', cpu])
  const gpuKind =
    sheet.gpu?.type === 'none'
      ? 'Sin GPU'
      : sheet.gpu?.type === 'integrated'
        ? 'Integrada'
        : sheet.gpu?.type === 'dedicated'
          ? 'Dedicada'
          : ''
  const gpu = [gpuKind, sheet.gpu?.brand, sheet.gpu?.model, sheet.gpu?.vram].filter(Boolean).join(' ')
  if (sheet.gpu?.notVisible) entries.push(['GPU', 'N/A'])
  else if (gpu) entries.push(['GPU', gpu])
  const ram = (Array.isArray(sheet.ramModules) ? sheet.ramModules : [])
    .map((row: any) => [row.type, row.capacity, row.speed, row.brand, row.warranty].filter(Boolean).join(' '))
    .filter(Boolean)
  if (sheet.ramNotVisible) entries.push(['RAM', 'N/A'])
  else if (ram.length) entries.push(['RAM', ram.join(' · ')])
  const disks = (Array.isArray(sheet.storageDrives) ? sheet.storageDrives : [])
    .map((row: any) => [row.type, row.capacity, row.speed, row.model, row.health, row.warranty].filter(Boolean).join(' '))
    .filter(Boolean)
  if (sheet.storageNotVisible) entries.push(['Almacenamiento', 'N/A'])
  else if (disks.length) entries.push(['Almacenamiento', disks.join(' · ')])
  if (sheet.batteryNotVisible) entries.push(['Batería', 'N/A'])
  else if (sheet.battery) entries.push(['Batería', String(sheet.battery)])
  if (sheet.notes) entries.push(['Observaciones', String(sheet.notes)])
  if (sheet.legacy?.cpu) entries.push(['CPU · ficha anterior', String(sheet.legacy.cpu)])
  if (sheet.legacy?.gpu) entries.push(['GPU · ficha anterior', String(sheet.legacy.gpu)])
  if (sheet.legacy?.ram) entries.push(['RAM · ficha anterior', String(sheet.legacy.ram)])
  if (sheet.legacy?.storage) entries.push(['Almacenamiento · ficha anterior', String(sheet.legacy.storage)])
  return entries
}

function buildReportData(db: Database, row: any) {
  const intake = (() => {
    try {
      return row.intake_json ? JSON.parse(row.intake_json) : {}
    } catch {
      return {}
    }
  })()
  const customer = db.get<any>('SELECT * FROM customers WHERE id = ?', row.customer_id)
  const technicianName = row.technician_id
    ? db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', row.technician_id)?.name ?? 'Sin asignar'
    : 'Sin asignar'
  const items = db.all<any>('SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY created_at ASC, rowid ASC', row.id)
  const payments = db.all<any>('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC, rowid ASC', row.id)
  const invoice = db.get<any>('SELECT * FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', row.id)
  const status = db.get<{ label: string }>('SELECT label FROM order_status_config WHERE status = ?', row.status)
  const legal = db.getSetting<any>('legal_config', DEFAULT_LEGAL)
  const messages = db.getSetting<any>('messages_config', DEFAULT_SETTINGS.messages)
  const subtotalCents = items.reduce((sum, item) => sum + Number(item.unit_price_cents) * Number(item.quantity), 0)
  const totalCents = subtotalCents > 0 ? subtotalCents : Math.round(Number(intake.estimate ?? 0) * 100)
  const paidCents = payments.reduce((sum, payment) => sum + Number(payment.amount_cents), 0)
  const isNoChargeDelivery =
    row.status === 'entregado' && Boolean(invoice) && String(invoice?.notes ?? '').startsWith('Excepción:')
  const balanceCents = isNoChargeDelivery ? 0 : Math.max(totalCents - paidCents, 0)
  const equipment = intake.customBuild ? `Equipo armado · ${intake.alias ?? row.model}` : `${row.brand} ${row.model}`
  const values = {
    cliente: row.customer_name,
    equipo: row.equipment_type,
    marca: row.brand,
    modelo: row.model,
    serial: row.serial,
    ot: row.number,
    estado: status?.label ?? row.status,
    diagnostico: row.diagnosis || 'Pendiente de diagnóstico',
    presupuesto: money(Number(intake.estimate ?? totalCents / 100)),
    total: money(totalCents / 100),
    saldo: money(balanceCents / 100),
    taller: legal.businessName,
    telefono: legal.phone,
    fecha: new Date().toLocaleDateString('es-CO')
  }
  return {
    intake,
    customer,
    items,
    payments,
    invoice,
    legal,
    messages,
    values,
    equipment,
    technicianName,
    statusLabel: status?.label ?? row.status,
    totalCents,
    paidCents,
    balanceCents,
    technical: technicalEntries(intake.technicalSheet)
  }
}

function reportHtml(db: Database, row: any, mode: ReportMode, generatedBy: string) {
  const data = buildReportData(db, row)
  const isDelivery = mode === 'delivery'
  const title = isDelivery ? 'Reporte de entrega' : 'Reporte inicial de diagnóstico'
  const itemRows = data.items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.description)}</td><td class="right">${escapeHtml(item.quantity)}</td><td class="right">${money(Number(item.unit_price_cents) / 100)}</td><td class="right">${money((Number(item.unit_price_cents) * Number(item.quantity)) / 100)}</td></tr>`
    )
    .join('')
  const technicalRows = data.technical
    .map(
      ([label, value]) =>
        `<div class="field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    )
    .join('')
  const paymentRows = data.payments
    .map(
      (payment) =>
        `<tr><td>${escapeHtml(payment.method)}</td><td>${escapeHtml(payment.created_at ? formatDate(payment.created_at) : '—')}</td><td class="right">${money(Number(payment.amount_cents) / 100)}</td></tr>`
    )
    .join('')

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.4; }
    h1, h2, h3, p { margin: 0; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #111827; padding-bottom: 10px; }
    .brand { font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
    .muted { color: #6b7280; }
    .right { text-align: right; }
    .tag { display: inline-block; border: 1px solid #111827; padding: 3px 7px; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
    h2 { margin-top: 16px; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 18px; margin-top: 8px; }
    .field { display: flex; flex-direction: column; gap: 1px; padding: 3px 0; border-bottom: 1px dotted #e5e7eb; }
    .field span { color: #6b7280; font-size: 8px; text-transform: uppercase; letter-spacing: .06em; }
    .field strong { font-weight: 600; }
    .box { border: 1px solid #d1d5db; padding: 8px; margin-top: 8px; }
    .box p { margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 4px 3px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-size: 8px; text-transform: uppercase; letter-spacing: .05em; }
    .total { font-size: 12px; font-weight: 800; }
    .signatures { display: flex; gap: 30px; margin-top: 42px; }
    .signature { flex: 1; border-top: 1px solid #111827; padding-top: 4px; text-align: center; font-size: 8px; color: #4b5563; }
    .footer { margin-top: 20px; border-top: 1px solid #d1d5db; padding-top: 6px; font-size: 8px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <p class="brand">${escapeHtml(data.legal.businessName)}</p>
      <p class="muted">NIT ${escapeHtml(data.legal.nit)} · Tel. ${escapeHtml(data.legal.phone)}</p>
      <p class="muted">${escapeHtml(data.legal.address)} · ${escapeHtml(data.legal.city)}</p>
    </div>
    <div class="right">
      <p class="tag">${escapeHtml(title)}</p>
      <p style="font-size:18px;font-weight:800;margin-top:6px">${escapeHtml(row.number)}</p>
      <p class="muted">${formatDate(row.created_at)}</p>
    </div>
  </div>

  <h2>Cliente y equipo</h2>
  <div class="grid">
    <div class="field"><span>Cliente</span><strong>${escapeHtml(row.customer_name)}</strong></div>
    <div class="field"><span>Teléfono</span><strong>${escapeHtml(data.customer?.phone ?? '—')}</strong></div>
    <div class="field"><span>Equipo</span><strong>${escapeHtml(data.equipment)}</strong></div>
    <div class="field"><span>Serial / código</span><strong>${escapeHtml(row.serial)}</strong></div>
    <div class="field"><span>Estado</span><strong>${escapeHtml(data.statusLabel)}</strong></div>
    <div class="field"><span>Técnico</span><strong>${escapeHtml(data.technicianName)}</strong></div>
    <div class="field"><span>Accesorios</span><strong>${escapeHtml(row.accessories)}</strong></div>
    <div class="field"><span>Condición física</span><strong>${escapeHtml(row.physical_condition)}</strong></div>
  </div>

  <h2>Ficha técnica</h2>
  ${technicalRows ? `<div class="grid">${technicalRows}</div>` : '<p class="muted">No registrada.</p>'}

  <h2>${isDelivery ? 'Trabajo realizado' : 'Diagnóstico inicial'}</h2>
  <div class="box">
    <span class="muted">Falla reportada por el cliente</span>
    <p><strong>${escapeHtml(row.reported_issue)}</strong></p>
    <span class="muted">Diagnóstico del técnico</span>
    <p>${escapeHtml(row.diagnosis || 'Pendiente de diagnóstico')}</p>
    ${row.notes ? `<span class="muted">Observaciones</span><p>${escapeHtml(row.notes)}</p>` : ''}
  </div>

  ${
    isDelivery
      ? `<h2>Ítems y repuestos</h2>
         <table><thead><tr><th>Descripción</th><th class="right">Cant.</th><th class="right">Valor unit.</th><th class="right">Total</th></tr></thead>
         <tbody>${itemRows || '<tr><td colspan="4" class="muted">Sin ítems registrados.</td></tr>'}</tbody></table>
         <h2>Pagos</h2>
         <table><thead><tr><th>Método</th><th>Fecha</th><th class="right">Valor</th></tr></thead>
         <tbody>${paymentRows || '<tr><td colspan="3" class="muted">Sin pagos registrados.</td></tr>'}</tbody></table>
         <div class="box">
           <div class="field"><span>Total</span><strong class="total">${money(data.totalCents / 100)}</strong></div>
           <div class="field"><span>Pagado</span><strong>${money(data.paidCents / 100)}</strong></div>
           <div class="field"><span>Saldo</span><strong>${money(data.balanceCents / 100)}</strong></div>
           <div class="field"><span>Garantía</span><strong>${escapeHtml(data.intake?.legal?.warrantyDays ?? data.legal.warrantyDays)} días</strong></div>
         </div>`
      : `<h2>Cotización inicial</h2>
         <div class="box">
           <div class="field"><span>Presupuesto estimado</span><strong class="total">${money(Number(data.intake?.estimate ?? 0))}</strong></div>
           <div class="field"><span>Revisión / diagnóstico</span><strong>${money(Number(data.intake?.diagnosticFee ?? 0))}</strong></div>
           <p class="muted">El presupuesto es informativo. El cobro se realiza al entregar el equipo.</p>
         </div>`
  }

  <div class="signatures">
    <div class="signature">Firma del cliente</div>
    <div class="signature">Recibió en el taller</div>
  </div>
  <div class="footer">
    Generado por ${escapeHtml(generatedBy)} · ${formatDate(new Date().toISOString())}. Documento interno sin valor fiscal DIAN. No incluye credenciales del equipo.
  </div>
</body>
</html>`
}

export async function generateDiagnosticReport({
  db,
  userDataPath,
  order,
  mode,
  generatedBy
}: {
  db: Database
  userDataPath: string
  order: any
  mode: ReportMode
  generatedBy: string
}) {
  const data = buildReportData(db, order)
  const html = reportHtml(db, order, mode, generatedBy)
  const reportsPath = path.join(userDataPath, 'reports')
  fs.mkdirSync(reportsPath, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safeNumber = String(order.number).replace(/[^A-Za-z0-9_-]/g, '_')
  const filePath = path.join(reportsPath, `${safeNumber}-${mode}-${stamp}.pdf`)
  const reportWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true }
  })
  try {
    await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await reportWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    })
    fs.writeFileSync(filePath, pdf)
  } finally {
    reportWindow.destroy()
  }

  const externalEnabled = process.env.BITACORETECH_DISABLE_EXTERNAL !== '1'
  if (externalEnabled) shell.showItemInFolder(filePath)
  const phone = normalizePhone(data.customer?.phone)
  const template = mode === 'delivery' ? data.messages.ready : data.messages.initial
  const message = renderMessageTemplate(template || (mode === 'delivery' ? DEFAULT_MESSAGES.ready : DEFAULT_MESSAGES.initial), data.values)
  const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null
  let whatsappOpened = false
  if (whatsappUrl && externalEnabled) {
    try {
      await shell.openExternal(whatsappUrl)
      whatsappOpened = true
    } catch {
      whatsappOpened = false
    }
  }
  return {
    path: filePath,
    fileName: path.basename(filePath),
    whatsappUrl,
    whatsappOpened,
    phoneFound: Boolean(phone),
    message
  }
}
