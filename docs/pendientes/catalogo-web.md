# Pendientes — Catálogo web (demo)

Fecha: 27 de octubre de 2026

Este archivo registra lo que queda fuera de la demo local del catálogo web y los siguientes pasos para convertirla en un canal público real. No incluye los pendientes de la aplicación 1.11.0, que siguen en `docs/pendientes/1.11.0.md`.

## Promociones reales

La app ya tiene el módulo real de promociones (1.12.0) y la web consume solo promociones activas, vigentes y publicadas. Queda pendiente:

- Alcance por SKU, por categoría o para todo el catálogo.
- Descuento por porcentaje o monto fijo.
- Vigencia con fecha inicial y final.
- Estado activa/inactiva.
- Publicar o no en el catálogo web.
- Prioridad cuando varias promociones aplican al mismo producto.
- Aviso y bloqueo si el precio promocional baja del costo de compra.
- Historial y auditoría de cambios.
- Regla de precio anterior y vigencia visible en la ficha.

Las promociones demo fueron eliminadas. La base real no tiene promociones cargadas al cierre de 1.12.0; se crean desde la app.

## Más vendidos y carrusel del hero

El carrusel del hero muestra hoy 9 destacados: 3 promociones y 6 destacados. La etiqueta “Más vendido” todavía no se usa.

Regla definida para cuando exista el módulo:

- Ventana de **30 días**.
- Mínimo **2 unidades por referencia**.
- Si una referencia solo vendió 1 unidad en el periodo, se ignora.
- Si ninguna referencia cumple, no se inventan slides de “Más vendido”; quedan promociones y destacados.
- Se necesita vincular las ventas al `product_id`. Hoy `invoice_items.product_id` está nulo y `stock_movements` solo tiene carga inicial.
- Falta definir si el carrusel sincroniza **promociones + destacados** o **solo promociones**. Esa opción debe vivir en el módulo de promociones; si la integración no lo permite, se ignora.
- No publicar promociones inactivas, vencidas o no marcadas para web.

Secuencia recomendada: cerrar 1.12 (promociones + publicación local), resolver la sincronización remota y el hosting en 1.13, implementar la regla de más vendidos y publicar con datos reales. Si se necesita lanzar antes, publicar solo catálogo sin promociones.

## Sincronización catálogo ↔ base

En 1.12.0 la app publica el snapshot local (manual o automático) en la carpeta configurada. También queda el comando manual:

```bash
cd web
npm run export:catalog
```

Hecho:

- Publicación local automática después de cambios de inventario, compras, ventas, OT y promociones.
- Exclusión de servicios, inactivos, insumos de taller, `publish_web = 0` y SKU de prueba.
- Imágenes copiadas y archivos huérfanos eliminados.
- Extensiones de imagen preservadas.
- Estado de publicación y aviso a administradores.

Falta para 1.13:

- Sincronización remota con Supabase/Vercel.
- Subir imágenes a Storage y servir URLs remotas.
- Resolver slugs estables si se edita el nombre.
- Validar el snapshot contra Supabase y manejar reintentos sin internet.
- Publicar solo campos autorizados: hoy se incluyen stock exacto, ids internos y fechas de creación/actualización.
- Reemplazar la web estática de MTO APP y definir carrito.

## Publicación real

- No hay despliegue en Vercel ni integración con Supabase.
- No hay dominio ni variables de entorno de producción.
- Falta definir la URL pública en `NEXT_PUBLIC_SITE_URL`.
- Falta revisar la política de caché de imágenes, páginas y JSON.
- Falta definir qué pasa con el catálogo si la base local está apagada.

## Portal de OT real

- La consulta actual usa `web/data/orders-demo.json`; no consulta la base real.
- El acceso es por número de OT + código, o por `/seguimiento/[code]`.
- El QR debe quedar **inactivo por defecto** y activarse desde configuración.
- Falta una API segura que valide el código y devuelva solo estado, equipo, fechas y pasos.
- No se deben publicar nombre, teléfono, serial, credenciales ni notas internas.
- Falta rotar códigos demo antes de cualquier publicación.
- Falta definir la vigencia del enlace y la revocación del código.

## Datos del negocio

- Falta correo de contacto.
- Falta dirección física.
- Las fotos de las 15 referencias sin imagen se irán cargando poco a poco.
- Falta decidir si se publican horarios especiales, festivos o tiempos de respuesta.

## Galería de imágenes

- Solo existe una imagen principal por producto.
- Pendiente heredado de `docs/pendientes/1.10.3.md`: imágenes adicionales, orden, portada y límite por producto.
- Falta definir el comportamiento de la galería en la ficha y en el catálogo.

## Otros

- El carrusel del hero muestra 9 slides uno a uno; si cambia la cantidad, revisar dots, contador y controles.
- La búsqueda normaliza tildes, pero no errores ortográficos ni sinónimos.
- La página de seguimiento no tiene autenticación adicional; el código es la única barrera.
- La demo no tiene analítica, cookies, aviso legal ni política de privacidad.
- Falta una prueba de carga con más referencias e imágenes.
- Falta validar el comportamiento en Safari/iOS y Firefox; la prueba actual usa Edge.
