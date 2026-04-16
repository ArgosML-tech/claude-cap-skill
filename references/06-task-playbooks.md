# Playbooks by task type

## Greenfield from spec playbook

> Activar cuando: el usuario proporciona una especificación de proyecto completo
> y no existe un proyecto CAP en el directorio de trabajo.
> Leer `references/00-spec-intake.md` primero.

### Registro de build (transversal — activo durante todas las fases)

Mantener un registro interno de incidencias durante el build. Cada vez que:
- Un error de compilación CDS requiere más de una corrección
- Un test falla por un comportamiento de CAP no obvio
- Se aplica una solución no documentada en las referencias del skill
- El comportamiento real de CAP difiere de lo esperado según la spec

→ Anotar en el registro: síntoma, causa identificada, solución aplicada, y en qué referencia del skill debería documentarse.

El registro se escribe como `build-log.md` en la raíz del proyecto al finalizar la Fase 7.

---

### Fase 1 — Entorno

**Hacer:**
1. Verificar `node -v` y `npm -v` — confirmar compatibilidad antes de fijar versiones
2. Crear `package.json` con `@sap/cds` y las dependencias reales del proyecto
3. Crear `.cdsrc.json` con `requires.db.kind: sqlite` y `auth.kind: mocked` para local
4. Crear estructura de carpetas: `db/data/`, `srv/external/data/`, `test/`, `app/`
5. Crear `package.json` scripts: `start`, `watch`, `test`

**Señal de completitud:**
- `node -e "require('@sap/cds')"` sin error
- `cds version` imprime versión correcta

**Si falla:** el entorno no tiene node/npm compatible — escalar al usuario con versiones exactas encontradas.

---

### Fase 2 — Schema (`db/schema.cds`)

**Hacer (en este orden):**
1. Code lists (`@cds.autoexpose @readonly entity X : CodeList`)
2. Entidades maestras simples
3. Entidades principales (con composiciones si aplica)
4. Entidades hijo (composition children)
5. Seed CSVs en `db/data/<namespace>-<Entity>.csv` para code lists y master data

**Reglas:**
- Usar `cuid` para claves de entidades editables por el usuario
- Usar `managed` para createdAt/createdBy/modifiedAt/modifiedBy automáticos
- Usar UUIDs hardcoded en CSVs para que los composition children puedan referenciar padres
- **Los IDs en CSVs deben ser UUIDs válidos — solo caracteres `[0-9a-f-]`.** Prefijos nemotécnicos como `t`, `r`, `o` NO son hex válidos → CAP lanza 400 al parsear la clave en Object Page navigation. Usar `a`, `b`, `c`... como prefijo en lugar de letras fuera del rango hex.
- NO incluir `createdBy`, `createdAt` en CSVs de entidades con `managed` — CAP los gestiona

**Señal de completitud:**
```bash
node -e "const cds = require('@sap/cds'); cds.load('db/schema.cds').then(m => console.log(Object.keys(m.definitions).filter(k => !k.startsWith('sap.')).join(', '))).catch(e => console.error(e.message))"
```
Debe imprimir todas las entidades esperadas sin errores.

**Si falla:** error de compilación CDS — es un error de modelado, no de handler. Leer el mensaje de error, identificar la entidad afectada, corregir en schema.cds antes de continuar.

---

### Fase 3 — Servicios CDS (`srv/*.cds`)

**Hacer:**
1. Un archivo `.cds` por servicio
2. Declarar `@path`, `@requires`
3. Proyectar entidades del domain model con `*` más aliases si se necesitan
4. Declarar acciones y funciones
5. Declarar `@restrict` por entidad (instancia-level: `createdBy`, `salesOrg`, etc.)
6. Para entidades `@odata.draft.enabled`: incluir virtual fields para `@Core.OperationAvailable`

**Señal de completitud:**
```bash
node -e "const cds = require('@sap/cds'); cds.load('srv').then(m => console.log(Object.keys(m.definitions).filter(k => k.includes('Service')).join('\n'))).catch(e => console.error(e.message))"
```
Debe mostrar el servicio y todas sus entidades/acciones.

**Si falla:** problema de referencia entre servicios o namespace. Revisar si el `using` statement apunta al path correcto.

---

### Fase 4 — Handlers (`srv/*.js`)

