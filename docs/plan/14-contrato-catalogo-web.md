# Contrato — Demo de catálogo web (F6)

> **Actualización 1.12.0:** la web consume promociones reales y el snapshot se publica localmente desde la app. Ver `docs/plan/15-contrato-1.12.0.md`.

| Dato | Valor |
| --- | --- |
| Fecha | 27 de octubre de 2026 |
| Alcance | Demo pública local del catálogo, servicios y consulta de OT |
| Aplicación base | 1.11.0, sin cambios en Electron |
| Ubicación | `web/` (Next.js) |
| Estado | Aprobado técnicamente; pendiente firma del usuario |

## Alcance

La demo publica un snapshot del catálogo real de OCTESTR y permite consultar productos, servicios y el estado de una OT de demostración desde el navegador. No hay backend, autenticación, carrito, pagos ni despliegue en producción.

- **39 referencias activas** exportadas desde `%APPDATA%\BitacoreTech\bitacoretech.db`.
- Se excluyen servicios, insumos de taller, productos inactivos y el SKU de prueba `00000000000`.
- **24 referencias con imagen** y **15 con placeholder** “Foto próximamente”.
- Categorías: **Accesorios (12)**, **Almacenamiento (13)** y **Periféricos (14)**.
- **9 destacados en el hero**, mostrados uno a uno: 3 promociones y 6 destacados.
- **3 promociones demo**: una fija y dos porcentuales.
- **3 OT demo**: `OT-002332/DEMO-01`, `OT-002341/DEMO-02` y `OT-002336/DEMO-03`.
- El catálogo se sirve en `http://localhost:3001`; se abre con `Abrir-demo-catalogo.bat`.

## Decisiones

- El home muestra hero con carrusel, barra de confianza, categorías y servicios. La sección inferior “Promociones y destacados” se eliminó.
- El hero no lleva eyebrow. El título es “Servicio de mantenimiento y reparación, venta de tecnología y accesorios para tu día a día.” y resalta **mantenimiento y reparación**.
- El subtexto no menciona envíos ni domicilios: la atención es presencial. Se eliminaron los tres puntos de garantía, atención en Medellín y revisión inicial del hero.
- Los botones se mantienen: **Explorar catálogo** principal y **Ver servicios** secundario.
- El carrusel del hero muestra **un producto a la vez**, avanza cada **4 segundos**, se pausa al pasar el mouse o al enfocar y queda en modo manual con `prefers-reduced-motion`.
- Las etiquetas del carrusel son **“Promoción”** y **“Destacado”**.
- La garantía de la tarjeta del producto y la barra de confianza se mantienen.
- Las promociones son **de demostración** y se generan en el exportador; no existe un módulo real de promociones.
- Los “más vendidos” quedan para cuando exista el módulo: ventana de 30 días, mínimo 2 unidades por referencia; si solo se vende 1, se ignora. Hoy no hay ventas vinculadas por producto.
- Cuando se desarrolle promociones, se definirá si el carrusel sincroniza promociones + destacados o solo promociones. Si la integración no lo permite, se ignora.
- El header solo incluye navegación; el contacto por teléfono/WhatsApp queda en la barra superior y en el pie.
- Los servicios no muestran precio ni valor por hora. La revisión inicial se cotiza según el equipo y el diagnóstico.
- La búsqueda de orden usa número de OT + código. `/seguimiento/[code]` permite el acceso directo que usará el QR.
- El QR queda **inactivo por defecto** en esta demo; solo aparece como nota informativa.
- La ficha muestra precio, precio anterior si hay promoción, condición, garantía, stock, referencia y botón de cotización por WhatsApp.
- El catálogo permite filtro por categoría, búsqueda por nombre/SKU/categoría sin exigir tildes y orden por precio o nombre.
- El snapshot es manual (`npm run export:catalog`). No se implementa sincronización automática ni publicación de imágenes.
- El JSON público no incluye el precio del servicio “Hora Servicio Técnico”.

## Rutas

| Ruta | Contenido |
| --- | --- |
| `/` | Home, hero con carrusel, confianza, categorías y banda de servicios |
| `/catalogo` | 39 referencias, búsqueda, filtro, orden y estado vacío |
| `/producto/[slug]` | 39 fichas estáticas con promoción, condición, garantía y WhatsApp |
| `/servicios` | Grupos de servicios y formulario de cotización |
| `/buscar-orden` | Consulta con número de OT y código; chips de datos demo |
| `/seguimiento/[code]` | Estado de la OT, pasos, privacidad y `noindex` |
| 404 | Página personalizada para producto, seguimiento o ruta inexistente |

## Datos y snapshot

El exportador lee la base local en modo de solo lectura, copia las imágenes a `web/public/products` y escribe:

- `web/data/catalog.json`
- `web/data/orders-demo.json`

Los campos publicados son los necesarios para el catálogo: id, SKU, slug, nombre, categoría, precio, precio regular, stock, condición, garantía, imagen y fechas. No se publican datos de clientes, teléfonos, seriales, credenciales ni notas internas de las OT.

## Criterios de aceptación

- `npm run typecheck` y `npm run build` pasan.
- El build contiene las 39 fichas estáticas.
- La prueba de humo recorre home, carrusel del hero, header, catálogo, ficha, servicios, órdenes, 404, móvil y movimiento reducido.
- No hay errores de consola, errores de página ni solicitudes locales inesperadas.
- La demo funciona en escritorio y en 390/360 px sin desborde horizontal.
- El acta registra resultados, capturas y observaciones.

## Fuera de alcance

- Módulo real de promociones en la aplicación.
- Ranking de más vendidos de 30 días y configuración de sincronización del carrusel.
- Sincronización automática catálogo ↔ base y publicación de imágenes.
- Supabase, Vercel, dominio y despliegue público.
- Portal de OT con datos reales, autenticación y QR activo.
- Galería de múltiples imágenes por producto.
- Carrito, pagos, cuentas de cliente y facturación electrónica.
- Correo y dirección del negocio.
- Los pendientes documentados de 1.11.0.
