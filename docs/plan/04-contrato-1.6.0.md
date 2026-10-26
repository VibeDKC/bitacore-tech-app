# Contrato 1.6.0 — Diccionarios y ficha técnica

Fecha: 26 de octubre de 2026

## Alcance

Esta entrega resuelve los puntos 1 y 4 del listado de mejoras:

- Módulo de diccionarios jerárquicos editable.
- Ficha técnica estructurada por componentes.
- Compatibilidad con las fichas planas de versiones anteriores.
- Integración de categorías de inventario, ubicaciones, proveedores y tipos de servicio.
- Tipos de equipo editables en la recepción de OT.

## Diccionarios

Tabla `dictionary_nodes`:

- `id`, `parent_id`, `type`, `code`, `name`, `sort_order`, `active`, `system`.
- Jerarquía dentro de cada tipo.
- Semilla idempotente en la primera apertura de 1.6.0.
- Los valores históricos de productos, proveedores y OT se agregan como nodos para no perder opciones.
- `system = 1` no permite eliminación; se puede renombrar, reordenar y desactivar.
- Los valores personalizados se pueden eliminar si no tienen hijos ni usos.

Tipos sembrados:

- Tipos de equipo.
- Sistemas operativos.
- Marcas y familias de CPU.
- Marcas de GPU.
- Tipos de RAM.
- Tipos de almacenamiento.
- Categorías de inventario.
- Ubicaciones de inventario.
- Categorías de proveedor.
- Tipos de servicio.

Permiso nuevo: `manageDictionaries` para administrador y propietario. La matriz de permisos lo refleja y la migración lo agrega a las bases existentes.

Renombrados con efecto en datos existentes:

- `inventory_category` → `products.category`.
- `inventory_location` → `products.location`.
- `supplier_category` → `suppliers.category`.
- `service_type` → `products.service_type`.

## Ficha técnica

Nueva estructura:

```ts
{
  os,
  cpu: { brand, family, model },
  gpu: { type, brand, model, vram },
  ramModules: [{ id, type, capacity, speed, brand, warranty }],
  storageDrives: [{ id, type, capacity, speed, model, health, warranty }],
  battery,
  notes,
  legacy: { cpu, gpu, ram, storage }
}
```

- CPU, GPU, OS, RAM y almacenamiento usan diccionarios en los campos de selección.
- Modelos, capacidades, velocidades, marcas y garantías son editables.
- Filas repetibles para RAM y discos, con añadir/eliminar.
- La ficha se guarda en `work_orders.intake_json` y en `equipment.technical_sheet_json`.
- Las fichas planas de 1.5.0 se conservan en `legacy` y se muestran como “ficha anterior”.
- La ficha se muestra en la OT y se imprime en A4.
- La versión de los términos ya no aparece en la recepción.

## Inventario y servicios

- El formulario de inventario permite marcar un producto como servicio y asignar un tipo de servicio.
- Las categorías, ubicaciones y tipos de servicio salen del diccionario.
- Los proveedores usan las categorías del diccionario.
- La creación de una OT con diccionarios de tipo de equipo conserva el tipo seleccionado como etiqueta y usa la categoría base para las reglas de accesorios y bloqueo.

## Migración

- Nueva tabla `dictionary_nodes`.
- Nueva columna `products.service_type`.
- Migración 6 registrada.
- Semilla de diccionarios idempotente.
- Validación sobre copia de la base real:
  - 6 usuarios, 9 clientes, 10 OT, 12 productos, 9 facturas, 4 compras y 4 proveedores conservados.
  - `PRAGMA integrity_check = ok`.
  - 110 nodos de diccionario.
  - Valores históricos de inventario, proveedores y equipos presentes.
  - Permiso `manageDictionaries` agregado al rol admin.

## Pruebas

- `npm run test:acceptance:1.6.0` → 14/14.
- Smoke empaquetado 1.6.0 → 14/14.
- `npm run test:migration:1.6.0` → migración, integridad, valores históricos e idempotencia.
- Regresión:
  - `npm run test:acceptance:1.5.0` → 11/11.
  - `npm run test:acceptance:f0f1` → 8/8.
  - `npm run test:acceptance:f2f3` → 15/15.
  - `npm run test:acceptance:f4f5` → 14/14.

## Pendiente para siguientes entregas

- Credenciales cifradas del equipo y reportes de diagnóstico.
- Identidad por teléfono y múltiples teléfonos.
- IA de facturas de compra con Gemini, sin guardar imágenes.
- Firma del instalador, migración Python, catálogo web y piloto.
