# Contrato 1.10.0 — IA de facturas de compra

Fecha: 26 de octubre de 2026

## Alcance

Implementa el escaneo de facturas de compra con Gemini. No incluye diagnóstico técnico, resúmenes ni anomalías de caja, que quedan como “Próximamente”.

## Configuración y seguridad

- Clave de Gemini cifrada con `safeStorage`.
- La clave nunca se devuelve al renderer; solo se muestra la huella.
- `configureAI` sigue siendo exclusivo del propietario.
- El escaneo exige `useAI` y `createPurchase`.
- **Probar conexión** valida clave y modelo.
- La clave se descarta al restaurar un respaldo y se debe volver a configurar.
- Se agregó una URL base de Gemini configurable solo para pruebas automatizadas.

## Escaneo

- Botón **Escanear factura** en Compras.
- Archivo, arrastrar/soltar o **Ctrl+V** con vista previa.
- Imagen PNG/JPEG/WebP o PDF, máximo 8 MB.
- Imagen redimensionada en el renderer.
- No se guardan imágenes ni PDFs.
- Gemini recibe el archivo y devuelve JSON estricto.
- El backend valida líneas, IVA, totales, proveedor y productos.
- Se compara el NIT exacto y el nombre del proveedor.
- Se comparan productos por nombre y SKU.
- El borrador no crea nada hasta la aprobación.

## Revisión

- Proveedor preseleccionado, editable o creable.
- Número y fecha.
- Líneas editables.
- Producto sugerido, opción de crear producto nuevo.
- IVA por línea.
- Descuento global.
- Total real editable.
- Diferencia conciliada:
  - Menor: descuento adicional.
  - Mayor: ajuste positivo.
  - Requiere confirmación.
- Alerta de costo >10 % con margen actual, costo nuevo y precio sugerido.
- Opción de actualizar precio de venta.
- Duplicado por proveedor + número con confirmación.
- Diferentes proveedores pueden repetir número.

## Aprobación

`purchases.createFromReview` es atómico:

- Crea la compra.
- Crea productos nuevos.
- Inserta líneas con IVA.
- Aumenta stock.
- Actualiza costo.
- Registra kardex.
- Actualiza precio de venta si se autorizó.
- Guarda metadatos de IA sin imagen.
- Audita.

## Migración 10

- `purchase_items.iva_rate`.
- `purchase_items.iva_cents`.
- `purchases.discount_cents`.
- `purchases.adjustment_cents`.
- `purchases.ai_metadata_json`.
- Se retira la unicidad global de `purchases.number`.
- Se agrega un índice no único por `(supplier_id, number)` para búsqueda y advertencia.
- Backfill de compras existentes al 19 %.

## Pruebas

- Aceptación 1.10.0: 7/7.
- Migración 10 sobre copia de la base real: OK.
- Gemini simulado: prueba de conexión, imagen, PDF, JSON inválido y cuota.
- AliExpress: total real menor, descuento y conciliación.
- Total real mayor: ajuste positivo.
- Producto nuevo, costo actualizado y precio actualizado.
- Duplicado confirmado y otro proveedor con el mismo número.
- Regresión:
  - 1.9.0: 9/9.
  - 1.8.0: 13/13.
  - 1.7.0: 11/11.
  - 1.6.1: 12/12.
  - 1.6.0: 14/14.
  - 1.5.0: 12/12.
  - F0/F1: 8/8.
  - F2/F3: 15/15.
  - F4/F5: 14/14.
- Smoke del instalador empaquetado.
