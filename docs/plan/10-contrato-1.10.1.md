# Contrato 1.10.1 — Cambio de modelo y cuotas de Gemini

Fecha: 27 de octubre de 2026

## Alcance

Parche sobre 1.10.0 para evitar que el escaneo de facturas quede bloqueado cuando un modelo de Gemini agota su cuota de RPM, RPD o tokens.

Incluye cambio manual y respaldo automático. No incluye rotación de claves ni evasión de límites del proveedor.

## Decisiones

- El propietario configura la clave, el catálogo y el respaldo automático.
- El propietario y los administradores con `useAI` pueden cambiar el modelo activo.
- Los técnicos no pueden listar ni cambiar modelos.
- El cambio manual está disponible en Configuración y dentro de la ventana de escaneo.
- El respaldo automático es opcional y admite hasta dos modelos.
- La clave sigue cifrada con `safeStorage` y nunca se devuelve al renderer.
- No se rota la clave automáticamente.
- La cuota real depende del plan y del proyecto de Gemini.

## Catálogo de modelos

- `ai.listModels` consulta `v1beta/models` con la clave almacenada.
- Solo incluye modelos con `generateContent`.
- Excluye modelos de embeddings.
- Guarda el catálogo y la fecha de actualización en `ai_config`.
- La interfaz permite elegir del catálogo o escribir un identificador personalizado.
- El catálogo puede actualizarse desde Configuración y desde el escaneo.

## Cambio manual

- `ai.setModel` valida el identificador y actualiza el modelo principal.
- Permitido a propietario y administradores con `useAI`.
- Audita el cambio.
- Limpia el enfriamiento del modelo elegido.
- En el escaneo, el modelo se puede cambiar sin cerrar la factura cargada.

## Respaldo automático

Cadena de intentos:

1. Modelo principal.
2. Primero de respaldo.
3. Segundo de respaldo.

- Solo se activa si el propietario lo configura.
- Se detiene al primer resultado exitoso.
- Máximo tres intentos.
- Se aplica a:
  - Cuota agotada (`AI_QUOTA`).
  - Modelo inexistente (`AI_MODEL_NOT_FOUND`).
  - Servicio no disponible (`AI_UNAVAILABLE`).
  - Timeout (`AI_TIMEOUT`).
- No se aplica a clave inválida, archivo inválido o JSON inválido.
- Los modelos agotados entran en enfriamiento temporal.
- Si todos fallan, se devuelve `AI_ALL_MODELS_FAILED` con los intentos.

## Errores y reintento

- Se conserva `RetryInfo.retryDelay` de Gemini.
- Se identifica si el límite es por minuto o diario.
- El mensaje incluye el modelo y el tiempo de espera cuando está disponible.
- La ventana de escaneo muestra:
  - Mensaje del error.
  - Tiempo de espera.
  - Modelos intentados.
  - Botón **Reintentar**.
  - Selector de modelo para propietario y administradores.
- La imagen o PDF permanece cargada tras un fallo.

## Metadatos

La extracción guarda:

- `model`: modelo que respondió.
- `requestedModel`: modelo principal solicitado.
- `fallbackUsed`: si se usó un respaldo.
- `attempts`: modelo, código, mensaje y espera de cada intento fallido.

El comprobante y la compra conservan estos metadatos sin guardar el archivo.

## Permisos

- `configureAI`: propietario.
- `ai.listModels`: propietario o administrador con `useAI`.
- `ai.setModel`: propietario o administrador con `useAI`.
- `settings.updateSection('ai')`: propietario.
- `purchases.scanInvoice`: `useAI` y `createPurchase`.

## Persistencia

No hay migración de base de datos. Los campos nuevos viven en el JSON de `ai_config`:

- `fallbackModels`.
- `autoFallback`.
- `modelCatalog`.
- `catalogUpdatedAt`.

## Pruebas

- Aceptación 1.10.1: 15/15.
- Casos cubiertos:
  - Catálogo y filtro de modelos.
  - Cuota agotada en el principal y respaldo exitoso.
  - Cuota agotada en todos los modelos.
  - Respaldo desactivado.
  - Respaldo ante 404 y 503.
  - Cambio de modelo por administrador.
  - Bloqueo a técnicos.
  - Interfaz de propietario.
  - Error 429, cambio de modelo y reintento sin perder la factura.
  - Flujo completo de AliExpress.
  - Cambio rápido de modelo por administrador.
- Regresión completa de versiones anteriores.

## Fuera de alcance

- Diagnóstico técnico con IA.
- Resúmenes y anomalías de caja.
- Rotación automática de claves.
- Proveedores distintos de Gemini.
- Ajuste automático de resolución o páginas del PDF según consumo de tokens.
