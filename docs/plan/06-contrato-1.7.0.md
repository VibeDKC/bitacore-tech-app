# Contrato 1.7.0 — Credenciales y reportes de diagnóstico

Fecha: 26 de octubre de 2026

## Alcance

Implementa los puntos 5B y 9 del listado de mejoras:

- Credenciales del equipo cifradas y temporales.
- Mensajes configurables para ingreso y entrega.
- Reportes de diagnóstico inicial y de entrega en PDF A4.
- Apertura de WhatsApp y revelación del archivo en la carpeta.

## Credenciales

Tabla `work_order_credentials`:

- Una fila por OT (`UNIQUE work_order_id`).
- `payload_encrypted` con `safeStorage`.
- Usuario, secreto, nota y tipo de bloqueo dentro del JSON cifrado.
- Metadatos de creación, actualización, última consulta y contador de vistas.

Acceso:

- Técnico asignado.
- Administrador.
- Propietario.

Cada consulta:

- Descifra solo en el proceso principal.
- Actualiza el contador.
- Registra una entrada de auditoría sin guardar el secreto.

Ciclo de vida:

- Se puede actualizar o eliminar manualmente.
- Se elimina automáticamente al pasar a `entregado`.
- Se elimina automáticamente al cerrar como `no_reparado`.
- Se descarta al restaurar un respaldo.
- No aparece en comprobantes ni reportes.

## Mensajes

Nueva configuración `messages_config`:

- `initial`: ingreso, estado y cotización inicial.
- `ready`: equipo listo, total y saldo.

Variables:

- `{{cliente}}`, `{{equipo}}`, `{{marca}}`, `{{modelo}}`, `{{serial}}`.
- `{{ot}}`, `{{estado}}`, `{{diagnostico}}`, `{{presupuesto}}`.
- `{{total}}`, `{{saldo}}`, `{{taller}}`, `{{telefono}}`, `{{fecha}}`.

La pestaña **Configuración → Mensajes** permite editar ambos textos, copiar variables, ver una vista previa y restaurar los valores predeterminados.

## Reportes

Nuevo RPC `orders.diagnosticReport` con modos `initial` y `delivery`.

- Genera HTML A4 y PDF con `webContents.printToPDF`.
- Guarda en `%APPDATA%/BitacoreTech/reports`.
- Revela el PDF con `shell.showItemInFolder`.
- Abre WhatsApp con `shell.openExternal` y el mensaje renderizado.
- Si el cliente no tiene teléfono, genera y revela el PDF sin abrir WhatsApp.
- El reporte de entrega requiere estado `listo` o `entregado`.
- El reporte inicial incluye ficha, falla, diagnóstico y cotización.
- El reporte de entrega incluye trabajo realizado, ítems, pagos, total, saldo y garantía.
- El PDF no incluye credenciales.

La prueba de aceptación desactiva la apertura externa con `BITACORETECH_DISABLE_EXTERNAL=1` para no abrir el navegador durante el test.

## Entrega sin cobro

- Se corrigió el saldo de las OT entregadas sin cobro: el total del trabajo se conserva, pero el saldo queda en cero.

## Migración

- Migración 7 crea `work_order_credentials`.
- No cambia tablas existentes.
- Validada sobre copia de la base real sin pérdida de datos.

## Pruebas

- `npm run test:acceptance:1.7.0` → 11/11.
- Smoke empaquetado 1.7.0 → 11/11.
- `npm run test:migration:1.7.0` → OK.
- Regresión 1.6.1 → 12/12.
- Regresión 1.6.0 → 14/14.
- Regresión 1.5.0 → 12/12.
- F0/F1 → 8/8.
- F2/F3 → 15/15.
- F4/F5 → 14/14.
