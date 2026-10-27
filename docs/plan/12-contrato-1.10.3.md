# Contrato 1.10.3 — Imagen principal, respaldo y SKU automático

Fecha: 27 de octubre de 2026

## Alcance

Completa el inventario de BitacoreTech con una imagen principal por producto, respaldo de esas imágenes y generación automática de SKU. La integración con catálogo web y la importación del inventario de MTO APP quedan fuera de esta versión y se registran como pendientes.

## Decisiones

- Cada producto tiene una sola imagen principal.
- La imagen se guarda localmente; no se publica en web ni se envía a servicios externos.
- La imagen principal se limita a 1200 px y la miniatura a 300 px.
- El renderer comprime a JPEG antes de enviar la imagen al proceso principal.
- El archivo original aceptado puede ser PNG, JPEG, WebP o BMP, con un máximo de 8 MB.
- Las imágenes se almacenan en `%APPDATA%\BitacoreTech\product-images\<productId>\`.
- El respaldo completo y el respaldo cifrado incluyen las imágenes de inventario.
- El SKU interno conserva el formato `[TIPO]-[MARCA]-[MODELO]`.
- Si el alta se envía sin SKU, el sistema lo genera automáticamente.
- Los productos legados con SKU vacío se pueden completar de forma masiva.
- La integración con catálogo web no se implementa en 1.10.3.
- La importación del inventario y las imágenes de MTO APP no se ejecuta en 1.10.3.

## Imagen principal

- Campo `products.image_path` para la imagen principal.
- Campo `products.image_thumb_path` para la miniatura.
- Campo `products.image_updated_at` para la fecha de actualización.
- Nombre de archivo basado en el hash del contenido, dentro de la carpeta del producto.
- La imagen anterior se elimina cuando se reemplaza o se quita.
- Si falla el alta o la edición después de escribir los archivos, se limpian los archivos nuevos.
- El protocolo local `bitacoretech-evidence://local/product-images/...` sirve las imágenes al renderer.
- La ruta se valida contra la carpeta raíz para impedir traversal.
- La ficha del producto muestra la imagen principal.
- El listado muestra la miniatura.
- La carga acepta archivo, arrastrar y soltar, y Ctrl+V.
- La vista previa se actualiza antes de guardar.
- **Quitar** elimina la vista previa y la imagen al guardar.

## Respaldo y restauración

- El respaldo completo copia `product-images` junto a la base de datos y las evidencias.
- El manifiesto agrega `productImages` con cantidad, bytes, rutas, tamaños y hashes.
- El tamaño total del respaldo incluye las imágenes.
- La restauración reemplaza la carpeta local de imágenes por la del respaldo.
- Si el respaldo no contiene la carpeta, se limpian las rutas de imagen en la base restaurada cuando las columnas existen.
- El respaldo cifrado incluye `productImages` en el contenedor exportado.
- La importación cifrada extrae las imágenes antes de restaurar.
- La purga de datos elimina `product-images` y registra la acción en auditoría.

## SKU automático

- `inventory.suggestSku` genera una propuesta y resuelve colisiones con sufijo numérico.
- El formulario de alta y el de edición incluyen **Generar**.
- Si el usuario guarda sin SKU, el alta y la edición lo generan automáticamente.
- `inventory.generateMissingSkus` completa productos activos con SKU vacío o `-`.
- El botón **Generar SKUs** del inventario ejecuta la generación masiva.
- Los SKU generados localmente se validan contra el formato interno.
- Los nombres sin tipo reconocido usan el prefijo `PROD-`.

## Migración 12

- `products.image_path`.
- `products.image_thumb_path`.
- `products.image_updated_at`.
- Las columnas son opcionales y no alteran los productos existentes.
- La migración conserva registros, integridad y claves foráneas.

## Interfaz

- Inventario: miniatura en el listado, imagen en la ficha y campo de imagen en alta/edición.
- Inventario: carga desde archivo, arrastrar y soltar, Ctrl+V, vista previa y eliminación.
- Inventario: **Generar** por producto y **Generar SKUs** en la cabecera.
- La imagen no se muestra en el POS ni se publica en catálogo web.

## Pruebas

- Aceptación 1.10.3: 26/26.
- Migración 12 sobre copia real: OK.
- Regresión de versiones anteriores: OK.
- Smoke empaquetado de aceptación y migración: OK.
- Casos nuevos: archivo BMP grande, compresión, miniatura, protocolo local, Ctrl+V, reemplazo, eliminación, SKU automático, generación masiva, respaldo completo y respaldo cifrado.

## Fuera de alcance

- Catálogo web, Supabase o publicación de imágenes.
- Importación del inventario o de las imágenes de MTO APP.
- Galería con múltiples imágenes por producto.
- Notas o detalle ampliado del producto.
- Edición individual de seriales.
- Miniaturas en POS y búsqueda de ventas.
- Importación CSV de inventario.
- Vista previa de imágenes en el historial de respaldos.
