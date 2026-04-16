# Role-Driven FE Visibility with CAP Singletons

Use this pattern when SAP Fiori Elements visibility should depend on role or service-side state, but the decision belongs in the CAP service contract — not in custom frontend code.

## When to use this

Good fits:
- Hide or show create/update affordances based on role
- Expose UI state flags like `isAdmin`, `canCreate`, `canUpdate` through OData
- Drive FE visibility from service-side conditions visible in `$metadata`

Do not use this as a substitute for backend authorization:
- The singleton provides **UI hints** for Fiori Elements
- `@requires` and `@restrict` provide **real access protection**

These are complementary, not alternatives. Always keep both.

## CDS: singleton definition

```cds
service CatalogService {
  @odata.singleton
  @cds.persistence.skip
  entity Configuration {
    key ID        : String;
        isAdmin   : Boolean;
        canCreate : Boolean;
        canUpdate : Boolean;
  }

  entity Books as projection on my.bookshop.Books;
}
```

Notes:
- `@odata.singleton` makes it a single-instance entity in OData (no collection)
- `@cds.persistence.skip` skips database persistence — values are computed at runtime
- Keep a technical key even though some consumers may work without it

## Node.js handler

```js
const cds = require('@sap/cds')

module.exports = cds.service.impl(function () {
  this.on('READ', 'Configuration', req => {
    const isAdmin = req.user?.is('admin') ?? false
    return {
      ID        : 'Configuration',
      isAdmin,
      canCreate : isAdmin,
      canUpdate : isAdmin
    }
  })
})
```

Keep the handler lightweight and deterministic. Compute flags from:
- `req.user.is('role')` — role membership
- Feature flags or service-side state passed via environment or configuration

## FE annotation: dynamic UI.CreateHidden / UI.UpdateHidden

```cds
annotate CatalogService.Books with @(
  UI.CreateHidden : {
    $edmJson : {
      $Not : { $Path : '/Configuration/isAdmin' }
    }
  },
  UI.UpdateHidden : {
    $edmJson : {
      $Not : { $Path : '/Configuration/isAdmin' }
    }
  }
);
```

Path note:
- Use `/Configuration/isAdmin` for the FE-friendly singleton path
- Use the full EntityContainer path only if the project already uses that style consistently

## Dynamic UI.Hidden for individual fields

```cds
annotate CatalogService.Books with {
  internalNote @(
    UI.Hidden : {
      $edmJson : { $Not : { $Path : '/Configuration/isAdmin' } }
    }
  );
}
```

## Validation checklist

Validate all of these before closing:

1. `$metadata` exposes a real `Singleton Name="Configuration"`
2. `$metadata` emits `UI.CreateHidden` or `UI.UpdateHidden` with the expected singleton path
3. `GET /<service>/Configuration` returns different values for different mocked users or roles
4. The team understands that visibility hints do not replace backend authorization

## Testing with mocked auth

```js
const cds = require('@sap/cds')
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

describe('Role-driven Configuration singleton', () => {
  const app = cds.test(__dirname + '/..')

  it('returns isAdmin=false for anonymous user', async () => {
    const res = await app.get('/odata/v4/CatalogService/Configuration')
    assert.equal(res.status, 200)
    assert.equal(res.data.isAdmin, false)
  })

  it('returns isAdmin=true for admin user', async () => {
    const res = await app
      .as({ id: 'alice', roles: ['admin'] })
      .get('/odata/v4/CatalogService/Configuration')
    assert.equal(res.status, 200)
    assert.equal(res.data.isAdmin, true)
  })
})
```

When `app.as(...)` is not available in the current `cds.test` flavor, use basic-auth headers with the mocked user credentials instead:
```js
const res = await app.get('/odata/v4/CatalogService/Configuration', {
  auth: { username: 'alice', password: '' }
})
```

Inspect the project's mocked users config to confirm which usernames and roles actually exist before inventing test identities.

## Separator: visibility vs. authorization

| Concern | Mechanism |
|---|---|
| FE button visibility (cosmetic) | Singleton + `UI.CreateHidden` / `UI.UpdateHidden` |
| Real access protection | `@requires` / `@restrict` on the entity |

Never rely solely on the singleton to protect data. A determined user can call the OData endpoint directly regardless of what the UI shows.
