import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_LEGAL } from './defaults'
import { sha256, newId } from './security'
import { SCHEMA_V1 } from './schema'
import { ensureDictionaries, ensureReferenceData } from './seed'
import { ALL_CAPABILITIES, capabilitiesForRole } from './permissions'

export const APP_DATA_FOLDER = 'BitacoreTech'
export const LEGACY_APP_DATA_FOLDER = 'octestr-taller'
export const DATABASE_FILENAME = 'bitacoretech.db'
export const BACKUP_DATABASE_FILENAME = 'database.db'
export const LEGACY_DATABASE_FILENAME = 'octestr.db'
export const EVIDENCE_FOLDER = 'evidence'
export const BACKUP_FOLDER = 'backups'

export interface SessionIdentity {
  userId: string
  userName: string
  role: string
  actualRole: string
}

export interface AuditInput {
  userId?: string | null
  userName: string
  role: string
  action: string
  entity: string
  entityId?: string | null
  detail: string
  createdAt?: string
}

type Bound = string | number | null
type Row = Record<string, unknown>

export class Database {
  readonly path: string
  private db: DatabaseSync
  private txDepth = 0

  constructor(path: string) {
    this.path = path
    this.db = new DatabaseSync(path)
    this.configure()
    this.migrate()
    ensureReferenceData(this)
    ensureDictionaries(this)
  }

