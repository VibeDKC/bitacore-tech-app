# Contrato técnico F0 — BitacoreTech 1.3.0

| Dato | Valor |
| --- | --- |
| Versión del contrato | 1.0 |
| Fecha | 2026-10-26 |
| Baseline | 1.1.0 · commit `38159be` |
| Alcance | F0 (contrato) y F1 (esqueleto/primer arranque) |
| Estado | Aprobado técnicamente. Pendiente firma del usuario. |

> Las reglas de T3 (permisos por usuario, fidelidad, equipos, NIT, respaldos y borde) están en `docs/plan/02-contrato-t3.md`.

## 1. Reglas generales

### Dinero
- Todo valor monetario se guarda en **centavos enteros** (`*_cents`). No se usan flotantes para saldos.
- La moneda es **COP** y el locale `es-CO`.
- El redondeo es al centavo más cercano (`Math.round`).
- Las ventas **no llevan IVA**. Las compras a proveedores llevan **IVA 19 %** separado.
- Los descuentos se restan del subtotal y nunca pueden producir un total negativo.
- La utilidad bruta es ingreso menos costo de repuestos. La utilidad neta es utilidad bruta menos egresos de caja.

### Fechas
- La base guarda fechas en ISO 8601 UTC.
- La interfaz muestra `America/Bogota`.
- Las fechas de compra y promesa se guardan como fecha local del negocio.

### Identificadores
- Prefijos por entidad: `u`, `cus`, `sup`, `prod`, `wo`, `inv`, `pay`, `pur`, `asg`, `evt`, `aud`, `bk`.
- Los identificadores son inmutables; no se reutilizan.

## 2. Diccionario de datos

| Tabla | Propósito | Campos clave |
| --- | --- | --- |
| `users` | Personal y propietario | `username`, `role`, `password_hash`, `active`, `is_protected` |
| `sessions` | Tokens activos | `token_hash`, `user_id`, `effective_role`, `expires_at` |
| `customers` | Clientes | `document_type`, `document`, `phone`, `email`, `address`, `is_final_consumer` |
| `suppliers` | Proveedores | `name`, `nit`, `contact`, `phone`, `category`, `active` |
| `products` | Inventario y servicios | `sku`, `barcode`, `category`, `stock`, `min_stock`, `cost_cents`, `price_cents`, `is_service` |
| `stock_movements` | Kardex append-only | `type`, `quantity`, `unit_cost_cents`, `reference_type`, `reference_id` |
| `purchases` | Compras | `supplier_id`, `purchase_date`, `subtotal_cents`, `iva_cents`, `total_cents`, `status` |
| `purchase_items` | Detalle de compra | `product_id`, `description`, `quantity`, `unit_price_cents` |
| `work_orders` | Órdenes de trabajo | `number`, `customer_id`, `status`, `technician_id`, `intake_json`, `promised_at` |
| `work_order_items` | Servicios y repuestos | `type`, `description`, `quantity`, `unit_price_cents`, `unit_cost_cents` |
| `work_order_events` | Timeline de la OT | `status`, `title`, `description`, `user_name`, `state` |
| `work_order_assignments` | Trazabilidad de técnico | `from_user_id`, `to_user_id`, `reason`, `assigned_by`, `created_at` |
| `work_order_evidence` | Evidencias fotográficas | `filename`, `path`, `sha256`, `stage`, `status` |
| `payments` | Libro de pagos | `kind`, `method`, `amount_cents`, `order_id`, `invoice_id` |
| `invoices` | Facturas internas | `number`, `type`, `subtotal_cents`, `discount_percent`, `total_cents`, `status` |
| `invoice_items` | Detalle de factura | `description`, `quantity`, `unit_price_cents`, `line_total_cents` |
| `cash_sessions` | Turnos de caja | `opened_at`, `initial_cents`, `expected_cents`, `counted_cents`, `status` |
| `cash_movements` | Movimientos de caja | `type`, `method`, `amount_cents`, `reference_type` |
| `audit_log` | Auditoría encadenada | `seq`, `action`, `entity`, `detail`, `prev_hash`, `hash` |
| `legal_versions` | Versiones legales | `version`, `config_json`, `created_by` |
| `backups` | Respaldos | `filename`, `path`, `sha256`, `format`, `created_at` |
| `app_settings` | Configuración | `key`, `value`, `updated_at` |

## 3. Usuarios, roles y permisos

| Rol | Alcance |
| --- | --- |
| `superadmin` (Propietario) | Acceso total, auditoría, respaldos, purga, configuración maestra. Invisible para los demás roles. |
| `admin` | Operación completa, costos, margen bruto, personal base y configuración. Sin auditoría, utilidad neta, restauración ni purga. |
| `tecnico` | Recepción, diagnóstico, órdenes, evidencias e inventario sin costos. |
| `cajero` | POS, caja, inventario sin costos y clientes. Sin evidencias. |

