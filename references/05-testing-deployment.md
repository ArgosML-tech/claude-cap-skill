# Testing, deployment, and multitenancy in CAP

## Node.js testing with cds.test

**Install:**
```bash
npm add -D @cap-js/cds-test
```

**Do not assume `@sap/cds` bundles `cds.test`** — in many versions you must declare `@cap-js/cds-test` in `devDependencies` explicitly. If `cds.test` fails with module-not-found, add that dependency.

### Assertion style: cds.test ships with Chai

The official `cds.test` API ships with Chai (`chai.expect`, `chai.assert`, `chai-subset`, `chai-as-promised`). The official CAP documentation uses Chai in all examples:

```js
const cds = require('@sap/cds')
const { expect } = cds.test(__dirname + '/..')   // Chai expect from cds.test

it('reads books', async () => {
  const { data } = await GET('/odata/v4/CatalogService/Books')
  expect(data.value).to.be.an('array')
})
```

Alternatively, `node:assert/strict` works if the repo prefers no extra dependencies:

```js
const cds = require('@sap/cds')
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

describe('CatalogService', () => {
  const app = cds.test(__dirname + '/..')

  it('reads books', async () => {
    const { data } = await app.get('/odata/v4/CatalogService/Books')
    assert.equal(Array.isArray(data.value), true)
  })

  it('rejects invalid quantity', async () => {
    const res = await app.post('/odata/v4/CatalogService/submitOrder', {
      book: '00000000-0000-0000-0000-000000000001',
      quantity: 0
    })
    assert.ok(res.status >= 400, `Expected 4xx, got ${res.status}`)
  })
})
```

**Rule: always follow the assertion style the repo already uses.** If the repo has no tests yet, Chai is the officially supported default; `node:assert/strict` is a valid lightweight alternative.

### Bound HTTP methods (shorthand)

```js
const { GET, POST, PUT, DELETE } = cds.test(__dirname + '/..')

const { data } = await GET('/odata/v4/CatalogService/Books')
await POST('/odata/v4/CatalogService/submitOrder', { book: 201, quantity: 1 })
```

### Resetting database state between tests

Use `test.data.reset()` to reset the database to its initial seed state. Useful for tests that mutate data:

```js
describe('Order tests', () => {
  const { test } = cds.test(__dirname + '/..')

  beforeEach(test.data.reset)   // reset before each test

  it('creates an order', async () => { ... })
  it('cancels an order', async () => { ... })
})
```

### Mocked auth in tests

```js
// Using basic-auth header (always works with mocked auth)
const res = await app.get('/odata/v4/AdminService/Books', {
  auth: { username: 'alice', password: '' }
})

// Using app.as() when available in the cds.test flavor
const res = await app
  .as({ id: 'alice', roles: ['Admin'] })
  .get('/odata/v4/AdminService/Books')
```

Inspect the project's mocked users config (in `package.json` or `.cdsrc.json`) to confirm which usernames and roles exist before inventing test identities.

Note: call `cds.test()` **before** importing other `@sap/cds` modules — loading order matters for environment setup.

### Test guidelines

- Place tests under `test/`
- Avoid `process.chdir()` in tests — use `__dirname + '/..'` relative path instead
- Cover success, error, auth, and regression paths
- Avoid fragile global-count assertions — prefer testing known base data or data created within the test
- For state-changing tests, use unique data per test or clean state afterward
- For draft-enabled services, test the full draft lifecycle explicitly (create draft → activate → read active)

### Draft lifecycle test pattern

```js
it('creates and activates a draft', async () => {
  // 1. create draft
  const created = await app.post('/odata/v4/SalesService/OrderRequests', {
    customerName: 'Test Customer', totalAmount: 100
  })
  assert.equal(created.data.IsActiveEntity, false)

  // 2. activate
  const activated = await app.post(
    `/odata/v4/SalesService/OrderRequests(ID=${created.data.ID},IsActiveEntity=false)/SalesService.draftActivate`,
    {}
  )
  assert.equal(activated.data.IsActiveEntity, true)

  // 3. verify active set
  const readActive = await app.get(
    `/odata/v4/SalesService/OrderRequests(ID=${created.data.ID},IsActiveEntity=true)`
  )
  assert.equal(readActive.status, 200)
})
```

