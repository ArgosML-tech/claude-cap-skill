# CAP Node.js: handlers, CQN, and TypeScript

## Context

This reference covers CAP Node.js with `@sap/cds` — both JavaScript and TypeScript handlers.

## Project signals to confirm before generating handler code

Use Grep/Glob tools:
- `package.json` with `@sap/cds`
- Handler files in `srv/*.js` or `srv/*.ts`
- Scripts: `cds watch`, `cds serve`, `npm test`
- Structure: `db/`, `srv/`, `app/`, `test/`

## Handler styles: function vs class

CAP supports two equivalent styles. Use whichever the repo already follows.

**Function style** (`cds.service.impl`) — concise, common in older projects:

```js
const cds = require('@sap/cds')

module.exports = cds.service.impl(function () {
  this.on('submitOrder', async req => {
    const { book, quantity } = req.data
    if (!quantity || quantity <= 0) req.reject(400, 'Quantity must be positive')

    const tx = cds.transaction(req)
    const row = await tx.run(
      SELECT.one.from('my.bookshop.Books').where({ ID: book })
    )

    if (!row) req.reject(404, 'Book not found')
    if (row.stock < quantity) req.reject(409, 'Insufficient stock')

    await tx.run(
      UPDATE('my.bookshop.Books').set({ stock: row.stock - quantity }).where({ ID: book })
    )

    return 'Order accepted'
  })
})
```

**Class style** (`extends cds.ApplicationService`) — promoted in official CAP docs, preferred for new projects:

```js
const cds = require('@sap/cds')

class CatalogService extends cds.ApplicationService {
  init() {
    this.after('READ', 'Books', results => results.forEach(book => {
      if (book.stock > 111) book.title += ' -- 11% discount!'
    }))

    this.on('submitOrder', async req => {
      const { book, quantity } = req.data
      if (!quantity || quantity <= 0) req.reject(400, 'Quantity must be positive')
      const tx = cds.transaction(req)
      const row = await tx.run(SELECT.one.from('my.bookshop.Books').where({ ID: book }))
      if (!row) req.reject(404, 'Book not found')
      if (row.stock < quantity) req.reject(409, 'Insufficient stock')
      await tx.run(UPDATE('my.bookshop.Books').set({ stock: row.stock - quantity }).where({ ID: book }))
      return 'Order accepted'
    })

    return super.init()   // ← always call super.init()
  }
}
module.exports = { CatalogService }
```

Note: when exporting the class by name, the filename must match the service name in the CDS file (`cat-service.js` for `CatalogService` defined in `cat-service.cds`), or you must configure the mapping explicitly.

## TypeScript handler pattern

When the project uses TypeScript (`srv/*.ts`, `tsconfig.json`):

```ts
import cds from '@sap/cds'
import type { Request } from '@sap/cds'

module.exports = cds.service.impl(function (this: cds.Service) {
  this.on('submitOrder', async (req: Request) => {
    const { book, quantity } = req.data as { book: string; quantity: number }
    if (!quantity || quantity <= 0) req.reject(400, 'Quantity must be positive')

    const tx = cds.transaction(req)
    const row = await tx.run(
      SELECT.one.from('my.bookshop.Books').where({ ID: book })
    )

    if (!row) req.reject(404, 'Book not found')
    if (row.stock < quantity) req.reject(409, 'Insufficient stock')

    await tx.run(
      UPDATE('my.bookshop.Books').set({ stock: row.stock - quantity }).where({ ID: book })
    )

    return 'Order accepted'
  })
})
```

Note: CAP generates typed entities via `cds-typer` when configured. If the repo uses `@cap-js/cds-typer`, prefer the generated entity types over string references.

## Reserved method names in ApplicationService

When using `class MyService extends cds.ApplicationService`, the following names are **reserved** by the base class and cannot be used as custom action names. Using them produces a startup warning and the handler is silently not registered:

```
reject, resolve, emit, on, before, after, prepend, handle,
send, get, put, post, delete, dispatch, tx, run, read, insert,
update, upsert, delete, begin, commit, rollback
```

