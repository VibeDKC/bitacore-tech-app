# Contrato 1.15.0 — Punto de venta y cobros

Fecha: 28 de octubre de 2026

## Alcance

La versión 1.15 abre el tramo POS del roadmap. Se entrega como **1.15.0** con cuatro mejoras operativas:

- Facturación de servicios manuales sin crear productos de inventario.
- Atajos de teclado en el POS.
- Creación rápida de clientes sin salir del cobro.
- Comprobante obligatorio configurable para pagos digitales.

No se agregan PDFs nuevos. La app sigue usando el comprobante interno de venta y el PDF fijo de diagnóstico inicial de la OT. La base conserva el esquema **16**.

## Decisiones

### Servicios manuales

- El servicio se agrega como una línea de factura, no como un producto.
- La línea guarda descripción, modalidad, cantidad, valor unitario, garantía y nota.
- Modalidades: tarifa fija, por hora y por unidad/equipo.
- La garantía se guarda como días y se refleja en la nota de la línea.
- El servicio no mueve inventario ni crea movimientos de stock.
- Se puede combinar con productos en una misma venta.
- La línea manual usa `product_id = NULL` en `invoice_items` y tipo `servicio`.

### Cliente rápido

- Se puede crear un cliente desde el POS con nombre obligatorio.
- Documento, teléfono y correo son opcionales.
- El cliente queda seleccionado para la venta actual y disponible para futuras ventas.
- Se reutiliza la validación y auditoría existentes de clientes.

### Atajos del POS

- **F1:** enfoca y selecciona el buscador.
- **F2:** abre el cliente rápido.
- **F3:** abre la facturación de servicio.
- **F5:** abre el cobro.
- **F9:** reimprime la última venta de la sesión.
- **Escape:** limpia la búsqueda.
- Los atajos no se disparan mientras hay un modal abierto.

### Comprobante digital

- La opción **Exigir comprobante en pagos digitales** queda en Configuración → Impresión/Cobros.
- Está desactivada por defecto para no romper la operación existente.
- Aplica a **Transferencia** y **Tarjeta**.
- Se valida en ventas POS, anticipos de OT y entrega/cobro de OT.
- El comprobante se adjunta como imagen PNG/JPEG/WebP o PDF de máximo 8 MB.
- El cobro no se registra si falta el comprobante cuando la regla está activa.
- El efectivo y el pago mixto no se bloquean por esta regla.
- La regla solo la cambia un usuario con permiso de configuración del negocio.

## Fuera de alcance

- Facturación electrónica DIAN.
- Impresión directa en hardware térmico.
- Nuevos PDFs de factura, compra u OT.
- Pagos en línea o conciliación bancaria.
- Servicios con precios por hora publicados en la web.
- Cuentas de cliente en la web.

## Pruebas

- Aceptación 1.15.0: 44/44.
- Regresión 1.14.1: 19/19 sin propietario.
- Regresión 1.14.0: 20/20 base.
- Regresión 1.13.1: 23/23.
- Regresión 1.13.0: 30/30.
- Typecheck y build de app.
- Smoke empaquetado 1.15.0.

## Criterio de cierre

1. Una venta puede contener solo servicios manuales y cerrar correctamente.
2. Los servicios manuales no crean productos ni mueven stock.
3. El cliente rápido queda creado y seleccionado en el POS.
4. Los atajos F1, F2, F3, F5 y F9 funcionan sin interferir con los modales.
5. La regla de comprobante digital se activa y desactiva desde Configuración.
6. Sin la regla, los cobros digitales siguen funcionando como antes.
7. Con la regla, POS y OT rechazan Transferencia/Tarjeta sin comprobante.
8. El comprobante adjunto queda guardado con el pago.
9. Se documenta y se genera el instalador 1.15.0.