### cds.test() must be called at the describe() level — not inside before()

`cds.test()` registers its own before/after hooks internally via node:test's hook API. If called inside a `before()` hook, those internal hooks run too late and the server is not ready when the first test fires — all requests fail with `ECONNREFUSED`.

```js
// WRONG — cds.test() inside before(), server not ready for first tests
describe('MySuite', () => {
  let app
  before(async () => { app = cds.test(__dirname + '/..') })  // ← too late
  it('...', async () => { /* ECONNREFUSED */ })
})

// CORRECT — cds.test() at describe level, registers hooks immediately
describe('MySuite', () => {
  const app = cds.test(__dirname + '/..')  // ← registers before/after automatically
  it('...', async () => { /* works */ })
})
```

### Handling expected error responses in cds.test

`cds.test` uses Axios under the hood. By default, Axios **throws** on 4xx and 5xx responses. Tests that expect error status codes must use try/catch:

```js
// WRONG — will throw instead of returning the response
const res = await app.get('/protected-route')  // throws AxiosError on 401
assert.equal(res.status, 401)

// CORRECT — catch and inspect the response status
const expectError = async (promise, expectedStatus) => {
  try {
    const res = await promise
    assert.fail(`Expected ${expectedStatus} but got ${res.status}`)
  } catch (err) {
    const status = err.response?.status ?? err.status
    assert.equal(status, expectedStatus)
  }
}

await expectError(app.get('/api/sales/SalesOrderDrafts'), 401)
await expectError(app.get('/api/sales/SalesOrderDrafts', { auth: { username: 'compliance1', password: '' } }), 403)
```

### Testing with mocked external services — use `--with-mocks`

`mocked: true` in `cds.requires` is a **`cds watch` feature only**. In `cds.test()`, external services are NOT automatically mocked — calling `cds.connect.to('ServiceName')` will throw `"No credentials configured for ServiceName"`.

To enable external service mocking in tests, pass `--with-mocks` to `cds.test()`:

```js
// WRONG — external services with mocked:true are silently unavailable
const app = cds.test(__dirname + '/..')

// CORRECT — enables mocked external services in the test server
const app = cds.test(__dirname + '/..', '--with-mocks')
```

With `--with-mocks`:
- External services with `mocked: true` in `cds.requires` are served in-process
- `cds.connect.to('ServiceName')` returns an `ApplicationService` (no HTTP)
- The startup log shows `[cds] - mocking ServiceName { ... }`

**CSV seed data for local entities (including draft-enabled):**

CSV files for local entities go in `db/data/` with the naming convention `<namespace>-<EntityName>.csv`. For draft-enabled entities, the CSV populates the **active entity table** — records are visible immediately in a List Report without needing to activate a draft.

```
db/data/
  com.salesord-SalesOrderDrafts.csv       ← active records (visible in List Report)
  com.salesord-SalesOrderDraftItems.csv   ← composition children, FK: order_ID
```

Column naming rules:
- Simple fields: use the property name as-is (`customerID`, `netAmount`)
- Association FK: use `<associationName>_code` for CodeList associations, `<associationName>_ID` for cuid associations
- `managed` mixin fields (`createdAt`, `createdBy`, etc.) are optional in CSV — CAP auto-populates them on first write