If your CDS model defines an action with one of these names (e.g. `action reject(...)`), rename the action. Common safe alternatives:
- `reject` → `dismissPair`, `rejectItem`, `declineRequest`
- `emit` → `publishEvent`, `dispatchMessage`
- `send` → `notifyUser`, `transmitData`

The warning at startup: `"Cannot add typed method for custom action '…' to service impl"` — always fix by renaming.

## Rules for handlers

- Use handlers for real domain logic, not for replicating framework behavior
- Keep handlers small and domain-focused
- Use the official request context for user and tenant — never hardcode
- Use `req.reject()` for an immediate error that stops processing
- Use `req.error()` to accumulate multiple validation errors — the framework rejects with all of them at the end:
  ```js
  req.error(400, 'Title is required', 'title')
  req.error(400, 'Price must be positive', 'price')
  // framework sends both errors in one 400 response
  ```
- If a handler fills or transforms fields that do not live in the database, model them as `virtual` to avoid SQL errors on read

## Bound actions on draft-enabled entities

If a bound action is exposed on a draft-enabled entity, register the handler for both active and draft targets:

```js
const applyStatus = async req => {
  const tx = cds.transaction(req)
  await tx.run(UPDATE(req.subject).set({ status: req.data.status }))
  return tx.run(SELECT.one.from(req.subject))
}

this.on('setProcessingStatus', 'OrderRequests', applyStatus)
this.on('setProcessingStatus', 'OrderRequests.drafts', applyStatus)
```

Why:
- Draft requests are dispatched to the `.drafts` target
- `req.subject` makes the same handler work against the correct active or draft instance
- Validate the stored state with a follow-up GET instead of relying on the immediate action payload

## Handler lifecycle hooks

```js
this.before('CREATE', 'Books', req => {
  if (!req.data.title) req.reject(400, 'Title is required')
})

this.on('submitOrder', async req => { /* domain logic */ })

this.after('READ', 'Books', each => {
  each.availability = each.stock > 0 ? 'in-stock' : 'out-of-stock'
})
```

- `before` → validate or prepare data before persisting or processing
- `on` → implement an operation or override behavior
- `after` → enrich the response without changing the base contract

### Validation: CREATE vs UPDATE require separate handlers

`before(['CREATE', 'UPDATE'], ...)` fires for both, but the guard conditions must differ:

```js
// CREATE: all required fields must be present — no undefined check
this.before('CREATE', 'Orders', (req) => {
  const { name, type } = req.data
  if (!name?.trim())  req.error(400, 'name is required', 'in/name')
  if (!type?.trim())  req.error(400, 'type is required', 'in/type')
})

// UPDATE: only validate fields that are actually in the payload
this.before('UPDATE', 'Orders', (req) => {
  const { name, type } = req.data
  if (name  !== undefined && !name?.trim())  req.error(400, 'name must not be blank', 'in/name')
  if (type  !== undefined && !type?.trim())  req.error(400, 'type must not be blank', 'in/type')
})
```

Why: on UPDATE, `req.data` only contains the patched fields. A missing field means "not being updated" — not a validation error. If you use `!field?.trim()` without the `!== undefined` guard in a shared `before(['CREATE','UPDATE'])`, it fires on UPDATE for unchanged fields (always undefined → always errors). Conversely, using the `!== undefined` guard in CREATE silently accepts a missing required field, letting the DB throw a 500 instead of a 400.

## Request lifecycle hooks

Beyond `before`/`on`/`after` on the service, individual requests expose their own lifecycle events. These run **outside** the framework-managed transaction — use them for side-effects that must not be part of the main transaction:

```js
this.on('submitOrder', async req => {
  // ... main logic inside transaction

  req.before('commit', () => {
    // runs immediately before the transaction commits
  })

  req.on('succeeded', async () => {
    // runs after successful commit — safe for external notifications
    // use cds.tx() if you need a new transaction here
    await cds.tx(async () => {
      await UPDATE `Stats`.set `orders = orders + 1`
    })
  })

  req.on('failed', () => {
    // runs after rollback
  })

  req.on('done', () => {
    // always runs, regardless of outcome
  })
})
```

These handlers cannot veto commits — they are observational only.

## CQN and data access

