# Contrato 1.12.0 — Promociones y publicación local del catálogo

Fecha: 27 de octubre de 2026

## Alcance

Integra en OCTESTR un módulo real de promociones para ventas y una publicación local del catálogo que consume la web de Next.js. La sincronización remota con Supabase/Vercel queda para 1.13.

- Promociones visibles para todos los roles.
- Creación, edición, activación, publicación y eliminación reservadas a propietario y administradores.
- Las promociones aplican a ventas del POS y al precio publicado en la web; no se aplican a OT.
- Publicación local del catálogo desde la app, con estado, historial de última publicación y aviso a administradores.
- Migración 14.

## Decisiones

### Reglas de promoción

- Alcance por **SKU, categoría o todo el catálogo**.
- Descuento por **porcentaje** o **monto fijo**.
- Vigencia por fechas inclusivas en `America/Bogota`.
- Estado activo/inactivo y publicación web independiente.
- Prioridad numérica.
- Si varias promociones aplican al mismo producto: mayor prioridad, luego mayor especificidad (SKU > categoría > todo), luego la más reciente.
- Una sola promoción por producto.
- Las promociones **no se acumulan** con descuento manual ni fidelidad. El POS y el backend lo bloquean.
- Si el precio promocional queda por debajo del costo, la app muestra el aviso y exige autorización explícita (`allow_below_cost`) para guardar.
- El precio final siempre lo resuelve el backend; el renderer no impone precios.

### Inventario y publicación

- Los productos tienen `publish_web` (por defecto activo).
- La publicación excluye servicios, inactivos, insumos de taller, `publish_web = 0` y el SKU de prueba `00000000000`.
- La web solo recibe promociones activas, vigentes y publicadas.
- La publicación local escribe `catalog.json`, `orders-demo.json` e imágenes en la carpeta configurada (por defecto `web/` cuando se ejecuta desde el repositorio).
- Puede publicarse manualmente o automáticamente tras cambios de inventario, compras, ventas, OT o promociones.
- La publicación automática viene **desactivada por defecto**; se habilita desde Configuración → Catálogo web para evitar escribir en carpetas no configuradas.
- Si la publicación falla, el cambio local se conserva y el estado queda en error para reintentar.
- En 1.12 no hay Supabase, Vercel ni dominio.

### Avisos

- Avisos en la campana de notificaciones para propietario y administradores:
  - promociones activas por debajo del costo;
  - error o publicación pendiente del catálogo.
- El propietario actúa como auditor: recibe el aviso y ve la auditoría, sin bloquear la operación.
- No hay notificaciones por correo ni WhatsApp en 1.12.

### Web

- La web deja de usar `demoPromotions`.
- La etiqueta “Promoción” aparece solo para promociones reales; el resto se muestra como “Destacado”.
- El carrusel del hero muestra 9 destacados uno a uno, con autoplay de 4 segundos.
- La ficha muestra precio anterior y precio promocional solo si hay promoción real.
- El teléfono público es `+57 324 638 1768`.
- La marca visible se mantiene como está (BitacoreTech / BitaCoreTech en el texto existente).

## Modelo de datos

Migración 14:

- `promotions`
  - `id`, `name`, `description`, `scope` (`all`/`category`/`sku`/`mixed`)
  - `discount_type` (`percent`/`amount`), `discount_percent`, `discount_cents`
  - `starts_on`, `ends_on`
  - `active`, `publish_web`, `priority`, `allow_below_cost`
  - `created_by`, `updated_by`, `created_at`, `updated_at`
- `promotion_targets`
  - `promotion_id`, `target_type` (`category`/`sku`), `category`, `product_id`
- `products.publish_web`
- `invoice_items.original_unit_price_cents`, `promotion_id`, `promotion_name`, `promotion_discount_cents`
- Versión 14 de `schema_migrations`

## Interfaz y permisos

- Nueva página **Promociones** en el sidebar, visible para todos.
- Técnicos y cajeros ven la lista en modo lectura.
- Propietario y administradores ven acciones de alta, edición, pausa, publicación web y eliminación.
- Nueva pestaña **Catálogo web** en Configuración para ruta, publicación automática, estado y publicación manual.
- POS:
  - precio y badge promocional;
  - desglose de ahorro;
  - descuento manual/fidelidad deshabilitado cuando hay promoción;
  - línea de factura con precio original y promoción.
- Capacidades nuevas: `managePromotions` y `publishCatalog`.
- Auditoría de creación, edición, activación, publicación web, eliminación y publicación del catálogo.

## Pruebas

- Aceptación 1.12.0: 22/22.
- Smoke empaquetado 1.12.0: 22/22.
- Migración 14 sobre copia de la base real: OK.
- Regresión 1.11.0: 34/34.
- Regresión 1.10.3: 26/26.
- Web sin promociones: 37/37.
- Web con promociones de prueba: 37/37.
- Typecheck y build de app y web: OK.

## Fuera de alcance

- Supabase, Vercel, dominio y sincronización remota (1.13).
- Publicación de imágenes a almacenamiento remoto.
- Ranking de más vendidos de 30 días con mínimo 2 unidades (queda preparado/documentado).
- Configuración de sincronizar promociones + destacados o solo promociones (1.13).
- Carrito en la web nueva (decisión pendiente para 1.13).
- Promociones en OT.
- Galería de múltiples imágenes.
- Correo y dirección del negocio.
- Pendientes de 1.11.0.