Reglas:
- La cuenta raíz (`superadmin`) no se crea, restaura, purga ni administra desde la UI de otro rol.
- Los permisos se validan en el proceso principal. La UI solo oculta acciones.
- La matriz es por rol. La configuración granular por rol queda para F5 (Tramo 3).
- `assignTechnician` es exclusivo de propietario y administrador.
- La auditoría es exclusiva del propietario.

## 4. Máquina de estados de la OT

Estados:
`recibido → diagnostico → aprobacion → reparacion → pruebas → listo → entregado`

Reglas:
- Solo se avanza en la secuencia; no se retrocede.
- `entregado` se registra exclusivamente desde **Cobrar y entregar**; no por cambio manual de estado.
- La entrega exige pago total o una excepción autorizada por el propietario con motivo auditado.
- `no_reparado` es un cierre alternativo con motivo obligatorio.
- Una OT `entregado` o `no_reparado` no admite nuevos ítems, pagos ni reasignación de técnico.
- La asignación inicial y cada reasignación quedan en `work_order_assignments`, en el timeline y en la auditoría.

## 5. NIT y dígito de verificación

Regla pendiente de implementación en F5 (Tramo 3):
- El NIT se almacena solo con dígitos, sin puntos ni espacios.
- Se permiten hasta 15 dígitos.
- El DV se calcula con los pesos DIAN `3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71`, de derecha a izquierda.
- `suma % 11`: si el resto es 0 o 1, el DV es el resto; en otro caso, `11 − resto`.
- La UI muestra el NIT y el DV por separado; al imprimir se usa `NIT 901245678-3`.
- El NIT de fábrica actual (`901.245.678-9`) no cumple el DV; se corregirá al implementar la regla.

## 6. Fidelidad y descuentos

Reglas para F4 (Tramo 3):
- Un cliente puede marcarse como **designado** para fidelidad.
- El beneficio puede ser porcentaje, monto fijo o precio especial, con vigencia.
- El descuento se aplica en POS y en la liquidación de la OT.
- **Piso:** el precio final no puede quedar por debajo del costo de compra vigente del producto. Si el descuento cruza el piso, se bloquea o requiere autorización del propietario con motivo.
- El descuento manual se puede ingresar como porcentaje o como valor; nunca produce total negativo.
- Todo descuento queda auditado.

## 7. Respaldos

- Un respaldo completo es una carpeta con `database.db`, `evidence/` y `manifest.json`.
- El manifiesto incluye versión de app, conteos, hashes SHA-256 de la base y de cada evidencia.
- La restauración crea un respaldo de seguridad antes de reemplazar datos.
- La importación/exportación cifrada con contraseña queda para F5 (Tramo 3).
- Los respaldos legados `.db` se pueden restaurar, pero solo recuperan la base.
- La purga crea un respaldo completo antes de borrar datos operativos y conserva los respaldos.

## 8. Primer arranque

- Una base nueva **no crea usuarios ni credenciales por defecto**.
- Al abrir por primera vez se muestra la pantalla **Configura tu taller**.
- El propietario se crea con nombre, usuario, contraseña y nombre del negocio.
- La contraseña debe tener al menos 8 caracteres.
- El modo demostración es opcional y explícito. Las cuentas demo reciben contraseñas aleatorias; no se publican credenciales conocidas.
- La configuración inicial crea auditoría, versión legal y un respaldo completo.
- Las bases existentes con usuarios no pasan por el asistente y conservan sus datos.

## 9. Sesión y seguridad

- La sesión base usa `sessionHours` (1–24 h recomendado).
- El token del primer arranque se guarda en `sessionStorage`.
- La eliminación del checkbox “Mantener sesión” y el cierre de sesión al cerrar la app quedan para F5 (Tramo 3).
- Los intentos fallidos se bloquean temporalmente tras 5 fallos.
- Las contraseñas se guardan con scrypt y salt.
- Los secretos de IA no se guardan en texto plano; la implementación queda para F6.

## 10. Equipos

- En este corte el equipo vive dentro de la OT: tipo, marca, modelo, serial, accesorios, condición, bloqueo y ficha técnica.
- No se crea un catálogo independiente de equipos. Se puede evaluar en una fase posterior si el negocio necesita historial por serial.

## 11. Fuera de alcance de F0/F1

- Facturación electrónica DIAN.
- QR, firma digital y tracking público.
- Multi-sucursal o multiusuario en red.
- Catálogo web y sincronización en la nube.
- IA real (diagnóstico, resumen, anomalías, facturas).
- Promociones, fidelidad, CxP y exportación/importación cifrada (Tramos 3–4).

## 12. Criterios de aceptación F0/F1

1. Instalación limpia sin usuarios ni credenciales por defecto.
2. Asistente de primer arranque crea el propietario y el negocio.
3. Login posterior con la cuenta creada.
4. Cerrar y reabrir exige login.
5. Auditoría de configuración inicial y de inicio de sesión.
6. Respaldo inicial creado.
7. Dashboard vacío sin errores.
8. No se puede repetir la configuración inicial.
9. Los contadores del menú reflejan datos reales.
10. El modo demo, si se elige, no expone credenciales conocidas.
