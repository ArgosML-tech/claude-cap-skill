# Agent evolution log

Registro acumulativo de hallazgos descubiertos durante builds reales.
Actualizado automáticamente por `scripts/close-learning-loop.js` al finalizar cada build.
No borrar entre sesiones.

---

## Iteration 2026-04-16
- **Hallazgo:** `requester1` recibía 403 "lacking required roles" aunque tenía roles definidos en `package.json`
- **Fix:** Mover el bloque de usuarios a `cds.requires.auth.users` en `package.json`
- **Reference actualizada:** `04-security-auth.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** `POST /odata/v4/ber/ExpenditureItems` retornaba 403 "A draft-enabled entity can only be modified via its root entity"
- **Fix:** Cambiar todos los POST de items en tests a usar path de navegación desde la raíz del draft
- **Reference actualizada:** `03-node-handlers.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** Validación de items en `before('SAVE')` fallaba con 422 "At least one expenditure item is required" aunque se habían añadido items vía navegación draft
- **Fix:** Mover la validación de items al action handler `Submit`, que se ejecuta DESPUÉS de `draftActivate` sobre la entidad activa donde los items ya están disponibles
- **Reference actualizada:** `03-node-handlers.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** CDS compiler error "Duplicate assignment with @UI.SelectionFields" al cargar modelo con dos archivos de annotations para la misma entidad
- **Fix:** Mantener `@UI.SelectionFields` solo en `ber-requests.cds`. En `ber-approvals.cds` usar qualifiers: `UI.LineItem #Approvals`, `UI.Facets #Approvals`
- **Reference actualizada:** `09-cap-frontend-fiori.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** `validate-metadata.js` rechazaba `AppComponent.extend('com.argosml.ber.requests.Component', ...)` indicando que no coincide con `sap.app.id`
- **Fix:** Cambiar a `AppComponent.extend('com.argosml.ber.requests', ...)`
- **Reference actualizada:** `09-cap-frontend-fiori.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** El script transforma `BERService` → `b-e-r` en lugar de `ber` al derivar el service slug para `$metadata`
- **Fix:** Verificación manual de `$metadata` vía `curl`. El endpoint `/odata/v4/ber/$metadata` es correcto y retorna 200 con todas las entidades y acciones
- **Reference actualizada:** `02-cds-services.md`
- **Reusable:** sí — registrado desde build-log automático


## Iteration 2026-04-16
- **Hallazgo:** Pantalla en blanco al abrir `/ber-requests/webapp/index.html`. Playwright muestra `failed to load JavaScript resource: sap/fe/core/AppRouter.js`. En el historial anterior la causa se atribuía a Basic Auth / XHR, pero la causa real era el CDN
- **Fix:** Crear en `server.js` dos rutas de auth-gate (`GET /ber-requests`, `GET /ber-approvals`) que: (1) emiten challenge Basic Auth con `WWW-Authenticate` propio, (2) tras credenciales válidas redirigen a `/$fiori-preview/BERService/ExpenditureRequests#preview-app`. El browser cachea credenciales para el origen; todas las llamadas OData siguientes incluyen el header automáticamente. `$fiori-preview` usa FLP sandbox + ushell y nunca carga AppRouter directamente
- **Reference actualizada:** `09-cap-frontend-fiori.md`
- **Reusable:** sí — registrado desde build-log automático


## Iteration 2026-04-17
- **Hallazgo:** CDS compiler error: `'case' is a reserved word - write '![case]' instead` en todas las entidades hijo (CaseApprovals, CaseAttachments, CaseComments, CaseEventLogs).
- **Fix:** Renombrar `case` → `caseRef` en todas las entidades hijo y en todas las cláusulas `on` de las Compositions. Actualizar `case_ID` → `caseRef_ID` en el handler JS.
- **Reference actualizada:** `11-cds-modeling-guardrails.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** Códigos de estado como `PENDING_UNIT_APPROVAL` (21 chars) exceden el límite de 11 chars de `sap.common.CodeList`.
- **Fix:** Definir aspecto personalizado `CatalogBase { key code: String(40); name: String(150); }` en lugar de extender `CodeList`. Eliminar import de `sap.common.CodeList`.
- **Reference actualizada:** `11-cds-modeling-guardrails.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** `status: Association to CaseStatuses default 'DRAFT'` falla — CDS no soporta default directo en Associations sin FK explícita.
- **Fix:** Eliminar `default 'DRAFT'` de la Association; establecer el estado inicial en el handler `before CREATE` vía `req.data.status_code ??= 'DRAFT'`.
- **Reference actualizada:** `11-cds-modeling-guardrails.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** `Cannot read properties of undefined (reading 'transitions')` al hacer deploy de CSVs con `@sap/cds 8.9.9` + `@cap-js/sqlite 2.2.0`.
- **Fix:** Actualizar `package.json` de `"@sap/cds": "^8"` a `"@sap/cds": "^9"` y `"@sap/cds-dk": "^8"` a `"@sap/cds-dk": "^9"`. Ejecutar `npm install`.
- **Reference actualizada:** `05-testing-deployment.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** `Cannot find module '@cap-js/cds-test'` al ejecutar `npm test` con CDS v9.
- **Fix:** `npm install @cap-js/cds-test --save-dev`.
- **Reference actualizada:** `05-testing-deployment.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** 403 Forbidden en todas las acciones con `@requires`, aunque los usuarios están definidos en `package.json` con los roles correctos. `cds.env.requires.auth.users` mostraba roles por defecto de CDS (alice=admin, bob=cds.ExtensionDeveloper) en lugar de los del proyecto.
- **Fix:** Mover la configuración completa de `auth` (con `kind`, `users`) de `cds.auth` a `cds.requires.auth` en `.cdsrc.json`.
- **Reference actualizada:** `04-security-auth.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** "Row click did not navigate to ObjectPage" — FAIL — cuando la lista está vacía (sin datos de prueba).
- **Fix:** (see build-log for details)
- **Reference actualizada:** `09-cap-frontend-fiori.md`
- **Reusable:** sí — registrado desde build-log automático

- **Hallazgo:** Pass 2 del script falla al resolver `$metadata` — intenta `/odata/v4/urgent-procurement/` en lugar de `/odata/v4/UrgentProcurementService/`.
- **Fix:** (see build-log for details)
- **Reference actualizada:** `09-cap-frontend-fiori.md`
- **Reusable:** sí — registrado desde build-log automático

