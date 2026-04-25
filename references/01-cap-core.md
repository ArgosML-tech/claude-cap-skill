# CAP: operational mental model

## What CAP is optimized for

SAP CAP is designed for building cloud business applications with focus on:

- Domain modeling in CDS
- Services defined as usage contracts
- Generic providers for standard behavior (CRUD, search, pagination, validation)
- Targeted extensions through handlers
- Clear separation between model, service, and specific logic

## Core rule

Before writing custom logic, ask whether the requirement is already solved by:

- CDS modeling or a new entity/aspect
- A service projection
- A constraint or annotation
- A generic CAP provider
- A domain action or function

## Recommended design order

1. Model the domain in `db/*.cds`
2. Define the service contract in `srv/*.cds`
3. Add handlers only if real domain logic is still missing after the above
4. Add service and security tests
5. Adjust deployment and environment configuration

## What usually goes wrong

- Treating `srv/*.js` or `srv/*.ts` as the first design location
- Manually replicating CRUD that CAP already provides
- Exposing technical entities directly to consumers without a projection
- Mixing security decisions with persistence logic
- Adding handlers for behavior the CDS model could already express declaratively

## Typical project structure

```
db/
  schema.cds          ← domain model (entities, aspects, types)
  data/               ← CSV seed data

srv/
  catalog-service.cds ← service definition, projections, actions
  catalog-service.js  ← handlers (only when needed)
  external/           ← imported external service models (.cds from EDMX)

app/
  index.html          ← launcher page (optional)
  <app-name>/
    webapp/
      manifest.json
      Component.js
      index.html
      annotations/    ← UI annotations (if XML style)
  <app-name>.cds      ← UI annotations (if CDS style)

test/
  catalog.test.js     ← cds.test-based tests

package.json          ← @sap/cds dependency, cds config section
.cdsrc.json           ← optional CDS configuration
```

## Questions the skill should ask itself

- Should this be solved in CDS or in a handler?
- Should the exposed entity be a projection?
- Is an explicit action or function needed?
- Can the restriction be expressed declaratively?
- Does this change affect auth, draft, tenant, or database behavior?

---

## Default Decisions Catalog

> Usar este catálogo cuando la spec no especifica algo. NO preguntar al usuario.
> Aplicar el default, anotarlo en el plan de build.

### Estructura y naming

| Si la spec calla sobre... | Decisión por defecto |
|---|---|
| Namespace CDS | `com.<nombre-proyecto-en-minúsculas>` |
| Nombre de paquete npm | `<nombre-proyecto>-app` |
| Versión de @sap/cds | La más reciente estable — verificar con `npm show @sap/cds version` |
| Driver SQLite | `@cap-js/sqlite@^2` — **NO usar `^1`**: incompatible con `@sap/cds@9`. `^1` requiere `@sap/cds >= 7.6 <9` y falla al instalar con peer dep conflict. |
| Test harness | `@cap-js/cds-test@^0` como **devDependency** explícita. A partir de `@sap/cds@9`, el módulo de test fue extraído del core; `cds.test()` lanza `Cannot find module '@cap-js/cds-test'` si no está declarado. |
| Tipo de clave primaria | `cuid` (UUID auto-generado por CAP) |
| Campos de auditoría | `managed` aspect (createdAt, createdBy, modifiedAt, modifiedBy) |
| Namespace de entidades en CSVs | `<namespace>-<EntityName>.csv` |

### Auth y seguridad

| Si la spec calla sobre... | Decisión por defecto |
|---|---|
| Auth en local | `mocked` auth en `.cdsrc.json` |
| Usuarios de prueba | Definir en `package.json → cds.users` un usuario por rol |
| Restricción de instancia no especificada | Sin restricción — solo restricción de rol (`@requires`) |
| Contraseña de usuarios mock | String vacío — `auth: { username: 'user', password: '' }` en tests |

### Modelado CDS

| Si la spec calla sobre... | Decisión por defecto |
|---|---|
| Relación padre-hijo con ciclo de vida compartido | `Composition` |
| Relación de referencia a master data | `Association` |
| Entidad de catálogo con valores fijos | `CodeList` + `@cds.autoexpose @readonly` — **caveat**: `sap.common.CodeList` define `key code: String(11)`. Para códigos más largos (e.g. `PENDING_UNIT_APPROVAL`) usar un aspecto propio `{ key code: String(40); name: String(150); }` en lugar de extender `CodeList`. |
| Entidades editadas incrementalmente antes de confirmar | `@odata.draft.enabled` |
| Tipo de campo de texto corto | `String(100)` salvo que la spec indique longitud |
| Tipo de campo de importe | `Decimal(15,2)` |
| Tipo de campo de fecha | `Date` (sin hora), `Timestamp` (con hora) |
| Currency default | `'EUR'` si el dominio es europeo, preguntar si es multinacional |

