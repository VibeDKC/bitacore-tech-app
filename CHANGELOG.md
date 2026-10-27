# Changelog

## 1.10.2 — 2026-10-27

### SKU y datos de proveedor
- Generador de SKU interno modular con reglas de tipo, marca y modelo.
- El SKU de la IA se valida; si no cumple el formato o copia al proveedor, se genera localmente.
- Resolución de colisiones de SKU sin duplicar productos.
- Nuevo campo de SKU/referencia de proveedor en productos.
- El SKU de proveedor se conserva en cada línea de compra.
- Búsqueda y exportación de inventario incluyen el SKU de proveedor.

### Higiene de facturas
- Limpieza de seriales y frases SEO en nombres extraídos.
- Seriales guardados como texto en la línea de compra y visibles en revisión, detalle y comprobante.
- Normalización de variantes de auriculares, memorias, RAM y SSD.
- Costo de la línea con IVA calculado para mostrar margen.
- El costo del inventario se mantiene antes de IVA; la revisión muestra margen con IVA.

### Crédito con proveedores
- Compras de contado o a crédito.
- Abono inicial opcional, vencimiento y saldo pendiente.
- Registro de abonos con medio de pago, fecha y notas.
- Historial de pagos en el detalle de compra.
- Estado de pago: pagada, abonada o pendiente.
- El efectivo exige caja abierta y registra el egreso.
- El indicador “Pendiente por pagar” usa el saldo real, no el estado de recepción.
- Migración 11 con backfill de pagos y saldos.

### Calidad
- Aceptación 1.10.2: 21/21.
- Migración 11 sobre copia de la base real: OK.
- Regresión: 1.10.1 15/15, 1.10.0 7/7, 1.9.0 9/9, 1.8.0 13/13, 1.7.0 11/11, 1.6.1 12/12, 1.6.0 14/14, 1.5.0 12/12, F0/F1 8/8, F2/F3 15/15 y F4/F5 14/14.
- Pruebas con Gemini simulado, sin consumir API real.
- Instalador `BitacoreTech-1.10.2-x64.exe`.

## 1.10.1 — 2026-10-27

### Cuotas y modelos de IA
- Catálogo de modelos de Gemini obtenido con la clave configurada.
- Selector de modelo principal con opción de identificador personalizado.
- Cambio rápido de modelo desde la ventana de escaneo para propietario y administradores.
- Hasta dos modelos de respaldo y cambio automático opcional.
- Reintento automático ante cuota agotada, modelo inexistente, timeout o servicio no disponible.
- Enfriamiento temporal por modelo agotado para evitar reintentos innecesarios.
- Mensajes 429 con tipo de límite y tiempo de espera.
- Reintento sin perder la factura cargada.
- Metadatos de modelo solicitado, modelo usado, intentos y respaldo.
- La clave y la configuración del respaldo siguen reservadas al propietario.
- Los técnicos no pueden cambiar ni listar modelos.
- Sin migración de base de datos: solo cambia la configuración de IA.

### Calidad
- Aceptación 1.10.1: 15/15.
- Smoke empaquetado 1.10.1: 15/15.
- Regresión: 1.10.0 7/7, 1.9.0 9/9, 1.8.0 13/13, 1.7.0 11/11, 1.6.1 12/12, 1.6.0 14/14, 1.5.0 12/12, F0/F1 8/8, F2/F3 15/15 y F4/F5 14/14.
- Pruebas con Gemini simulado, sin consumir API real.
- Instalador `BitacoreTech-1.10.1-x64.exe`.

## 1.10.0 — 2026-10-26

### IA de facturas de compra
- Nueva clave de Gemini cifrada con `safeStorage`; nunca se devuelve al renderer.
- Botón **Probar conexión** y errores claros para clave, modelo, cuota y red.
- Escaneo desde Compras con archivo, arrastrar/soltar o **Ctrl+V**.
- Vista previa antes de enviar a Gemini.
- Extracción de proveedor, NIT, número, fecha, líneas, costos, IVA y totales.
- Revisión humana obligatoria antes de registrar la compra.
- IVA por línea y descuento global.
- Campo **Total real de la factura** y conciliación automática:
  - Diferencia menor: descuento adicional.
  - Diferencia mayor: ajuste positivo.
