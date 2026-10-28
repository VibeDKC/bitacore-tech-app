# Contrato 1.16.2 — Acceso inicial y actualización

Fecha: 28 de octubre de 2026

## Alcance

La versión **1.16.2** corrige el acceso en instalaciones nuevas y actualizaciones:

- Evitar que una base existente con administradores vuelva a pedir “Configura tu taller”.
- Permitir que el propietario inicie sesión antes de crear el administrador.
- Limpiar la pantalla de acceso de datos internos y textos innecesarios.
- Dar una salida clara a “¿Olvidaste tu clave?” con contacto del taller.

No hay migración de base de datos.

## Decisiones

### Actualización y primer arranque

- La existencia de un administrador es la señal principal de que la app ya está configurada.
- Si hay un administrador, no se muestra configuración inicial aunque falte la marca `setup_completed`.
- Si no hay ningún administrador y la base nunca se configuró, se muestra “Configura tu taller”.
- Si la base ya fue configurada pero no hay administrador, se muestra login para que el propietario recupere el acceso; no se crea una cuenta nueva automáticamente.
- `auth.setup` se bloquea cuando ya existe un administrador o la base está marcada como configurada.

### Acceso del propietario

- En la pantalla de configuración inicial se agrega el botón:
  - **“¿Ya tienes una cuenta? Inicia sesión”**.
- Ese botón muestra el formulario de login del propietario.
- Solo el rol `superadmin` puede iniciar sesión mientras no exista un administrador activo.
- Los demás usuarios siguen bloqueados hasta que la app tenga un administrador.
- Después de entrar como propietario sin administrador, se muestra un aviso y se abre **Configuración** para crear el administrador o restaurar un respaldo.
- Cuando exista el primer administrador, el login normal queda habilitado.

### Limpieza del login

- Se elimina la tarjeta de OT activa y los nombres/círculos del equipo de la columna izquierda.
- Se elimina la descripción del aviso **Acceso protegido**; queda solo el título y el icono.
- Se elimina el pie “Instalación local. Tus datos permanecen en este equipo”.
- Se conserva el logo, el hero y las cuatro tarjetas de funcionalidades.
- La columna se rebalancea para no quedar vacía.

### Recuperación de contraseña

- “¿Olvidaste tu clave?” abre un modal.
- El modal explica que un administrador o el propietario debe restablecer la contraseña desde Configuración → Usuarios y roles.
- Si el negocio tiene teléfono configurado, muestra el botón **“Escribir al taller”** por WhatsApp.
- `auth.status` expone únicamente nombre del negocio y teléfono; no usuarios, órdenes ni auditoría.

## Fuera de alcance

- Recuperación automática de contraseña.
- Envío de correos o SMS.
- Cambios en cartera, POS, inventario o compras.
- Búsqueda web de órdenes (ya entregada en 1.16.1).
- Firma de código del instalador.

## Pruebas

- Aceptación 1.16.2: 16/16.
- Regresión 1.16.1: 6/6.
- Regresión 1.16.0: 36/36.
- Regresión 1.15.0: 44/44.
- Typecheck y build de app.
- Smoke empaquetado 1.16.2.

## Criterio de cierre

1. Una base con administradores no vuelve a pedir configuración.
2. El botón “¿Ya tienes una cuenta? Inicia sesión” está en primer arranque.
3. El propietario puede intentar login antes de crear el administrador.
4. Los demás usuarios siguen bloqueados antes del setup.
5. Se puede volver a la configuración inicial.
6. El login no muestra OT activas, nombres del equipo, descripción de acceso protegido ni pie local.
7. “¿Olvidaste tu clave?” muestra el contacto del taller.
8. Se documenta y se genera el instalador 1.16.2.