```csv
# com.salesord-SalesOrderDrafts.csv
ID,customerID,customerName,salesOrg,status_code,riskLevel_code,riskScore,netAmount,currency
a1111111-0000-0000-0000-000000000001,C001,Acme GmbH,1000,Draft,Low,20,25000.00,EUR
a1111111-0000-0000-0000-000000000002,C006,Shenzhen Tech,1000,PendingApproval,High,80,98500.00,EUR

# com.salesord-SalesOrderDraftItems.csv — FK is order_ID (association name + _ID for cuid)
ID,order_ID,materialID,description,quantity,unit,unitPrice,currency,netValue
b1111111-0000-0000-0000-000000000001,a1111111-0000-0000-0000-000000000001,MAT-001,Pump,10.000,EA,1500.00,EUR,15000.00
```

**Note:** Use hardcoded UUIDs in CSV (not auto-generated) so composition children can reference parents with a known `order_ID`. The startup log shows `> init from db/data/<file>.csv` confirming the file was loaded.

---

**CSV seed data for mocked external services:**

CSV files for mocked external services do NOT go in `db/data/`. They go in a `data/` folder relative to the service model's CDS file:

```
srv/external/API_BUSINESS_PARTNER.cds      ← service model
srv/external/data/
  API_BUSINESS_PARTNER-A_BusinessPartnerAddress.csv  ← mock data here
```

The naming convention is `<ServiceName>-<EntityName>.csv`, same as local entities. The file is picked up when `--with-mocks` is active and the startup log shows `> init from srv/external/data/<file>.csv`.

**Watch the silent failure trap:**

If `cds.connect.to()` in a handler wraps an external service call in try/catch and the service is unavailable, the catch block silently skips the enrichment — tests pass but the feature is not actually tested. Always add a dedicated test that verifies the enriched data:

```js
describe('with external mocks', () => {
  const app = cds.test(__dirname + '/..', '--with-mocks')  // ← --with-mocks required

  it('enriches order with customer country from API_BUSINESS_PARTNER', async () => {
    // ... activate draft order for customer C001 (DE in mock CSV)
    const activated = await app.get(`/api/sales/SalesOrderDrafts(ID=${ID},IsActiveEntity=true)`)
    // verify country was used in compliance evaluation
  })
})
```

### Mocked external services: `@Core.ComputedDefaultValue` keys require explicit values

When a mocked external service (served via `--with-mocks`) has a primary key annotated with `@Core.ComputedDefaultValue: true`, the default CAP mock does **NOT** auto-generate the key. The real SAP backend assigns it, but the SQLite mock enforces `NOT NULL` and the INSERT fails.

```
NOT NULL constraint failed: CE_SALESORDER_0001_SalesOrder.SalesOrder
```

For SAP A2X entities with non-UUID keys, provide the key explicitly in the INSERT:

```js
INSERT.into(soService.entities.SalesOrder).entries({
  SalesOrder: String(Date.now()).slice(-10),  // ← provide mock key manually
  SalesOrderType: 'OR',
  ...
})
```

### Mocked A2X services: create a custom handler for entities with many `not null` fields

A2X SAP entities (e.g., `CE_SALESORDER_0001.SalesOrder`) typically have dozens of `not null` fields that the real backend computes. The default CAP mock (`app-service.js`) enforces all `not null` constraints via SQLite, so deep INSERTs fail if computed fields are not provided.

The solution: create a custom implementation file adjacent to the external service CDS model. CAP automatically discovers it as the service implementation:

```
srv/external/CE_SALESORDER_0001.cds   ← generated CDS model
srv/external/CE_SALESORDER_0001.js    ← custom mock handler (auto-discovered)
```

```js
// srv/external/CE_SALESORDER_0001.js
'use strict'
const cds = require('@sap/cds')

module.exports = class CE_SALESORDER_0001 extends cds.ApplicationService {
  async init() {
    // Override CREATE to skip not-null constraints on computed fields
    this.on('CREATE', 'SalesOrder', req => {
      const SalesOrder = String(Date.now()).slice(-10)  // mock 10-digit order number
      return { SalesOrder, ...req.data }
    })
    return super.init()
  }
}
```

