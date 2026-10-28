# BitacoreTech — Esquema de trabajo por tramos

| Dato | Valor |
| --- | --- |
| Proyecto | BitacoreTech Taller & POS |
| Repositorio | https://github.com/VibeDKC/bitacore-tech-app |
| Baseline | Versión 1.1.0 · commit `38159be` |
| Proyecto de referencia | https://github.com/VibeDKC/bitacore-tech · commit `6a29c5c` |
| Fecha del esquema | 2026-10-26 |
| Estado | Tramos 1, 2 y 3 cerrados técnicamente. Tramo 4 pendiente. |

## Estado de ejecución

| Tramo | Fases | Estado | Evidencia |
| --- | --- | --- | --- |
| 1 | F0 + F1 | Cerrado técnicamente; pendiente firma | `docs/actas/f0-f1.md` · 8/8 |
| 2 | F2 + F3 | Cerrado técnicamente; pendiente firma | `docs/actas/f2-f3.md` · 15/15 |
| 3 | F4 + F5 | Cerrado técnicamente; pendiente firma | `docs/actas/f4-f5.md` · 14/14 |
| 4 | F6 + F7 | Pendiente | — |

> Los Tramos 1 y 2 se ejecutaron en una misma sesión. El release 1.3.0 incluye ambos; el release 1.4.0 cierra F4/F5 con catálogo de equipos, permisos por usuario, NIT, fidelidad y respaldos cifrados.
>
> **F6 — Catálogo web:** demo local en `web/` con contrato en `docs/plan/14-contrato-catalogo-web.md` y acta en `docs/actas/catalogo-web.md`. En 1.12.0 se integraron promociones reales y publicación local (`docs/plan/15-contrato-1.12.0.md`). No cierra el Tramo 4.

## 1. Objetivo

Cerrar las fases F0–F7 del plan original en **cuatro tramos de dos fases cada uno**, con una compuerta de aceptación al final de cada tramo. La prioridad es que cada módulo sea realmente funcional —no una pantalla de fachada— y que cada entrega quede trazada en Git, con pruebas y acta de aceptación.

## 2. Definición de “funcional” (DoD)

Un módulo se considera funcional solo si cumple todo esto:

1. La interfaz ejecuta la acción y esta persiste en SQLite.
2. El proceso principal valida permisos; la UI no es la única barrera.
3. La acción deja evento en la auditoría cuando corresponde.
4. Tiene validaciones, estados vacíos y manejo de errores.
5. Tiene prueba automatizada o guion manual reproducible.
6. No depende de datos estáticos, listas hardcodeadas ni toasts de “próximamente”.
7. Sigue funcionando después de cerrar y reabrir la aplicación.

Si falta uno de estos puntos, el módulo es **parcial** y no puede cerrar el tramo.

## 3. Estado real de partida

### 3.1 Fases F0–F7

| Fase | Estado real | Qué falta |
| --- | --- | --- |
| F0. Contrato | Reglas materializadas en esquema, estados, permisos y dinero en centavos | Documento formal congelado; NIT/DV y reglas de fidelidad |
| F1. Esqueleto | Instalador, SQLite, migraciones, IPC, login, roles, auditoría y respaldo inicial | Primer arranque sin credenciales por defecto y con cambio obligatorio de clave |
| F2. Núcleo | Clientes, inventario, proveedores, compras con IVA, kardex, caja y reportes | CRUD real de proveedores, comprobante de compra, catálogo de equipos si se requiere |
| F3. OT completa | Recepción, estados, repuestos, anticipos, entrega con cobro/excepción, legal, A4/58/80, Code128 | Asignación y reasignación de técnico con trazabilidad; exportación real de OTs |
| F4. Ventas y reportes | POS, factura interna, stock/caja, reportes, dashboard, CSV | Promociones, CxP/abonos, descuento libre %/valor, fidelidad, gráficos reales |
| F5. Configuración y endurecimiento | Configuración, legal, impresión, respaldos/restauración, auditoría encadenada | Exportar/importar respaldos, cifrado de secretos, sesión sin recordar, matriz configurable, foto/campos de usuario, NIT, fusión de Legal en Negocio |
| F6. Migración y extras | Pendiente | Migración desde la base Python, catálogo web, IA de facturas, plantillas WhatsApp |
| F7. QA y piloto | Pruebas Playwright, impresión, respaldos e instalador | Firma del instalador, rendimiento, checklist de aceptación y piloto formal |

> La migración que ya funciona es desde `%APPDATA%\octestr-taller\octestr.db` (versión Electron anterior). La migración desde la base Python `MTO APP\data\bitacore.db` **no** está hecha.

### 3.2 Matriz de módulos

