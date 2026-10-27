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

### IA de facturas de compra

- Escaneo de facturas con Gemini desde **Compras → Escanear factura**.
- Se puede cargar una imagen o PDF, arrastrarlo o pegar una imagen con **Ctrl+V**.
- La clave se cifra con el almacén seguro de Windows y nunca vuelve al renderer.
- El propietario configura la clave, el catálogo y el respaldo; el administrador puede escanear y cambiar el modelo activo si tiene `useAI` y `createPurchase`.
- Selector de modelo con catálogo actualizado desde Gemini y opción de escribir un identificador personalizado.
- Respaldo automático configurable con hasta dos modelos alternativos.
- Si Gemini responde 429, la app muestra si el límite es por minuto o diario y el tiempo de espera.
- La factura cargada se conserva para reintentar o cambiar de modelo sin volver a subirla.
- La revisión es humana y obligatoria.
- La IA extrae proveedor, NIT, número, fecha, líneas, costos, IVA y totales.
- Genera un **SKU interno modular** y conserva el **SKU o referencia del proveedor** cuando existe.
- Limpia seriales y frases SEO del nombre; los seriales quedan como texto en la línea de compra.
- Se permite IVA por línea, descuento global y **total real** de la factura.
- La diferencia entre el total calculado y el real se registra como descuento o ajuste.
- Se pueden crear productos nuevos dentro de la revisión, con SKU interno, SKU proveedor y margen calculado con IVA.
- Se advierte si el costo sube más del 10 %.
- Se advierte y pide confirmación para facturas duplicadas del mismo proveedor y número.
- No se guardan imágenes ni PDFs; solo la extracción, el modelo, el respaldo usado y un hash.
- Las pruebas automatizadas usan un Gemini simulado, sin consumir API real.
- Cambiar de modelo solo ayuda si la cuota es independiente por modelo; si el límite es del proyecto, hay que esperar o ampliar el plan.
- Las compras se pueden registrar de contado o a crédito. El saldo del proveedor queda visible y se puede abonar desde el detalle de la compra.

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
- **Administrador:** operación completa, costos y margen bruto, usuarios base, identidad del negocio y matriz de permisos. Puede ajustar los roles Administrador, Técnico y Cajero, pero solo conceder permisos que su propia cuenta ya tiene. No ve utilidad neta, auditoría, restauración ni purga.
- **Técnico:** recepción, diagnóstico, órdenes, evidencias (agregar), inventario sin costos y clientes.
- **Cajero:** POS, caja, inventario sin costos y clientes. Sin acceso a evidencias.

Las acciones sensibles quedan en la auditoría encadenada por hash SHA-256. Las cláusulas legales, la garantía y el abandono siguen siendo exclusivos del propietario. Las credenciales del equipo se guardan cifradas y temporales; se eliminan al entregar o cerrar la OT.

## Funcionalidad incluida