  private configure() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
    `)
  }

  private migrate() {
    this.db.exec(SCHEMA_V1)
    this.ensureColumn('backups', 'format', "TEXT NOT NULL DEFAULT 'db'")
    this.ensureColumn('work_order_evidence', 'source', "TEXT NOT NULL DEFAULT 'archivo'")
    this.ensureColumn('users', 'document_type', 'TEXT')
    this.ensureColumn('users', 'document', 'TEXT')
    this.ensureColumn('users', 'phone', 'TEXT')
    this.ensureColumn('users', 'address', 'TEXT')
    this.ensureColumn('users', 'photo_path', 'TEXT')
    this.ensureColumn('users', 'photo_thumb_path', 'TEXT')
    this.ensureColumn('customers', 'is_foreign_document', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('customers', 'loyalty_active', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('customers', 'loyalty_discount_type', "TEXT NOT NULL DEFAULT 'percent'")
    this.ensureColumn('customers', 'loyalty_discount_value', 'REAL NOT NULL DEFAULT 0')
    this.ensureColumn('customers', 'loyalty_valid_until', 'TEXT')
    this.ensureColumn('customers', 'loyalty_notes', 'TEXT')
    this.ensureColumn('suppliers', 'is_foreign_nit', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('work_orders', 'equipment_id', 'TEXT REFERENCES equipment(id)')
    this.ensureColumn('invoices', 'discount_type', "TEXT NOT NULL DEFAULT 'percent'")
    this.ensureColumn('invoices', 'discount_value', 'REAL NOT NULL DEFAULT 0')
    this.ensureColumn('products', 'service_type', 'TEXT')
    this.ensureColumn('products', 'alert_enabled', 'INTEGER NOT NULL DEFAULT 1')
    this.ensureColumn('products', 'rotation', "TEXT NOT NULL DEFAULT 'rotativo'")
    this.ensureColumn('invoice_items', 'note', 'TEXT')
    this.ensureRolePermissions()
    this.backfillEquipment()
    const now = new Date().toISOString()
    for (const version of [1, 2, 3, 4, 5, 6, 7]) {
      this.run('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, now)
    }
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.all<{ name: string }>(`PRAGMA table_info(${table})`)
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  private ensureRolePermissions() {
    const now = new Date().toISOString()
    for (const role of ['superadmin', 'admin', 'tecnico', 'cajero'] as const) {
      const granted = new Set(capabilitiesForRole(role))
      for (const capability of ALL_CAPABILITIES) {
        this.run(
          'INSERT OR IGNORE INTO role_permissions (role, capability, allowed, updated_at) VALUES (?, ?, ?, ?)',
          role,
          capability,
          granted.has(capability) ? 1 : 0,
          now
        )
      }
    }
    this.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('role_permissions_seeded', '1')")
  }

  private backfillEquipment() {    const done = this.get<{ value: string }>("SELECT value FROM meta WHERE key = 'equipment_backfill'")
    if (done?.value === '1') return
    const orders = this.all<any>(
      'SELECT * FROM work_orders WHERE equipment_id IS NULL ORDER BY created_at ASC'
    )
    let created = 0
    for (const order of orders) {
      const existing = this.get<any>(
        `SELECT id FROM equipment
         WHERE customer_id = ? AND serial = ? COLLATE NOCASE AND brand = ? COLLATE NOCASE AND model = ? COLLATE NOCASE
         LIMIT 1`,
        order.customer_id,
        order.serial,
        order.brand,
        order.model
      )
      let equipmentId = existing?.id as string | undefined
      if (!equipmentId) {
        equipmentId = `eq_legacy_${sha256(`${order.customer_id}|${order.serial}|${order.brand}|${order.model}`).slice(0, 20)}`
        let technicalSheet: string | null = null
        try {
          const intake = order.intake_json ? JSON.parse(order.intake_json) : null
          if (intake?.technicalSheet && typeof intake.technicalSheet === 'object') {
            technicalSheet = JSON.stringify(intake.technicalSheet)
          }
        } catch {
          technicalSheet = null
        }
        this.run(
          `INSERT OR IGNORE INTO equipment
            (id, customer_id, category, category_label, equipment_type, brand, model, serial, accessories,
             technical_sheet_json, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          equipmentId,
          order.customer_id,
          order.device_category,
          order.category_label,
          order.equipment_type,
          order.brand,
          order.model,
          order.serial,
          order.accessories,
          technicalSheet,
          order.created_at,
          order.updated_at
        )
        created += 1
      }
      this.run('UPDATE work_orders SET equipment_id = ? WHERE id = ?', equipmentId, order.id)
    }
    if (created > 0) {
      this.appendAudit({
        userName: 'Sistema',
        role: 'Sistema',
        action: 'Migración de equipos',
        entity: 'Sistema',
        detail: `${created} equipos creados a partir de OT históricas y vinculados a su cliente.`
      })
    }
    this.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('equipment_backfill', '1')")
  }

  raw() {
    return this.db
  }

  close() {
    this.db.close()
  }

  reopen() {
    this.db = new DatabaseSync(this.path)
    this.configure()
    this.migrate()
    ensureReferenceData(this)
    ensureDictionaries(this)
  }

  get<T = Row>(sql: string, ...params: Bound[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  all<T = Row>(sql: string, ...params: Bound[]): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  run(sql: string, ...params: Bound[]) {
    return this.db.prepare(sql).run(...params)
  }

  exec(sql: string) {
    this.db.exec(sql)
  }

  count(table: string, where = '', ...params: Bound[]) {
    const allowed = new Set([
      'users',
      'customers',
      'products',
      'suppliers',
      'purchases',
      'work_orders',
      'invoices',
      'payments',
      'cash_sessions',
      'cash_movements',
      'audit_log',
      'backups',
      'work_order_evidence'
    ])
    if (!allowed.has(table)) throw new Error('Tabla no permitida')
    const row = this.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table} ${where}`, ...params)
    return Number(row?.count ?? 0)
  }

  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.txDepth += 1
    try {
      const result = fn()
      this.db.exec('COMMIT')
      this.txDepth -= 1
      return result
    } catch (error) {
      this.txDepth -= 1
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // La transacción pudo haber sido revertida por SQLite.
      }
      throw error
    }
  }

  appendAudit(input: AuditInput) {
    const createdAt = input.createdAt ?? new Date().toISOString()
    const prev = this.get<{ hash: string }>('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1')?.hash ?? 'GENESIS'
    const id = newId('aud')
    const payload = [
      id,
      createdAt,
      input.userId ?? '',
      input.userName,
      input.role,
      input.action,
      input.entity,
      input.entityId ?? '',
      input.detail,
      prev
    ].join('|')
    const hash = sha256(payload)
    this.run(
      `INSERT INTO audit_log
        (id, created_at, user_id, user_name, role, action, entity, entity_id, detail, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      createdAt,
      input.userId ?? null,
      input.userName,
      input.role,
      input.action,
      input.entity,
      input.entityId ?? null,
      input.detail,
      prev,
      hash
    )
    return { id, hash, prevHash: prev, createdAt }
  }

  verifyAuditChain() {
    const rows = this.all<{
      id: string
      created_at: string
      user_id: string | null
      user_name: string
      role: string
      action: string
      entity: string
      entity_id: string | null
      detail: string
      prev_hash: string
      hash: string
    }>('SELECT * FROM audit_log ORDER BY seq ASC')
    let previous = 'GENESIS'
    for (const row of rows) {
      const payload = [
        row.id,
        row.created_at,
        row.user_id ?? '',
        row.user_name,
        row.role,
        row.action,
        row.entity,
        row.entity_id ?? '',
        row.detail,
        previous
      ].join('|')
      const expected = sha256(payload)
      if (row.prev_hash !== previous || row.hash !== expected) {
        return { valid: false, brokenAt: row.id, checked: rows.length }
      }
      previous = row.hash
    }
    return { valid: true, brokenAt: null as string | null, checked: rows.length }
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', key)
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  }

  setSetting(key: string, value: unknown) {
    const encoded = JSON.stringify(value)
    const now = new Date().toISOString()
    this.run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      encoded,
      now
    )
  }

  nextSequence(key: string, start: number) {
    const row = this.get<{ value: number }>('SELECT value FROM sequences WHERE key = ?', key)
    const next = row ? Number(row.value) + 1 : start
    if (row) {
      this.run('UPDATE sequences SET value = ? WHERE key = ?', next, key)
    } else {
      this.run('INSERT INTO sequences (key, value) VALUES (?, ?)', key, next)
    }
    return next
  }

  invoiceNumber() {
    return `FV-${String(this.nextSequence('invoice', 185)).padStart(6, '0')}`
  }

  orderNumber() {
    return `OT-${String(this.nextSequence('order', 2342)).padStart(6, '0')}`
  }

  paymentNumber() {
    return `AB-${String(this.nextSequence('payment', 1)).padStart(6, '0')}`
  }
}

