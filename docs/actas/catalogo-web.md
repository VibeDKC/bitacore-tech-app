# Acta — Demo de catálogo web (F6)

| Dato | Valor |
| --- | --- |
| Fecha | 27 de octubre de 2026 |
| Alcance | Demo local de catálogo, servicios y consulta de OT |
| Build | Next.js 16.4.3 · 45 rutas · 39 fichas estáticas |
| Resultado | **37/37 comprobaciones OK** |
| Firma del usuario | **Pendiente** |

## Entregado

### Catálogo y datos

- Snapshot de **39 referencias activas** desde `%APPDATA%\BitacoreTech\bitacoretech.db`.
- Exclusión de servicios, insumos de taller, productos inactivos y el SKU de prueba `00000000000`.
- **24 referencias con imagen** y **15 con placeholder** “Foto próximamente”.
- Categorías: **Accesorios (12)**, **Almacenamiento (13)** y **Periféricos (14)**.
- **9 destacados en el hero**, mostrados uno a uno: 3 promociones y 6 destacados.
- **3 promociones demo**: Power Bank (-$10.000), SSD 512 GB (-10%) y auriculares KZ (-15%).
- El JSON público no incluye el precio de “Hora Servicio Técnico”.

### Home y navegación

- Hero sin eyebrow, con el título “Servicio de mantenimiento y reparación, venta de tecnología y accesorios para tu día a día.”
- Resaltado morado en **mantenimiento y reparación**.
- Subtexto presencial, sin envíos ni domicilios.
- Eliminados los tres puntos de garantía, atención en Medellín y revisión inicial del hero.
- Botones **Explorar catálogo** y **Ver servicios** sin cambios.
- Carrusel dentro del hero, un producto a la vez, con 9 slides: 3 promociones y 6 destacados.
- Carrusel cada **4 segundos**, con pausa al pasar el mouse o al enfocar.
- Controles de anterior/siguiente, dots y contador `1 / 9`.
- Etiquetas **Promoción** y **Destacado**.
- Con `prefers-reduced-motion`, el carrusel no avanza solo.
- Se eliminó la sección inferior de “Promociones y destacados”.
- Barra de confianza, tres categorías y banda de servicios se mantienen.
- Header con desplegable de categorías.
- Menú móvil con submenú de catálogo.
- Contacto por teléfono/WhatsApp solo en la barra superior y en el pie.

### Catálogo y ficha

- 39 referencias, filtro por categoría, búsqueda por nombre/SKU/categoría y orden por precio o nombre.
- Búsqueda sin tildes: `perifericos` encuentra “Periféricos”.
- Parámetros `?q=` y `?categoria=` funcionando.
- Estado vacío cuando no hay coincidencias.
- Ficha con precio, precio anterior, condición, garantía, stock, referencia y relacionados.
- Botón **Solicitar cotización** con mensaje de WhatsApp que incluye producto, SKU y precio.
- Producto sin foto muestra el placeholder correctamente.

### Servicios

- 16 servicios seleccionables; el servicio “Próximamente” no se ofrece en el formulario.
- Sin precio ni valor por hora.
- Nota de revisión inicial: “se cotiza según el equipo y el diagnóstico”.
- Formulario que arma el mensaje de WhatsApp con servicio y detalle.

### Órdenes de trabajo

- Tres códigos demo: `OT-002332/DEMO-01`, `OT-002341/DEMO-02` y `OT-002336/DEMO-03`.
- Consulta por número de OT + código, con error controlado para datos incorrectos.
- Chips de datos demo que cargan el estado.
- `/seguimiento/[code]` con pasos, fechas, equipo y aviso de privacidad.
- `noindex` en la página de seguimiento.
- QR presentado como **inactivo por defecto**; solo se usa número + código en la demo.

### Calidad y responsive

- 390×844 y 360×800 sin desborde horizontal en home, catálogo, ficha, servicios, orden y seguimiento.
- Corrección del desborde del seguimiento móvil (`min-width: 0` en la tarjeta).
- Sin errores de consola, errores de página ni solicitudes locales inesperadas.
- 404 personalizado para producto, seguimiento y ruta inexistente.

## Pruebas ejecutadas

| Prueba | Resultado |
| --- | --- |
| `npm run typecheck` | OK |
| `npm run build` | OK · 45/45 rutas · 39 fichas SSG |
| `npm run export:catalog` | 39 productos, 24 con imagen, 3 promociones, 3 OT |
| `npm run test:smoke` | **37/37 OK** |
| Comparación snapshot ↔ base local | 39 productos y categorías 12/13/14 |
| Navegación de escritorio 1440×1000 | OK |
| Navegación móvil 390×844 y 360×800 | OK |
| Movimiento reducido | OK |

La prueba de humo usa Microsoft Edge en modo headless, `playwright-core` de la raíz y el build de producción en `http://localhost:3001`.

También se ejecutó con `next dev` en `http://localhost:3001` (el mismo comando de `Abrir-demo-catalogo.bat`): **37/37 OK**. En desarrollo debe usarse `localhost`; Next bloquea el HMR de `127.0.0.1` y el cliente no hidrata.

## Evidencia

- Script: `web/scripts/smoke-test.cjs` (`npm run test:smoke`).
- Capturas de la sesión de producción: `docs/evidencias/web-demo/`.
- Capturas de la última ejecución en desarrollo: `C:\Users\Dave\AppData\Local\Temp\opencode\catalogo-web-shots\`.
- Contrato: `docs/plan/14-contrato-catalogo-web.md`.
- Pendientes: `docs/pendientes/catalogo-web.md`.

Capturas principales:

- `01-home-desktop.png`
- `01b-home-carrusel.png`
- `02-catalogo-desktop.png`
- `03-ficha-promo-desktop.png`
- `04-servicios-desktop.png`
- `04b-servicios-formulario.png`
- `05-buscar-orden-desktop.png`
- `06-seguimiento-desktop.png`
- `07-404-desktop.png`
- `08-home-movil.png`
- `09-menu-movil.png`
- `10-catalogo-movil.png`
- `11-ficha-movil.png`
- `12-seguimiento-movil.png`
- `13-hero-panel-movil.png`

## Observaciones

- El catálogo sigue siendo un snapshot manual; no hay sincronización automática.
- Las promociones son de demostración; no existe un módulo real en la aplicación.
- Los “más vendidos” no se pueden calcular todavía: las facturas no guardan `product_id` y el stock solo tiene carga inicial. La regla queda en 30 días y mínimo 2 unidades; si solo se vende 1, se ignora.
- Cuando se desarrolle promociones se definirá si el carrusel sincroniza promociones + destacados o solo promociones; si la integración no lo permite, se ignora.
- La consulta de OT usa datos demo; el portal real con API y QR activable queda pendiente.
- No hay despliegue, Supabase ni dominio.
- Faltan correo y dirección del negocio.
- La galería de imágenes múltiples sigue pendiente de 1.10.3.
- Los pendientes de 1.11.0 no se tocaron.
- El commit queda pendiente de aprobación del usuario.

## Firma

- Aprobación técnica: ______________________
- Aprobación del usuario: ___________________
- Fecha: __________________________________