- Dashboard por rol, alertas de stock y estado del taller.
- Recepción dinámica de equipos por tipo (portátil, PC, consola, impresora, otro), accesorios, checklist, estado de encendido, bloqueo, motivo de ingreso y presupuesto.
- Alta rápida de clientes con teléfono principal, múltiples teléfonos y documento opcional; búsqueda por documento, teléfono o correo.
- Evidencias fotográficas del estado del equipo al ingreso y durante la reparación, con verificación de integridad y exportación ZIP.
- Órdenes de trabajo con repuestos, servicios, anticipos, descuentos, notas, estados e historial.
- Motivo de ingreso condicional: **Falla de equipo** con descripción libre o un servicio de mantenimiento tomado del diccionario.
- Garantía por repuesto del inventario, con snapshot de días en la OT, el reporte de entrega y la factura A4.
- Salud de disco por porcentaje de benchmark o N/A; los componentes del cliente no llevan garantía.
- Cobro al pasar a `entregado`, con libro de pagos y saldo separado del total. La entrega sin cobro requiere autorización y motivo auditado.
- POS con carrito, descuento por porcentaje o valor, fidelidad automática, efectivo/tarjeta/mixto y factura interna sin IVA. El precio final nunca queda por debajo del costo de compra.
- Catálogo ligero de equipos por cliente, con historial de OT y evidencias; QR interno opcional e inactivo por defecto.
- Fidelidad configurable por cliente (porcentaje o valor, vigencia) y bloqueo de venta bajo costo.
- Permisos por rol y excepciones por usuario, configurables por el administrador dentro de sus propios permisos, con auditoría y guardrails del propietario.
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
- Inventario con SKU, código de barras Code128, seriales, ubicaciones, condición, origen, stock mínimo y exportación CSV.
- Configuración de negocio, usuarios, permisos, impresión, respaldos completos, cláusulas legales, IA/API y seguridad.
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
| `npm run test:acceptance:1.7.0` | Credenciales cifradas, borrado automático, mensajes y reportes PDF. |
| `npm run test:acceptance:1.8.0` | Permisos de admin, negocio, salud %, garantía de inventario y falla/mantenimiento. |
| `npm run test:acceptance:1.9.0` | Teléfonos múltiples, documento opcional, condición/origen y ficha “Otro”. |
| `npm run test:acceptance:1.10.0` | IA de facturas, Ctrl+V, revisión, AliExpress, duplicados y ajuste. |
| `npm run test:acceptance:1.10.1` | Catálogo, cambio de modelo, respaldo automático, cuota 429 y reintento. |
| `npm run test:acceptance:1.10.2` | SKU interno/proveedor, seriales, higiene, margen con IVA y crédito con abonos. |
| `npm run test:migration:1.5.0` | Migración 5 sobre una copia de la base real. |
| `npm run test:migration:1.6.0` | Migración 6 y diccionarios sobre una copia de la base real. |
| `npm run test:migration:1.7.0` | Migración 7 y tabla de credenciales cifradas. |
| `npm run test:migration:1.8.0` | Migración 8, garantía por repuesto y nuevas capacidades. |
| `npm run test:migration:1.9.0` | Migración 9, teléfonos y diccionarios de inventario/componentes. |
| `npm run test:migration:1.10.0` | Migración 10, IVA por línea y revisión de compras. |
| `npm run test:migration:1.10.2` | Migración 11, SKU proveedor, seriales, pagos y crédito. |

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
npm run test:acceptance:1.7.0
npm run test:acceptance:1.8.0
npm run test:acceptance:1.9.0
npm run test:acceptance:1.10.0
npm run test:acceptance:1.10.1
npm run test:acceptance:1.10.2
npm run test:migration:1.5.0
npm run test:migration:1.6.0
npm run test:migration:1.7.0
npm run test:migration:1.8.0
npm run test:migration:1.9.0
npm run test:migration:1.10.0
npm run test:migration:1.10.2
```

Las evidencias quedan en la carpeta temporal que imprime cada script. Los resultados esperados son `8/8 OK`, `15/15 OK`, `14/14 OK`, `12/12 OK`, `14/14 OK`, `12/12 OK`, `11/11 OK`, `13/13 OK`, `9/9 OK`, `7/7 OK`, `15/15 OK` y `21/21 OK`. Las pruebas de migración usan una copia de `%APPDATA%\BitacoreTech\bitacoretech.db` y no modifican la base real.

## Empaquetado

```bash
npm run dist
```

El instalador queda en `release/` como `BitacoreTech-1.10.2-x64.exe`. La configuración de electron-builder está en el bloque `build` de `package.json`:

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
- Los clientes tienen teléfono principal, múltiples teléfonos y documento opcional; se pueden buscar por cualquiera de sus teléfonos.
- Los diccionarios alimentan la ficha técnica, las categorías, ubicaciones, condiciones y orígenes de inventario, las categorías de proveedor, las marcas de componentes y los motivos de ingreso de la OT.
- La ficha técnica estructurada se guarda en el intake y se copia al snapshot legal de cada OT; las OT anteriores conservan su texto original.
- La ficha incluye un campo “Otro” para modelos o componentes que no estén en los diccionarios.
- El propietario es invisible para los demás usuarios en Configuración y respaldos; su cuenta se administra desde Mi perfil.
- Las torres y equipos “Otro” pueden registrarse como armados por partes con alias y código interno.
- La ficha técnica admite N/A por componente cuando no es visible y la salud del disco se registra como porcentaje del benchmark o N/A.
- Los componentes que ingresan con el equipo del cliente no llevan garantía. La garantía por repuesto aparece solo cuando se asocia un producto del inventario.
- El admin puede editar la identidad del negocio y la matriz de permisos; las cláusulas, la garantía legal y el abandono siguen siendo del propietario.
- Las credenciales del equipo son temporales, cifradas y se eliminan al entregar o cerrar la OT.
- Los reportes de diagnóstico se generan en PDF A4 y usan las plantillas de Configuración → Mensajes; WhatsApp se abre con el mensaje, pero el PDF se adjunta manualmente.
- La IA de facturas de compra es opcional; el diagnóstico técnico, los resúmenes y las anomalías de caja siguen pendientes.
- El inventario usa un SKU interno y conserva un SKU o referencia de proveedor opcional. Las líneas de compra guardan ambos y el texto de seriales.
- El costo del inventario se mantiene antes de IVA; la revisión de compras muestra el margen calculado con IVA para tomar decisiones de precio.
- Las compras a crédito registran saldo pendiente, vencimiento opcional y abonos; el efectivo requiere un turno de caja abierto.
- La cuota de Gemini depende del plan y del proyecto. El respaldo automático no evade límites: solo intenta otro modelo configurado cuando el principal falla.
- Al restaurar un respaldo en otro equipo se descarta la clave de IA y se debe volver a configurar.
- Las fotos de evidencia se conservan en la carpeta de datos y en cada respaldo completo; no se envían a servicios externos.