- Advertencia y confirmación para duplicados del mismo proveedor y número.
- Diferentes proveedores pueden usar el mismo número.
- Creación de productos nuevos dentro de la revisión.
- Alerta si el costo sube más del 10 %, con opción de actualizar precio de venta.
- Las imágenes y PDFs no se guardan; solo la extracción, el modelo y un hash.
- La clave de IA se descarta al restaurar un respaldo.

### Compras
- Migración 10: IVA por línea, descuento, ajuste y metadatos de IA.
- Se retiró la unicidad global del número de factura y se agregó un índice por proveedor + número.
- Comprobante de compra con IVA por línea, descuento y ajuste.
- Detalle de compra con líneas reales y marca de procesamiento por IA.
- Las compras manuales conservan su validación de duplicado por proveedor + número.

### Calidad
- Aceptación 1.10.0: 7/7.
- Migración 10 sobre copia de la base real: OK.
- Regresión: 1.9.0 9/9, 1.8.0 13/13, 1.7.0 11/11, 1.6.1 12/12, 1.6.0 14/14, 1.5.0 12/12, F0/F1 8/8, F2/F3 15/15 y F4/F5 14/14.
- Pruebas de IA con servidor Gemini simulado, sin consumir API real.
- Instalador `BitacoreTech-1.10.0-x64.exe`.

## 1.9.0 — 2026-10-26

### Clientes y teléfonos
- El teléfono principal es obligatorio en la interfaz; el documento pasa a ser opcional.
- Nuevos clientes sin documento se guardan como “Sin documento” con un identificador interno único.
- Nueva tabla `customer_phones` para varios teléfonos por cliente, con etiqueta y principal.
- Migración 9: el teléfono existente se convierte en el principal.
- Búsqueda de clientes por nombre, documento, correo o cualquiera de sus teléfonos.
- Aviso de teléfono compartido entre clientes, sin bloquear el guardado.
- WhatsApp, comprobantes, OT y reportes usan el teléfono principal.
- La ficha del cliente muestra todos sus teléfonos.

### Inventario
- Nuevos diccionarios `inventory_condition` e `inventory_origin`.
- Los productos guardan condición y origen, visibles en la ficha de inventario.
- Nuevo diccionario `component_brand` para marcas de RAM, almacenamiento y componentes.
- Migración 9 agrega `products.condition` y `products.origin`.

### Ficha técnica
- Nuevo campo libre **Otro / componentes no listados**.
- La marca de RAM se selecciona desde el diccionario de marcas de componentes, con opción de escribir otra.
- La ficha se copia al snapshot legal de la OT, además de conservarse en `intake_json`.
- La ficha se sigue mostrando en OT, comprobante A4 y reporte PDF.

### Calidad
- Aceptación 1.9.0: 9/9.
- Migración 9 sobre copia de la base real: OK.
- Regresión: 1.8.0 13/13, 1.7.0 11/11, 1.6.1 12/12, 1.6.0 14/14, 1.5.0 12/12, F0/F1 8/8, F2/F3 15/15 y F4/F5 14/14.
- Instalador `BitacoreTech-1.9.0-x64.exe`.

## 1.8.0 — 2026-10-26

### Permisos y negocio
- Nuevas capacidades `configureBusiness` y `managePermissions`.
- El administrador puede editar nombre, NIT, DV, NIT extranjero, contacto, moneda y zona horaria.
- El administrador puede ajustar los roles Administrador, Técnico y Cajero, pero solo conceder permisos que su propia cuenta ya tiene.
- Los permisos exclusivos del propietario siguen bloqueados.
- El propietario conserva la edición de cláusulas, garantía y abandono.
- La identidad del negocio queda auditada y no crea una versión legal nueva.
- Se impide que un administrador retire `managePermissions` al rol Administrador.

