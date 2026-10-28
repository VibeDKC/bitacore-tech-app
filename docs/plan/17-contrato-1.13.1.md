# Contrato 1.13.1 — Carrito y reglas del catálogo web

Fecha: 28 de octubre de 2026

## Alcance

Completar la experiencia de compra del catálogo público y cerrar las reglas de publicación por referencia, sin agregar pagos ni pedidos en línea. La app sigue siendo la única fuente de verdad y la sincronización con la web sigue siendo unidireccional.

- Carrito local en la web.
- Mensaje de WhatsApp con referencias, cantidades, precios y total.
- Recogida en tienda como única modalidad de entrega.
- Visibilidad de stock configurable.
- Publicación por referencia con la casilla `publish_web`.
- Regla de condición para usados/reacondicionados.
- Sin migración de base de datos; el esquema sigue en 14.

## Decisiones

### Carrito

- El carrito vive en el navegador (`localStorage`) y no crea pedidos en la base.
- Cada línea guarda el id del producto y la cantidad; el catálogo se resuelve contra el snapshot vigente.
- La cantidad se limita al stock conocido.
- El botón final abre WhatsApp con:
  - nombre y referencia de cada producto;
  - cantidad y precio unitario;
  - total de referencias;
  - aviso de recogida en tienda.
- Los productos agotados no se incluyen en el mensaje.

### Visibilidad de stock

- `stockVisibility = 'outOnly'` es el valor predeterminado.
- En `outOnly` la web no muestra “Disponible”, “Última unidad” ni “Pocas unidades”; solo muestra “Agotado” cuando el stock es cero.
- En `always` la web muestra la etiqueta de disponibilidad actual.
- El número exacto de stock puede seguir en `catalog.json` para calcular el límite del carrito; no se muestra en la interfaz cuando está oculto.
- El valor se configura en **Configuración → Catálogo web → Stock en la web**.

### Publicación por referencia

- La casilla **Publicar en catálogo web** viene marcada por defecto en referencias elegibles.
- Solo `Nuevo` y `Reacondicionado` son elegibles para la web.
- En `Usado`, `Para repuesto`, `Otro` o sin condición la casilla queda desmarcada y bloqueada.
- La migración despublica automáticamente las referencias no elegibles que estuvieran marcadas.
- El publicador y el exportador filtran por condición, además de `publish_web`; la elegibilidad también se valida al crear o editar.
- El exportador local usa la misma regla que la publicación remota.

### Recogida en tienda

- La ficha, el catálogo, el carrito y los mensajes de WhatsApp hablan de recogida en tienda, no de entrega a domicilio.
- La dirección física sigue pendiente; por ahora se coordina por WhatsApp en Medellín.

## Fuera de alcance

- Pedidos en línea con base de datos.
- Pagos en línea.
- Cuentas de cliente.
- Portal de OT con datos reales.
- Galería de múltiples imágenes.
- Cambio de dominio o retiro de la web vieja de MTO APP.

## Pruebas

- `npm run test:acceptance:1.13.1` — 23/23.
- Smoke empaquetado 1.13.1 — 23/23.
- `npm run test:acceptance:1.13.0` — 30/30 como regresión.
- Web local: `npm run test:smoke` — 39/39.
- Web remota: `npm run test:remote` — 7/7.
- Typecheck y build de app y web.
- Smoke empaquetado 1.13.1.

## Criterio de cierre

1. La web permite agregar, cambiar cantidades, quitar y vaciar el carrito.
2. El mensaje de WhatsApp contiene referencias, cantidades, precios y total.
3. La web solo muestra “Agotado” cuando la configuración es `outOnly`.
4. Una referencia con `publish_web = 0` no aparece en el catálogo.
5. Un usado, un repuesto para partes o un producto sin condición no se publica.
6. Se documenta el resultado y se genera el instalador.
