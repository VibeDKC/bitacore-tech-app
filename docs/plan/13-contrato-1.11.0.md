# Contrato 1.11.0 — Cuentas de pago, caja y trazabilidad

Fecha: 27 de octubre de 2026

## Alcance

Esta versión incorpora cuentas de pago configurables, una cuenta de ingresos con administrador responsable, caja con base 0 y cierre por conteo total, comprobantes por pago en POS y OT, importación de bases para administradores y trazabilidad de ventas, producción y compras por usuario.

La versión mantiene el método de pago del POS sin cambios. Los pagos digitales se enrutan automáticamente a la cuenta de ingresos activa.

## Decisiones

- Las cuentas de compra forman una sola lista; el canal se deduce de la cuenta seleccionada.
- Los canales de compra son **Efectivo**, **Transferencia** y **Tarjeta**.
- Una cuenta de compra puede vincularse a la cuenta de ingresos para descontar compras y abonos.
- Una cuenta de compra con canal **Efectivo** no puede vincularse a la cuenta de ingresos.
- Solo puede existir una cuenta de ingresos activa.
- La cuenta de ingresos debe estar vinculada a un administrador activo.
- QR, transferencia y Bre-B se cobran con el método existente y se registran en la cuenta de ingresos.
- Si no hay una cuenta de ingresos activa, el cobro digital se rechaza con un mensaje de configuración.
- La base inicial de caja es 0 por defecto y es editable.
- El cierre permite conteo total o por denominaciones, incluso con conteo 0 y diferencia negativa.
- El efectivo contado queda como base del siguiente turno.
- Para depositar se usa **Trasladar a banco**; no se descuenta automáticamente al cerrar.
- El traslado del administrador vinculado se aprueba automáticamente. Los traslados de otros usuarios quedan pendientes.
- El administrador vinculado puede editar el monto, aprobar o rechazar. La aprobación exige una caja abierta.
- Se adjunta como máximo un comprobante por pago, en imagen o PDF de hasta 8 MB.
- Los comprobantes se guardan localmente y se incluyen en los respaldos.
- Los administradores importan `.bctbackup` escribiendo la contraseña del archivo.
- Solo el propietario configura, cambia, revela o copia la contraseña de respaldo y ejecuta restauraciones locales.
- Los diccionarios solo los administran el propietario y los administradores.
- Los administradores pueden ser vendedores y técnicos; el superadmin no se asigna como técnico.
- Las ventas se atribuyen al vendedor de la factura; las OT al técnico responsable; las compras al comprador.
- El reporte de compras por usuario está activo por defecto y se puede desactivar sin borrar la atribución.
- Técnicos y cajeros ven solo su rendimiento personal, sin costos ni márgenes.

## Modelo de datos

### Migración 13

- `dictionary_nodes.channel`.
- `dictionary_nodes.responsible_user_id`.
- `dictionary_nodes.linked_income_account_id`.
- `invoices.created_by_name`.
- `invoices.created_by_role`.
- `purchases.created_by_name`.
- `purchases.created_by_role`.
- `purchases.payment_account`.
- `purchases.payment_account_id`.
- `supplier_payments.payment_account`.
- `supplier_payments.payment_account_id`.
- `payments.income_account_id`.
- `payments.income_account_name`.
- `payments.created_by_role`.
- `cash_sessions.carry_over_cents`.
- Tabla `payment_receipts`.
- Tabla `cash_transfers`.
- Tabla `account_movements`.

La migración conserva registros, integridad y claves foráneas. No modifica pagos existentes porque la tabla `payments` es append-only.

### Cuentas por defecto

- `income_account`: **Cuenta de ingresos**, canal Digital, activa y vinculada al primer administrador activo cuando existe.
- `purchase_payment_account`: **Efectivo**, **Transferencia**, **Tarjeta** y **Cuenta de ingresos**.
- **Cuenta de ingresos** de compras queda vinculada a la cuenta de ingresos.
- Las cuentas se siembran una sola vez y no se reactivan si el administrador las desactiva.

## Cuentas de pago

- **Compras** usa una lista única de cuentas de pago.
- El formulario guarda `payment_account_id` y `payment_account` en la compra.
- Los abonos a proveedores guardan la cuenta utilizada.
- Un pago con cuenta vinculada registra un egreso en `account_movements`.
- Una compra pagada en efectivo se registra en caja y no afecta la cuenta de ingresos.
- El reporte de cuentas muestra ingresos, egresos y saldo por cuenta.
- El nombre de la cuenta se conserva como instantánea histórica en compras, abonos y pagos.

