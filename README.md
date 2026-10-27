# BitacoreTech · Taller & POS

Aplicación de escritorio para gestionar un taller técnico y su punto de venta: recepción de equipos, evidencias fotográficas, órdenes de trabajo, inventario, compras, caja, ventas, reportes, auditoría y configuración.

Está construida con **Electron**, **React**, **TypeScript**, **Vite** y **SQLite** local (`node:sqlite`). Los datos se guardan en el equipo del negocio; no requiere internet ni un servidor externo.

## Requisitos

- Windows 10/11 x64.
- Node.js 24 o superior (la app usa el módulo integrado `node:sqlite`).
- npm.

## Desarrollo

```bash
npm install
npm run dev
```

Esto abre la aplicación Electron con recarga en caliente del renderer.

Para probar el build de producción sin empaquetar:

```bash
npm run build
npm start
```

## Primer arranque

La primera vez **no se crean usuarios ni credenciales por defecto**. La aplicación muestra la pantalla **Configura tu taller**, donde se registra:

- Nombre del propietario.
- Nombre del taller o negocio.
- Usuario y contraseña (mínimo 8 caracteres).
- Correo de contacto opcional.

La configuración inicial crea la cuenta raíz, registra la auditoría y genera un respaldo completo. En ese momento se puede elegir **Cargar datos de demostración** para probar la aplicación con productos, clientes y OT ficticias. Las cuentas demo de ese modo reciben contraseñas aleatorias; no se publican credenciales conocidas.

Si actualizas desde una instalación anterior, la base existente conserva sus usuarios y datos. Cambia las contraseñas demo desde **Configuración → Seguridad** antes de usar información real.

## Datos, evidencias y respaldos

