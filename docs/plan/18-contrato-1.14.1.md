# Contrato 1.14.1 — Identidad, permisos y operación de OT

Fecha: 28 de octubre de 2026

## Alcance

La versión 1.14 se dividió en dos bloques y se entrega como **1.14.1**:

- **Bloque A (1.14.0):** superadmin oculto, primer arranque solo con administrador, administradores que crean admins y módulo de permisos por módulos/submódulos.
- **Bloque B (1.14.1):** facturación separada de entrega, mano de obra consolidada, anticipos, crédito autorizado, reportes separados, purga parcial/total y código de seguimiento con portal real.

La app sigue siendo local y la web solo lee. El esquema pasa a **16**.

## Decisiones

### Identidad

- La base se crea con una cuenta raíz **Propietario** oculta y protegida.
- El primer arranque ya no crea la cuenta raíz: muestra el formulario para crear la cuenta **Administrador**.
- La cuenta raíz no aparece en la lista de usuarios para nadie excepto para sí misma.
- Los administradores pueden crear y elevar administradores.
- Un administrador no puede ver ni modificar la cuenta raíz.
- El último administrador activo no puede desactivarse ni degradarse.
- La restauración de respaldos vuelve a garantizar la existencia de la cuenta raíz.

### Permisos

- El módulo de permisos se organiza por rol, módulos y acciones.
- El administrador puede editar roles y permisos, pero las opciones exclusivas del propietario se ocultan.
- Los módulos controlan la navegación y el backend; las acciones controlan operaciones específicas.
- El módulo de auditoría y las capacidades destructivas siguen siendo exclusivos del propietario.

### OT, mano de obra y facturación

- Se pueden agregar varias líneas internas de mano de obra.
- La factura y la impresión muestran una sola línea **Mano de obra** con la suma.
- Los repuestos conservan su línea y su garantía.
- **Facturar** crea la factura sin entregar.
- La entrega normal exige que el saldo esté pago.
- La entrega a crédito solo se permite si el cliente está marcado como autorizado y el usuario tiene la capacidad `authorizeCredit`.
- El anticipo sigue entrando a caja en el momento; no se convierte en venta hasta que exista factura.
- La factura se reconoce al facturar y la entrega se registra después.

### Reportes

- Ventas POS y ventas OT se muestran separadas.
- Se conserva el total general, el margen y la utilidad según permisos.

### Purga

- **Todo:** operación, inventario, clientes, proveedores y promociones.
- **Solo movimiento operativo:** ventas, OT, compras, caja y numeraciones; conserva inventario y clientes.
- **Selección manual:** permite elegir bloques; inventario, clientes o proveedores incluyen automáticamente la operación para no dejar referencias huérfanas.
- Antes de purgar se crea un respaldo completo y se exige la contraseña del propietario.
- Se conservan usuarios, configuración, respaldos y auditoría.
- Al terminar se republica el catálogo resultante.

### Seguimiento

- Cada OT recibe un código aleatorio `SG-` no incremental.
- El código se imprime en la OT y el comprobante.
- El portal público busca por número de OT + código.
- La web solo recibe el hash del código, nunca el código en texto plano.
- El QR sigue inactivo por defecto.

## Fuera de alcance

- Pagos en línea.
- Cuentas de cliente.
- Conciliación bancaria.
- Firma de código del instalador.
- Multiequipo.

## Pruebas

- Aceptación 1.14.1: 22/22.
- Aceptación 1.14.0: 20/20 base; 22/22 con validación del propietario.
- Regresión 1.13.1: 23/23.
- Regresión 1.13.0: 30/30.
- Web local: 39/39.
- Web remota: 7/7.
- Typecheck y build de app y web.
- Smoke empaquetado 1.14.1.

## Criterio de cierre

1. El primer arranque crea un administrador y oculta al propietario.
2. Los administradores pueden crear y elevar administradores.
3. Los permisos por módulo bloquean navegación y backend.
4. Facturar no entrega; entregar exige pago o crédito autorizado.
5. La factura muestra una sola línea de mano de obra.
6. La purga parcial conserva lo no seleccionado.
7. El portal real valida número + código por hash.
8. Se documenta y se genera el instalador 1.14.1.