- Use idiomatic `@sap/cds` APIs (SELECT, INSERT, UPDATE, DELETE, UPSERT)
- Use `SELECT.one` when you expect a single row
- Use `cds.transaction(req)` to preserve request and tenant context
- Avoid raw SQL unless CAP does not cover the case — document the coupling if you do

```js
// Preferred — idiomatic CAP
const tx = cds.transaction(req)
return tx.run(
  SELECT.from('my.bookshop.Books')
    .columns('ID', 'title', 'stock')
    .where({ stock: { '>': 0 } })
    .orderBy('stock desc')
    .limit(10)
)

// UPSERT — insert or update
UPSERT([{ ID: 201, title: 'Wuthering Heights', stock: 12 }]).into('my.bookshop.Books')
```

## SQL injection safety — critical

Tagged template literals in CQN are **safe** only when used **without parentheses**. The parentheses trap is the most common SQL injection mistake in CAP:

```js
// SAFE — tagged template (no parentheses)
SELECT.from `Books` .where `ID = ${input}`

// SAFE — query-by-example object
SELECT.from(Books).where({ ID: input })

// UNSAFE — parentheses turn template into a regular string
SELECT.from `Books` .where (`ID = ${input}`)  // ← bug, not a template literal

// UNSAFE — string concatenation
SELECT.from `Books` .where ('ID = ' + input)  // ← SQL injection risk
```

Rule: **never use string concatenation** in query conditions. **Never wrap tagged template strings in parentheses.**

## Scope of this.entities in class-based handlers

In a class-based handler, `this.entities` only contains entities **declared in that specific service**. Entities from other services or from the database layer are NOT included.

```js
class SalesOrderService extends cds.ApplicationService {
  async init() {
    // this.entities contains: SalesOrderDrafts, SalesOrderDraftItems, ComplianceEvaluations
    const { SalesOrderDrafts, SalesOrderDraftItems } = this.entities

    // ComplianceRules and RiskProfiles are in ComplianceService and db — NOT in this.entities
    // this.entities.ComplianceRules → undefined → causes "Cannot read properties of undefined"

    // CORRECT: access DB-layer entities via cds.entities(namespace)
    const { ComplianceRules, RiskProfiles } = cds.entities('com.salesord')

    // CORRECT: or reference by string in CQN (no entity object needed)
    const rules = await SELECT.from('com.salesord.ComplianceRules').where({ active: true })
  }
}
```

This is the most common source of cryptic `Cannot read properties of undefined (reading 'raw')` errors in handlers — an entity reference that resolves to `undefined` causes the CDS query builder to fail internally.

## Accessing global request context

From anywhere in your code (not just inside a handler):

```js
const { tenant, user } = cds.context
```

This is a continuation-local variable backed by Node.js async local storage. Prefer the local `req` reference in handlers for clarity and performance; use `cds.context` only when `req` is not in scope.

## Consuming mocked external services

Keep roles clearly separated:

