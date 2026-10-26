# Changelog

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