**Hacer solo los handlers que la spec requiere. NO reimplementar CRUD genérico.**

Handlers necesarios típicamente:
- `before('NEW')` para inicializar campos de estado
- `before('PATCH')` para recalcular campos derivados
- `before('SAVE')` para validación de negocio + integración pre-activación
- `on('action')` para transiciones de estado
- `after('READ')` para virtual fields (canSubmit, canApprove, etc.)

Para cada handler:
- Extraer la lógica pura a `srv/lib/*.js` si es reutilizable (calculadores, evaluadores)
- Registrar handlers con `this.on/before/after` en clase que extiende `cds.ApplicationService`

**Señal de completitud:**
```bash
node -e "const cds = require('@sap/cds'); cds.load('srv').then(() => { console.log('OK'); process.exit(0) }).catch(e => { console.error(e.message); process.exit(1) })"
```
Modelo compila sin errores. La validación real se obtiene ejecutando `npm test`.

> **Antipatrón eliminado:** `cds.test('.').then(async () => {...})` falla con `TypeError: Cannot read properties of undefined (reading 'catch')` en `@sap/cds@9`. `cds.test()` devuelve un TestFacade thenable propio que no acepta async functions en `.then()` de la misma forma que una Promise nativa. Usar `cds.load()` para smoke-test de compilación.

**Si falla:** error en handler — identificar si es error de scope (this.entities), error de CQL, o error de lógica. Ver Error Resolution Protocol más abajo.

---

### Fase 5 — Tests (`test/*.test.js`)

**Estructura por servicio:**
- Un archivo de test por servicio (`<service-name>.test.js`)
- Si hay flujos de failure path complejos → archivo separado (`<feature>-failure.test.js`)

**Cobertura mínima por servicio:**
1. Happy path — acción principal de negocio de principio a fin
2. Error path — validación de negocio rechaza correctamente
3. Auth — usuario sin permiso recibe 403 o 404 (según @restrict where vs @requires)
4. Estado final — GET después de acción verifica estado correcto (no solo el response de la acción)

**Patrón estándar:**
```js
const cds = require('@sap/cds')
const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')

describe('NombreServicio', () => {
  const app = cds.test(__dirname + '/..', '--with-mocks')
  // ...
})
```

**Señal de completitud:**
```bash
node --test test/*.test.js 2>&1 | tail -10
```
`fail 0` — todos los tests en verde.

**Si falla:** ver Error Resolution Protocol.

---

### Fase 6 — UI (`app/`) [condicional — solo si la spec pide Fiori Elements]

**Hacer:**
1. Crear `app/<nombre>/annotations.cds` con UI.HeaderInfo, UI.LineItem, UI.Facets, UI.FieldGroup
2. Crear `app/<nombre>/webapp/manifest.json` con routing correcto
3. Crear `app/<nombre>/webapp/Component.js`, `index.html`, `i18n/i18n.properties`
4. Si hay acciones bound → añadir `@Core.OperationAvailable` en annotations + virtual fields en handler

**Señal de completitud:**
- `cds watch` arranca sin errores
- `GET http://localhost:4004/$metadata` muestra las entidades
- `GET http://localhost:4004/index.html` carga sin error 404

**No afirmar que el UI funciona visualmente sin haberlo abierto en un navegador.**

---

### Fase 7 — Validación final

Verificar que el proyecto entero está completo:

```bash
# Schema compila
node -e "const cds=require('@sap/cds');cds.load('db/schema.cds').then(()=>console.log('schema OK')).catch(e=>console.error(e.message))"

# Todos los tests pasan
node --test test/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)"

# El server arranca
# (no verificar UI visual sin browser — declararlo explícitamente)
```

Producir un resumen de completitud:
```
BUILD COMPLETO
Entidades: <lista>
Servicios: <lista>
Tests: <N> passing, 0 failing
UI: <completa / no solicitada / pendiente de verificación visual>
Gaps de la spec resueltos con defaults: <lista>
```

**Escribir `build-log.md`** en la raíz del proyecto con todas las incidencias registradas durante el build. Formato:

```markdown
# Build log — <nombre-proyecto>
> Generado automáticamente al finalizar el build. Revisar para incorporar gaps al skill.

## Incidencias encontradas durante el build

### G1 — <título corto>
- **Fase:** <1–7>
- **Síntoma:** <qué falló o se comportó de forma inesperada>
- **Causa:** <por qué ocurrió>
- **Solución aplicada:** <qué cambio resolvió el problema>
- **Candidato a documentar en:** `references/<archivo>.md`

### G2 — ...
```

