# CAP External Services on Node.js

Use this reference when the task mentions S/4HANA APIs, imported `.edmx`, `cds import`, remote services, external OData, SAP Business Accelerator Hub APIs, destinations, or local mocks of remote contracts.

## Recommended thinking order

1. Confirm whether the user wants:
   - A real remote connection
   - A local mock for development
   - Both, with a local-first path
2. Locate the imported or hand-curated external model under `srv/external/`
3. Decide whether the local model only stores the remote key or also caches remote fields
4. Expose a use-case-oriented service projection instead of leaking the external service directly
5. Validate how `$expand` should behave when a local entity points to a remote identifier

## Importing from EDMX

```bash
cds import <path>/API_BUSINESS_PARTNER.edmx --as cds
```

Prefer keeping the generated model under `srv/external/`. After the import:
- Inspect the generated CDS file for the exact entity shapes and field names before modeling local associations
- Check `package.json` — `cds import` can add SAP Cloud SDK dependencies automatically
- Do not assume a fixed filename pattern like `*.imported.cds`; verify the actual generated file

In a real validation with `API_BUSINESS_PARTNER.edmx`, the service name was already `API_BUSINESS_PARTNER` (not namespaced), so an extra `service` mapping in `cds.requires` was unnecessary and caused conflicts. Verify before adding config from memory.

## Alias required services explicitly

When your code uses a short alias but the imported model exposes a fully qualified service:

```json
"cds": {
  "requires": {
    "API_BUSINESS_PARTNER": {
      "model": "srv/external/API_BUSINESS_PARTNER",
      "service": "api_business_partner.API_BUSINESS_PARTNER"
    }
  }
}
```

If the imported service name already matches your alias, keep it simple — omit the `service` property:

```json
"cds": {
  "requires": {
    "API_BUSINESS_PARTNER": {
      "model": "srv/external/API_BUSINESS_PARTNER",
      "impl": "srv/external/API_BUSINESS_PARTNER.js"
    }
  }
}
```

## Verify the generated entity shape

Do not infer external field names from API Hub documentation once the real EDMX has been imported. Inspect the generated CDS for:
- The key of `A_BusinessPartner`
- Whether `A_Supplier` exposes `Supplier`, `BusinessPartner`, both, or neither
- Which descriptive fields actually exist (`BusinessPartnerFullName`, `SupplierFullName`, etc.)

In a real validation, `A_Supplier` exposed `Supplier` and `SupplierFullName`, but not `BusinessPartner`. A local association based on `supplier.BusinessPartner` was wrong as a result.

## Local mock strategy

Two useful patterns:

**1. In-process mock (simpler, preferred for local validation)**
```json
"cds": {
  "requires": {
    "API_BUSINESS_PARTNER": {
      "model": "srv/external/API_BUSINESS_PARTNER",
      "impl": "srv/external/API_BUSINESS_PARTNER.js"
    }
  }
}
```

**2. Separate mock service (for HTTP-level behavior)**
- Expose a mock service with the same contract
- Run it locally with CAP tooling
- Point the consuming service at that local endpoint

For quick local validation, the in-process mock is usually simpler and more stable.

## Modeling local entities against external keys

For a local entity like `Products`, the safest base pattern:
- Store the remote key locally (e.g., `supplierBusinessPartner : String`)
- Keep the remote association in the service layer, not in the persistence model
- Expose a use-case projection such as `Suppliers` for UI and API consumers

This keeps the database model portable and avoids pretending the external supplier is a local persisted relation.

## `A_BusinessPartner` vs `A_Supplier`

| Prefer `A_Supplier` when | Prefer `A_BusinessPartner` when |
|---|---|
| Use case is vendor/supplier-centric | Use case is a generic external party |
| Need purchasing, posting, or payment fields | Same relation may later include customers |
| App is procurement-focused | App needs broader business-partner semantics |

## `$expand` caveat

Do not assume CAP automatically resolves every expand across a local entity and a remote target.

If the target is external, verify whether you need:
- A service-level association for metadata and consumer ergonomics
- Plus response enrichment in a handler to materialize the expanded data

If `$expand` returns `null` or empty objects, inspect the service boundary before patching UI code.

When the local service exposes projections of external entities, a plain projection may still read from the local database unless you explicitly forward the request. If CAP generates SQL for a view like `RiskService_Suppliers` instead of routing to the remote service, add an explicit `READ` handler that forwards the query to the external alias.

## Validation: reject unknown remote keys

```js
this.before(['CREATE', 'UPDATE'], 'Products', async req => {
  const { supplierBusinessPartner } = req.data
  if (!supplierBusinessPartner) return

  const remote = await cds.connect.to('API_BUSINESS_PARTNER')
  const found = await remote.tx(req).run(
    SELECT.one.from(remote.entities.A_BusinessPartner).where({ BusinessPartner: supplierBusinessPartner })
  )
  if (!found) req.reject(400, `Unknown supplier: ${supplierBusinessPartner}`)
})
```

