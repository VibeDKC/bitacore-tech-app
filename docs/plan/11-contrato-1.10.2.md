# Contrato 1.10.2 — SKU, proveedor, seriales y crédito

Fecha: 27 de octubre de 2026

## Alcance

Integra en BitacoreTech las funciones que faltaban del flujo de facturas con IA auditado en MTO APP, adaptadas a la arquitectura Electron/React/SQLite.

No se modifica el soporte existente de PDF ni se reemplaza la revisión atómica por un carrito separado.

## Decisiones

- El costo del inventario se mantiene antes de IVA.
- La revisión muestra el margen calculado con IVA.
- El SKU interno es propio de BitacoreTech; el SKU de proveedor es opcional.
- Los seriales se guardan como texto, sin tabla individual nueva.
- Las compras pueden ser de contado o a crédito.
- El crédito se registra con saldo, vencimiento opcional y abonos.
- El efectivo requiere un turno de caja abierto.
- La recepción y el pago son estados separados.

## SKU

- Generador `[TIPO]-[MARCA]-[MODELO]` en `electron/main/sku.ts`.
- El SKU de Gemini se normaliza y valida.
- Si es inválido, vacío o igual al código del proveedor, se genera localmente.
- Si existe una colisión, se agrega un sufijo numérico.
- El SKU de un producto existente nunca se reemplaza.
- El SKU se conserva en productos nuevos y en la línea de compra.

## SKU de proveedor

- Campo `products.supplier_sku`.
- Campo `purchase_items.supplier_sku`.
- Se extrae del proveedor cuando aparece en la factura.
- Se usa para buscar coincidencias antes del nombre.
- Se muestra en inventario, revisión, detalle y comprobante.
- Si un producto existente no tenía SKU de proveedor, se completa con el de la compra.

## Higiene de nombres

- Extracción de seriales desde `SERIAL:`, `S/N:`, `SERIE:`.
- Eliminación de frases SEO y de marketing.
- Normalización de `Type-C`, `3.5mm`, `con Mic` y `sin Mic`.
- Conservación de modelo, capacidad, versión USB, DDR/NVMe y color.
- Los seriales quedan en `purchase_items.serial_text`.

## Costos, IVA y margen

- `unit_price_cents` sigue siendo el costo antes de IVA.
- `iva_cents` sigue siendo el IVA de la línea.
- El costo con IVA se calcula para la revisión y el margen.
- El margen se muestra como `(precio venta - costo con IVA) / precio venta`.
- La alerta de costo >10 % conserva la comparación antes de IVA.

## Crédito con proveedores

Campos nuevos en compras:

- `payment_status`: pagada, pendiente o parcial.
- `payment_method`.
- `paid_cents`.
- `balance_cents`.
- `due_date`.

Tabla nueva:

- `supplier_payments`: abonos con monto, medio, fecha, notas y usuario.

Flujo:

- Contado: pagado = total, saldo = 0.
- Crédito: abono inicial opcional; saldo = total - abono.
- Abonos posteriores desde el detalle de compra.
- El efectivo exige caja abierta y genera egreso.
- La compra no cambia su estado de recepción por pagar a crédito.
- El indicador “Pendiente por pagar” usa el saldo real.

## Migración 11

- `products.supplier_sku`.
- `purchase_items.supplier_sku`.
- `purchase_items.serial_text`.
- `purchases.payment_status`.
- `purchases.payment_method`.
- `purchases.paid_cents`.
- `purchases.balance_cents`.
- `purchases.due_date`.
- Tabla `supplier_payments`.
- Backfill: compras existentes quedan pagadas o pendientes según su estado anterior.
- Se crean abonos migrados para compras con valor pagado.
- La suma de abonos coincide con `paid_cents`.
- `paid_cents + balance_cents = total_cents`.

## Interfaz

- Inventario: SKU interno, SKU proveedor, búsqueda y exportación.
- Revisión IA: SKU interno, SKU proveedor, seriales, margen con IVA y forma de pago.
- Compras: forma de pago, medio, abono inicial, vencimiento, columna de pago y saldo.
- Detalle: pagos, saldo y acción **Registrar abono**.
- Comprobante: SKU proveedor, seriales y estado de pago.

## Pruebas

- Aceptación 1.10.2: 21/21.
- Migración 11 sobre copia real: OK.
- Regresión completa de versiones anteriores.
- Gemini simulado.
- Casos: SKU local, SKU IA, colisión, SKU proveedor, seriales, higiene, margen, crédito, abonos y sobrepago.

## Fuera de alcance

- PDF nuevo o eliminación del soporte existente.
- Carrito separado de la revisión atómica.
- Tabla individual de seriales.
- Módulo de cuentas por pagar separado del detalle de compra.
- Diagnóstico, resúmenes o anomalías con IA.