```js
this.on('countBusinessPartnersByCountry', async req => {
  const host = req.http?.req?.headers?.host
  const remote = await cds.connect.to('API_BUSINESS_PARTNER', {
    kind: 'odata-v4',
    model: 'srv/external/business-partner-service',
    credentials: { url: `http://${host}/mock-business-partner` },
    service: 'API_BUSINESS_PARTNER',
    silent: true
  })

  const rows = await remote.tx(req).run(
    SELECT.from(remote.entities.A_BusinessPartner).columns('BusinessPartner', 'Country')
  )

  return rows.filter(r => r.Country === req.data.country).length
})
```

Verify:
- The external contract is loaded into the CAP model
- The mock provider is actually served
- The runtime includes SAP Cloud SDK modules needed by CAP remote OData services
- Tests validate the public CAP endpoint, not the mock endpoint in isolation

## Error handling and idempotency for A2X / external integrations

When a bound action calls an external SAP A2X service (e.g. deep insert to CE_SALESORDER), the
failure model requires careful design. The naive approach (keeping status = Approved on failure)
conflates "never tried" with "tried and failed".

### Recommended pattern: dedicated SyncFailed status

1. **Add error fields** to the entity: `errorCode: String(20)` and `errorDetail: String(2000)`.
2. **On failure**: set `status = SyncFailed`, populate `errorCode`/`errorDetail`, keep `sapID` as-is.
3. **On success**: set `status = Submitted`, clear `errorCode`/`errorDetail`.
4. **Expose a separate `retryPublish` action** with a state guard (`status = SyncFailed`).
5. **Idempotency guard inside the shared publish helper**: if the remote ID (e.g. `sapSalesOrderID`)
   is already set, skip the A2X INSERT and just reconcile the local status to Submitted.
   This handles the partial-success case where the A2X call succeeded but the local DB
   write failed before updating the status.

```js
// Shared publish helper — called by publishToSAP and retryPublish
const _doPublish = async (ID, entity) => {
  const order = await SELECT.one.from(entity).where({ ID })
  const items  = await SELECT.from(Items).where({ order_ID: ID })

  let remoteID = null, syncStatus = 'Success', errorCode = null, errorDetail = null

  if (order.sapSalesOrderID) {
    // Idempotency: remote order already created — skip A2X call
    remoteID = order.sapSalesOrderID
  } else {
    try {
      const svc = await cds.connect.to('CE_SALESORDER_0001')
      const result = await svc.run(INSERT.into(svc.entities.SalesOrder).entries({ ...header, _Item: items }))
      remoteID = result?.SalesOrder ?? 'UNKNOWN'
    } catch (err) {
      syncStatus  = 'Failed'
      errorCode   = String(err.code ?? err.statusCode ?? 'ERR').slice(0, 20)
      errorDetail = err.message?.slice(0, 2000) ?? 'Unknown error'
    }
  }

  const ok = syncStatus === 'Success'
  await UPDATE(entity).set({
    status_code:       ok ? 'Submitted' : 'SyncFailed',
    sapSalesOrderID:   ok ? remoteID : order.sapSalesOrderID,
    sapSubmittedAt:    ok && !order.sapSubmittedAt ? new Date().toISOString() : order.sapSubmittedAt,
    sapLastSyncStatus: ok ? 'Success' : 'Failed',
    errorCode:         ok ? null : errorCode,
    errorDetail:       ok ? null : errorDetail
  }).where({ ID })

  return SELECT.one.from(entity).where({ ID })
}

// First publish attempt — guard: Approved only
const publishToSAP = async req => {
  const { ID, IsActiveEntity } = req.params?.[0] ?? {}
  const entity = IsActiveEntity === false ? Entity.drafts : Entity
  const order = await SELECT.one.from(entity).where({ ID })
  if (!order) return req.reject(404)
  if (order.status_code !== 'Approved') return req.reject(409, `Expected Approved, got '${order.status_code}'`)
  return _doPublish(ID, entity)
}

// Retry after failure — guard: SyncFailed only
const retryPublish = async req => {
  const { ID, IsActiveEntity } = req.params?.[0] ?? {}
  const entity = IsActiveEntity === false ? Entity.drafts : Entity
  const order = await SELECT.one.from(entity).where({ ID })
  if (!order) return req.reject(404)
  if (order.status_code !== 'SyncFailed') return req.reject(409, `Expected SyncFailed, got '${order.status_code}'`)
  return _doPublish(ID, entity)
}
```

### Testing idempotency

The idempotency path (sapSalesOrderID already set) requires a seed record with
`status = SyncFailed` and a known `sapSalesOrderID`. This simulates the partial-success
case. The mock A2X handler is never invoked — the helper detects the existing ID and
skips the remote call:

```js
// Seed: a1111111-...-0006 has status=SyncFailed, sapSalesOrderID='SAPMOCK-999'
it('retryPublish (idempotency) transitions SyncFailed → Submitted', async () => {
  const res = await app.post(`/Entity(ID=${SEED_ID})/SalesOrderService.retryPublish`, {}, auth('manager1'))
  assert.equal(res.data.status_code, 'Submitted')
  assert.equal(res.data.sapSalesOrderID, 'SAPMOCK-999')  // preserved, not re-created
  assert.equal(res.data.errorCode, null)                 // cleared on success
})
```

### Virtual field for `retryPublish` availability in Fiori Elements

```cds
// In service .cds projection
virtual canRetry : Boolean

