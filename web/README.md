# Catálogo web BitacoreTech

Demo de catálogo público construida con Next.js, usando un snapshot de la base local de OCTESTR. Pertenece a la fase F6 (catálogo web) y todavía no tiene sincronización automática ni despliegue público.

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

El catálogo se genera leyendo `%APPDATA%\BitacoreTech\bitacoretech.db` y copiando las imágenes a `web/public/products`.

```bash
cd web
npm run export:catalog
```

El script excluye:

- Servicios.
- Insumos de taller.
- El producto de pruebas `USB GENERIC` (`00000000000`).
- Productos inactivos.

El JSON público no incluye el precio del servicio “Hora Servicio Técnico”.

## Prueba de humo

Con la demo activa en 3001:

```bash
cd web
npm run test:smoke
```

La prueba usa `http://localhost:3001` (se puede cambiar con `BASE_URL`), Microsoft Edge en modo headless y guarda capturas en `%TEMP%\opencode\catalogo-web-shots` (se puede cambiar con `SHOTS_DIR`). Cubre home, carrusel del hero cada 4 segundos, header, catálogo, ficha, servicios, órdenes, 404, móvil y movimiento reducido. `playwright-core` se reutiliza desde las dependencias de la raíz.

En modo desarrollo no uses `127.0.0.1` para la prueba: Next bloquea el HMR de ese origen y el cliente no hidrata. La demo y el `.bat` usan `localhost`.

## Alcance de esta fase

- Home con hero y carrusel de 9 destacados uno a uno (3 promociones + 6 destacados).
- 39 referencias activas, 24 con imagen y 15 con placeholder.
- Búsqueda por nombre, SKU o categoría sin exigir tildes.
- Categorías, orden y disponibilidad.
- Precio, condición y garantía reales del snapshot.
- Promociones de demostración (no hay módulo real todavía).
- Servicios sin precio por hora; revisión inicial sujeta a cotización.
- Consulta demo de OT con número y código.
- Diseño responsive y contacto por WhatsApp en la barra superior y el pie.

No incluye carrito, pagos, cuentas, promociones reales, sincronización automática, portal de OT con datos reales ni despliegue. Eso corresponde a fases posteriores.