Si no hubo incidencias, escribir `build-log.md` con el mensaje: `Sin incidencias — build completado sin desviaciones del skill.`

---

## Implementation playbook

1. Detect runtime and repo structure using Glob/Grep tools
2. Confirm real access to key files (`package.json`, `db/*.cds`, `srv/*.cds`)
3. If local startup or installation is involved, verify `node -v` and `npm -v`
4. Classify which layer the change belongs to: CDS, service contract, annotations, or handler
5. Apply the most declarative solution possible before writing handler code
6. Add or adjust tests using the assertion style the repo already follows — Chai if using the official `cds.test` default, `node:assert/strict` if the repo prefers no extra dependencies
7. Review security, portability, and multitenancy impact before closing

If the task includes a CAP frontend:
8. Decide between Fiori Elements, SAPUI5 freestyle, or a simpler UI
9. Locate or scaffold `app/`, `manifest.json`, `Component.js`, and annotations
10. Validate over HTTP that CAP serves the app assets and that `mainService.uri` points to the real OData endpoint
11. If the FE app was generated, inspect the generated `manifest.json` — Fiori tools can produce a non-CAP `mainService.uri`
12. If generation added `cds-plugin-ui5` to the root project, re-run tests and isolate whether failures come from the plugin, not the CAP service

If the task includes external services:
8. Locate the imported or curated external model under `srv/external/`
9. Decide whether the local loop uses an in-process mock, a separate mock service, or a real remote connection
10. Inspect the generated CDS before assuming field names, file names, or service aliases
11. If the imported service name is fully qualified, add a stable alias in `cds.requires`
12. Test both the catalog read and the local entity path that depends on the remote key

---

## Minimal greenfield playbook

Before creating any files:
1. Confirm whether the goal is a real project or a skill test
2. Verify the environment (`node -v`, `npm -v`) before fixing dependencies
3. Confirm that proposed package versions actually exist in npm
4. If local SQLite is involved, validate the `cds deploy` step before testing endpoints
5. State explicitly when startup could not be verified in the current session

Do not keep iterating on a test repo if the main failure is in the skill instructions.

---

## Review playbook

Look first for these problems:
- Handlers that duplicate CRUD or filtering CAP already provides
- Direct exposure of the persistence model where a projection is better
- Manual security that should be `@requires` or `@restrict`
- Unnecessary native SQL or accidental HANA coupling
- Missing tests for non-trivial business logic
- CAP anti-patterns: treating `srv/*.js` as the first design location

---

## Refactor playbook

Before changing code:
1. Identify whether logic can move from handler to CDS or service
2. Separate model, contract, and domain logic
3. Reduce coupling between persistent entities and the public API
4. Preserve naming and repo conventions

---

## Debugging playbook

1. Confirm runtime, startup command, and service structure
2. Locate the affected entity or action in `db/*.cds` and `srv/*.cds`
3. Identify which layer the failure starts in: modeling / service exposure / auth / handler / data
4. Check whether the expected behavior already existed in generic providers
5. Review logs, tests, and environment configuration before proposing a patch
6. If CDS compiler errors appear, classify them as modeling problems first unless there is strong evidence they originate in runtime-only code

If the bug includes frontend:
7. Check whether the problem is in the OData contract, annotations, `manifest.json`, or UI runtime
8. Distinguish real visual validation from simple availability of static assets

If the bug includes external services:
9. Distinguish whether the failure is in imported metadata, alias resolution, mock wiring, real remote credentials, or response enrichment

---

## FE debugging mini-playbooks

### `403` in Fiori Elements

1. Identify the exact failing resource or navigation path
2. Check whether it is a main entity, a child collection, or a shared value-help catalog
3. Verify the relevant `@requires` and `@restrict`
4. Check whether different FE apps by role share a target that should be split into role-specific projections
5. Only after that inspect `manifest.json`

### Filter or value help does not behave as a fixed list