### Servicios

| Si la spec calla sobre... | Decisión por defecto |
|---|---|
| Cuántos servicios | Uno por cluster de roles con entidades distintas |
| Path del servicio | `/api/<nombre-servicio-en-minúsculas>` |
| Service binding para external services | `mocked: true` en local, real credentials en cloud |
| Alias de external service | El nombre corto del sistema (BP, CE, S4, etc.) |

### Handlers

| Si la spec calla sobre... | Decisión por defecto |
|---|---|
| Respuesta de acción | Retornar el entity actualizado (no solo 204) |
| Guard de estado incorrecto | `req.reject(409, ...)` |
| Entidad no encontrada | `req.reject(404, ...)` |
| Validación fallida | `req.reject(422, ...)` para regla de negocio; `req.reject(400, ...)` para campos |
| Error en external service | Capturar, almacenar errorCode + errorDetail, NO propagar como 500 |
| Rol no autorizado en unbound action | `req.reject(403, ...)` con check `req.user.is('Rol')` |

### Testing

| Si la spec calla sobre... | Decisión por defecto |
|---|---|
| Framework de assertions | `node:assert/strict` con `node:test` |
| Placement de cds.test() | Nivel del `describe()` — nunca dentro de `before()` |
| External services en tests | `cds.test(__dirname + '/..', '--with-mocks')` |
| Cobertura mínima | Happy path + error path + auth por cada servicio |
| Tests de flujos async (cds.spawn) | Usar action Admin `triggerProcessing` — NO sleep ni polling |

### UI (Fiori Elements)

| Si la spec calla sobre... | Decisión por defecto |
|---|---|
| Tipo de app FE | List Report + Object Page |
| CDN de UI5 | `https://sapui5.hana.ondemand.com/resources/sap-ui-core.js` — **NO usar `ui5.sap.com` ni versiones con `.x`**: producen CORB en Chrome/Edge cuando el MIME type es `text/html`. Ver `references/09-cap-frontend-fiori.md` sección "UI5 bootstrap: correct CDN host". |
| Shell wrapper | **FE 1.120+**: `ComponentSupport` directo — NO envolver con `sap.m.Shell`. En FE 1.120+, `sap.fe.core.AppComponent` gestiona su propio router; `sap.m.Shell` es legado y puede romper la navegación en standalone. Solo usar `sap.m.Shell` si el proyecto usa SAPUI5 freestyle sin `sap.fe.core.AppComponent`. Ver `references/09-cap-frontend-fiori.md` sección "Standalone FE app — patrón correcto". |
| Anotaciones de acción | `@Core.OperationAvailable` con virtual Boolean field |
| Title del Object Page | Campo más descriptivo para el humano (no el UUID) |
| Una app por rol vs compartida | Una app por cluster de rol si los datos son distintos |

## Gap descubierto — 2026-04-18

**Área:** G3 — `db.entities()` deprecated en CAP 9
**Síntoma:** Warning en consola: `DEPRECATED: srv.entities() — use cds.entities() instead`
**Causa:** La API `db.entities('namespace')` fue deprecada en CAP 9
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-21

**Área:** [Fase 4 — Auth] cds.users ubicación incorrecta en package.json
**Síntoma:** Usuario `admin` se autenticaba pero sin roles — `User 'admin' is lacking required roles: [TemplateAdmin,DocumentConsumer]`
**Causa:** En CAP 9.x, el bloque `cds.users` en `package.json` a nivel raíz no es leído por el middleware de mocked auth. Los usuarios deben estar bajo `cds.requires.auth.users`.
**Fix aplicado:** Mover `"users": {...}` dentro de `"cds": { "requires": { "auth": { "kind": "mocked", "users": {...} } } }`

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-24

**Área:** Logging JSON en Python
**Síntoma:** Logging JSON en Python
**Causa:** (see build-log for details)
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-24

**Área:** Validación max_records en Python engine
**Síntoma:** Validación max_records en Python engine
**Causa:** (see build-log for details)
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-24

**Área:** Dockerfile python:3.12-slim
**Síntoma:** Dockerfile python:3.12-slim
**Causa:** (see build-log for details)
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-24

**Área:** Batch INSERT — atomicidad real
**Síntoma:** Batch INSERT — atomicidad real
**Causa:** (see build-log for details)
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-24

**Área:** Idempotencia en submitJob
**Síntoma:** Idempotencia en submitJob
**Causa:** (see build-log for details)
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-24

**Área:** exportDecisions enriquecido
**Síntoma:** exportDecisions enriquecido
**Causa:** (see build-log for details)
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.
