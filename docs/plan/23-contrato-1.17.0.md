# Contrato 1.17.0 — Inventario, compras y catálogo

Fecha: 28 de octubre de 2026

## Alcance

La versión **1.17.0** cierra el bloque de inventario, compras y catálogo con:

- Ficha comercial e interna del producto.
- Galería de hasta 8 imágenes con portada y orden.
- Slug estable para las URLs del catálogo.
- Historial de compras y último costo por producto.
- Miniatura del producto en POS.
- Publicación de descripción e imágenes en la web.

La base sube al esquema **18**.

## Decisiones

### Ficha del producto

- `description`: texto comercial visible en la app y en la web.
- `internalNotes`: notas privadas del taller; nunca se publican.
- Ambos campos se editan desde inventario.
- La descripción aparece en la ficha del producto y en el detalle público.
- Las notas internas solo se muestran en la app.

### Galería

- Cada producto admite hasta **8 imágenes**.
- La primera imagen es la portada y se sincroniza con los campos históricos `image_path` y `image_thumb_path`.
- Se puede agregar, quitar, cambiar portada y reordenar.
- Los archivos se guardan en `product-images/` y se incluyen en los respaldos completos.
- La galería reutiliza el procesamiento de imagen existente: JPEG principal de hasta 1200 px y miniatura de 300 px.
- El POS y la lista de inventario usan la miniatura de la portada.

### Slug estable

- Cada producto guarda un `slug` único.
- Se genera al crear el producto desde el nombre o el SKU.
- No cambia al renombrar el producto, para conservar la URL pública.
- La migración backfillea los slugs existentes con el mismo orden y algoritmo que usaba el publicador.
- El publicador usa el slug guardado y resuelve colisiones con sufijos.

### Compras

- La ficha del producto muestra el historial de compras:
  - proveedor, número de factura, fecha, cantidad, costo unitario y total de línea.
- Se muestran hasta 20 compras recientes.
- El costo actual del producto se actualiza con las compras recibidas, como ya ocurría.
- Las compras con producto nuevo desde la revisión de IA generan slug desde su creación.

### Catálogo

- `catalog.json` publica `description`, `images` y el slug estable.
- `image` sigue siendo la portada para tarjetas, hero y categorías.
- `stats.images` cuenta todos los archivos de imagen publicados.
- Las notas internas no se incluyen.
- La web muestra galería con miniaturas y descripción comercial.
- La compatibilidad con catálogos antiguos se mantiene: si no hay `images`, se usa `image`.

## Fuera de alcance

- Devoluciones o notas de crédito de compras.
- Importación CSV masiva.
- Edición individual de seriales por unidad física.
- Galería en la creación inicial; la primera imagen se carga como portada y las adicionales se agregan al editar.
- Nuevos PDFs.
- Firma de código del instalador.

## Pruebas

- Aceptación 1.17.0: 20/20.
- Migración 1.17.0 sobre base real: OK.
- Regresión 1.16.2: 16/16.
- Regresión 1.16.0: 36/36.
- Regresión 1.15.0: 44/44.
- Regresión 1.14.1: 19/19 sin propietario.
- Regresión 1.13.1: 23/23.
- Regresión 1.13.0: 30/30.
- Web local: 39/39.
- Web remota: 7/7.
- Typecheck y build de app y web.

## Criterio de cierre

1. El producto guarda descripción, notas internas y slug.
2. El slug no cambia al renombrar.
3. La galería permite hasta 8 imágenes, portada y orden.
4. La galería no publica notas internas.
5. El historial de compras muestra proveedor, fecha, cantidad y costo.
6. El último costo de compra actualiza el producto.
7. El catálogo publica descripción, slug e imágenes.
8. La web muestra galería y descripción.
9. El POS muestra la miniatura.
10. Se documenta y se genera el instalador 1.17.0.