1. Confirm whether the field is backed by a real code list or only by an enum
2. Prefer a readonly code-list projection plus `Common.ValueListWithFixedValues`
3. If the filter should be single-choice, add `Capabilities.FilterRestrictions.FilterExpressionRestrictions`
4. Validate the behavior in the browser, not only in `$metadata`

### FE app renders but remains unusable

1. Confirm `mainService.uri`
2. Inspect `$metadata`
3. Confirm draft semantics when the app is transactional
4. Verify value-help catalogs and child collections for the active role
5. Distinguish: wrong metadata vs FE standard behavior the product does not want

### FE app was generated but fails in a local CAP project

1. Inspect the generated `manifest.json`
2. Compare `mainService.uri` with the real CAP service path and `@path`
3. Confirm CAP serves `index.html` and `manifest.json` from the generated app folder
4. Run a smoke test reading the FE manifest over HTTP
5. Only then proceed to visual browser validation

### External service mock or alias does not work

1. Confirm the actual fully qualified service name generated by the imported model
2. If code wants a short alias, map it explicitly in `cds.requires.<alias>.service`
3. If the imported service name already equals the alias, remove the redundant `service` property
4. Decide whether local development should use `cds.requires.<alias>.impl` or a separately served mock endpoint
5. If a projected local entity forwards a query to the external service, verify whether the target name must be translated
6. If `$expand` crosses a local entity and a remote target, verify whether response enrichment is needed

### CDS compiler message keeps appearing

1. Identify whether the message is about name resolution, type mismatch, redirection, association targets, or annotation placement
2. Inspect the affected `db/*.cds` and `srv/*.cds` before touching handlers
3. Check whether the service contract still matches the base entity after recent changes
4. If the issue is a relationship, re-evaluate composition vs association
5. If the issue is repeated structure or field drift, check whether an aspect is missing

---

## Diagnostic heuristics

- If an action returns something unexpected, compare: its CDS signature / what the handler returns / what the test expects
- If the endpoint "works" but the contract is misaligned, do not close the case just because there is no `500`
- If a failure appears only in the immediate action result but not in a follow-up read, inspect whether the issue is in the service contract or in response enrichment
- If tests fail intermittently or with unexpected counts, suspect state contamination before concluding it is a business bug

---

## Control questions

- Is the problem in the service contract or in the implementation?
- Does CAP already support this behavior declaratively?
- Does the bug affect auth, draft, tenant, or database behavior?
- Would the solution work both locally and in cloud if the repo requires that?
- Is Fiori Elements the right fit here, or would a simpler UI be more honest?
- Does the FE app have enough metadata, annotations, and `mainService` wiring to work?
- Is the remaining issue still solvable in metadata, or is FE standard behavior the actual constraint?

---

## When to escalate to the user

Escalate and describe the blocker when:
- You cannot access the real workspace or key files
- You cannot confirm runtime or minimal project structure
- The request is about MTX or tenant lifecycle but the repo shows no real multitenancy signals
- The request is about CF or Kyma deployment but the repo shows no real deployment descriptors or bindings
- You are about to guess compatibility of versions without verification

---

## Error Resolution Protocol (builds autónomos)

> Usar este protocolo cuando una fase del build autónomo falla.
> NO escalar al usuario hasta haber agotado el árbol de diagnóstico.

### Clasificación de errores

#### E1 — Error de compilación CDS

Síntoma: `cds.load()` lanza error, mensaje de compilación.