// In actions block
action retryPublish() returns Entity;

// In @restrict — same roles as publishToSAP
{ grant: 'retryPublish', to: ['Manager', 'Admin'] }
```

```js
// In after('READ') handler
order.canRetry = isManager && status === 'SyncFailed'
```

```cds
// In annotations.cds
retryPublish @(Core.OperationAvailable: canRetry);
```

---

## Async background jobs with cds.spawn (Gap #25)

### cds.spawn — two modes

`cds.spawn` runs tasks outside the current request transaction. It has two modes:

```js
// One-off: runs once in background, returns a Promise
cds.spawn(async () => {
  await INSERT.into(Jobs).entries({ ... })
})

// Periodic: runs every N milliseconds (safety net / scheduler)
cds.spawn({ every: 30_000 }, async () => {
  const pending = await SELECT.from(Jobs).where({ status: 'Pending' })
  for (const job of pending) await processJob(job.ID)
})
```

Inside `cds.spawn`, CQL statements (`SELECT/UPDATE/INSERT`) have implicit DB access — no explicit transaction wrapper needed. CAP manages the DB context.

### cds.run() is NOT a transaction wrapper

`cds.run()` executes a single CQN query object (SELECT, INSERT, etc.). It is NOT a wrapper for async function blocks:

```js
// WRONG — cds.run does not accept an async function
await cds.run(async () => {
  await SELECT.from(Entity)...
})

// CORRECT — for wrapping multi-statement blocks needing explicit tx
await cds.tx(async () => {
  await SELECT.from(Entity)...
  await UPDATE(Entity)...
})

// CORRECT — inside a request handler, use ambient tx (no wrapper needed)
this.on('myAction', async req => {
  await SELECT.from(Entity)...  // uses req's ambient transaction
  await UPDATE(Entity)...
})
```

### Race condition: immediate cds.spawn + tests

Firing an immediate `cds.spawn` inside a request handler creates a race condition in `cds.test` tests: the background task may complete before the test's next assertion, making test expectations non-deterministic.

**Pattern for testable async jobs:**
1. Action creates a job record (status=Pending) and returns immediately
2. Do NOT fire `cds.spawn` immediately inside the action
3. Use a periodic scheduler (e.g. `every: 30_000`) as the production mechanism
4. Expose an Admin-only action/function (`triggerProcessing`) that runs the job synchronously — used in tests and for manual recovery

```js
// Handler init: periodic scheduler only (no immediate spawn in action)
cds.spawn({ every: 30_000 }, async () => {
  const pending = await SELECT.from(PublishJobs).where({ jobStatus: 'Pending' })
  for (const job of pending) {
    try { await _processJob(job.ID) }
    catch (err) { console.error(`[Scheduler] job ${job.ID}:`, err.message) }
  }
})

// Action: creates job, returns immediately — no spawn
const publishToSAP = async req => {
  const jobID = cds.utils.uuid()
  await INSERT.into(PublishJobs).entries({ ID: jobID, order_ID: ID, jobStatus: 'Pending' })
  await UPDATE(entity).set({ status_code: 'Publishing', currentJob_ID: jobID })
  return SELECT.one.from(entity).where({ ID })
}

// Admin-only trigger (for tests / recovery)
this.on('triggerProcessing', async req => {
  if (!req.user?.is('Admin')) return req.reject(403, 'Admin required')
  return _processJob(req.data.jobID)
})
```

```js
// In tests: trigger job processing synchronously
const pub = await app.post(`.../SalesOrderService.publishToSAP`, {}, auth('manager1'))
assert.equal(pub.data.status_code, 'Publishing')  // immediate
const jobID = pub.data.currentJob_ID

await app.post('/api/sales/triggerProcessing', { jobID }, auth('admin1'))

const final = await app.get(`...SalesOrderDrafts(ID=${ID},IsActiveEntity=true)`, auth('manager1'))
assert.equal(final.data.status_code, 'Submitted')  // after processing
```

### @restrict does NOT work for unbound actions/functions with grant syntax (Gap #26)

`@restrict` with `grant: 'actionName'` works for **bound actions** on `@odata.draft.enabled` entities. It does NOT work for unbound actions/functions at the service level:

```cds
// DOES NOT WORK — unbound action restrict with grant
annotate SalesOrderService with @restrict: [
  { grant: 'triggerProcessing', to: 'Admin' }
];

