# Contrato 1.5.0 — Ajustes operativos

Fecha: 26 de octubre de 2026

## Alcance

Esta entrega resuelve los puntos 2, 3, 6, 7, 8 y 11 del listado de mejoras, sin cambiar la identidad del cliente ni implementar todavía la IA de facturas.

### 1. Términos sin versión impresa

- Los comprobantes impresos muestran `Términos esenciales` y `Términos legales completos`.
- La pantalla de la OT muestra `Términos aceptados`.
- La versión sigue guardada en el snapshot legal y en auditoría, pero no se imprime.

### 2. Detalle de servicios en POS

- Las líneas de servicio aceptan un detalle de hasta 500 caracteres.
- El detalle se guarda en `invoice_items.note`.
- Se muestra en la factura A4 y en el detalle de la factura del cliente.
- No se muestra en tickets de 80 mm ni 58 mm.
- El detalle aparece en el CSV del historial de ventas.

### 3. Inventario: edición de referencias y alertas opcionales

- Nuevo RPC `inventory.update`.
- Solo administradores y propietario pueden editar referencias.
- Se pueden editar nombre, SKU, código de barras, categoría, ubicación, stock mínimo, costo, precio, garantía, rotación y alerta.
- El stock no se edita directamente: se mueve con `inventory.adjust` para conservar el kardex.
- Nuevos campos `products.alert_enabled` y `products.rotation`:
  - `rotativo`
  - `no_rotativo`
  - `prueba`
- Las alertas del dashboard y las notificaciones solo cuentan referencias con `alert_enabled = 1`.
- Las referencias existentes conservan la alerta activa durante la migración.

### 4. Historial de ventas en POS

- Nueva pestaña **Historial de ventas** dentro de POS.
- Nuevo RPC `invoices.history`, disponible para el módulo POS y por tanto para cajeros.
- Lista las últimas 500 facturas, incluyendo ventas POS y facturas de OT.
- Filtros por fecha, cliente/número/servicio, método, estado y tipo.
- Detalle con líneas, notas de servicio, descuentos y total.
- Reimpresión en 80 mm, 58 mm y A4.
- Exportación CSV.
- Anulación solo con permiso `annulInvoice`.

### 5. Foto de perfil para admin y propietario

- Nuevo RPC `users.updatePhoto`, independiente de la edición completa de la ficha.
- Un administrador puede cambiar su propia foto y la foto de cualquier cuenta visible, incluida la del propietario, sin poder cambiar nombre, rol, clave ni estado de la cuenta raíz.
- El propietario sigue siendo el único que puede editar la ficha completa de la cuenta raíz.
- `photoUrl` viaja en la sesión y se muestra en topbar, sidebar y lista de usuarios.
- Se añadió `refreshProfile` al contexto de autenticación para reflejar la foto propia sin reiniciar sesión.

### 6. Sesión al cerrar

- Sin cambios de comportamiento: el token vive en `sessionStorage` y `closeDatabase()` elimina las sesiones.
- Se añadió una prueba de regresión que cierra la aplicación, la reabre y verifica que exige login.

## Migración

La migración 5 agrega:

- `products.alert_enabled INTEGER NOT NULL DEFAULT 1`
- `products.rotation TEXT NOT NULL DEFAULT 'rotativo'`
- `invoice_items.note TEXT`

Se validó sobre una copia de la base real:

- 6 usuarios, 9 clientes, 10 OT, 12 productos, 9 facturas y 4 compras conservados.
- `PRAGMA integrity_check = ok`.
- Productos existentes con alerta activa y rotación `rotativo`.

## Pruebas

- `npm run test:acceptance:1.5.0` → 11/11.
- `npm run test:migration:1.5.0` → migración, integridad y conservación de datos.
- Regresión:
  - `npm run test:acceptance:f0f1` → 8/8.
  - `npm run test:acceptance:f2f3` → 15/15.
  - `npm run test:acceptance:f4f5` → 14/14.

## Pendiente para siguientes entregas

- Diccionarios jerárquicos y ficha técnica estructurada.
- Credenciales cifradas del equipo y reportes de diagnóstico.
- Identidad por teléfono y múltiples teléfonos.
- Escaneo de facturas de compra con IA.