let database: Database | null = null

export function getDatabasePath(userDataPath: string) {
  const override = process.env.BITACORETECH_DB_PATH || process.env.OCTESTR_DB_PATH
  if (override) return override
  return path.join(userDataPath, DATABASE_FILENAME)
}

export function getEvidencePath(userDataPath: string) {
  return path.join(userDataPath, EVIDENCE_FOLDER)
}

export function getBackupPath(userDataPath: string) {
  return path.join(userDataPath, BACKUP_FOLDER)
}

function sameFactoryLegal(legal: any) {
  return (
    legal &&
    legal.businessName === 'OCTESTR Taller & POS' &&
    legal.email === 'hola@octestr.co' &&
    legal.nit === DEFAULT_LEGAL.nit
  )
}

const seedEmailMigration: Record<string, string> = {
  'propietario@octestr.co': 'propietario@bitacoretech.co',
  'andrea@octestr.co': 'andrea@bitacoretech.co',
  'camila@octestr.co': 'camila@bitacoretech.co',
  'julian@octestr.co': 'julian@bitacoretech.co',
  'santiago@octestr.co': 'santiago@bitacoretech.co'
}

/**
 * Migración única desde la carpeta de datos de OCTESTR.
 *
 * Genera la base nueva con VACUUM INTO en un archivo temporal, copia respaldos
 * y evidencias, corrige las rutas y solo al final renombra la base definitiva.
 * Si algo falla, la base nueva no aparece y la app se detiene con un error
 * visible en lugar de arrancar con información vacía.
 */
