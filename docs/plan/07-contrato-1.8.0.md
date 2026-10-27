# Contrato 1.8.0 — Permisos, negocio y refinamientos de OT

Fecha: 26 de octubre de 2026

## Alcance

Implementa los cinco refinamientos solicitados después de 1.7.0:

1. Administradores pueden configurar permisos y editar la identidad del negocio.
2. Se elimina el campo redundante “Componentes internos visibles”.
3. La salud del disco se registra como porcentaje de benchmark o N/A.
4. Los componentes del cliente no llevan garantía; los repuestos del inventario sí.
5. La falla reportada se reemplaza por un motivo de ingreso condicional con servicios de mantenimiento editables.

## Permisos y negocio

Nuevas capacidades:

- `configureBusiness`: editar la identidad del negocio.
- `managePermissions`: administrar la matriz de permisos.

Asignación por defecto:

- Propietario: ambas.
- Administrador: ambas.
- Técnico y cajero: no.

Reglas:

- El administrador puede editar las columnas Administrador, Técnico y Cajero.
- Solo puede conceder capacidades que su propia cuenta tiene.
- No puede conceder capacidades exclusivas del propietario.
- No puede retirar `managePermissions` al rol Administrador; solo el propietario.
- Los permisos exclusivos del propietario siguen siendo: auditoría, restauración, purga, gestión de administradores, cláusulas legales y claves de IA.
- La columna Administrador advierte que afecta a todas las cuentas admin.

Nuevo RPC `business.update`:

- Actualiza nombre, NIT, DV, NIT extranjero, teléfono, correo, dirección y ciudad.
- Valida NIT/DV.
- Registra auditoría.
- No toca cláusulas, garantía ni abandono.
- No crea una versión legal nueva.

`legal.update` queda reservado al propietario y se usa solo para cláusulas, días de garantía y abandono. La versión legal solo cambia con estas cláusulas.

## Recepción de la OT

### Componentes internos

- Se elimina el campo “Componentes internos visibles” de la recepción.
- Se conserva la lectura del valor en OTs antiguas.
- Se mantiene “Incluye discos o periféricos externos”.

### Motivo de ingreso

El campo único de falla se reemplaza por:

- “Falla de equipo”.
- Valores activos del diccionario `service_type`.

Comportamiento:

- Falla de equipo: se muestra y exige la falla reportada.
- Mantenimiento o servicio: se oculta la falla y se muestra un detalle opcional.
- Se guarda en el intake:
  - `serviceKind`: `falla` o `mantenimiento`.
  - `serviceType`.
  - `serviceDetail`.
- `reported_issue` conserva el texto visible para compatibilidad con WhatsApp, reportes y búsquedas.
- Las etiquetas cambian a “Servicio solicitado” en OT, comprobante A4 y reporte PDF.
- El diccionario se muestra como “Tipos de servicio y mantenimiento”.

## Ficha técnica

### Salud del disco

- Entrada numérica de 0 a 100 %.
- Casilla N/A por disco.
- Se guarda `healthPercent` y `healthNotApplicable`.
- Los valores antiguos Bueno/Regular/Crítico/No evaluado se conservan como legado.
- Se valida el rango en el renderer y en el proceso principal.
- Se imprime como “Salud: 87 %” o “Salud: N/A”.

### Garantía de componentes

- Se elimina la garantía de RAM y almacenamiento de la ficha técnica, tipos, normalización e impresión.
- Los componentes que ingresan con el equipo del cliente no llevan garantía.

## Garantía de repuestos

- Nueva columna `work_order_items.warranty_days` (migración 8).
- El campo de garantía aparece solo cuando:
  - El ítem es de tipo Repuesto.
  - Está vinculado a un producto activo del inventario.
- Se precarga desde `products.warranty_days` y se puede ajustar para la OT.
- Se guarda un snapshot por ítem.
- Los servicios y repuestos manuales no llevan garantía.
- Se muestra en:
  - Detalle de la OT.
  - Reporte de entrega.
  - Factura A4, como nota del ítem.
- La garantía legal de mano de obra y repuestos del taller se mantiene en el snapshot legal.

## Migración

Migración 8:

- Agrega `work_order_items.warranty_days INTEGER NOT NULL DEFAULT 0`.
- No modifica datos existentes.
- Las nuevas capacidades se siembran en bases existentes mediante `ensureRolePermissions`.
- Los campos nuevos de ficha e intake viven dentro del JSON y no requieren migración.

## Pruebas

- Aceptación 1.8.0: 13/13.
- Smoke empaquetado 1.8.0: 13/13.
- Migración 8 sobre copia de la base real: OK.
- Smoke de migración empaquetado: OK.
- Regresión:
  - 1.7.0: 11/11.
  - 1.6.1: 12/12.
  - 1.6.0: 14/14.
  - 1.5.0: 12/12.
  - F0/F1: 8/8.
  - F2/F3: 15/15.
  - F4/F5: 14/14.
- Smoke del instalador empaquetado 1.8.0.
