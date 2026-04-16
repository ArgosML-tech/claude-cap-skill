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
