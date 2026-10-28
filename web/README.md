# Catálogo web BitacoreTech

Catálogo público construido con Next.js, usando el snapshot local de OCTESTR. Desde 1.12 las promociones reales de la app se publican en la web y la app puede regenerar el snapshot localmente. La sincronización remota con Supabase/Vercel queda para 1.13.

## Requisitos

- Node.js 24 o superior (el exportador usa `node:sqlite`).
- npm.
- Microsoft Edge instalado para ejecutar la prueba de humo (Playwright usa Edge).

## Ver la demo

Desde la raíz de OCTESTR:

```text
Abrir-demo-catalogo.bat
```

Abre `http://localhost:3001` en el navegador.

## Desarrollo

```bash
cd web
npm install
npm run dev
```

## Regenerar los datos del catálogo

La app puede publicar el snapshot desde **Configuración → Catálogo web** o desde **Promociones → Publicar catálogo web**. La publicación automática es opcional y viene desactivada por defecto; se habilita en Configuración. También se puede regenerar manualmente leyendo `%APPDATA%\BitacoreTech\bitacoretech.db` y copiando las imágenes a `web/public/products`:

```bash
cd web
npm run export:catalog
```

Se excluyen:

- Servicios.
- Insumos de taller.
- Productos inactivos.
- Productos con `publish_web = 0`.
- El producto de pruebas `USB GENERIC` (`00000000000`).

El JSON público no incluye el precio del servicio “Hora Servicio Técnico”. Las promociones se leen de las tablas `promotions` y `promotion_targets`; solo salen las activas, vigentes y publicadas en web.

## Prueba de humo

Con la demo activa en 3001:

```bash
cd web
npm run test:smoke
```

La prueba usa `http://localhost:3001` (se puede cambiar con `BASE_URL`), Microsoft Edge en modo headless y guarda capturas en `%TEMP%\opencode\catalogo-web-shots` (se puede cambiar con `SHOTS_DIR`). Cubre home, carrusel del hero cada 4 segundos, header, catálogo, ficha, servicios, órdenes, 404, móvil y movimiento reducido. `playwright-core` se reutiliza desde las dependencias de la raíz.

En modo desarrollo no uses `127.0.0.1` para la prueba: Next bloquea el HMR de ese origen y el cliente no hidrata. La demo y el `.bat` usan `localhost`.

## Alcance de esta fase

- Home con hero y carrusel de 9 destacados uno a uno. La etiqueta “Promoción” aparece solo cuando la app publica una promoción real.
- 39 referencias activas, 24 con imagen y 15 con placeholder.
- Búsqueda por nombre, SKU o categoría sin exigir tildes.
- Categorías, orden y disponibilidad.
- Precio, condición y garantía reales del snapshot.
- Promociones reales con alcance por SKU/categoría/todo, vigencia, prioridad y publicación web.
- Publicación local manual y automática opcional desde la app; snapshot regenerable con `npm run export:catalog`.
- Servicios sin precio por hora; revisión inicial sujeta a cotización.
- Consulta demo de OT con número y código.
- Diseño responsive y contacto por WhatsApp en la barra superior y el pie.

No incluye carrito, pagos, cuentas, sincronización remota Supabase/Vercel ni portal de OT con datos reales. Eso corresponde a 1.13.