Árbol de diagnóstico:
1. ¿El error menciona un nombre de entidad? → revisar ese entity en schema.cds o srv/*.cds
2. ¿Dice "not found" o "unknown" en un `using`? → el path del `using` está mal
3. ¿Dice "redefines" o "duplicate"? → proyección o entidad repetida
4. ¿Menciona "redirection"? → association target no accesible desde el servicio
5. ¿Menciona "unresolved"? → campo referenciado en `@restrict where` que no existe

**No tocar handlers hasta resolver todos los errores de compilación.**

---

#### E2 — Test retorna 4xx inesperado

Síntoma: test espera 200/201 pero recibe 403, 404, o 400.

Árbol de diagnóstico:
- **403:** problema de autorización
  1. ¿El usuario del test tiene el rol correcto en `package.json` (cds.users)?
  2. ¿La entidad tiene `@requires` o `@restrict` que excluye ese rol?
  3. ¿Es una entidad hijo accedida directamente (sin navegación desde el padre)?
  4. ¿Es una unbound action con check manual de `req.user.is()` en el handler?
- **404:** entidad no encontrada o filtrada silenciosamente
  1. ¿El ID existe en seed data o fue creado en un test anterior?
  2. ¿Hay `@restrict where createdBy = $user` y el user del test no es el creador?
  3. ¿La entidad es draft-enabled y se busca por ID sin `IsActiveEntity` en el path?
- **400:** validación de negocio falla
  1. ¿Hay un `before('SAVE')` con `req.error()` activo?
  2. ¿Faltan campos obligatorios en el payload del test?
  3. ¿Hay un guard de estado incorrecto (`status_code !== 'X'`)?

---

#### E3 — Test retorna 4xx en lugar de 5xx (error no controlado)

Síntoma: test espera error pero Axios lanza una excepción no capturada.

Diagnóstico:
1. `cds.test` usa Axios — lanza en 4xx/5xx. Los tests de error deben usar try/catch.
2. Patrón correcto:
```js
try {
  await app.post(...)
  assert.fail('Expected 4xx')
} catch (err) {
  assert.equal(err.response?.status ?? err.status, 403)
}
```

---

#### E4 — ECONNREFUSED en tests

Síntoma: `connect ECONNREFUSED 127.0.0.1:XXXX`

Diagnóstico:
1. `cds.test()` está dentro de `before()` en lugar de en el nivel del `describe()`.
2. Mover `const app = cds.test(...)` al nivel del describe (fuera de cualquier hook).

---

#### E5 — External service falla en tests

Síntoma: `No credentials configured for ServiceName` o `connect ECONNREFUSED`

Diagnóstico:
1. ¿Se está usando `cds.test(__dirname + '/..', '--with-mocks')`? Sin `--with-mocks` los external services no se mockean.
2. ¿Existe un CSV de seed data en `srv/external/data/<ServiceName>-<Entity>.csv`?
3. ¿El servicio A2X tiene campos NOT NULL que el mock no puede satisfacer? → necesita custom handler en `srv/external/<ServiceName>.js`.

---

#### E6 — Test pasa pero el dato no es el esperado

Síntoma: assertion falla porque el campo tiene el valor incorrecto (no porque el status sea wrong).

Diagnóstico:
1. ¿El handler está registrado en la entidad correcta (draft vs active)?
   - Draft: `SalesOrderDrafts.drafts` — para before('PATCH'), before('NEW')
   - Active: `SalesOrderDrafts` — para acciones después de draftActivate
2. ¿El `SELECT` en el handler usa la misma entidad que el `UPDATE`?
3. ¿El campo es un campo `managed` (createdBy, modifiedAt)? → no se puede asignar manualmente
4. ¿El campo es virtual? → debe calcularse en `after('READ')`, no persistirse

---

#### E7 — cds.spawn produce resultados no deterministas en tests

Síntoma: un test pasa a veces y falla otras veces.

Diagnóstico:
1. Hay un `cds.spawn()` inmediato en un action handler.
2. La tarea background puede completarse antes o después de que el test haga la siguiente assertion.
3. Solución: no disparar spawn inmediato desde el handler. Usar scheduler periódico + action Admin para trigger explícito en tests.
   Ver patrón en `03-node-handlers.md` — Gap #25.

---

#### E8 — Draft lock conflict en tests

Síntoma: `403 — The entity is locked by user 'X'`

Diagnóstico:
1. Un draft creado por usuario A está siendo modificado por usuario B mientras sigue bloqueado.
2. Los drafts están bloqueados hasta `draftActivate` o `draftDiscard`.
3. Solución: las acciones sobre el draft deben ejecutarse con el mismo usuario que lo creó,
   o el draft debe activarse antes de que otros usuarios lo modifiquen.
4. Si necesitas escalar riesgo antes de activar: usa PATCH (recálculo automático) en lugar de escalateRisk.

---

#### Cuándo escalar al usuario (tras agotar el árbol)

Escalar si después de dos intentos de fix el error persiste y:
- El error requiere credenciales o acceso a sistemas externos reales
- El error indica una contradicción en la spec (dos reglas se anulan mutuamente)
- El error es un bug conocido de la versión de @sap/cds instalada (no algo solucionable en el código)

Al escalar: describir el error exacto, qué se intentó, y qué necesitas del usuario.
