/**
 * Esquema SQLite de BitacoreTech.
 *
 * Reglas de dinero: todas las columnas *_cents guardan pesos colombianos en
 * centavos (enteros). La API convierte a pesos para el renderer.
 * Reglas de auditoría: audit_log, stock_movements, cash_movements y payments
 * son libros append-only protegidos por triggers.
 */
export const SCHEMA_V1 = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  email TEXT,
  document_type TEXT,
  document TEXT,
  phone TEXT,
  address TEXT,
  photo_path TEXT,
  photo_thumb_path TEXT,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'tecnico', 'cajero')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  is_protected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  granted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, capability)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  capability TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (role, capability)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_role TEXT NOT NULL CHECK (effective_role IN ('superadmin', 'admin', 'tecnico', 'cajero')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'CC' CHECK (document_type IN ('CC', 'NIT', 'Pasaporte')),
  document TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '—',
  email TEXT NOT NULL DEFAULT '—',
  address TEXT NOT NULL DEFAULT 'Sin dirección',
  is_final_consumer INTEGER NOT NULL DEFAULT 0,
  is_foreign_document INTEGER NOT NULL DEFAULT 0,
  loyalty_active INTEGER NOT NULL DEFAULT 0,
  loyalty_discount_type TEXT NOT NULL DEFAULT 'percent',
  loyalty_discount_value REAL NOT NULL DEFAULT 0,
  loyalty_valid_until TEXT,
  loyalty_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE (document)
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'otro',
  category_label TEXT NOT NULL DEFAULT 'Equipo',
  equipment_type TEXT NOT NULL DEFAULT 'Equipo',
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT 'Sin serial',
  accessories TEXT NOT NULL DEFAULT 'Sin accesorios',
  technical_sheet_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_customer ON equipment(customer_id);
CREATE INDEX IF NOT EXISTS idx_equipment_serial ON equipment(serial);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'Bodega A',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  warranty_days INTEGER NOT NULL DEFAULT 0,
  is_service INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_serials (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  serial TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disponible',
  created_at TEXT NOT NULL,
  UNIQUE (product_id, serial)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  user_id TEXT,
  user_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS stock_movements_no_update
BEFORE UPDATE ON stock_movements BEGIN
  SELECT RAISE(ABORT, 'stock_movements es append-only');
END;

CREATE TRIGGER IF NOT EXISTS stock_movements_no_delete
BEFORE DELETE ON stock_movements BEGIN
  SELECT RAISE(ABORT, 'stock_movements es append-only');
END;

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nit TEXT NOT NULL DEFAULT '—',
  is_foreign_nit INTEGER NOT NULL DEFAULT 0,
  contact TEXT NOT NULL DEFAULT '—',
  phone TEXT NOT NULL DEFAULT '—',
  category TEXT NOT NULL DEFAULT 'Repuestos',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchase_date TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 1,
  subtotal_cents INTEGER NOT NULL,
  iva_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('recibida', 'pendiente')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id TEXT,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  equipment_id TEXT REFERENCES equipment(id),
  device_category TEXT NOT NULL,
  category_label TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  serial TEXT NOT NULL,
  accessories TEXT NOT NULL DEFAULT 'Sin accesorios',
  physical_condition TEXT NOT NULL DEFAULT 'Sin observaciones',
  reported_issue TEXT NOT NULL,
  diagnosis TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  technician_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  promised_at TEXT NOT NULL,
  delivered_at TEXT,
  notes TEXT,
  intake_json TEXT,
  received_by TEXT,
  created_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_order_items (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('servicio', 'repuesto')),
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  product_id TEXT REFERENCES products(id),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_order_events (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'current',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_order_assignments (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  from_user_id TEXT,
  from_name TEXT,
  to_user_id TEXT NOT NULL,
  to_name TEXT NOT NULL,
  reason TEXT,
  assigned_by TEXT NOT NULL,
  assigned_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_order_assignments_order ON work_order_assignments(work_order_id);

CREATE TABLE IF NOT EXISTS work_order_evidence (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general',
  note TEXT,
  stage TEXT NOT NULL DEFAULT 'ingreso' CHECK (stage IN ('ingreso', 'reparacion')),
  status TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'anulada')),
  source TEXT NOT NULL DEFAULT 'archivo' CHECK (source IN ('archivo', 'camara')),
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  thumb_filename TEXT,
  thumb_path TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  thumb_size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  captured_by TEXT NOT NULL,
  captured_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  voided_by TEXT,
  voided_by_name TEXT,
  void_reason TEXT,
  verified_at TEXT,
  verified_by TEXT,
  verified_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_work_order_evidence_order ON work_order_evidence(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_evidence_status ON work_order_evidence(status);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('venta', 'ot')),
  customer_id TEXT REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  order_id TEXT REFERENCES work_orders(id),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value REAL NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'anulada')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  annulled_at TEXT,
  annulled_by TEXT,
  annul_reason TEXT
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id TEXT,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0,
  item_type TEXT NOT NULL DEFAULT 'producto'
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('anticipo', 'saldo', 'venta')),
  order_id TEXT REFERENCES work_orders(id),
  invoice_id TEXT REFERENCES invoices(id),
  method TEXT NOT NULL CHECK (method IN ('Efectivo', 'Transferencia', 'Tarjeta', 'Mixto')),
  amount_cents INTEGER NOT NULL,
  received_cents INTEGER,
  change_cents INTEGER NOT NULL DEFAULT 0,
  reference TEXT,
  is_exception INTEGER NOT NULL DEFAULT 0,
  exception_reason TEXT,
  created_by TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS payments_no_update
BEFORE UPDATE ON payments BEGIN
  SELECT RAISE(ABORT, 'payments es append-only');
END;

CREATE TRIGGER IF NOT EXISTS payments_no_delete
BEFORE DELETE ON payments BEGIN
  SELECT RAISE(ABORT, 'payments es append-only');
END;

CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  opened_by TEXT,
  opened_by_name TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  initial_cents INTEGER NOT NULL DEFAULT 0,
  closed_by TEXT,
  closed_by_name TEXT,
  closed_at TEXT,
  expected_cents INTEGER,
  counted_cents INTEGER,
  difference_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto', 'cerrado')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES cash_sessions(id),
  type TEXT NOT NULL CHECK (type IN ('ingreso', 'egreso', 'venta')),
  method TEXT NOT NULL CHECK (method IN ('Efectivo', 'Transferencia', 'Tarjeta', 'Mixto')),
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  user_id TEXT,
  user_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS cash_movements_no_update
BEFORE UPDATE ON cash_movements BEGIN
  SELECT RAISE(ABORT, 'cash_movements es append-only');
END;

CREATE TRIGGER IF NOT EXISTS cash_movements_no_delete
BEFORE DELETE ON cash_movements BEGIN
  SELECT RAISE(ABORT, 'cash_movements es append-only');
END;

CREATE TABLE IF NOT EXISTS legal_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log BEGIN
  SELECT RAISE(ABORT, 'audit_log es append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log BEGIN
  SELECT RAISE(ABORT, 'audit_log es append-only');
END;

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'db',
  created_by TEXT,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequences (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_status_config (
  status TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  short_label TEXT NOT NULL,
  description TEXT NOT NULL,
  tone TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_terminal INTEGER NOT NULL DEFAULT 0,
  requires_payment INTEGER NOT NULL DEFAULT 0,
  is_cancel INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON work_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_created ON work_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(session_id);
CREATE INDEX IF NOT EXISTS idx_customers_document ON customers(document);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
`
