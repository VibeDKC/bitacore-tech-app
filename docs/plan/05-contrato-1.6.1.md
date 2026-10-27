# Contrato 1.6.1 — Perfil, propietario invisible y recepción

Fecha: 26 de octubre de 2026

## Alcance

Parche de corrección posterior a 1.6.0:

1. “Mi perfil” deja de llevar a Configuración.
2. El propietario queda invisible para los demás usuarios, pero se ve a sí mismo en Configuración.
3. Equipos armados por partes para PC Torre y Otro.
4. Formulario de recepción reordenado y ficha técnica completa con N/A.

## Perfil propio

- Nuevo modal **Mi perfil** en el menú de cuenta.
- “Configuración” sigue llevando a la configuración del taller.
- Cada usuario puede editar su nombre, correo, teléfono, dirección, documento, foto y contraseña.
- Usuario y rol son solo lectura.
- Nuevos RPC `profile.get` y `profile.update`, siempre sobre el usuario de la sesión.
- El cambio de contraseña usa `auth.changePassword`.

## Invisibilidad del propietario

- `users.list` oculta la cuenta `superadmin` a todos los usuarios, salvo al propio propietario.
- El propietario ve su cuenta en Configuración, marcada como protegida, sin cámara ni edición directa.
- La cuenta raíz se edita desde **Mi perfil**.
- Un administrador no puede cambiar la foto ni la ficha del propietario.
- Los respaldos muestran `Cuenta raíz` en lugar del nombre del propietario cuando los consulta un administrador.
- La auditoría conserva la trazabilidad completa y sigue siendo exclusiva del propietario.

## Equipos armados

- Casilla **Equipo armado por partes** para `pc_torre` y `otro`.
- No exige marca, modelo ni serial de fábrica.
- Exige alias.
- Se guarda:
  - `brand = 'Armado'`.
  - `model = alias`.
  - `serial = ARM-XXXXXXXX`.
- No se deduplica por marca/modelo/serial. Si la misma torre vuelve, se selecciona del historial del cliente.
- El comprobante A4 muestra “Código interno”.
- La ficha técnica sigue siendo la identificación principal del equipo.

## Recepción y ficha técnica

Orden definitivo:

1. Cliente.
2. Equipo.
3. Ficha técnica avanzada.
4. Accesorios dejados.
5. Evidencia fotográfica.
6. Falla y presupuesto.

- La ficha deja de ser un acordeón en la recepción y en el detalle de la OT.
- Controles N/A por bloque: sistema operativo, CPU, GPU, RAM, almacenamiento y batería.
- Los valores N/A se guardan como banderas en el JSON de la ficha y se imprimen como `N/A`.
- Se mantiene el título **Falla y presupuesto** sin agregar un campo de repuesto.

## Pruebas

- `npm run test:acceptance:1.6.1` → 12/12.
- Smoke empaquetado 1.6.1 → 12/12.
- Regresión 1.5.0 → 12/12.
- Regresión 1.6.0 → 14/14.
- F0/F1 → 8/8.
- F2/F3 → 15/15.
- F4/F5 → 14/14.

## Migración

No hay cambios de esquema. Los nuevos datos de equipo armado y N/A viajan en el JSON de la OT y en las columnas existentes del equipo.