### Recepción de la OT
- Se eliminó el campo redundante **Componentes internos visibles**; la ficha técnica avanzada conserva esos datos.
- Nuevo desplegable **Motivo de ingreso**:
  - Falla de equipo, con el campo de falla reportada.
  - Servicios de mantenimiento desde el diccionario `service_type`.
- Si se elige un mantenimiento se oculta la falla y aparece un detalle opcional.
- Las etiquetas de la OT, el comprobante y el reporte cambian a **Servicio solicitado** cuando aplica.
- El diccionario se renombró a **Tipos de servicio y mantenimiento**.

### Ficha técnica
- La salud del disco se registra como porcentaje de benchmark (0–100 %) o N/A por unidad.
- Se conservan los valores anteriores Bueno/Regular/Crítico como legado.
- Se eliminaron los campos de garantía de RAM y almacenamiento: los componentes del cliente no llevan garantía.

### Garantía de repuestos
- Nueva columna `work_order_items.warranty_days` con migración 8.
- La garantía se muestra solo para repuestos vinculados a un producto del inventario.
- Se precarga desde `products.warranty_days` y se guarda como snapshot de la OT.
- Los servicios y los repuestos escritos manualmente no llevan garantía.
- La garantía del repuesto se imprime en el detalle de la OT, el reporte de entrega y la factura A4.
- La garantía legal de mano de obra y repuestos del taller se mantiene.

### Calidad
- Aceptación 1.8.0: 13/13.
- Migración 8 sobre copia de la base real: OK.
- Regresión: 1.7.0 11/11, 1.6.1 12/12, 1.6.0 14/14, 1.5.0 12/12, F0/F1 8/8, F2/F3 15/15 y F4/F5 14/14.
- Instalador `BitacoreTech-1.8.0-x64.exe`.

## 1.7.0 — 2026-10-26

### Credenciales del equipo
- Campo de usuario y contraseña/PIN/patrón en la recepción de la OT.
- Cifrado local con `safeStorage`; nunca se guarda en texto plano.
- Solo puede consultarlas el técnico asignado, un administrador o el propietario.
- Cada consulta queda auditada y aumenta el contador de vistas.
- Se pueden actualizar o eliminar manualmente.
- Se eliminan automáticamente al entregar la OT o cerrarla como no reparada.
- No se imprimen en comprobantes ni reportes.
- Se descartan al restaurar un respaldo para evitar dependencia del equipo de origen.

### Mensajes y reportes
- Nueva pestaña **Configuración → Mensajes** con dos plantillas:
  - Ingreso / diagnóstico inicial.
  - Equipo listo / entrega.
- Variables para cliente, equipo, OT, estado, diagnóstico, presupuesto, total, saldo, taller, teléfono y fecha.
- Botones **Reporte inicial** y **Reporte de entrega** en la OT.
- Generación de PDF A4 con diagnóstico, ficha técnica, accesorios, falla, ítems, pagos y saldos según el tipo de reporte.
- El PDF se guarda en `reports`, se revela en el Explorador y se abre WhatsApp con el mensaje configurado.
- El reporte de entrega está disponible desde Listo para entrega.
- El reporte no incluye credenciales.

### Corrección de entrega
- Una entrega sin cobro ya no deja saldo pendiente en la OT.

### Calidad
- Aceptación 1.7.0: 11/11.
- Migración 7 sobre copia de la base real: OK.
- Regresión: 1.6.1 12/12, 1.6.0 14/14, 1.5.0 12/12, F0/F1 8/8, F2/F3 15/15 y F4/F5 14/14.
- Instalador `BitacoreTech-1.7.0-x64.exe`.

## 1.6.1 — 2026-10-26