- La base se crea en `%APPDATA%\BitacoreTech\bitacoretech.db`.
- Las fotografías se guardan como archivos en `%APPDATA%\BitacoreTech\evidence\`.
- Los respaldos se guardan en `%APPDATA%\BitacoreTech\backups\`.
- Si existe una instalación anterior en `%APPDATA%\octestr-taller`, la app migra automáticamente la base, los respaldos y las evidencias a la carpeta nueva. La carpeta anterior se conserva intacta. Si la migración falla, la aplicación se detiene con un mensaje claro en lugar de arrancar con datos vacíos.
- Variables de entorno de soporte:
  - `BITACORETECH_DB_PATH`: ruta alternativa para la base de datos.
  - `OCTESTR_DB_PATH`: compatibilidad con la versión anterior, se usa si no existe la anterior.
  - `BITACORETECH_DATA_PATH` y `BITACORETECH_LEGACY_DATA_PATH`: aíslan las carpetas de datos en pruebas o instalaciones portables.
- El seed solo se ejecuta cuando la base está vacía. También existe la purga auditada desde Configuración, que conserva usuarios, configuración, respaldos y auditoría.

### Respaldos completos

Cada respaldo nuevo es una carpeta dentro de `backups\` con:

- `database.db`: copia consistente de SQLite.
- `evidence/`: todas las fotografías y miniaturas.
- `manifest.json`: manifiesto con versión, conteos, hashes SHA-256 del archivo de base y de cada evidencia.

Los respaldos `.db` de versiones anteriores se siguen pudiendo restaurar. Al restaurar un respaldo legado solo se recupera la base: se eliminan las evidencias actuales y no se recuperan fotografías. La interfaz advierte esta diferencia antes de continuar.

La purga crea primero un respaldo completo, elimina las fotografías de las OT purgadas y conserva los respaldos para auditoría.

### Evidencias fotográficas

- Se pueden cargar archivos o tomar la foto con la cámara del equipo. Si no hay cámara o el permiso falla, la carga de archivos permanece disponible.
- Las imágenes se comprimen a JPEG de máximo 1600 px, sin EXIF ni GPS, y se genera una miniatura de 640 px.
- Límites: 10 fotos por lote, 2.5 MB por foto y 25 MB por OT.
- La foto es opcional: al guardar una recepción sin evidencia se registra una advertencia en el evento y la auditoría. Después se pueden agregar fotos etiquetadas como **reparación** desde el detalle de la OT.
- Las evidencias se guardan junto con la OT en una sola operación. Si una foto falla, no queda una OT con evidencia parcial.
- Una evidencia anulada no se borra físicamente: se conserva auditada y deja de contar como activa.
- Permisos: técnico, administrador y propietario agregan; administrador y propietario anulan, verifican y exportan; el cajero no accede.
- La exportación genera un ZIP con las fotos, un `manifest.json`, hashes SHA-256 y el resultado de integridad por archivo.
- Las evidencias son **solo digitales**: no se imprimen ni se anexan al comprobante A4. En los tickets y en el A4 solo puede aparecer una línea con el número de fotos registradas.

## Roles y permisos

Los permisos se validan en el proceso principal de Electron, no solo en la interfaz.

- **Propietario:** acceso total, utilidad neta, auditoría, restauración, purga y configuración maestra. Puede previsualizar la interfaz como otro rol sin cambiar sus permisos reales.
- **Administrador:** operación completa, costos y margen bruto, usuarios base y configuración. No ve utilidad neta, auditoría, restauración ni purga.
- **Técnico:** recepción, diagnóstico, órdenes, evidencias (agregar), inventario sin costos y clientes.
- **Cajero:** POS, caja, inventario sin costos y clientes. Sin acceso a evidencias.

Las acciones sensibles quedan en la auditoría encadenada por hash SHA-256. La contraseña, el PIN o el patrón del equipo del cliente nunca se almacenan: solo se registra el tipo de bloqueo y si el cliente autoriza el acceso.

## Funcionalidad incluida

- Dashboard por rol, alertas de stock y estado del taller.
- Recepción dinámica de equipos por tipo (portátil, PC, consola, impresora, otro), accesorios, checklist, estado de encendido, bloqueo, falla y presupuesto.
- Alta rápida de clientes y autocompletado por documento, teléfono o correo.
- Evidencias fotográficas del estado del equipo al ingreso y durante la reparación, con verificación de integridad y exportación ZIP.
- Órdenes de trabajo con repuestos, servicios, anticipos, descuentos, garantía, notas, estados e historial.
- Cobro al pasar a `entregado`, con libro de pagos y saldo separado del total. La entrega sin cobro requiere autorización y motivo auditado.
- POS con carrito, descuento por porcentaje o valor, fidelidad automática, efectivo/tarjeta/mixto y factura interna sin IVA. El precio final nunca queda por debajo del costo de compra.
- Catálogo ligero de equipos por cliente, con historial de OT y evidencias; QR interno opcional e inactivo por defecto.
- Fidelidad configurable por cliente (porcentaje o valor, vigencia) y bloqueo de venta bajo costo.
- Permisos por rol y excepciones por usuario, con auditoría y guardrails del propietario.
- NIT colombiano con DV automático y NIT extranjero opcional.
- Respaldos exportables/importables en `.bctbackup` cifrado con contraseña; la contraseña se guarda cifrada con el almacén del sistema.
- Sesión sin “recordar”: se cierra al cerrar la aplicación; duración máxima configurable por horas.
- Layout integrado al borde de la ventana.
- Compras a proveedores con IVA del 19 % y actualización de inventario.
- Proveedores con alta y edición desde la interfaz, filtro de historial y comprobante de compra imprimible.
- Asignación y reasignación de técnico con historial, motivo y auditoría; bloqueo en OT cerradas.
- Historial de cliente con acceso directo a la factura y a la OT seleccionadas.
- Caja con apertura, movimientos, arqueo por denominaciones y cierre de turno.
- Reportes de ventas, compras, margen bruto, utilidad neta restringida y estadísticas por técnico.
- Inventario con SKU, código de barras Code128, seriales, ubicaciones, stock mínimo y exportación CSV.
- Configuración de negocio, usuarios, impresión, respaldos completos, cláusulas legales, IA/API y seguridad.
- Cláusulas legales versionadas con snapshot inmutable por orden de trabajo.

## Impresión

Al imprimir una orden o una venta se muestran los tres formatos disponibles:

- Ticket de 80 mm con altura dinámica.
- Ticket de 58 mm.
- A4 con dos copias, línea de corte y cláusulas completas.

El formato predeterminado de **Configuración → Impresión** solo preselecciona la vista; el selector permanece disponible en cada impresión. Los comprobantes son internos, no reemplazan la facturación electrónica DIAN y no incluyen QR ni firma digital. Las evidencias fotográficas no se imprimen.

## Scripts

| Comando | Uso |
| --- | --- |
| `npm run dev` | Desarrollo con Electron y recarga en caliente. |
| `npm run build` | Verifica TypeScript y genera `out/`. |
| `npm start` | Ejecuta el build de producción. |
| `npm run typecheck` | Solo verificación de tipos. |
| `npm run dist` | Genera el instalador NSIS x64 en `release/`. |
| `npm run test:acceptance:f0f1` | Prueba aislada de primer arranque, login, auditoría y respaldo inicial. |
| `npm run test:acceptance:f2f3` | Prueba aislada de proveedores, compra, comprobante, técnico, OT e historiales. |
| `npm run test:acceptance:f4f5` | Prueba aislada de NIT/DV, permisos, equipos, QR, fidelidad, respaldos y sesión. |
| `npm run test:acceptance:1.5.0` | Historial POS, notas de servicio, inventario editable, alertas, foto y sesión. |
| `npm run test:acceptance:1.6.0` | Diccionarios, jerarquías, ficha estructurada, legado y permisos. |
| `npm run test:acceptance:1.6.1` | Perfil propio, propietario invisible, equipos armados, orden del formulario y N/A. |
| `npm run test:migration:1.5.0` | Migración 5 sobre una copia de la base real. |
| `npm run test:migration:1.6.0` | Migración 6 y diccionarios sobre una copia de la base real. |

## Pruebas de aceptación

Las pruebas usan una carpeta temporal y **no tocan los datos reales** del negocio. Ejecuta primero el build:

```bash
npm run build
npm run test:acceptance:f0f1
npm run test:acceptance:f2f3
npm run test:acceptance:f4f5
npm run test:acceptance:1.5.0
npm run test:acceptance:1.6.0
npm run test:acceptance:1.6.1
npm run test:migration:1.5.0
npm run test:migration:1.6.0
```

Las evidencias quedan en la carpeta temporal que imprime cada script. Los resultados esperados son `8/8 OK`, `15/15 OK`, `14/14 OK`, `12/12 OK`, `14/14 OK` y `12/12 OK`. Las pruebas de migración usan una copia de `%APPDATA%\BitacoreTech\bitacoretech.db` y no modifican la base real.

## Empaquetado

```bash
npm run dist
```

El instalador queda en `release/` como `BitacoreTech-1.6.1-x64.exe`. La configuración de electron-builder está en el bloque `build` de `package.json`:

- `appId`: `co.bitacoretech.taller`
- `productName`: `BitacoreTech`
- Ícono: `build/icon.png`
- NSIS x64 con GUID estable `d9257d69-156f-58ee-929f-56203b25b59a` para actualizar una instalación existente sin duplicarla.

## Alcance actual

- Moneda COP y locale `es-CO`.
- Las ventas no llevan IVA; las compras sí aplican IVA del 19 %.
- No se emiten facturas electrónicas DIAN.
- No hay integración con hardware de impresión ni básculas; se usa el diálogo de impresión del sistema.
- El inventario permite editar referencias solo a administradores y propietario; el stock se mueve mediante ajustes auditados.
- Las alertas de stock son opcionales por referencia y las referencias de prueba pueden quedar sin aviso.
- Los diccionarios alimentan la ficha técnica, las categorías y ubicaciones de inventario, las categorías de proveedor y los tipos de servicio.
- La ficha técnica estructurada se guarda como snapshot en cada OT; las OT anteriores conservan su texto original.
- El propietario es invisible para los demás usuarios en Configuración y respaldos; su cuenta se administra desde Mi perfil.
- Las torres y equipos “Otro” pueden registrarse como armados por partes con alias y código interno.
- La ficha técnica admite N/A por componente cuando no es visible.
- La IA es opcional y su integración real (facturas, diagnóstico y resúmenes) sigue pendiente. Hoy solo existe la configuración y la huella de la clave; no se guarda la clave en texto plano.
- Las fotos de evidencia se conservan en la carpeta de datos y en cada respaldo completo; no se envían a servicios externos.
