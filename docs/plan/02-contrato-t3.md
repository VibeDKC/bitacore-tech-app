# Contrato técnico T3 — BitacoreTech 1.4.0

| Dato | Valor |
| --- | --- |
| Fecha | 2026-10-26 |
| Baseline | 1.3.0 · cierre F0–F3 |
| Alcance | F4 + F5, catálogo de equipos, permisos por usuario, NIT, respaldos cifrados |
| Estado | Cerrado técnicamente. Pendiente firma del usuario. |

## 1. Permisos

- Matriz base editable por rol para `admin`, `tecnico` y `cajero`.
- El rol `superadmin` es inmutable y conserva todos los permisos.
- Cada usuario puede tener excepciones `allow`/`deny` sobre su rol.
- Permiso efectivo: excepción de usuario > permiso del rol.
- Los permisos se validan en el proceso principal; la UI solo los refleja.
- Guardrails:
  - Nadie puede conceder un permiso que su propia cuenta no tiene, salvo el propietario.
  - Auditoría, purga, restauración, gestión de admins, legal y claves de IA son exclusivos del propietario y no se delegan.
  - Los cambios de matriz y de excepciones se auditan.
- La visibilidad de módulos sigue la configuración base del rol; las excepciones afectan las acciones dentro de los módulos.

## 2. Fidelidad y descuentos

- El cliente se marca como **Cliente fiel** desde su ficha, con tipo (`percent` o `amount`), valor, vigencia y notas.
- Si el cliente tiene fidelidad activa y vigente, el descuento se aplica automáticamente en POS y OT.
- Si no la tiene, el usuario con `applyDiscount` puede ingresar un descuento manual por porcentaje o valor.
- No se acumulan fidelidad y descuento manual: la fidelidad tiene prioridad. Una excepción requiere autorización del propietario.
- **Piso:** el precio final de cada producto no puede quedar por debajo de su costo de compra vigente. Si el descuento cruza el piso, la operación se bloquea con `DISCOUNT_BELOW_COST`.
- Los servicios no tienen costo de compra; se permite el descuento dentro del subtotal, con auditoría.
- Todo descuento queda en la factura (`discount_type`, `discount_value`, `discount_cents`) y en la auditoría.

## 3. Catálogo de equipos

- Un equipo pertenece a un cliente y conserva: categoría, marca, modelo, serial, accesorios, ficha técnica y notas.
- La OT guarda su propio snapshot de ingreso y se vincula al equipo mediante `equipment_id`.
- Un equipo puede volver al taller; su historial acumula OT y evidencias.
- No hay transferencia normal de propietario. Solo una corrección autorizada por propietario/admin, con motivo y auditoría, puede cambiar el cliente.
- Las OT históricas se backfillean una vez agrupando por cliente + marca + modelo + serial; se crea un equipo por combinación y se vincula cada OT.
- El QR es una etiqueta interna con el serial. Está **inactivo por defecto** y se activa en **Configuración → Negocio → Catálogo de equipos**. No usa servicios externos.
- El QR se imprime en etiqueta de 80 × 50 mm; no hay portal público en esta fase.

## 4. NIT

- NIT colombiano: solo dígitos, sin puntos ni espacios; máximo 15.
- DV con pesos DIAN y módulo 11; se calcula automáticamente.
- Se aplica a negocio, clientes y proveedores cuando el documento es NIT.
- NIT extranjero: campo opcional; acepta alfanumérico y no calcula DV.
- El NIT de fábrica se corrigió a `901245678-3`.
- Los snapshots legales históricos no se modifican.

## 5. Respaldos

- Una sola contraseña de respaldo, configurable en **Configuración → Respaldos**.
- Se guarda cifrada con `safeStorage` de Electron; nunca en texto plano.
- Solo propietario/admin puede configurarla, verla o copiarla; cada visualización/copia se audita.
- Exportación `.bctbackup` cifrada con AES-256-GCM y derivación scrypt.
- Importación: descifra, valida, crea copia de seguridad y restaura.
- Si se cambia la contraseña, los respaldos anteriores requieren la contraseña anterior. No hay recuperación si se pierde.
- El respaldo local completo sigue existiendo; la exportación es adicional.

## 6. Sesión

- No existe “recordar sesión”.
- El token vive solo en `sessionStorage`; al cerrar la aplicación se elimina y se borran las sesiones del equipo.
- La duración máxima se configura por horas (1–168).
- El login posterior al cierre exige credenciales.

## 7. Usuarios

- Campos opcionales: documento, teléfono y dirección.
- Foto de perfil opcional, recortada a 256 px y guardada dentro de la base local.
- Permisos especiales por usuario desde su ficha.
- La cuenta raíz no se edita desde el panel.

## 8. Interfaz

- Layout edge-to-edge: sidebar y contenido llegan al borde de la ventana; se eliminó el margen flotante y el borde sobrante.
- “Legal y fiscal” se integró en **Negocio**: identidad, cláusulas, garantía/abandono y estado fiscal en una sola sección.
- El login ya no muestra “recordar sesión”; informa que la sesión se cierra al salir.

## 9. IA

- Se mantiene fuera de T3. La integración de facturas con Gemini queda para T4, con:
  - Modelo configurable en **Configuración → IA**.
  - Gemini Flash 3.5 como opción inicial si la cuenta lo expone; fallback al Flash vigente.
  - Proveedor manual en compras; la IA extrae ítems, cantidades, costos e IVA.
  - Revisión humana obligatoria y **sin guardar la imagen**.
  - Clave cifrada con `safeStorage`, nunca solo huella.

## 10. Pendiente para T4

- Promociones avanzadas y CxP/abonos.
- IA de facturas de compra.
- Migración desde Python, catálogo web, plantillas WhatsApp.
- Firma del instalador, rendimiento y piloto formal.
- Portal público para QR (si se decide).

## 11. Criterios de aceptación T3

1. NIT/DV y NIT extranjero funcionando.
2. Permiso por usuario y matriz por rol aplicados en backend.
3. Equipo creado, vinculado a OT y visible en el cliente.
4. QR inactivo por defecto y activable desde configuración.
5. Fidelidad automática y bloqueo bajo costo.
6. Campos, foto y permisos de usuario.
7. Contraseña de respaldo cifrada, visible/copiable solo por admin/propietario.
8. Exportación e importación cifrada con restauración.
9. Sesión sin recordar y cierre al salir.
10. Legal integrado en Negocio y borde de la ventana integrado.