## Tests worth adding

At minimum:
- Reading the external-style projection or catalog
- Reading a local entity with `$expand` over the remote relation
- Rejecting create/update with an unknown remote key
- If relevant: reading both a generic partner projection and a supplier-specific projection

## Real remote connection

When the user wants the real S/4 flow, add explicitly:
- Credentials or destination-based configuration in `cds.requires`
- Connectivity setup if the landscape needs SAP BTP Destination / Connectivity
- Authentication aligned with the target landscape
- Environment-specific configuration rather than hardcoded URLs or tokens

## Retry with exponential backoff for external calls

External services (S/4, BTP APIs, third-party REST) fail transiently with 503, 429, or network errors. Wrap calls with retry logic rather than propagating those errors directly to the UI.

**Minimal implementation (no extra dependencies):**

```js
async function retry(fn, { attempts = 3, delay = 500, factor = 2, on = [503, 429, 'ETIMEDOUT'] } = {}) {
  let wait = delay;
  let lastErr;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = on.some(t =>
        typeof t === 'number' ? (err.status === t || err.statusCode === t) : err.code === t
      );
      if (attempt < attempts && retryable) {
        await new Promise(r => setTimeout(r, wait));
        wait *= factor;
      } else if (!retryable) {
        throw err;           // non-retryable errors fail fast
      }
    }
  }
  throw lastErr;
}

// Usage in a handler
const result = await retry(
  () => ExternalService.run(req.send('GET', '/BusinessPartners')),
  { attempts: 3, delay: 500, factor: 2, on: [503, 429, 'ETIMEDOUT'] }
);
```

**Key decisions:**
- Non-retryable errors (400, 401, 403, 404) must fail immediately — retrying them wastes time and can confuse the caller
- Use exponential backoff (`delay * factor^n`) to avoid hammering recovering services
- Expose the `on` filter so each call site decides what counts as transient for that specific service
- Do not retry inside `on('READ', ...)` handlers silently — surface the final error with `req.error()` so the client knows the request failed

**Where NOT to use retry:**
- On mutations (POST/PUT to external services) — the remote may have already processed the request; retrying creates duplicates unless the remote is idempotent or you hold a correlation ID
- Inside `cds.spawn` periodic schedulers that already retry on the next tick

## Guardrails

- Do not present a local mock as proof that destination or OAuth setup is done
- Do not hardcode the imported fully qualified service name if a short alias can be configured
- Do not store duplicated remote descriptive fields locally unless the requirement calls for caching
- Do not assume `READ` against a projected local entity forwards unchanged to the external service — check the target names in the query first
- Do not ask the user to paste service keys, OAuth tokens, or client secrets into the chat

## Gap descubierto — 2026-04-20

**Área:** Integración de servicios externos (mock in-process)
**Síntoma:** `No credentials configured for "API_BUSINESS_PARTNER"` al ejecutar `cds.test()` — los tests no arrancaban.
**Causa:** `cds.test()` no activa `--with-mocks` automáticamente. Los servicios `kind: "odata-v2"` sin credenciales fallan al inicializar el `RemoteService`.
**Fix aplicado:** Crear archivos `srv/external/*.js` con `impl` explícito que extienden `cds.Service` y sirven datos desde un array en memoria. Añadir `"impl"` a la config de `cds.requires`.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-20

**Área:** Data Mashup — query re-targeting
**Síntoma:** `SqliteError: no such table: WarrantyService_ExtendedBusinessPartners` en el handler de mashup.
**Causa:** El handler delegaba `req.query` directamente al servicio externo, pero la query tenía como FROM el nombre de la projection view de servicio (`WarrantyService_ExtendedBusinessPartners`), no la entidad real (`API_BUSINESS_PARTNER.A_BusinessPartner`).
**Fix aplicado:** Re-construir la query con `SELECT.from('API_BUSINESS_PARTNER.A_BusinessPartner', [...columns])` antes de pasarla al servicio externo.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

---

## Importar APIs externas — `cds import` (SAP BTP Developer Guide)

### Workflow para integrar una API OData de S/4

```bash
# 1. Importar el EDMX/API spec → genera CDS + metadatos en srv/external/
cds import API_BUSINESS_PARTNER.edmx --as cds
# genera: srv/external/API_BUSINESS_PARTNER.cds + srv/external/API_BUSINESS_PARTNER.json

# 2. Instalar SAP Cloud SDK para conectividad y resilencia
npm add @sap-cloud-sdk/http-client@3.x \
        @sap-cloud-sdk/util@3.x \
        @sap-cloud-sdk/connectivity@3.x \
        @sap-cloud-sdk/resilience@3.x
```

### Proyección del servicio externo (remote.cds)

