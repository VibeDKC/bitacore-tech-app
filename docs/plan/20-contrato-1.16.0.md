# Contrato 1.16.0 — Taller y cartera

Fecha: 28 de octubre de 2026

## Alcance

La versión 1.16 cierra el bloque de **taller y cartera** con dos frentes:

- **Cartera:** cupo y días de crédito por cliente, vencimientos, consulta de saldos, antigüedad de la deuda y abonos después de entregar la OT.
- **Taller:** estado de garantía por OT entregada, pestaña de garantías y riesgo de abandono según el snapshot legal.

No se agregan PDFs nuevos. La base sube al esquema **17**.

## Decisiones

### Crédito del cliente

- El cupo se expresa en pesos y **0 significa sin límite**.
- Los días de crédito se guardan por cliente, con rango de 1 a 365 y 30 por defecto.
- El cupo se valida antes de autorizar una entrega a crédito.
- La exposición del cliente suma el saldo pendiente de sus facturas a crédito activas.
- Si el cupo no alcanza, la entrega se rechaza con el saldo disponible.
- Cambiar cupo o días requiere `manageLoyalty`.

### Facturas a crédito

- El vencimiento se calcula al entregar la OT: fecha de entrega + días de crédito.
- La factura conserva la fecha de vencimiento aunque el cliente cambie sus días después.
- El saldo se calcula con todos los pagos vinculados a la OT, incluidos anticipos y abonos.
- Las facturas a crédito se reconocen con `credit_authorized = 1`.

### Cartera

- Nuevo módulo **Cartera** con permiso de acceso por rol.
- Resumen de saldo total, vencido, por vencer (7 días) y al día.
- Antigüedad de la deuda vencida: 1–30, 31–60, 61–90 y +90 días.
- Listado por factura/OT con cliente, teléfono, vencimiento, total, abonado, saldo y estado.
- Búsqueda por cliente, factura, OT o teléfono; filtros por estado.
- Recordatorio por WhatsApp con el saldo y el vencimiento.
- Exportación CSV.

### Abonos de cartera

- Se registran desde Cartera después de la entrega.
- Métodos: Efectivo, Transferencia, Tarjeta y Mixto.
- El abono entra a caja y, si es digital, mueve la cuenta de ingresos.
- Respeta la regla de comprobante digital obligatorio de 1.15.
- No supera el saldo pendiente.
- Queda como pago append-only vinculado a la OT y a la factura.
- Requiere la capacidad `collectReceivables`; por defecto la tienen propietario, administrador y cajero.
- El historial de pagos y el comprobante se consultan desde el detalle de cartera.

### Garantías

- La garantía de una OT entregada se calcula con los días del snapshot legal.
- Estados: **vigente**, **por vencer** (30 días o menos) y **vencida**.
- Se muestra en la lista de OT y en la tarjeta de cierre financiero.
- La pestaña **Garantías** muestra las OT con garantía vigente o por vencer.
- Los repuestos conservan su garantía individual existente.

### Abandono

- Se calcula con los días del snapshot legal de la OT.
- Aplica a OT abiertas (no entregadas y no marcadas como no reparadas).
- Se muestra un aviso en el detalle de la OT.
- Se agrega una notificación en el panel cuando hay equipos en riesgo.

## Fuera de alcance

- Crédito directo desde el POS.
- Facturación electrónica DIAN.
- Pagos en línea o conciliación bancaria.
- Recordatorios automáticos programados por WhatsApp.
- Cuotas, intereses o mora.
- Firma de código del instalador.

## Pruebas

- Aceptación 1.16.0: 36/36.
- Smoke empaquetado 1.16.0: 36/36.
- Regresión 1.15.0: 44/44.
- Regresión 1.14.1: 19/19 sin propietario.
- Regresión 1.14.0: 20/20 base.
- Regresión 1.13.1: 23/23.
- Regresión 1.13.0: 30/30.
- Typecheck y build de app.
- Migración 17 sobre una base 1.15.

## Criterio de cierre

1. El cliente tiene cupo y días de crédito configurables.
2. La entrega a crédito respeta el cupo disponible.
3. La factura a crédito guarda su vencimiento.
4. Cartera muestra saldo, vencimiento, antigüedad y estado.
5. Se puede registrar un abono después de entregar la OT.
6. El abono baja el saldo, entra a caja y respeta el comprobante digital.
7. La OT queda saldada cuando se cubre el total.
8. La garantía de una OT entregada muestra estado y vencimiento.
9. El riesgo de abandono aparece en la OT y en las notificaciones.
10. Se documenta y se genera el instalador 1.16.0.
