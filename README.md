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

## Acceso inicial

La primera vez se crea una base de datos con datos ficticios de ejemplo y estas cuentas:

| Rol | Usuario | Contraseña |
| --- | --- | --- |
| Propietario / cuenta raíz | `superadmin` | `3mm4hy3r` |
| Administrador | `andrea` | `demo1234` |
| Técnico | `julian` | `demo1234` |
| Cajero | `camila` | `demo1234` |

Cambia las contraseñas desde **Configuración → Seguridad** antes de usar la aplicación con información real.

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
- POS con carrito, descuentos según rol, efectivo/tarjeta/mixto y factura interna sin IVA.
- Compras a proveedores con IVA del 19 % y actualización de inventario.
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

## Empaquetado

```bash
npm run dist
```

El instalador queda en `release/` como `BitacoreTech-1.1.0-x64.exe`. La configuración de electron-builder está en el bloque `build` de `package.json`:

- `appId`: `co.bitacoretech.taller`
- `productName`: `BitacoreTech`
- Ícono: `build/icon.png`
- NSIS x64 con GUID estable `d9257d69-156f-58ee-929f-56203b25b59a` para actualizar una instalación existente sin duplicarla.

## Alcance actual

- Moneda COP y locale `es-CO`.
- Las ventas no llevan IVA; las compras sí aplican IVA del 19 %.
- No se emiten facturas electrónicas DIAN.
- No hay integración con hardware de impresión ni básculas; se usa el diálogo de impresión del sistema.
- La IA es opcional y su clave solo se guarda como huella SHA-256, nunca en texto plano.
- Las fotos de evidencia se conservan en la carpeta de datos y en cada respaldo completo; no se envían a servicios externos.
