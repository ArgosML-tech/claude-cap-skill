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
