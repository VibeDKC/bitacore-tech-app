# Contrato 1.13.0 — Catálogo remoto con Supabase y Vercel

Fecha: 28 de octubre de 2026

## Alcance

Publicar el catálogo de OCTESTR en Supabase Storage y hacer que la web de Next.js lo lea desde ahí, manteniendo un respaldo local. La sincronización es **unidireccional**: la app publica y la web solo lee.

- La app sigue siendo la única fuente de verdad.
- La web no escribe en Supabase ni modifica productos, precios, stock o promociones.
- No se agregan tablas nuevas ni migraciones de base de datos; la versión de esquema sigue en 14.
- Se reutiliza el proyecto Supabase actual y el bucket `catalogo-web`, público de lectura.
- La clave secreta se guarda cifrada en la app; nunca viaja a la web, al repositorio ni al chat.
- Vercel sirve la web y lee el catálogo remoto con ISR.

## Decisiones

### Dirección de la sincronización

```text
App OCTESTR (SQLite)
        │ publica snapshot + imágenes
        ▼
Supabase Storage (bucket catalogo-web, lectura pública)
        │ solo lectura
        ▼
Web Next.js en Vercel
```

No hay escritura desde la web. Un carrito o pedido en línea sería otro flujo (web → base de pedidos), fuera de 1.13.

### Archivos publicados

En la raíz del bucket:

- `catalog.json`
- `orders-demo.json`

En `products/`:

- Una imagen por producto publicado, con el nombre `${product.id}${extensión}`.

El `catalog.json` remoto usa URLs absolutas de Supabase para las imágenes, con un parámetro `?v=<hash>` para invalidar caché cuando cambia la imagen. El JSON y las órdenes se suben después de las imágenes, para no dejar referencias rotas.

### Configuración en la app

**Configuración → Catálogo web**:

- URL del proyecto Supabase.
- Bucket.
- Clave secreta (service role / secret key), cifrada con `safeStorage`.
- Probar conexión.
- Publicar en Supabase.
- Activar Supabase como destino de la web.
- Estado remoto: última publicación, productos, imágenes, promociones, tamaño y error.
- Respaldo local: carpeta, publicación manual y automática opcional.

La publicación automática sigue desactivada por defecto. Si se activa, publica el respaldo local y, si Supabase está habilitado, también el remoto.

### Seguridad

- La clave se guarda cifrada en `catalog_config.remote.secretCipher`.
- `settings.get` y `catalog.status` no devuelven la clave ni el texto cifrado.
- Solo propietario y administradores con `publishCatalog` pueden configurar, probar y publicar.
- Los errores de Supabase se muestran sin incluir la clave.
- La clave pública (`sb_publishable_...`) se rechaza para escritura.
- El bucket es público de lectura; la escritura requiere la clave secreta.

### Web

- Variable de entorno `CATALOG_URL` con la URL pública de `catalog.json`.
- `ORDERS_URL` opcional; si no existe, se deriva `orders-demo.json` desde `CATALOG_URL`.
- Sin `CATALOG_URL`, la web usa el snapshot local commiteado.
- Si el remoto falla, la web usa el snapshot local y registra el aviso en el servidor.
- Revalidación cada 60 segundos (`CATALOG_REVALIDATE_SECONDS` permite ajustarlo).
- Las fichas de producto nuevas se generan con `dynamicParams`.
- Las imágenes remotas se sirven directamente desde Supabase.

### Más vendidos

- Regla: ventas activas de los últimos 30 días, mínimo 2 unidades por producto.
- Se calcula sobre `invoice_items.product_id`; las facturas antiguas sin `product_id` no cuentan.
- El snapshot incluye `bestSellers` y `bestSeller` por producto.
- La web muestra “Más vendido” solo cuando la regla se cumple.
- Si no hay datos suficientes, no se muestra la etiqueta.

## Fuera de alcance

- Carrito y pedidos en línea (1.13.1/1.14).
- Portal de OT con datos reales.
- Sincronización bidireccional.
- Edición del catálogo desde la web.
- Migración de la web vieja de MTO APP y cambio de dominio.
- Múltiples imágenes por producto.
- Publicación de stock en tiempo real por WebSocket.

## Pruebas

- Aceptación 1.13.0 con Supabase simulado: 30/30.
- Smoke empaquetado 1.13.0: 30/30.
- Web remota: 7/7.
- Web local: 37/37.
- Regresión 1.12.0: 22/22.
- Migración 1.12.0 (esquema 14): OK.
- Regresión 1.11.0: 34/34.
- Regresión 1.10.3: 26/26.
- Typecheck y build de app y web: OK.
- Instalador 1.13.0 generado.
- Prueba contra el proyecto Supabase real: pendiente de ingresar la clave en la app.

## Criterio de cierre

1. La app publica `catalog.json`, `orders-demo.json` e imágenes en `catalogo-web`.
2. La web de Vercel lee el catálogo remoto con `CATALOG_URL`.
3. La clave no aparece en la web, el repositorio ni el chat.
4. La web vieja de MTO APP sigue intacta hasta el corte de dominio.
5. Se documenta el resultado y se genera el instalador.
