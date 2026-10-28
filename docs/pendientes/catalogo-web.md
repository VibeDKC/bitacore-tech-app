# Pendientes — Catálogo web

Fecha: 28 de octubre de 2026

Este archivo registra lo que queda fuera de 1.14.1 y los siguientes pasos del catálogo público. Los pendientes de la aplicación están en `docs/pendientes/1.14.1.md`.

## Estado actual

- La app publica el catálogo, las órdenes demo y las imágenes en Supabase Storage (`catalogo-web`).
- La web de Next.js lee `CATALOG_URL` con ISR de 60 segundos y fallback local.
- La sincronización es unidireccional: app → Supabase → web.
- La web está desplegada en `https://bitacore-tech-app.vercel.app`.
- El bucket es público de lectura; la escritura usa una clave secreta cifrada en la app.
- Las promociones demo fueron eliminadas; la web usa promociones reales.
- La regla de “Más vendido” está implementada: 30 días, mínimo 2 unidades.
- El carrito local y el mensaje de WhatsApp están implementados; la recogida es en tienda.
- La visibilidad de stock es configurable (`always` u `outOnly`).

## Promociones

Hecho en 1.12/1.13:

- Alcance por SKU, categoría o todo el catálogo.
- Descuento por porcentaje o monto fijo.
- Vigencia, estado activa/inactiva y publicación web.
- Prioridad y resolución por especificidad.
- Aviso y bloqueo si el precio promocional baja del costo.
- Historial y auditoría.
- Precio anterior y vigencia visible en la ficha.
- Publicación remota sin recompilar la web.

Pendiente:

- Decidir si se permiten varios objetivos por promoción en la interfaz.
- Programación por días u horarios.
- Reporte de margen de ventas con promoción.
- Reactivar una promoción vencida sin duplicarla.

## Más vendidos y carrusel del hero

Implementado:

- Ventana de 30 días.
- Mínimo 2 unidades por referencia.
- `bestSellers` y `bestSeller` en el snapshot.
- Etiqueta “Más vendido” solo cuando hay datos.
- El carrusel sigue mostrando 9 destacados; las promociones y los más vendidos entran primero.

Pendiente:

- Definir si se muestran top 3, top 5 o todos los que cumplan.
- Definir si se incluyen ventas de OT o solo POS.
- Las facturas antiguas sin `product_id` no cuentan; el ranking empezará a llenarse con ventas nuevas.
- Definir si el carrusel sincroniza promociones + destacados o solo promociones.

## Sincronización

Hecho:

- Supabase Storage con `catalog.json`, `orders-demo.json` e imágenes.
- Clave secreta cifrada y prueba de conexión.
- URLs absolutas de imagen con hash de contenido.
- Limpieza de imágenes huérfanas.
- Estado remoto y avisos de error.
- Publicación automática opcional.
- Respaldo local y exportador manual.

Pendiente:

- Validar contra el proyecto Supabase real con la clave definitiva.
- Agregar `CATALOG_URL` en Vercel y redeploy.
- Resolver slugs estables si se edita el nombre.
- Definir reintentos automáticos con espera si no hay internet.
- Publicar solo campos autorizados: hoy se incluyen stock exacto, ids internos y fechas.
- Evaluar revalidación instantánea con Deploy Hook o endpoint protegido.

## Web y despliegue

- Vercel está desplegado con Root Directory `web`.
- Falta `CATALOG_URL` en las variables de entorno.
- Falta definir el dominio definitivo y el corte de la web vieja de MTO APP.
- Falta `NEXT_PUBLIC_SITE_URL` de producción.
- Falta revisar la política de caché de imágenes, páginas y JSON.
- Falta definir qué pasa si Supabase está caído: hoy se usa el snapshot local.
- Faltan pedidos en línea, pagos y cuentas de cliente; el carrito solo envía el pedido por WhatsApp.
- Falta analítica, cookies, aviso legal y política de privacidad.
- Falta validar Safari/iOS y Firefox; la prueba actual usa Edge.

## Portal de OT real

Implementado en 1.14.1:

- La app publica estados sanitizados y el hash SHA-256 del código en `orders-demo.json`.
- El acceso es por número de OT + código, o por `/seguimiento/[code]`.
- La API `/api/seguimiento` valida el código por hash y devuelve solo estado, equipo y fechas.
- No se publican nombre, teléfono, serial, credenciales ni notas internas.
- El código no aparece en texto plano en el JSON.
- El QR sigue inactivo por defecto.

Pendiente:

- Definir vigencia y revocación del código.
- Definir si las OT demo se retiran en producción.
- Evaluar límite de intentos en la API.
- Probar con una OT real publicada.

## Datos del negocio

- Falta correo de contacto.
- Falta dirección física.
- Las 15 referencias sin imagen se irán cargando poco a poco.
- Falta decidir si se publican horarios especiales, festivos o tiempos de respuesta.

## Galería de imágenes

- Solo existe una imagen principal por producto.
- Pendiente heredado de `docs/pendientes/1.10.3.md`: imágenes adicionales, orden, portada y límite por producto.
- Falta definir la galería en la ficha y en el catálogo.

## Otros

- El carrusel del hero muestra 9 slides uno a uno; si cambia la cantidad, revisar dots, contador y controles.
- La búsqueda normaliza tildes, pero no errores ortográficos ni sinónimos.
- La página de seguimiento no tiene autenticación adicional; el código es la única barrera.
- Falta una prueba de carga con más referencias e imágenes.
