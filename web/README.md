# Catálogo web BitacoreTech

Catálogo público construido con Next.js. Desde 1.13.0 la app publica el catálogo, las promociones y las imágenes en **Supabase Storage**, y esta web los lee desde el bucket `catalogo-web` con revalidación cada 60 segundos. Si el remoto no está disponible, usa el snapshot local commiteado.

La sincronización es **unidireccional**: la app escribe y la web solo lee. La web no modifica productos, precios, stock ni promociones.

## Requisitos

- Node.js 24 o superior (el exportador usa `node:sqlite`).
- npm.
- Microsoft Edge instalado para ejecutar la prueba de humo (Playwright usa Edge).

## Desarrollo

```bash
cd web
npm install
npm run dev
```

Abre `http://localhost:3001`. Desde la raíz también existe:

```text
Abrir-demo-catalogo.bat
```

## Variables de entorno

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `CATALOG_URL` | No | URL pública de `catalog.json` en Supabase. Sin ella se usa el snapshot local. |
| `ORDERS_URL` | No | URL de `orders-demo.json`. Si falta, se deriva desde `CATALOG_URL`. |
| `CATALOG_REVALIDATE_SECONDS` | No | Revalidación ISR. Por defecto 60 segundos, mínimo 30. |
| `NEXT_PUBLIC_SITE_URL` | No | URL canónica del sitio para metadatos. |

Ejemplo para producción:

```text
CATALOG_URL=https://<proyecto>.supabase.co/storage/v1/object/public/catalogo-web/catalog.json
NEXT_PUBLIC_SITE_URL=https://bitacore-tech-app.vercel.app
```

`CATALOG_URL` es de servidor: no se expone al navegador. La clave secreta de Supabase **no** se configura en Vercel; solo vive cifrada en la app.

## Regenerar el snapshot local

La app puede publicar desde **Configuración → Catálogo web** o desde **Promociones → Publicar catálogo web**. La publicación automática es opcional y viene desactivada por defecto. También se puede regenerar manualmente leyendo `%APPDATA%\BitacoreTech\bitacoretech.db` y copiando las imágenes a `web/public/products`:

```bash
cd web
npm run export:catalog
```

Se excluyen:

- Servicios.
- Insumos de taller.
- Productos inactivos.
- Productos con `publish_web = 0`.
- Productos `Usado`, `Para repuesto`, `Otro` o sin condición.
- El producto de pruebas `USB GENERIC` (`00000000000`).

La casilla **Publicar en catálogo web** de cada referencia es la que decide dentro de las condiciones elegibles. Solo `Nuevo` y `Reacondicionado` pueden publicarse; `Usado`, `Para repuesto`, `Otro` y las referencias sin condición quedan bloqueadas y desmarcadas. El `catalog.json` incluye `stockVisibility` con el valor `always` u `outOnly` configurado en la app.

El JSON público no incluye el precio del servicio “Hora Servicio Técnico”. Las promociones se leen de las tablas `promotions` y `promotion_targets`; solo salen las activas, vigentes y publicadas en web.

## Pruebas

Con la web local activa en 3001:

```bash
cd web
npm run test:smoke
```

Cubre home, carrusel, header, catálogo, ficha, carrito, servicios, órdenes, 404, móvil y movimiento reducido. Usa Microsoft Edge headless y guarda capturas en `%TEMP%\opencode\catalogo-web-shots`.

Para validar la lectura remota, sin tocar Supabase real:

```bash
cd web
npm run test:remote
```

Ese comando levanta un servidor HTTP con un catálogo modificado, compila Next con `CATALOG_URL`, inicia la web en el puerto 3013 y comprueba home, catálogo, ficha, seguimiento, imágenes y la etiqueta “Más vendido”. Al terminar, vuelve a compilar sin `CATALOG_URL` si quieres dejar el build local.

En modo desarrollo no uses `127.0.0.1` para la prueba de humo: Next bloquea el HMR de ese origen y el cliente no hidrata. Usa `localhost`.

## Despliegue en Vercel

- Proyecto conectado a `VibeDKC/bitacore-tech-app`.
- Root Directory: `web`.
- Framework: Next.js.
- Variables: `CATALOG_URL` y, opcionalmente, `NEXT_PUBLIC_SITE_URL`.
- Después de cambiar una variable, haz redeploy.

## Alcance actual

- Home con hero y carrusel de 9 destacados uno a uno.
- Etiqueta “Promoción” solo con promociones reales.
- Etiqueta “Más vendido” con ventas de los últimos 30 días y mínimo 2 unidades.
- 39 referencias activas, 24 con imagen y 15 con placeholder.
- Búsqueda por nombre, SKU o categoría sin exigir tildes.
- Categorías, orden y disponibilidad configurable.
- Carrito local con mensaje de WhatsApp y pedido para recoger en tienda.
- Precio, condición y garantía reales del snapshot.
- Promociones con alcance por SKU/categoría/todo, vigencia, prioridad y publicación web.
- Publicación remota en Supabase y respaldo local.
- Servicios sin precio por hora; revisión inicial sujeta a cotización.
- Consulta demo de OT con número y código.
- Diseño responsive y contacto por WhatsApp en la barra superior y el pie.

No incluye pagos en línea, cuentas de cliente, portal de OT con datos reales ni edición del catálogo desde la web. Eso queda para fases posteriores.