When the file is present, the startup log changes from:
```
impl: 'node_modules/@sap/cds/srv/app-service.js'   ← default (no file)
impl: 'srv/external/CE_SALESORDER_0001.js'           ← custom handler picked up
```

This pattern applies to any A2X or complex external service entity where the real backend computes mandatory fields.

### cds-plugin-ui5 interference

If FE tooling added `cds-plugin-ui5` to the CAP root and `cds.test` starts failing:
- Inspect whether the failure comes from plugin startup, not from the service under test
- In test-only contexts, `CDS_PLUGIN_UI5_ACTIVE=false` can isolate the service from the plugin
- Document that opt-out clearly rather than silently weakening the test scope

---

## Deployment

### Before proposing deployment steps, verify

Evidence for **Cloud Foundry**:
- `mta.yaml`, `manifest.yml`, or explicit CF deployment scripts
- Service bindings for managed CF services

Evidence for **Kyma**:
- Helm charts, Kubernetes manifests, or Kyma-specific deployment docs
- Container and binding configuration targeting Kubernetes

Not sufficient on its own:
- Transitive dependencies in `package-lock.json`
- Generic CAP packages
- A local SQLite setup with no cloud descriptors

If those stronger signals are missing, frame the project as locally validated and present CF or Kyma guidance as architecture-level advice requiring repo-specific confirmation.

### Cloud Foundry specifics

- Verify `cf target` before assuming destinations, bindings, or service connectivity
- If `cf services` shows `abap-trial`, classify it as ABAP trial evidence first — not as S/4 API integration
- Distinguish ABAP extensibility from CAP-side consumption of real S/4 APIs

### Secrets handling

- Do not ask the user to paste complete service keys, tokens, or OAuth credentials
- Ask only for non-sensitive metadata (service offering, plan, host purpose, available scopes)
- If the user pastes secrets accidentally, recommend rotating the key and proceed with redacted values only

---

## Multitenancy and MTX

Evidence that the project is **really multi-tenant**:
- Explicit MTX-related dependencies in `package.json` (not just transitive)
- Tenant or subscription configuration in project files
- Sidecar or SaaS provisioning configuration
- Scripts or commands that target tenant lifecycle

Not sufficient on its own:
- A mention in `package-lock.json`
- Generic CAP packages
- Vague naming conventions

When multitenancy is confirmed:
- Treat it as an architectural decision — not only as business logic
- Review production configuration and managed services
- Clearly separate domain logic, platform configuration, and tenant lifecycle
- Avoid proposals that only work in single-tenant mode if the requirement is multi-tenant

## Gap descubierto — 2026-04-17

**Área:** [Compatibilidad] `@cap-js/sqlite@^2` requiere `@sap/cds >= 9.8`
**Síntoma:** `Cannot read properties of undefined (reading 'transitions')` al hacer deploy de CSVs con `@sap/cds 8.9.9` + `@cap-js/sqlite 2.2.0`.
**Causa:** `@cap-js/db-service 2.9.0` (depende de `@cap-js/sqlite@^2`) usa `this.srv.resolve.transitions()` que solo existe en CDS v9 (`@sap/cds/lib/ql/resolve.js`). Los peer deps lo declaran explícitamente: `"@sap/cds": ">=9.8"`.
**Fix aplicado:** Actualizar `package.json` de `"@sap/cds": "^8"` a `"@sap/cds": "^9"` y `"@sap/cds-dk": "^8"` a `"@sap/cds-dk": "^9"`. Ejecutar `npm install`.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-17

**Área:** [CDS v9] `cds.test()` requiere `@cap-js/cds-test` como dependencia explícita
**Síntoma:** `Cannot find module '@cap-js/cds-test'` al ejecutar `npm test` con CDS v9.
**Causa:** En CDS v9, el módulo de test se extrae a `@cap-js/cds-test` como paquete separado (no incluido en `@sap/cds`).
**Fix aplicado:** `npm install @cap-js/cds-test --save-dev`.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.
