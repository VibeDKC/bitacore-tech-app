# Contrato 1.9.0 — Teléfonos, documento opcional y cierres de ficha

Fecha: 26 de octubre de 2026

## Alcance

Cierra los faltantes del plan 1.5.0–1.8.0 **excepto la IA de facturas de compra**:

- Punto 10: teléfono principal y múltiples teléfonos por cliente.
- Documento de cliente opcional.
- Diccionarios de condición y origen de inventario.
- Diccionario de marcas de componentes.
- Campo “Otro” en la ficha técnica.
- Copia de la ficha técnica al snapshot legal.
- Migración 9 y compatibilidad con datos existentes.

La IA de facturas queda fuera hasta nueva indicación.

## Clientes

### Teléfonos

Nueva tabla `customer_phones`:

- `id`, `customer_id`, `phone`, `label`, `is_primary`, `created_at`.
- Varios teléfonos por cliente.
- Exactamente uno principal por cliente cuando existan teléfonos.
- `customers.phone` conserva el principal para compatibilidad con facturas, OT y reportes.

Comportamiento:

- La interfaz exige al menos un teléfono principal para clientes nuevos.
- La búsqueda de clientes cubre nombre, documento, correo y todos los teléfonos.
- WhatsApp usa el principal.
- El comprobante y los documentos muestran el principal.
- La ficha del cliente lista todos los teléfonos.
- Si un teléfono ya existe en otro cliente se muestra un aviso, pero no se bloquea.
- La migración convierte el teléfono existente en el principal.

### Documento opcional

- La interfaz y el backend aceptan clientes sin documento.
- Se guarda un identificador interno único `SD-...` y `document_missing = 1`.
- La interfaz muestra “Sin documento”.
- Si luego se agrega un documento real, se valida duplicado y NIT como antes.
- Los clientes existentes conservan su documento y `document_missing = 0`.

## Inventario

Nuevos tipos de diccionario:

- `inventory_condition`: Nuevo, Usado, Reacondicionado, Para repuesto, Otro.
- `inventory_origin`: Compra local, Importado, Devolución, Cliente, Otro.
- `component_brand`: Kingston, Corsair, Crucial, Samsung, Western Digital, Seagate, ADATA, TeamGroup, G.Skill, Gigabyte, ASUS, Otro.

Cambios:

- `products.condition` y `products.origin`.
- Se editan desde inventario y se muestran en la ficha del producto.
- Los valores se siembran también en bases existentes mediante `ensureSupplementalDictionaries`, sin repetir los diccionarios ya sembrados.

## Ficha técnica

- Nuevo campo `other` para modelos o componentes no listados.
- Se muestra en la recepción, el detalle de la OT, el comprobante A4 y el reporte PDF.
- La marca de RAM se elige desde `component_brand`, con opción de escribir otra.
- La ficha se copia al snapshot legal de la OT (`intake.legal.technicalSheet`), además de conservarse en `intake.technicalSheet` y `equipment.technical_sheet_json`.
- Las OT antiguas conservan su ficha legada.

## Migración

Migración 9:

- Crea `customer_phones`.
- Agrega `customers.document_missing`.
- Agrega `products.condition` y `products.origin`.
- Reconstruye el teléfono principal de cada cliente existente en `customer_phones`.
- Siembra los diccionarios nuevos en bases ya inicializadas.
- No elimina ni modifica datos históricos.

## Pruebas

- Aceptación 1.9.0: 9/9.
- Smoke empaquetado 1.9.0: 9/9.
- Migración 9 sobre copia de la base real: OK.
- Smoke de migración empaquetado: OK.
- Regresión:
  - 1.8.0: 13/13.
  - 1.7.0: 11/11.
  - 1.6.1: 12/12.
  - 1.6.0: 14/14.
  - 1.5.0: 12/12.
  - F0/F1: 8/8.
  - F2/F3: 15/15.
  - F4/F5: 14/14.
- Smoke del instalador empaquetado 1.9.0.
