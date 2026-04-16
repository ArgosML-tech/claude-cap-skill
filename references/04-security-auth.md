# Security in CAP: authentication and authorization

## Core distinction

- **Authentication** — who the user is and which claims they present
- **Authorization** — what that user can do on specific resources

CAP handles both, but they are configured separately.

## Strategy by environment

### Local / testing
Use mocked auth (`cds.requires.auth.kind = "mocked"`) unless the project explicitly sets otherwise. Mocked auth lets you test roles and restrictions without a real identity provider.

### Cloud / production
Align the proposal with the existing landscape:
- **IAS** (SAP Identity and Authentication Service) — modern cloud-native apps
- **XSUAA** — traditional Cloud Foundry-based apps
- **Hybrid IAS + XSUAA** — when both are already in use in the project

Never propose a specific auth provider without checking the project's existing configuration.

## Declarative authorization — always first

Before adding manual checks in handlers, evaluate:

- `@requires` — service or entity level, blocks access entirely for unauthorized users
- `@restrict` — fine-grained per-operation control with optional instance filter
- Role-based restrictions — static roles from JWT
- Instance-based restrictions — field comparison against `$user` or other context

**By default, CAP services have no access control.** Authenticated users can access all entities. Always add explicit authorization declarations.

## Behavior of declarative annotations

| Scenario | `@requires` result |
|---|---|
| Anonymous user, no token | `401 Unauthorized` |
| Authenticated, wrong role | `403 Forbidden` |
| Authenticated, correct role | Passes |

## Minimum local validation with mocked auth

When using mocked auth, always validate these three cases before calling the auth strategy complete:

1. Anonymous access → expect `401`
2. Authenticated user without required role → expect `403`
3. Authenticated user with required role → expect `2xx`

Do not consider the strategy validated if you have only checked case 3.

## `@restrict` grant values

The `grant` field accepts:
- Standard CRUD events: `READ`, `CREATE`, `UPDATE`, `DELETE`
- `WRITE` — virtual event that covers **all write operations** (CREATE, UPDATE, DELETE, UPSERT) in one declaration
- Action or function names: `'submitOrder'`, `'approve'`
- `'*'` — wildcard for all events

```cds
// WRITE covers CREATE + UPDATE + DELETE + UPSERT
annotate SalesService.Orders with @restrict: [
  { grant: 'READ',  to: ['Buyer', 'Admin'] },
  { grant: 'WRITE', to: 'Admin' }
];
```

## Restriction inheritance — service projections inherit from db entities

Service entities **inherit** restrictions declared on the underlying database entity. Explicit restrictions at the service level **override** (not add to) the inherited ones:

```cds
// db/schema.cds — base restriction
annotate db.Books with @restrict: [
  { grant: 'READ', to: 'authenticated-user' }
];

// BuyerService inherits db.Books restriction → READ for authenticated users
service BuyerService {
  entity Books as projection on db.Books;
}

// AdminService overrides — db.Books restriction no longer applies here
service AdminService {
  entity Books @(restrict: [{ grant: '*', to: 'Admin' }])
    as projection on db.Books;
}
```

This can be surprising: adding `@restrict` at the service level does not combine with the db-level restriction — it replaces it.

## `@restrict` by operation

If you use `@restrict`, validating only a generic READ is not enough. Check separately:

```cds
annotate CatalogService.ProductReviews with @restrict: [
  { grant: 'READ', to: ['admin', 'cds.ExtensionDeveloper'] },
  { grant: 'CREATE', to: ['admin', 'cds.ExtensionDeveloper'] },
  { grant: ['UPDATE', 'DELETE'], to: 'admin' },
  { grant: ['UPDATE', 'DELETE'], to: 'cds.ExtensionDeveloper', where: 'createdBy = $user' }
];
```

Minimum test matrix for this config:
- Anonymous on READ
- `cds.ExtensionDeveloper` on READ ✓
- `cds.ExtensionDeveloper` on CREATE ✓
- `cds.ExtensionDeveloper` on UPDATE of a record they own ✓
- `cds.ExtensionDeveloper` on UPDATE of a record owned by another user → expect `403` or `404`
- `admin` on UPDATE of any record ✓

## Deep authorization with `exists` predicate

When access should be derived from associated entities rather than direct field comparison:

```cds
entity Projects @(restrict: [
  { grant: ['READ', 'WRITE'],
    where: (exists members[userId = $user and role = 'Editor']) }
]) {
  members : Association to many Members;
}
```

This evaluates to true if the current user appears as an Editor in the `members` association. Recursive paths are supported: `exists a[exists b[...]]`.