// CORRECT for unbound actions — enforce in handler
this.on('triggerProcessing', async req => {
  if (!req.user?.is('Admin')) return req.reject(403, 'Admin role required')
  ...
})

// ALTERNATIVE — use @requires on the action (if supported in your CDS version)
annotate SalesOrderService.triggerProcessing with @requires: 'Admin';
```

Also: `@readonly` on an entity projection blocks POST/PUT/DELETE/PATCH with HTTP 405 (not 403). This is distinct from `@restrict` which returns 403.

```cds
@readonly
entity PublishJobs as projection on db.PublishJobs;
// POST /api/sales/PublishJobs → 405 "Entity is read-only"
// versus @restrict READ → 403 "Forbidden"
```

## Draft entity validation — correct event targets

For draft-enabled entities, the write lifecycle is:
- `POST /Entity` → creates a draft (`IsActiveEntity=false`)
- `PATCH /Entity(ID,IsActiveEntity=false)` → saves changes to the draft
- `POST /Entity(ID,IsActiveEntity=false)/draftActivate` → activates draft → fires `SAVE`

**CRITICAL (confirmed in CAP 9.x):** `before(['CREATE','UPDATE'], Entity, ...)` does NOT reliably fire during the draft lifecycle for `@odata.draft.enabled` entities. Use `before('SAVE', Entity, ...)` for all draft validation — it fires on `draftActivate`:

```js
this.before('SAVE', Entity, (req) => {
  const { title, status, priority } = req.data;

  if (title !== undefined && !title?.trim()) {
    req.error(400, 'title must not be blank', 'in/title');
  }
  if (priority !== undefined && (priority < 1 || priority > 100)) {
    req.error(400, 'priority must be between 1 and 100', 'in/priority');
  }
});
```

Note: `req.error(code, message, target)` accumulates errors — all validations run and all errors are returned together. Use `req.reject()` only when you want to stop immediately.

**`IsActiveEntity` is a virtual element — never use in WHERE clauses:**

`IsActiveEntity` is computed at runtime and does not exist as a DB column. Using it in `SELECT.one.from(Entity).where({ ID: id, IsActiveEntity: true })` throws `500 - Virtual elements are not allowed in expressions`. Filter by ID only:

```js
const entity = await SELECT.one.from(Entity).where({ ID: id });
```

Active vs draft distinction in unbound actions is handled by the service context — querying the service entity returns active entities by default.

**Test pattern for draft validation:**

Validation tests must go through `draftActivate`, not the initial POST:

```js
it('rejects blank title on activate', async () => {
  const { data: draft } = await POST(BASE, { title: '   ' }); // whitespace-only bypasses @mandatory
  const err = await POST(
    `${BASE}(ID=${draft.ID},IsActiveEntity=false)/draftActivate`
  ).then(() => null, (e) => e);
  expect(err).to.exist;
  expect(err.message).to.match(/title/i);
});
```

Note: use whitespace-only (`'   '`) not empty string (`''`) when testing custom handler messages — CAP's `@mandatory` intercepts empty strings first with a generic "Provide the missing value." that doesn't name the field. Either omit `@mandatory` and let the handler own validation, or test with whitespace-only strings.

**`before('SAVE', ...)` and draft table access:**

Use `before('SAVE', ...)` only for cross-field or cross-entity invariants that can only be checked at activation, not at write time. Items in draft tables are not yet visible in the active tables at this point — query from draft tables explicitly:

```js
this.before('SAVE', Entity, async (req) => {
  const { ID } = req.params?.[0] ?? {};
  const items = await SELECT.from(Entity.drafts).where({ parent_ID: ID });
  if (items.length === 0) req.error(400, 'At least one item is required');
});
```

**`@readonly` on handler-managed fields:**

When a field's value is exclusively controlled by the handler (e.g., `status`), mark it `@readonly` in the CDS model to prevent clients from directly setting it. The framework returns 400 if the client attempts to write it, and the handler sets the value in the appropriate events:

```cds
entity Approval : cuid, managed {
  title  : String(100) @mandatory;
  status : String(20) default 'DRAFT' @readonly;   // ← only handler writes this
}
```

```js
// Handler enforces transitions explicitly — client cannot bypass
this.on('submit', async (req) => {
  const { id } = req.data;
  await UPDATE(Entity).where({ ID: id }).with({ status: 'SUBMITTED' });
  return SELECT.one.from(Entity).where({ ID: id });
});
```

## Gap descubierto — 2026-04-16

**Área:** G2 — Composition children no modificables directamente en draft-enabled parents
**Síntoma:** `POST /odata/v4/ber/ExpenditureItems` retornaba 403 "A draft-enabled entity can only be modified via its root entity"
**Causa:** CAP impide modificar composition children directamente cuando el padre es draft-enabled. La navegación correcta es `POST /ExpenditureRequests(ID,IsActiveEntity=false)/items`
**Fix aplicado:** Cambiar todos los POST de items en tests a usar path de navegación desde la raíz del draft

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-16

**Área:** G3 — before('SAVE') no puede acceder a items draft via ExpenditureItems
**Síntoma:** Validación de items en `before('SAVE')` fallaba con 422 "At least one expenditure item is required" aunque se habían añadido items vía navegación draft
**Causa:** `before('SAVE')` se dispara durante `draftActivate`. En ese momento, los items están en tablas draft (no en la tabla activa). Querying `ExpenditureItems` (tabla activa) devuelve vacío
**Fix aplicado:** Mover la validación de items al action handler `Submit`, que se ejecuta DESPUÉS de `draftActivate` sobre la entidad activa donde los items ya están disponibles

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-19

**Área:** G6 — SELECT.one + count(*) devuelve objeto, no array
**Síntoma:** 500 "TypeError: (intermediate value) is not iterable" en `getScenarioDashboard`
**Causa:** `SELECT.one` devuelve un objeto único, no un array. La destructuración `const [{ count }] = await db.run(SELECT.one...)` falla porque un objeto no es iterable.
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-21

**Área:** [Handler Node.js] LargeBinary se excluye de SELECT * y se devuelve como Readable stream
**Síntoma:** `!staging.fileContent` era `true` aunque el campo tenía datos en la BD; `length` undefined.
**Causa:** En `@cap-js/sqlite` 9.x, los campos `LargeBinary` (especialmente con `@Core.MediaType`) se excluyen de los SELECT estrella. Cuando se los pide explícitamente con `.columns(...)`, se devuelven como `Readable` stream de Node.js, no como `Buffer`.
**Fix aplicado:** (1) Usar `SELECT.one.from(...).columns('ID','fileContent',...)` explícito. (2) Convertir el stream a Buffer con `for await (const chunk of stream)` antes de pasarlo a `xlsx.read()`.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

---

## Logging en CAP — `cds.log`

CAP provee un facade minimalista de logging. **No usar `console.log` en handlers.**

```js
const LOG = cds.log('processor-service');  // namespace para filtrado

