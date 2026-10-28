# Pendientes — Catálogo web (demo)

Fecha: 27 de octubre de 2026

Este archivo registra lo que queda fuera de la demo local del catálogo web y los siguientes pasos para convertirla en un canal público real. No incluye los pendientes de la aplicación 1.11.0, que siguen en `docs/pendientes/1.11.0.md`.

## Promociones reales

La web solo tiene tres promociones de demostración generadas por el exportador. Falta el módulo real en OCTESTR:

- Alcance por SKU, por categoría o para todo el catálogo.
- Descuento por porcentaje o monto fijo.
- Vigencia con fecha inicial y final.
- Estado activa/inactiva.
- Publicar o no en el catálogo web.
- Prioridad cuando varias promociones aplican al mismo producto.
- Aviso y bloqueo si el precio promocional baja del costo de compra.
- Historial y auditoría de cambios.
- Regla de precio anterior y vigencia visible en la ficha.

Mientras no exista el módulo, las promociones de la demo no deben interpretarse como precios comerciales.

## Más vendidos y carrusel del hero

El carrusel del hero muestra hoy 9 destacados: 3 promociones y 6 destacados. La etiqueta “Más vendido” todavía no se usa.

Regla definida para cuando exista el módulo:

- Ventana de **30 días**.
- Mínimo **2 unidades por referencia**.
- Si una referencia solo vendió 1 unidad en el periodo, se ignora.
- Si ninguna referencia cumple, no se inventan slides de “Más vendido”; quedan promociones y destacados.
- Se necesita vincular las ventas al `product_id`. Hoy `invoice_items.product_id` está nulo y `stock_movements` solo tiene carga inicial.
- Falta definir si el carrusel sincroniza **promociones + destacados** o **solo promociones**. Esa opción debe vivir en el módulo de promociones; si la integración no lo permite, se ignora.
- No publicar el carrusel con promociones demo como si fueran comerciales.

Secuencia recomendada: cerrar la demo, resolver sincronización y hosting, montar promociones + regla de 30 días y publicar con datos reales. Si se necesita lanzar antes, publicar solo catálogo sin promociones.

## Sincronización catálogo ↔ base

Hoy el catálogo es un snapshot manual:

```bash
cd web
npm run export:catalog
```

Falta:

- Automatizar la exportación al publicar cambios de inventario.
- Definir si la fuente será la base local, Supabase o una API.
- Subir imágenes al publicar y servir URLs remotas o firmadas.
- Resolver el nombre de archivo de imagen: hoy siempre se copia como `.jpg`, aunque el origen sea PNG/WebP.
- Limpiar imágenes huérfanas cuando un producto se elimina o cambia de foto.
- Evitar que los slugs cambien si se edita el nombre del producto.
- Validar que el snapshot tenga las 39 referencias esperadas, los 3 destacados por categoría y las 3 promociones demo.
- Mantener las OT demo o reemplazarlas por datos anonimizados estables.
- Publicar solo campos autorizados: hoy se incluyen stock exacto, ids internos y fechas de creación/actualización.

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