### Perfil y seguridad
- “Mi perfil” abre un modal propio; “Configuración” sigue llevando a los datos del taller.
- Cada usuario puede editar su nombre, correo, teléfono, dirección, documento, foto y contraseña.
- El propietario es invisible para todos los demás usuarios en gestión de usuarios y respaldos.
- El propietario se ve a sí mismo en Configuración y administra su cuenta desde Mi perfil.
- Se bloqueó que un administrador cambie la foto o la ficha del propietario.

### Equipos armados
- Casilla **Equipo armado por partes** para PC Torre y Otro.
- Marca, modelo y serial de fábrica dejan de ser obligatorios.
- Se usa un alias y un código interno `ARM-...`.
- Los equipos armados no se deduplican por marca/modelo/serial; si vuelve la misma torre se selecciona desde el historial del cliente.
- El comprobante A4 muestra el código interno.

### Ficha técnica y recepción
- Orden del formulario: Cliente, Equipo, Ficha técnica, Accesorios, Evidencia, Falla y presupuesto.
- La ficha técnica queda siempre visible, sin acordeón.
- Controles **No visible / N/A** para sistema operativo, CPU, GPU, RAM, almacenamiento y batería.
- La ficha del detalle de la OT también queda siempre visible.
- Se conserva “Falla y presupuesto” sin agregar un campo de repuesto.

### Calidad
- Aceptación 1.6.1: 12/12.
- Regresión: 1.5.0 12/12, 1.6.0 14/14, F0/F1 8/8, F2/F3 15/15 y F4/F5 14/14.
- Instalador `BitacoreTech-1.6.1-x64.exe`.

## 1.6.0 — 2026-10-26

### Diccionarios
- Nuevo módulo **Configuración → Diccionarios** con jerarquía, orden, activación y edición.
- Valores del sistema protegidos contra eliminación; se pueden renombrar, reordenar o desactivar.
- Diccionarios sembrados: tipos de equipo, sistemas operativos, marcas y familias de CPU, marcas de GPU, tipos de RAM, almacenamiento, categorías y ubicaciones de inventario, categorías de proveedor y tipos de servicio.
- Los valores históricos de inventario, proveedores y equipos se agregan automáticamente al migrar.
- Renombrar categorías de inventario, ubicaciones, categorías de proveedor o tipos de servicio actualiza las referencias existentes.
- Permiso `manageDictionaries` para administradores y propietario.

### Ficha técnica
- Ficha estructurada en la recepción de OT:
  - CPU con marca, familia y modelo.
  - GPU con tipo, marca, modelo y VRAM.
  - RAM con filas repetibles: tipo, capacidad, velocidad, marca y garantía.
  - Almacenamiento con filas repetibles: tipo, capacidad, velocidad, modelo, salud y garantía.
  - Batería, sistema operativo y observaciones.
- Los campos desplegables se alimentan de diccionarios; los modelos y detalles siguen editables.
- Las OT antiguas conservan su ficha plana como “ficha anterior” y se muestra completa.
- La ficha estructurada se muestra en la OT y se imprime en A4.
- Se eliminó la versión visible de los términos en la recepción.

### Inventario y servicios
- Se puede marcar un producto como servicio y asignarle un tipo de servicio del diccionario.
- Las categorías y ubicaciones del inventario ahora salen del diccionario.
- Las categorías de proveedor salen del diccionario.

### Calidad
- Aceptación 1.6.0: 14/14.
- Migración sobre copia de la base real: OK, integridad y diccionarios idempotentes.
- Regresión: 1.5.0 11/11, F0/F1 8/8, F2/F3 15/15 y F4/F5 14/14.
- Instalador `BitacoreTech-1.6.0-x64.exe`.

### Pendiente para siguientes entregas
- Credenciales cifradas del equipo y reportes de diagnóstico.
- Identidad por teléfono y múltiples teléfonos.
- IA de facturas de compra con Gemini, sin guardar imágenes.
- Firma del instalador, migración Python, catálogo web y piloto.

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
- El admin puede cambiar su propia foto y la foto del propietario sin editar el resto de la cuenta raíz. **Superado por 1.6.1:** el propietario ya no es visible ni editable por administradores.
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