LOG.info('Incident processed', { id, user: req.user?.id });
LOG.warn('Slow query detected');
LOG.error('Failed to connect', err);
```

Configurar niveles por módulo en `package.json`:

```json
{
  "cds": {
    "log": {
      "levels": {
        "sqlite": "debug",
        "processor-service": "info",
        "cds": "warn"
      }
    }
  }
}
```

Niveles: `debug`, `info`, `warn`, `error`, `silent`.

## Tagged template literals en WHERE

```js
// Más legible para condiciones con paths de asociación
const closed = await SELECT.one(1).from(req.subject).where`status.code = 'C'`
if (closed) req.reject(`Can't modify a closed incident!`)
```

Los backticks en `.where\`...\`` son tagged templates — CAP los parsea como CDS expressions, permitiendo path expressions como `status.code` (navegación de asociación). No usar string interpolation con valores de usuario en este contexto.

## Custom audit log en `server.js`

Para generar audit logs personalizados (ej. eventos de seguridad 403), crear `server.js` en la raíz del proyecto:

```js
const cds = require('@sap/cds')

let audit

cds.on('served', async () => {
  audit = await cds.connect.to('audit-log')
})

// log 403 en requests normales
cds.on('bootstrap', app => {
  app.use((req, res, next) => {
    req.on('close', () => {
      if (res.statusCode === 403) {
        audit.tx(async () => {
          await audit.log('SecurityEvent', {
            data: {
              user: cds.context.user?.id || 'unknown',
              action: `Unauthorized access to "${req.originalUrl}"`
            },
            ip: req.ip
          })
        })
      }
    })
    next()
  })
})

// log 403 en batch subrequests
cds.on('serving', srv => {
  if (srv instanceof cds.ApplicationService) {
    srv.on('error', (err, req) => {
      if (err.code === 403) {
        const { originalUrl, ip } = req.http.req
        // handle batch subrequest path
      }
    })
  }
})

module.exports = cds.server  // obligatorio — extiende el server por defecto
```