| Módulo | Estado | Brecha principal |
| --- | --- | --- |
| Dashboard | Parcial | El gráfico de flujo usa `charts_history`, un histórico estático del seed |
| POS | Funcional | Descuento limitado a 0/5/10 % |
| Órdenes de trabajo | Funcional | Técnico fijo a dos nombres; exportación de OTs es un toast |
| Inventario | Funcional | Sin segmentos de reacondicionado/repuestos/insumos ni código de proveedor |
| Clientes | Funcional | Las filas de factura/OT del historial no abren el documento |
| Compras | Parcial | Crear proveedor y comprobante son toasts; sin IA; CxP solo indicador |
| Caja | Funcional | — |
| Reportes | Parcial | Gráficos estáticos; faltan CxP/egresos completos y algunas exportaciones |
| Auditoría | Funcional | — |
| Configuración | Parcial | Legal duplicado; DIAN “próximamente”; IA solo configuración |
| Usuarios y roles | Parcial | Sin foto ni campos personales; matriz solo lectura |
| Respaldos | Parcial | Sin exportar/importar |
| Evidencias | Funcional | — |
| Impresión | Funcional | — |
| IA | Esqueleto | No hay llamada real a ningún proveedor |
| Promociones/fidelidad | Ausente | No existe el módulo |

## 4. Esquema de cuatro tramos

### Tramo 1 — F0 + F1: Contrato y esqueleto

**Duración orientativa:** 7–10 días.

**Pasos**

1. **Congelar el contrato:** diccionario de datos, máquina de estados, matriz de permisos, reglas de dinero/IVA/redondeo, NIT/DV, piso de fidelidad y política de respaldos. Documento aprobado antes de programar.
2. **Auditar F0/F1:** comparar el contrato con el código actual y registrar brechas.
3. **Primer arranque real:** crear propietario, sin credenciales por defecto y con cambio obligatorio de clave. Los datos demo quedan como opción separada.
4. **Base de seguridad:** roles/capacidades, auditoría, respaldo inicial y sesión base.
5. **Cierre:** instalador en ruta estable (no en Temp), prueba en Windows limpio, tag `f0-f1` y acta firmada.

**Entregable:** instalador que crea una base nueva, permite crear el propietario, inicia sesión y registra auditoría.

**Compuerta de aceptación**

- Instalación limpia en Windows.
- Crear propietario y entrar sin usuarios demo.
- Cerrar y reabrir la app: debe exigir login.
- Ver el evento de inicio de sesión en auditoría.
- Instalador en ruta estable.

**Decisiones requeridas:** NIT/DV, permisos por rol o por usuario, piso de fidelidad y si el catálogo de equipos será una entidad separada.

### Tramo 2 — F2 + F3: Núcleo operativo y OT

**Duración orientativa:** 16–20 días; parte del código ya existe, pero la auditoría puede revelar brechas.

**Pasos**

1. **Auditoría funcional módulo por módulo:** clientes, proveedores, inventario, compras, caja, reportes, OT e impresión. Cada botón debe persistir o se marca como fachada.
2. **Cerrar F2:** CRUD real de proveedores, comprobante de compra, catálogo de equipos si se aprueba, reportes básicos con datos reales.
3. **Cerrar F3:** asignación y reasignación de técnico con trazabilidad, flujo completo de OT, entrega bloqueada sin pago/excepción, snapshot legal e impresión.
4. **Prueba de punta a punta:** proveedor → compra → stock/costo → cliente → OT → técnico → repuestos → anticipo → listo → cobro/entrega → impresión → auditoría.
5. **Cierre:** cero toasts de “próxima versión” en estos módulos; caja y stock cuadran; tag `f2-f3`; instalador 1.3.0.

**Entregable:** operación real de taller y mostrador con datos creados por el usuario, no solo datos sembrados.

**Compuerta de aceptación**

- Ejecutar el flujo completo con datos de prueba reales.
- Verificar que el stock y la caja cuadren.
- Verificar que la OT no se pueda entregar sin pago o excepción auditada.
- Verificar que el técnico asignado quede en el historial de la OT.
- Firmar el acta del tramo.

### Tramo 3 — F4 + F5: Ventas, reportes y endurecimiento

**Duración orientativa:** 9–12 días.

**Pasos**

1. **Auditoría F4/F5.**
2. **F4:** descuento por porcentaje o valor, promociones, fidelidad con piso de costo, CxP/abonos, gráficos reales de caja y exportaciones completas.
3. **F5:** sesión sin recordar, matriz de permisos configurable, foto y campos de usuario, exportar/importar respaldos, NIT/DV, Legal dentro de Negocio, cifrado de secretos, borde de la app y textos del login.
4. **Aceptación:** venta con fidelidad que respete el piso; reporte que cuadre con caja; respaldo exportado e importado en otro PC; permisos verificados; sesión cerrada al salir.
5. **Cierre:** tag `f4-f5`; instalador 1.4.0.

**Entregable:** app operable con ventas, reportes reales, respaldos portables y seguridad endurecida.

**Compuerta de aceptación**

- Ningún botón de fachada en POS, reportes, usuarios, respaldos y configuración.
- El respaldo cifrado se exporta, se importa y se restaura en un equipo limpio.
- La matriz de permisos se guarda y se aplica en el proceso principal.
- La sesión no se recuerda al cerrar la aplicación.
- El descuento de fidelidad nunca deja el precio por debajo del piso definido.

