# Changelog

## 1.5.0 — 2026-10-26

### POS y documentos
- Historial de ventas dentro de POS con filtros por fecha, cliente, método, estado y tipo.
- Detalle de factura, reimpresión 80/58/A4, anulación con permiso y exportación CSV.
- Detalle por línea de servicio en POS, guardado en la factura y visible solo en A4.
- Términos impresos sin la versión `v1.0`.

### Inventario
- Edición de referencias con nombre, SKU, código de barras, categoría, ubicación, mínimo, costo, precio y garantía.
- Edición de referencias restringida a administradores y propietario.
- Campos opcionales de alerta de stock y rotación: `rotativo`, `no_rotativo` y `prueba`.
- Dashboard y notificaciones solo alertan referencias con aviso activo.
- Migración 5 con `products.alert_enabled`, `products.rotation` e `invoice_items.note`.

### Perfiles y sesión
- Foto de perfil visible en topbar, sidebar y lista de usuarios.
- El admin puede cambiar su propia foto y la foto del propietario sin editar el resto de la cuenta raíz.
- Nueva operación `users.updatePhoto` con auditoría.
- Prueba de regresión de cierre de sesión al cerrar la aplicación.

### Calidad
- Aceptación 1.5.0: 11/11.
- Migración sobre copia de la base real: OK, sin pérdida de datos.
- Regresión: F0/F1 8/8, F2/F3 15/15 y F4/F5 14/14.
- Smoke empaquetado 1.5.0: 11/11.
- Instalador `BitacoreTech-1.5.0-x64.exe`.

### Pendiente para siguientes entregas
- Diccionarios jerárquicos y ficha técnica estructurada.
- Credenciales cifradas del equipo y reportes de diagnóstico.
- Identidad por teléfono y múltiples teléfonos.
- IA de facturas de compra con Gemini, sin guardar imágenes.
- Firma del instalador, migración Python, catálogo web y piloto.

## 1.4.0 — 2026-10-26

### Operación y clientes
- Catálogo ligero de equipos por cliente, con historial de OT y evidencias.
- Backfill automático de equipos desde OT históricas.
- QR interno opcional, inactivo por defecto y activable en Configuración → Negocio.
- Fidelidad por cliente con descuento porcentual o fijo y vigencia.
- Descuento manual por porcentaje o valor en POS y OT.
- Bloqueo de venta cuando el descuento deja un producto por debajo del costo.
- Historial de cliente con factura y OT clicables (ya iniciado en 1.3.0).

### Seguridad y configuración
- Permisos por rol editables y excepciones por usuario.
- Guardrails: el propietario no delega auditoría, purga, restauración ni gestión de admins.
- NIT colombiano con DV automático y solo dígitos.
- Campo opcional de NIT extranjero.
- Legal y fiscal integrado dentro de Negocio.
- Campos opcionales de usuario: documento, teléfono, dirección y foto.
- Sesión sin “recordar”; el token vive en `sessionStorage` y se borra al cerrar.
- Contraseña de respaldo cifrada con `safeStorage`, con copia auditada.
- Exportación e importación `.bctbackup` cifrada con AES-256-GCM y restauración probada.
- Layout edge-to-edge, sin margen ni borde flotante.

### Reportes
- Gráficos de flujo de caja calculados con ventas, compras y egresos reales.
- Exportación CSV de órdenes de trabajo.

### Calidad
- Aceptación T3: 14/14.
- Regresión: T1 8/8 y T2 15/15.
- Typecheck y build en verde.
- Instalador `BitacoreTech-1.4.0-x64.exe`.

### Pendiente para 1.5.0
- Promociones avanzadas, CxP/abonos y reportes ejecutivos.
- IA de facturas con Gemini, sin guardar imágenes.
- Migración Python, catálogo web y plantillas WhatsApp.
- Firma del instalador, rendimiento y piloto.

## 1.3.0 — 2026-10-26

### Primer arranque y seguridad
- La base nueva ya no crea usuarios ni credenciales por defecto.
- Asistente **Configura tu taller** para crear el propietario, el negocio y la contraseña.
- Modo demostración opcional; las cuentas demo usan contraseñas aleatorias.
- Auditoría y respaldo completo al finalizar la configuración inicial.
- Bloqueo temporal tras cinco intentos fallidos de login.
- Se corrigió el dashboard con base vacía y los contadores fijos del menú.

### Operación
- CRUD de proveedores con validación de duplicados y auditoría.
- Filtro de historial por proveedor.
- Comprobante de compra imprimible con líneas, IVA y total.
- Selector de técnico dinámico desde usuarios activos.
- Asignación inicial y reasignación de técnico con motivo, historial, evento y auditoría.
- Reasignación bloqueada en OT entregadas o cerradas.
- Historial de cliente con acceso directo a la factura y a la OT.
- Las facturas muestran sus líneas en el detalle del historial.

### Calidad
- Prueba de aceptación F0/F1: 8/8.
- Prueba de aceptación F2/F3: 15/15.
- `npm run typecheck` y `npm run build` en verde.
- Instalador NSIS x64 generado como `BitacoreTech-1.3.0-x64.exe`.

### Pendiente para Tramos 3 y 4
- Sesión sin “recordar”, matriz de permisos configurable, foto/campos de usuario.
- Exportar/importar respaldos con contraseña, NIT/DV, Legal dentro de Negocio, borde de la app.
- Promociones, fidelidad, descuento libre %/valor, CxP/abonos y gráficos reales.
- IA de facturas, migración Python, catálogo web, plantillas WhatsApp.
- Firma del instalador, rendimiento y piloto formal.