export function migrateLegacyData(newUserDataPath: string, legacyUserDataPath: string) {
  const newDatabasePath = path.join(newUserDataPath, DATABASE_FILENAME)
  const legacyDatabasePath = path.join(legacyUserDataPath, LEGACY_DATABASE_FILENAME)
  if (fs.existsSync(newDatabasePath) || !fs.existsSync(legacyDatabasePath)) {
    return { migrated: false, from: null as string | null, evidenceFiles: 0 }
  }

  fs.mkdirSync(newUserDataPath, { recursive: true })
  const tempPath = path.join(newUserDataPath, `.migration-${Date.now()}.db`)
  const tempWal = `${tempPath}-wal`
  const tempShm = `${tempPath}-shm`
  try {
    for (const candidate of [tempPath, tempWal, tempShm]) {
      if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true })
    }
    const source = new DatabaseSync(legacyDatabasePath)
    try {
      source.exec('PRAGMA busy_timeout = 5000')
      source.exec(`VACUUM INTO '${tempPath.replace(/'/g, "''")}'`)
    } finally {
      source.close()
    }

    const legacyBackups = path.join(legacyUserDataPath, BACKUP_FOLDER)
    const newBackups = path.join(newUserDataPath, BACKUP_FOLDER)
    if (fs.existsSync(legacyBackups)) {
      fs.mkdirSync(newBackups, { recursive: true })
      fs.cpSync(legacyBackups, newBackups, { recursive: true, force: true })
    }

    const legacyEvidence = path.join(legacyUserDataPath, EVIDENCE_FOLDER)
    const newEvidence = path.join(newUserDataPath, EVIDENCE_FOLDER)
    let evidenceFiles = 0
    if (fs.existsSync(legacyEvidence)) {
      fs.cpSync(legacyEvidence, newEvidence, { recursive: true, force: true })
      evidenceFiles = countFiles(newEvidence)
    }

    const migrated = new Database(tempPath)
    try {
      const legal = migrated.getSetting<any>('legal_config', null)
      if (sameFactoryLegal(legal)) {
        migrated.setSetting('legal_config', {
          ...legal,
          businessName: DEFAULT_LEGAL.businessName,
          email: DEFAULT_LEGAL.email
        })
      }

      migrated.run(
        "UPDATE users SET name = 'Propietario BitacoreTech' WHERE username = 'superadmin' AND name = 'Propietario OCTESTR'"
      )
      for (const [oldEmail, newEmail] of Object.entries(seedEmailMigration)) {
        migrated.run('UPDATE users SET email = ? WHERE email = ?', newEmail, oldEmail)
      }

      for (const row of migrated.all<{ id: string; filename: string }>('SELECT id, filename FROM backups')) {
        const target = path.join(newBackups, row.filename)
        if (fs.existsSync(target)) {
          migrated.run('UPDATE backups SET path = ? WHERE id = ?', target, row.id)
        }
      }

      migrated.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('brand_migrated', '1')")
      migrated.appendAudit({
        userName: 'Sistema',
        role: 'Sistema',
        action: 'Migración de datos',
        entity: 'Sistema',
        detail: `Base, respaldos y ${evidenceFiles} archivos de evidencia migrados desde ${legacyUserDataPath}.`
      })
      migrated.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } finally {
      migrated.close()
    }

    if (fs.existsSync(tempWal)) fs.rmSync(tempWal, { force: true })
    if (fs.existsSync(tempShm)) fs.rmSync(tempShm, { force: true })
    fs.renameSync(tempPath, newDatabasePath)
    return { migrated: true, from: legacyUserDataPath, evidenceFiles }
  } catch (error) {
    for (const candidate of [tempPath, tempWal, tempShm]) {
      try {
        if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true })
      } catch {
        // La limpieza no debe ocultar el error original.
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `No fue posible migrar los datos de OCTESTR a BitacoreTech. La carpeta anterior se conserva intacta. ${message}`
    )
  }
}

function countFiles(directory: string) {
  let total = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(path.join(directory, entry.name))
    else if (entry.isFile()) total += 1
  }
  return total
}

export function openDatabase(userDataPath: string) {
  if (!database) database = new Database(getDatabasePath(userDataPath))
  return database
}

export function db() {
  if (!database) throw new Error('La base de datos no está inicializada')
  return database
}

export function closeDatabase() {
  if (database) {
    try {
      database.run('DELETE FROM sessions')
    } catch {
      // La limpieza de sesiones no debe impedir el cierre.
    }
    database.close()
    database = null
  }
}

export function reopenDatabase() {
  if (database) {
    database.reopen()
  }
}