```cds
// srv/remote.cds
using { API_BUSINESS_PARTNER as S4 } from './external/API_BUSINESS_PARTNER';

service RemoteService {
  entity BusinessPartner as projection on S4.A_BusinessPartner {
    key BusinessPartner as ID,
    FirstName as firstName,
    LastName  as lastName,
    BusinessPartnerName as name,
    to_BusinessPartnerAddress as addresses
  }
  entity BusinessPartnerAddress as projection on S4.A_BusinessPartnerAddress {
    BusinessPartner as ID,
    AddressID as addressId,
    to_EmailAddress as email,
    to_PhoneNumber  as phoneNumber
  }
}
```

### SELECT con expand inline para servicios remotos

Los servicios remotos no soportan path expressions — se deben usar expands explícitos:

```js
async onCustomerRead(req) {
  const { BusinessPartner } = this.remoteService.entities;

  let result = await this.S4bupa.run(
    SELECT.from(BusinessPartner, bp => {
      bp('*'),
      bp.addresses(address => {
        address('email'),
        address.email(emails => {
          emails('email')
        })
      })
    }).limit(top, skip)
  );

  // aplanar la estructura
  result = result.map(bp => ({
    ID: bp.ID,
    name: bp.name,
    email: bp.addresses[0]?.email[0]?.email
  }));
  result.$count = 1000;  // necesario para value help en Fiori
  return result;
}
```

### Cachear datos remotos localmente con UPSERT

```js
async onCustomerCache(req, next) {
  const { Customers } = this.entities;
  const newCustomerId = req.data.customer_ID;
  const result = await next();  // ejecutar operación original primero

  if (newCustomerId && req.event === 'CREATE') {
    const { BusinessPartner } = this.remoteService.entities;
    const customer = await this.S4bupa.run(
      SELECT.one(BusinessPartner, bp => {
        bp('*'),
        bp.addresses(address => {
          address('email', 'phoneNumber'),
          address.email(e => e('email')),
          address.phoneNumber(p => p('phone'))
        })
      }).where({ ID: newCustomerId })
    );

    if (customer) {
      customer.email = customer.addresses[0]?.email[0]?.email;
      customer.phone = customer.addresses[0]?.phoneNumber[0]?.phone;
      delete customer.addresses;
      await UPSERT.into(Customers).entries(customer);
    }
  }
  return result;
}
```

### Inicializar conexiones en `init()`

```js
async init() {
  this.on(['CREATE', 'UPDATE'], 'Incidents', (req, next) => this.onCustomerCache(req, next));
  this.on('READ', 'Customers', req => this.onCustomerRead(req));

  // conectar a servicios externos — await obligatorio en init()
  this.S4bupa = await cds.connect.to('API_BUSINESS_PARTNER');
  this.remoteService = await cds.connect.to('RemoteService');

  return super.init();
}
```

### Modificar Associations → Compositions en EDMX importado

El EDMX generado usa `Association` para relaciones de navegación. Para que CAP pueda hacer expands anidados, cambiar a `Composition`:

```cds
// srv/external/API_BUSINESS_PARTNER.cds — editar después del import
entity A_BusinessPartner {
  // cambiar Association → Composition para poder expandir
  to_BusinessPartnerAddress : Composition of many A_BusinessPartnerAddress
    on to_BusinessPartnerAddress.BusinessPartner = BusinessPartner;
}
entity A_BusinessPartnerAddress {
  to_EmailAddress : Composition of many A_AddressEmailAddress
    on to_EmailAddress.AddressID = AddressID;
  to_PhoneNumber  : Composition of many A_AddressPhoneNumber
    on to_PhoneNumber.AddressID = AddressID;
}
```

---

## SAP Event Mesh — messaging en CAP

### Configuración en package.json

```json
{
  "cds": {
    "requires": {
      "messaging": {
        "kind": "local-messaging",
        "[production]": {
          "kind": "enterprise-messaging-shared",
          "format": "cloudevents"
        }
      }
    }
  }
}
```

`local-messaging` funciona in-process en desarrollo. En producción usa SAP Event Mesh con formato CloudEvents.

### Emitir eventos

```js
// srv/external/API_BUSINESS_PARTNER.js — handler del servicio externo
module.exports = function () {
  const { A_BusinessPartner } = this.entities;

  this.after('UPDATE', A_BusinessPartner, async data => {
    const messaging = await cds.connect.to('messaging');
    await messaging.emit(
      'sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1',
      { BusinessPartner: data.BusinessPartner }
    );
  });
}
```

### Consumir eventos

```js
// En init() del handler del servicio que escucha
async init() {
  this.messaging = await cds.connect.to('messaging');
  this.messaging.on(
    'sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1',
    async ({ event, data }) => this.onBusinessPartnerChanged(event, data)
  );
  return super.init();
}

async onBusinessPartnerChanged(event, data) {
  const { Customers } = this.entities;
  const Id = data.BusinessPartner;
  // ... actualizar caché local con datos del BP
}
```

### Tests con mocks de mensajería

```js
// En tests/test.js — usar --with-mocks para activar local-messaging
const { GET, POST, expect } = cds.test(__dirname + '../../', '--with-mocks');
```
