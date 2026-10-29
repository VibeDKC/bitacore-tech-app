# Contrato 1.18.0 — Garantías, abandono y despiece

Fecha: 29 de octubre de 2026

## Alcance

La versión **1.18.0** implementa el flujo de garantía posterior a la entrega y el cierre de equipos abandonados con traspaso a despiece.

Incluye:

- Reclamo de garantía vinculado a una OT entregada.
- Pruebas de garantía en taller y en las condiciones del cliente.
- Entrega de garantía sin cobro.
- Abandono con traspaso a despiece.
- Bloqueo de acceso persistente después de 5 intentos.
- Variante del logo para fondos oscuros.

La base sube al esquema **19**.

## Decisiones

### Reclamo de garantía

- Solo se puede crear desde una OT **entregada** con garantía vigente.
- Se crea una OT nueva con número consecutivo nuevo, vinculada a la original.
- El cliente y el equipo se reutilizan; no se duplica la ficha.
- La OT de garantía no crea venta, factura, pago ni movimiento de caja.
- Se registran:
  - pruebas realizadas en taller;
  - condiciones en casa del cliente;
  - accesorios o condiciones relevantes;
  - resultado: pendiente, sin falla reproducida, falla reproducida o no cubierta;
  - recomendaciones.
- Si no se reproduce la falla, se entrega sin cobro.
- Si se reproduce y está cubierta, se repara sin cobro; los repuestos cubiertos descuentan stock y registran costo.
- Si no está cubierta, se debe crear una OT normal para cobrar.
- La garantía original no se extiende automáticamente.
- No se permite más de un reclamo abierto por OT original.
- La pestaña Garantías muestra las OT con garantía vigente y los reclamos vinculados.

### Abandono y despiece

- La acción solo aplica a OT abiertas que superen los días de abandono del snapshot legal.
- Requiere autorización de propietario o administrador.
- La OT se cierra como **Abandonado**.
- Se crea un producto en la categoría **Despiece**, ubicación **Caja de despiece**, con stock 1, sin publicación web.
- Se registra el movimiento `traspaso_despiece` y un evento en la OT.
- El serial del equipo se conserva si está disponible.
- La deuda pendiente no se cancela automáticamente.
- No se implementan recordatorios automáticos, reclamación de garantía formal ni mantenimientos recurrentes.

### Acceso

- Se mantiene el bloqueo de 5 intentos fallidos.
- El bloqueo dura un minuto y ahora se guarda en la base, por lo que persiste entre reinicios.
- No se implementa recuperación de clave del propietario.

### Marca

- Se agrega una variante del logo para fondos oscuros.
- Se usa en la pantalla 404 oscura.

## Fuera de alcance

- Devoluciones de ventas y compras.
- Reverso o anulación de abonos.
- Filtros de compras.
- Venta POS a crédito.
- Comparación de precios entre proveedores.
- Catálogo y web.
- Facturación electrónica DIAN.
- Pagos en línea.
- Firma de código del instalador.

Estos puntos quedan para 1.18.1 o posteriores, según decisión del negocio.

## Criterio de cierre

1. Una OT entregada con garantía vigente puede generar un reclamo.
2. El reclamo queda vinculado y no genera venta.
3. Las pruebas de garantía se guardan y se muestran.
4. La entrega de garantía no cobra ni factura.
5. La OT original muestra sus reclamos.
6. Una OT vencida en abandono puede trasladarse a despiece.
7. Se crea el producto de despiece y su movimiento.
8. El bloqueo de 5 intentos persiste tras reiniciar.
9. La base migra a esquema 19 sin perder datos.
10. Se generan pruebas, documentación e instalador.