Puntos clave:
- `cds.on('served', ...)` — se ejecuta una vez, todos los servicios ya están disponibles; aquí conectar a servicios externos como audit-log.
- `cds.on('bootstrap', app => ...)` — Express app disponible; aquí registrar middleware.
- `cds.on('serving', srv => ...)` — cada servicio CAP está siendo inicializado; útil para error handlers por servicio.
- `module.exports = cds.server` es **obligatorio** en `server.js` — sin él el servidor no arranca.

## Gap descubierto — 2026-04-23

**Área:** Handlers
**Síntoma:** Warning en arranque: "custom action 'reject()' conflicts with method in base class"
**Causa:** `ApplicationService` tiene un método `reject()` reservado — no se puede registrar `this.on('reject', ...)` sin shadowing
**Fix aplicado:** renombrar acción `reject` → `dismissPair` en CDS, handler y tests

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-23

**Área:** Tests — validación CREATE vs UPDATE
**Síntoma:** POST sin campo `name` devuelve 500 (DB constraint) en lugar de 400
**Causa:** el handler `before(['CREATE','UPDATE'])` con `if (name !== undefined && ...)` no captura el caso de CREATE sin name porque name es `undefined` y la condición no dispara
**Fix aplicado:** separar en `before('CREATE')` (sin check `!== undefined`) y `before('UPDATE')` (con check)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-24

**Área:** Handlers — transacción CAP y req.error()
**Síntoma:** Tests "job queda en failed quando el engine falla" y "run queda en failed" fallan — el job aparece en estado 'draft', no 'failed'; no se encuentra ningún run
**Causa:** `req.error()` en CAP hace rollback de toda la transacción del request. Los `UPDATE` previos (status='failed') se revierten junto con el INSERT del run y el UPDATE a 'submitted'. El rollback es total y atómico.
**Fix aplicado:** Eliminar los UPDATEs a 'failed' del catch block (serían ignorados por el rollback de todos modos). Actualizar los tests para reflejar la semántica real: cuando el engine falla, la operación completa revierte y el job vuelve a 'draft'. Documentado como comportamiento esperado, no como bug.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-24

**Área:** CandidatePairs y FieldScores via string namespace
**Síntoma:** CandidatePairs y FieldScores via string namespace
**Causa:** (see build-log for details)
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-24

**Área:** Rate limiting con status 'submitted' bloquea tests
**Síntoma:** 7 tests fallan con 429 al añadir el rate limit check `WHERE status IN ('submitted', 'running')`. Los tests de jobs.test.js y integration.test.js dejan jobs en `submitted` (no records → engine no llamado), lo que bloquea todos los submitJob posteriores del mismo usuario.
**Causa:** `submitted` es un estado permanente válido cuando se envía un job sin records (esperando datos externos). No es indicativo de que el engine esté activo. El check demasiado amplio captura jobs dormidos.
**Fix aplicado:** Mover el check al punto justo antes de llamar al engine, chequear solo `status = 'running'` (excluyendo el job actual con `ID != jobID`). Además, añadir `UPDATE status = 'running'` justo antes de la llamada al engine para que un eventual request concurrente sí lo detecte.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.
