# Contrato 1.16.1 — Marca y búsqueda web de órdenes

Fecha: 28 de octubre de 2026

## Alcance

La versión **1.16.1** es un parche de identidad y portal:

- Integrar el logo oficial de BitacoreTech en la app.
- Usar el símbolo sin texto como icono del instalador, ventana y favicon.
- Facilitar la búsqueda de órdenes en la web: el cliente escribe solo el número de OT, sin `#OT-`, y su clave de seguimiento.

No hay migración de base de datos. La versión funcional sigue siendo 1.16.0; este parche no altera cartera, POS ni taller.

## Decisiones

### Marca

- La fuente es `bitacoretech_logo_.png` (logo transparente) y los assets ya alineados de la web.
- El logo completo se usa donde hay espacio y fondo claro: login móvil y 404.
- En la barra lateral y el login de escritorio se usa el símbolo + wordmark en HTML. Así el texto sigue legible a 17 px y se adapta a fondos claros u oscuros.
- El icono del instalador y el favicon usan solo el símbolo, sin texto, sobre fondo transparente.
- Se conserva el color brand de la app (`#6C5CE7`) para “Tech”.

### Búsqueda web

- El número de OT se escribe solo con dígitos: `002332`.
- El campo elimina cualquier letra o prefijo que se pegue; `#OT-002332` se convierte en `002332`.
- El backend normaliza a `OT-002332` antes de comparar.
- La clave acepta minúsculas, espacios y el formato sin `SG-`.
- La consulta sigue exigiendo **número + clave**. No se permite buscar solo con la OT para no exponer datos del cliente.
- La clave se sigue validando por hash SHA-256; nunca se publica en el catálogo.
- El enlace directo `/seguimiento/[code]` también normaliza la clave.

## Fuera de alcance

- Cambiar el diseño del logo o crear variantes vectoriales.
- Búsqueda por teléfono, serial o nombre.
- Búsqueda solo por número de OT.
- Nuevos PDFs o cambios en cartera.
- Firma de código del instalador.

## Pruebas

- Aceptación 1.16.1: 6/6.
- Regresión 1.16.0: 36/36.
- Regresión 1.15.0: 44/44.
- Web local: 39/39.
- Web remota: 7/7.
- Typecheck y build de app y web.
- Smoke empaquetado 1.16.1.

## Criterio de cierre

1. El logo se ve correctamente en login, barra lateral y 404.
2. El icono del instalador es el símbolo sin texto y tiene 512×512.
3. El favicon tiene 256×256 y carga en el renderer.
4. La búsqueda web acepta `002332` sin `#OT-`.
5. La clave funciona en minúsculas o sin `SG-`.
6. La búsqueda solo responde con número + clave correctos.
7. Se documenta y se genera el instalador 1.16.1.