## Instance-level authorization

When access depends on who owns or created a record:

```cds
using { managed } from '@sap/cds/common';

entity ProductReviews : managed {
  key ID   : UUID;
      text : String;
}

annotate CatalogService.ProductReviews with @restrict: [
  { grant: 'READ',   to: ['admin', 'cds.ExtensionDeveloper'] },
  { grant: 'CREATE', to: ['admin', 'cds.ExtensionDeveloper'] },
  { grant: ['UPDATE', 'DELETE'], to: 'admin' },
  { grant: ['UPDATE', 'DELETE'], to: 'cds.ExtensionDeveloper', where: 'createdBy = $user' }
];
```

Validation rule:
1. Create a record as the lower-privilege user
2. Verify the same user can update/delete that record
3. Verify the same user cannot update/delete a record owned by another user
4. Verify the stored record is unchanged after the denied operation

Do not assume denied instance-level operations always surface as `403` — depending on provider and operation, you may also see `404` or filtered-out results. The important check is whether unauthorized access is blocked and protected data remains unchanged.

## Critical: compositions are NOT protected by @restrict

**Restrictions on composition children are not enforced by the CAP runtime.** Only the root entity's authorization is checked at request time. If you `@restrict` the root, it does not cascade to its composition items.

```cds
entity Orders @(restrict: [{ grant: '*', to: 'Admin' }]) {
  items : Composition of many OrderItems on items.order = $self;
}

// @restrict on Orders does NOT protect OrderItems navigation paths
// A user who can read Orders can also read OrderItems via navigation
// Custom handlers are required for composition-level security
```

When composition-level access control is required, implement it explicitly in `before` handlers on the child entity.

## Draft authorization behavior

Draft authorization is derived from the active entity's restrictions — no separate draft-specific annotations are needed:
- Users with `CREATE` privilege can create new drafts and manage them
- Users with `UPDATE` privilege can open drafts for editing
- **Draft entities are only editable by their creator** — this is enforced automatically by CAP

## `where` clause validates input data too

The `where` condition in `@restrict` is not only a read filter. For `CREATE` and `UPDATE` events, it also validates that the submitted data matches the condition. Invalid data receives a `400` response:

```cds
// User cannot set accountingArea to a value outside their authorized list
annotate Orders with @(restrict: [
  { grant: '*', where: 'accountingArea = $user.accountingAreas' }
]);
```

## User attributes in `@restrict where` — correct syntax

User attributes defined in mocked auth config under `attr` are accessed in `@restrict where` clauses as `$user.<attrName>` — **without** the `.attr.` prefix.

**Why:** CAP's internal resolver (`utils.js resolveUserAttrs`) starts from `req.user.attr` when it sees `$user.X`. So `$user.salesOrg` resolves to `req.user.attr.salesOrg`. Adding `.attr.` in the path causes CAP to look for `attr` inside `req.user.attr`, which doesn't exist → always evaluates to false (silently shows 0 results).

```json
// package.json — mocked auth config
"manager1": {
  "roles": ["Manager"],
  "attr": { "salesOrg": "1000" }
}
```

```cds
// WRONG — $user.attr.salesOrg: looks for 'attr' in user.attr → not found → always false
{ grant: 'READ', to: 'Manager', where: 'salesOrg = $user.attr.salesOrg' }

// CORRECT — $user.salesOrg: looks for 'salesOrg' in user.attr → finds "1000" ✓
{ grant: 'READ', to: 'Manager', where: 'salesOrg = $user.salesOrg' }
```

**Symptom of the wrong syntax:** the Manager sees 0 records (not 403) — the WHERE clause `salesOrg = null` silently filters everything out.

**Note for XSUAA:** same rule applies — custom claims from the JWT are accessible as `$user.<claimName>`, not `$user.attr.<claimName>`.

## `@restrict where` on READ: 404 not 403 for filtered records

When a READ request matches a record excluded by a `@restrict where` clause, CAP returns **404**, not 403.

- `GET /SalesOrderDrafts` (list) → excluded records simply absent from the list (no error)  
- `GET /SalesOrderDrafts(ID=...)` (single, excluded by where) → **404** Not Found

This is intentional: the client cannot infer that a record exists from the denied access response. It is different from service-level `@requires` (which returns 403 for wrong role).

```
// @restrict where on READ — salesrep1 accessing another user's draft
GET /api/sales/SalesOrderDrafts(ID=<rep2-order>,IsActiveEntity=false)
→ 404 Not Found   (NOT 403 Forbidden)
```