## Caja

- `cash.open` acepta una base editable; si no se envía, usa el `carry_over_cents` del último cierre.
- La interfaz inicia en **Conteo total** y permite cambiar a **Por denominación**.
- `cash.close` acepta conteo 0 y calcula la diferencia aunque sea negativa.
- El cierre guarda `counted_cents`, `difference_cents` y `carry_over_cents`.
- El efectivo para base no puede superar el efectivo contado.
- **Trasladar a banco** crea una solicitud con monto y nota.
- El administrador responsable de la cuenta recibe la solicitud y la ve en Caja y en las notificaciones.
- Si el responsable solicita el traslado, se aprueba automáticamente.
- La aprobación descuenta el efectivo del turno abierto y registra el ingreso en la cuenta.
- El rechazo exige motivo y deja el efectivo en caja.
- Las solicitudes y resoluciones quedan en auditoría.

## Comprobantes de pago

- Un comprobante por pago.
- Formatos: PNG, JPEG, WebP y PDF.
- Límite: 8 MB.
- Las imágenes se comprimen a un máximo de 1600 px antes de enviarse.
- Se guardan en `payment-receipts/<paymentId>/<hash>.<ext>`.
- Se sirven por `bitacoretech-evidence://local/payment-receipts/...`.
- Se pueden adjuntar en ventas POS, anticipos de OT y liquidación de OT.
- El comprobante se abre con la aplicación del sistema; no hay visor interno.
- El respaldo completo, el respaldo cifrado y la restauración incluyen los comprobantes.
- La purga elimina los archivos y deja auditoría.

## Atribución y reportes

- Cada factura guarda vendedor y rol.
- Cada compra guarda comprador y rol.
- Cada OT conserva su técnico responsable; la factura de la OT conserva además el vendedor que la cobró.
- Reporte **Ventas por usuario**: facturas, ventas, margen y ticket promedio.
- Reporte **Producción por técnico**: OTs facturadas, servicios, repuestos, ventas y margen.
- Reporte **Compras por usuario**: compras, ítems, total, IVA y margen estimado con el precio de venta actual.
- El margen de compras es estimado, no realizado.
- El interruptor de rastreo oculta el reporte de compras, pero conserva comprador y auditoría.
- El Dashboard muestra **Mi rendimiento** de los últimos 30 días.
- Técnicos y cajeros no ven costos ni márgenes.

## Permisos y respaldos

- `importBackup`: propietario y administrador.
- `restoreBackup`: solo propietario.
- `backups.setPassword` y `backups.revealPassword`: solo propietario.
- `backups.import`: administrador con contraseña del archivo; propietario puede usar la contraseña guardada.
- La interfaz del administrador muestra **Importar base**, pero oculta el campo de contraseña y el botón **Copiar**.
- `manageDictionaries`: propietario y administrador.
- `orders.technicians`: técnicos y administradores activos; nunca el superadmin.
- Las cuentas de pago no se listan a técnicos ni cajeros.

## Interfaz

- **Compras**: selección de cuenta de pago, visualización de cuenta y comprador, y abonos por cuenta.
- **Revisión IA de compras**: cuenta de pago editable.
- **Caja**: cuenta de ingresos, traslados pendientes, aprobación con monto editable, rechazo y conteo total.
- **POS**: campo de comprobante en el cobro y visualización en el historial.
- **OT**: comprobante en anticipo y en liquidación; visualización por pago.
- **Reportes**: ventas por usuario, producción por técnico, compras por usuario y cuenta de ingresos.
- **Dashboard**: rendimiento personal.
- **Configuración**: interruptor de rastreo de compras, importación para administradores y contraseña oculta para administradores.
- **Diccionarios**: canal, cuenta de ingresos vinculada y administrador responsable.

## Pruebas

- Aceptación 1.11.0: 34/34.
- Migración 13 sobre copia real: OK.
- Regresión 1.10.3: 26/26.
- Regresión f4f5: 14/14.
- Smoke empaquetado de aceptación: 34/34.
- Smoke empaquetado de migración: OK.
- Typecheck y build: OK.

## Fuera de alcance

- Conciliación bancaria y extractos.
- Integración específica con Bre-B o pasarelas QR.
- Visor interno de comprobantes.
- Múltiples comprobantes por pago.
- Exportación selectiva de comprobantes.
- Importación selectiva de datos desde un respaldo.
- Reversión automática de movimientos de cuenta al anular una factura.
- Desglose de la porción digital en pagos mixtos.