### Tramo 4 — F6 + F7: Extras, QA y piloto

**Duración orientativa:** 9–13 días.

**Pasos**

1. **F6:** escaneo de facturas con IA, migración desde la base Python, catálogo web y plantillas WhatsApp si siguen en alcance.
2. **F7:** suite Playwright, pruebas de impresión y respaldos, rendimiento, instalador firmado y piloto con copia de datos reales.
3. **Cierre:** checklist de aceptación firmado, tag `f6-f7` e instalador final.

**Entregable:** instalador firmado y piloto sin bloqueos.

**Compuerta de aceptación**

- Migración dry-run sin pérdidas.
- IA con clave cifrada y revisión humana antes de crear la compra.
- Instalador firmado.
- Checklist de aceptación firmado.
- Piloto con copia de datos reales sin bloqueos.

## 5. Reglas de trazabilidad

- **Una rama por tramo:** `fase/f0-f1`, `fase/f2-f3`, `fase/f4-f5`, `fase/f6-f7`.
- **Un tag por tramo:** `f0-f1`, `f2-f3`, `f4-f5`, `f6-f7`.
- **Un instalador por tramo** y una sesión de aceptación antes de continuar.
- **Matriz de módulos actualizada** al inicio y al final de cada tramo.
- **Evidencias:** capturas, logs de pruebas, `CHANGELOG` y acta firmada.
- **No se mezclan fases:** nada de F4 dentro del tramo F2/F3.
- **No se avanza** si la compuerta no pasa.

### Documentación propuesta

| Ruta | Contenido |
| --- | --- |
| `docs/plan/` | Este esquema y sus actualizaciones |
| `docs/auditoria/` | Matriz de módulos y brechas por tramo |
| `docs/pruebas/` | Guiones y resultados de pruebas |
| `docs/actas/` | Actas de aceptación firmadas |
| `docs/evidencias/` | Capturas y logs de respaldo |

## 6. Mapa de los 15 puntos del usuario

| # | Punto | Tramo |
| --- | --- | --- |
| 1 | Foto de usuarios | Tramo 3 (F5) |
| 2 | Sesión sin recordar y cierre al salir | Tramo 3 (F5) |
| 3 | “Invitar usuario” → añadir/crear | Tramo 1 (F1) |
| 4 | Dirección, teléfono y documento de usuario | Tramo 3 (F5) |
| 5 | Integrar o eliminar el borde | Tramo 3 (F5/UI) |
| 6 | Matriz de permisos configurable | Tramo 3 (F5) |
| 7 | Exportar/importar respaldos con contraseña | Tramo 3 (F5) |
| 8 | DV automático y NIT solo números | Tramo 1 (regla) / Tramo 3 (implementación) |
| 9 | Legal y fiscal dentro de Negocio | Tramo 3 (F5) |
| 10 | Placeholder “usuario” en login | Tramo 1 (F1) |
| 11 | Escanear facturas de compra con IA | Tramo 4 (F6) |
| 12 | Historiales que abran el documento | Tramo 2 (F2/F4) |
| 13 | Asignación de técnico con trazabilidad | Tramo 2 (F3) |
| 14 | Descuento por porcentaje o valor | Tramo 3 (F4) |
| 15 | Fidelidad con piso de precio | Tramo 3 (F4) |

## 7. Decisiones pendientes

1. ¿El catálogo de equipos será una entidad separada o el equipo seguirá viviendo dentro de la OT?
2. ¿La matriz de permisos será por rol o tendrá excepciones por usuario?
3. ¿El piso de fidelidad será el costo de compra del producto o el último precio de venta?
4. ¿La contraseña del respaldo será por archivo o fija del negocio? ¿Cifrado obligatorio?
5. ¿Qué proveedor de IA se usará y cómo se guardará la clave?
6. ¿El borde será edge-to-edge con marco nativo o ventana sin marco con barra propia?
7. ¿Se usará un certificado de firma de código para el instalador?
8. ¿El piloto se hará con copia de datos reales o con datos anonimizados?

## 8. Fuera de alcance de esta oleada

- Facturación electrónica DIAN.
- QR, firma digital y tracking público.
- Multi-sucursal o multiusuario en red.
- Integraciones contables externas.
- Catálogo web e IA si el usuario decide postergarlos.

## 9. Próximo paso

Iniciar el **Tramo 4 (F6 + F7)**: IA de facturas de compra con Gemini, migración desde Python, catálogo web/WhatsApp, firma del instalador, rendimiento y piloto. Antes de ejecutar, confirmar el proveedor/modelo de IA y el alcance de migración.

---

### Registro de cambios

| Versión | Fecha | Cambio |
| --- | --- | --- |
| v1 | 2026-10-26 | Esquema inicial de cuatro tramos y reglas de trazabilidad. |