## `@restrict` on child entity: direct access vs. navigation

`@restrict` on a child entity exposed in the same service blocks **direct access** but does NOT block **navigation from an allowed parent**.

```cds
annotate SalesOrderService.ComplianceEvaluations with @restrict: [
  { grant: 'READ', to: ['Manager', 'Admin'] }
  // SalesRep is excluded
];
```

```
// Direct access — blocked ✓
GET /api/sales/ComplianceEvaluations
→ 403 Forbidden for SalesRep

// Navigation from parent — NOT blocked ✗
GET /api/sales/SalesOrderDrafts(ID=<own-order>,IsActiveEntity=false)/evaluations
→ 200 OK for SalesRep (child @restrict is bypassed via navigation)
```

**Why:** CAP enforces `@restrict` on the entity as a service endpoint. Navigation from a parent entity is treated as part of the parent READ context — the parent's permission propagates. The child's `@restrict` is not re-evaluated for navigation requests.

**For true child-level restriction:** use a `before('READ', ChildEntity)` handler with programmatic authorization logic. The `@restrict` on the child alone is insufficient when the child is a navigation target.

```js
this.before('READ', ComplianceEvaluations, async req => {
  if (req.user?.is('Admin') || req.user?.is('Manager')) return
  // SalesRep: only their own order's evaluations via navigation
  // Add WHERE condition or reject if user has no permission
  req.reject(403, 'Access to compliance evaluations requires Manager role')
})
```

Note: this also updates the existing section "Critical: compositions are NOT protected by @restrict" — that section is correct but incomplete. `@restrict` on a composition child entity DOES protect direct endpoint access; it just does not protect navigation. The combination needed is: `@restrict` for direct access + handler for navigation.

## `managed` fields cannot be set in CSV seed data

CSV seed data for entities using the `managed` mixin (`createdAt, createdBy, modifiedAt, modifiedBy`) must NOT include those fields as CSV columns.

**Why:** Including `createdBy` (or any managed field) in the CSV header causes a column order mismatch in the SQLiteService INSERT — the service merges CSV columns with managed auto-generated columns, and for Timestamp fields it calls `Date.toISOString()` on the wrong value → `RangeError: Invalid time value`.

```
// WRONG — adding createdBy to CSV causes RangeError on cds deploy
ID,customerID,...,createdBy
a1..001,C001,...,salesrep1
→ /> deployment to in-memory database. failed
   RangeError: in cds.deploy(): Invalid time value
```

**Implication:** CSV seed data always gets `createdBy = 'anonymous'`. If tests need records with specific `createdBy` values (for `@restrict where: 'createdBy = $user'` testing), create those records via API in the test `before()` hook — CAP's managed aspect will set `createdBy` to the authenticated user.

## Default GET returns active entities only

`GET /EntitySet` without filter returns only active entities (`IsActiveEntity=true`). Draft entities (`IsActiveEntity=false`) require an explicit filter:

```
GET /api/sales/SalesOrderDrafts                                   → active only
GET /api/sales/SalesOrderDrafts?$filter=IsActiveEntity eq false   → drafts only
```

This matters for tests: if the test setup creates orders via POST (which creates drafts), a subsequent `GET /EntitySet` to verify them will return 0 results. Use `?$filter=IsActiveEntity eq false` or activate the drafts first.

## Anti-patterns

- Repeating manual auth checks across many handlers instead of using `@requires` / `@restrict`
- Security-by-convention without explicit annotations
- Assuming instance-level restrictions are validated by role-level smoke tests
- Assuming `@restrict` on a root entity also protects its composition children — it does not
- Assuming service-level `@restrict` adds to db-level restrictions — it replaces them
- Mixing authorization decisions with persistence logic without separation
- Not testing the denied paths — only testing that the happy path works

## What to review in a security audit

- Which roles exist or are expected by the project
- Which entities or actions need protection
- Whether the restriction is static (role-based) or instance-based (data-dependent)
- Whether the solution must also work correctly in draft mode (draft entities have separate access paths)

## Gap descubierto — 2026-04-16

**Área:** G1 — cds.users en nivel incorrecto (@sap/cds@9)
**Síntoma:** `requester1` recibía 403 "lacking required roles" aunque tenía roles definidos en `package.json`
**Causa:** Los usuarios mock se definieron en `cds.users` (nivel raíz), pero en `@sap/cds@9` deben estar en `cds.requires.auth.users`
**Fix aplicado:** Mover el bloque de usuarios a `cds.requires.auth.users` en `package.json`

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.
