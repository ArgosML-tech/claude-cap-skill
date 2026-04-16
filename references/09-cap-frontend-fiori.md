# CAP frontend with SAPUI5 and Fiori Elements

## When to propose Fiori Elements

Propose FE when several of these are true:
- There is already a CAP OData service or one will clearly exist
- The use case fits list reports, object pages, sub-object pages, or bound actions
- You want to reuse filters, tables, navigation, variants, and standard floorplans
- The service contract and metadata matter more than highly custom interaction

Do not propose FE by default when:
- The UI is a complex wizard not centered on entities
- The screen is heavily custom, canvas-heavy, or non-standard
- A very quick proof is needed — a simple page is the right validation step

In those cases, explain why a simple UI or SAPUI5 freestyle fits better.

## Typical `app/` structure (CAP convention)

```
app/
  index.html                         ← launcher (optional)
  <app-name>/
    webapp/
      index.html                     ← bootstraps UI5 with ComponentSupport
      Component.js                   ← extends sap/fe/core/AppComponent
      manifest.json                  ← mainService.uri, routing, sap.fe.templates
      i18n/
        i18n.properties
      annotations/                   ← XML annotations (only if project uses XML style)
  <app-name>.cds                     ← CDS annotations (preferred for CAP-first projects)
```

If SAP Fiori tools generators are unavailable, a minimal manual skeleton must include all of the above. Do not skip `manifest.json` wiring.

## Annotation placement

| Location | When to use |
|---|---|
| `app/<app-name>.cds` | CAP-first projects — keeps UI contract close to service |
| `srv/*.cds` | Only if the repo already centralizes UI annotations there |
| `webapp/annotations/*.xml` | Only if the project already uses a UI-owned XML annotation layer |

Prefer CDS annotations in `app/` when the project follows CAP Fiori guidance.

## Role-based app separation

If roles are clearly distinct, prefer multiple focused FE apps:
- `app/requester/` — for requesters
- `app/approver/` — for approvers

instead of one blended app with mixed responsibilities.

## CAP OData ↔ Fiori Elements relationship

Minimum checklist:
- OData service exists and exposes stable metadata
- For transactional create/edit flows, use `@odata.draft.enabled`
- `mainService.uri` in `manifest.json` points to the real CAP endpoint
- Bound actions are modeled in CDS — FE cannot invoke actions that are not in `$metadata`
- Authorization protects the service — the UI must not compensate for weak backend modeling

For transactional object pages, also check:
- Whether child collections are `composition` or only `association`
- Whether the expected create flow depends on draft-enabled compositions
- Whether the projection preserved or redefined draft semantics correctly

## Draft lifecycle events for FE-driven apps

When a FE app triggers draft operations, CAP fires specific events at each step. If you need server-side validation or initialization at a specific point, register on the appropriate event:

| FE user action | CAP event | Register on |
|---|---|---|
| Create new record | `NEW` | `Entity.drafts` |
| Click Edit on existing record | `EDIT` | Active entity (not `.drafts`) |
| Change a field value | `PATCH` | `Entity.drafts` |
| Click Save / Activate | `SAVE` | `Entity.drafts` |
| Click Discard / Cancel | `DISCARD` | `Entity.drafts` |

Example — validate before save:
```js
this.before('SAVE', 'OrderRequests.drafts', req => {
  if (!req.data.customerName) req.reject(400, 'Customer name is required')
})
```

## Draft configuration

```json
{
  "cds": {
    "fiori": {
      "draft_lock_timeout": "30min",
      "draft_deletion_timeout": "28d"
    }
  }
}
```

- `draft_lock_timeout` — how long a draft lock is held (default: 15 minutes). Accepts `'1h'`, `'10min'`, or milliseconds.
- `draft_deletion_timeout` — how long inactive drafts are kept before deletion (default: 30 days). Set to `false` to disable cleanup.

## Key UI annotations for List Report / Object Page

```cds
annotate CatalogService.Books with @(
  UI.HeaderInfo : {
    TypeName       : 'Book',
    TypeNamePlural : 'Books',
    Title          : { Value : title }
  },
  UI.SelectionFields : [ genre, author_ID ],
  UI.LineItem : [
    { Value : title },
    { Value : author.name, Label : 'Author' },
    { Value : stock },
    { $Type  : 'UI.DataFieldForAction',
      Action : 'CatalogService.submitOrder',
      Label  : 'Order' }
  ],
  UI.Facets : [
    { $Type  : 'UI.ReferenceFacet',
      Label  : 'Details',
      Target : '@UI.FieldGroup#Details' }
  ],
  UI.FieldGroup#Details : {
    Data : [
      { $Type : 'UI.DataField', Value : title,  Label : 'Title' },
      { $Type : 'UI.DataField', Value : stock,  Label : 'Stock' },
      { $Type : 'UI.DataField', Value : price,  Label : 'Price' }
    ]
  }
);
```

## FieldGroup DataField labels — always explicit

**Rule:** Every `UI.DataField` inside a `UI.FieldGroup` must have an explicit `Label:`. Do not rely on FE's fallback.

**Why it matters:** FE falls back to the CDS property's `@title`. If the property is a projection alias of an association element (e.g., `status.name as statusName`), FE inherits `@title : 'Name'` from the `CodeList` base type — and in localized UIs this renders as "Nombre:", "Name:", etc. instead of "Status".

```cds
// WRONG — no Label, field shows "Nombre:" in Spanish UI
UI.FieldGroup#RiskApproval: {
  Data: [
    { Value: statusName }   // alias for status.name → inherits CodeList "name" @title
  ]
}

// CORRECT — always explicit
UI.FieldGroup#RiskApproval: {
  Data: [
    { $Type: 'UI.DataField', Value: statusName, Label: 'Status' }
  ]
}
```

**Prefer FK over alias for status-like fields:** For association-based status/risk fields, prefer the FK (`status_code`, `riskLevel_code`) over the projected name alias (`statusName`, `riskLevelName`). The FK field participates in value-help resolution and renders as a dropdown when a value list is configured, whereas the alias is just a plain string input.

```cds
// BETTER — FK field, value-help-compatible, editable dropdown
{ $Type: 'UI.DataField', Value: status_code, Label: 'Status' }

// WORSE — alias string, plain input, no value-help
{ $Type: 'UI.DataField', Value: statusName, Label: 'Status' }
```

## Value help and code lists

For a field that should render as a fixed dropdown in FE:
- Model a readonly `sap.common.CodeList` entity
- Expose it through a `@readonly` projection in the service
- Use `Common.ValueListWithFixedValues: true` and `Common.ValueList` on the source field
- If the filter should be single-choice, add `Capabilities.FilterRestrictions.FilterExpressionRestrictions`

Prefer this over raw enum rendering when the values are business-owned and finite.

## Mandatory and computed fields

```cds
annotate SalesService.Orders with {
  customerName @mandatory;
  dueDate      @mandatory;
  status       @readonly;                      // server-controlled
  orderNumber  @Core.Computed;                 // assigned by backend
  customerID   @mandatory @(Common.ValueList : {
    CollectionPath : 'Customers',
    Parameters : [
      { $Type : 'Common.ValueListParameterInOut',
        LocalDataProperty : customerID, ValueListProperty : 'ID' },
      { $Type : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty : 'fullName' }
    ]
  });
}
```

- Mark `@mandatory` at the element level, not inside an annotation group
- Combine `@readonly` (service-level) with `@Common.FieldControl: #ReadOnly` (FE-level) when the field must be visually read-only in addition to ignoring client writes

## Shared value-help catalogs across role-specific apps

When multiple FE apps share filter catalogs or value helps:
- Expose those readonly catalogs with read permissions for every role that uses them
- Otherwise FE fails with `403` before any business action happens
- Consider sharing a common service projection for catalog entities or using `@readonly` + `@requires` combinations

## FE visibility driven by role or service-side state

Two complementary patterns — choose based on what the visibility depends on:

| Pattern | When to use |
|---|---|
| **Virtual Boolean fields** (per-instance) | Action depends on **both** entity state AND user role (e.g., approve only when status=PendingApproval AND user is Manager) |
| **Singleton** (entity-type-level) | Visibility depends only on role, not on a specific entity's state (e.g., show Create button only for Admin) |

### Pattern A — Virtual fields for bound action availability

Add `virtual` Boolean fields to the entity projection. Populate them in `after('READ')` combining state + role. Reference them in `@Core.OperationAvailable`.

```cds
// srv/sales-order-service.cds
entity SalesOrderDrafts as projection on db.SalesOrderDrafts {
  *,
  virtual canSubmit   : Boolean,   // Draft + requiresApproval + SalesRep
  virtual canApprove  : Boolean,   // PendingApproval + Manager
  virtual canPublish  : Boolean,   // Approved + Manager
  virtual canEscalate : Boolean    // any non-terminal status + Manager
}
```

```js
// srv/sales-order-service.js
const setActionAvailability = (results, req) => {
  const rows = Array.isArray(results) ? results : [results]
  for (const order of rows) {
    if (!order) continue
    const isManager  = req.user?.is('Manager') || req.user?.is('Admin')
    const isSalesRep = req.user?.is('SalesRep') || req.user?.is('Admin')
    const status     = order.status_code ?? ''
    order.canSubmit  = isSalesRep && status === 'Draft' && order.requiresApproval === true
    order.canApprove = isManager  && status === 'PendingApproval'
    order.canPublish = isManager  && status === 'Approved'
    order.canEscalate = isManager && !['Submitted', 'Cancelled'].includes(status)
  }
}
// Register for both active and draft entity
this.after('READ', SalesOrderDrafts,        setActionAvailability)
this.after('READ', SalesOrderDrafts.drafts, setActionAvailability)
```

```cds
// app/<app>/annotations.cds
annotate SalesOrderService.SalesOrderDrafts with actions {
  submitForApproval @(Core.OperationAvailable: canSubmit);
  approve           @(Core.OperationAvailable: canApprove);
  publishToSAP      @(Core.OperationAvailable: canPublish);
  escalateRisk      @(Core.OperationAvailable: canEscalate);
};
```

Important: `@Core.OperationAvailable` takes a **path to a Boolean property** on the entity. It does NOT accept an inline expression. The property must be present in `$metadata` — that is why it must be declared as `virtual` in the projection (virtual fields ARE emitted to EDMX).

Verification: after GET on the entity, the JSON response includes `canSubmit`, `canApprove`, etc. as Boolean values. These are the values Fiori Elements uses to enable/disable action buttons.

### Critical: virtual field dependencies must be in FE's `$select`

Fiori Elements only includes fields in its OData `$select` that it finds in `UI.LineItem`, `UI.FieldGroup`, `@Core.OperationAvailable`, and similar used annotations. If the `after('READ')` handler computes a virtual field using a persistent field (e.g. `status_code`) that is **not** referenced in any annotation FE uses for its request, that persistent field will be absent from the query result — and the virtual field computation silently returns `false` for every row.

**Symptom**: all inline action buttons are disabled in the List Report, even for rows where they should logically be enabled.

**What does NOT work**: adding `{ $Type: 'UI.DataField', Value: status_code, ![@UI.Hidden]: true }` to `UI.LineItem`. FE excludes hidden DataField entries from its `$select` entirely — the field is still absent.

**Correct fix**: use `@Common.Text` to link the code field to its display text, then put the **code field** (not the text alias) in `UI.LineItem`. FE fetches the code field AND its text automatically.

```cds
// In annotations.cds — declare code-text binding BEFORE the main annotate block
annotate SalesOrderService.SalesOrderDrafts with {
  status_code    @Common.Text: statusName    @Common.TextArrangement: #TextOnly;
  riskLevel_code @Common.Text: riskLevelName @Common.TextArrangement: #TextOnly;
};

// In UI.LineItem — use the code field, not the text alias
{ $Type: 'UI.DataField', Value: status_code,    Label: 'Status' },     // shows "Pending Approval" (text only)
{ $Type: 'UI.DataField', Value: riskLevel_code, Label: 'Risk Level' }, // shows "High" (text only)
```

**Why `@Common.Text` works**: FE includes the code field (`status_code`) in `$select`, and also fetches its `@Common.Text` path (`statusName`) for display. The server returns both. The after handler receives `status_code`, computes `canApprove = isManager && status_code === 'PendingApproval'`, and FE uses the result to enable/disable the button per row.

**Rule of thumb**: for every `order.someField` reference in `setActionAvailability`, verify `someField` appears as the `Value` in a `UI.DataField` entry in `UI.LineItem` or `UI.FieldGroup` — not hidden, not an alias.

### Pattern B — Singleton for entity-type-level visibility

Use when the flag depends only on the user's role, not on per-instance state. See `references/12-role-driven-visibility-singletons.md` for the full pattern.

Do not move business rules into the frontend.

## UI5 bootstrap: correct CDN host

Two SAP CDN hosts exist for UI5. Only one works reliably in all environments:

| Host | Use |
|---|---|
| `https://sapui5.hana.ondemand.com/` | **Correct for development.** This is what `cds watch` Fiori preview uses internally. |
| `https://ui5.sap.com/` | Alternate host; can fail with CORB if the path format is wrong or the host is blocked. |

**Never use a version suffix with `.x`** — `1.120.x` is not a real path on the CDN and returns a 404 HTML page. Chrome then blocks that HTML as a script (CORB).

```html
<!-- WRONG — wrong host, invalid version path, causes CORB -->
<script src="https://ui5.sap.com/1.120.x/resources/sap-ui-core.js" ...></script>

<!-- CORRECT — same host cds-dk Fiori preview uses, no version = latest -->
<script src="https://sapui5.hana.ondemand.com/resources/sap-ui-core.js" ...></script>
```

**Symptom of the wrong URL:** blank page, Issues tab shows:
```
Response was blocked by CORB (Cross-Origin Read Blocking)
Affected resources: sap-ui-core.js
```
or:
```
GET .../resources/sap-ui-core.js  net::ERR_ABORTED 404 (Not Found)
Refused to execute script ... because its MIME type ('text/html') is not executable
```

**Diagnostic shortcut:** if `$fiori-preview` works but your custom `index.html` does not, the CDN host or URL path is wrong. Look at the host that `cds-fiori` uses (found in `@sap/cds-fiori/app/preview.js`) and mirror it.

**Note on `cds-plugin-ui5`:** this package only works for projects with full UI5 CLI tooling (`ui5.yaml`). It does NOT serve UI5 as a simple CDN replacement and should not be used just to avoid the CDN.

## Mocked Basic Auth and standalone FE apps

CAP's `mocked` auth uses HTTP Basic Auth. In standalone FE apps (custom `index.html`), the OData V4 model sends `$metadata` requests without credentials. CAP returns **403** (not 401) when the browser has stale or empty credentials cached — and the OData V4 model fails fatally before the app renders.

**Symptom:**
```
GET /api/sales/$metadata - 403 Forbidden
[FUTURE FATAL] Failed to load component for container - Error: Forbidden
```

**Development workaround — hardcode credentials in manifest.json:**
```json
"settings": {
  "httpHeaders": {
    "Authorization": "Basic c2FsZXNyZXAxOg=="
  }
}
```

`c2FsZXNyZXAxOg==` = `base64("salesrep1:")`. This tells the OData V4 model to include Basic Auth on every request, bypassing the browser credential cache entirely.

This is a **development-only** pattern. In production (BTP/CF), replace with XSUAA or the appropriate auth header from the platform. Never ship hardcoded credentials.

**Root cause:** the browser caches Basic Auth credentials per origin. If credentials are stale, wrong, or missing (e.g., after a browser restart or tracking prevention), the OData request gets 403 with no retry — unlike FLP-embedded apps where ushell handles credential refresh. The `$fiori-preview` endpoint works because CAP handles the auth challenge at the server side for that route.

## sap.m.Shell wrapper required for standalone sap.fe.templates

`sap.fe.templates.ListReport` and `ObjectPage` in **standalone mode** (without FLP ushell) require `sap.m.Shell` as a sizing context. Without it, the component mounts but renders with zero visible content — white screen, no JS error.

**Symptom:** app initializes, OData requests succeed, FE components load, but white screen.

**Wrong — ComponentSupport alone, no Shell:**
```html
<!-- index.html -->
<div data-sap-ui-component data-name="myapp" ...></div>
```

**Correct — manually create Shell + ComponentContainer:**
```html
<!-- index.html — no data-sap-ui-oninit, no ComponentSupport -->
<script>
  sap.ui.require([
    "sap/m/Shell",
    "sap/ui/core/ComponentContainer"
  ], function (Shell, ComponentContainer) {
    new Shell({
      app: new ComponentContainer({
        height   : "100%",
        name     : "myapp",
        manifest : true,
        async    : true,
        settings : { id: "myapp" }
      })
    }).placeAt("content")
  })
</script>
<body class="sapUiBody" id="content" style="height:100%;margin:0;overflow:hidden"></body>
```

`sap.m.Shell` provides the sizing and scroll context that `sap.fe.templates` expects from the shell layer. It is a lightweight wrapper — no FLP ushell required. This is the correct standalone pattern for `sap.fe.templates` in development and in simple deployments without Fiori Launchpad.

## List Report row navigation — explicit `navigation` config required

In manually written `manifest.json`, **row click navigation from List Report to Object Page does NOT work automatically** without an explicit `navigation` setting in the List Report target options.

**Symptom:** "Crear" (new draft) navigates correctly to the Object Page, but clicking on an existing row in the list does nothing.

**Why:** When FE creates a new draft, it navigates programmatically. Row-press navigation for existing records uses the manifest routing, but the List Report needs an explicit map of which route to use per entity set.

**Fix — add `navigation` to the List Report target in `manifest.json`:**
```json
"SalesOrdersList": {
  "type": "Component",
  "name": "sap.fe.templates.ListReport",
  "options": {
    "settings": {
      "entitySet": "SalesOrderDrafts",
      "navigation": {
        "SalesOrderDrafts": {
          "detail": {
            "route": "SalesOrdersObjectPage"
          }
        }
      }
    }
  }
}
```

The `navigation` key maps each entity set to the `detail` route name defined in `sap.ui5.routing.routes`. Without this, the List Report renders and filters correctly but row press is a no-op.

**Add to the Local validation checklist:** after loading the List Report with data, click an existing row and verify the URL changes to `EntitySet(ID=...,IsActiveEntity=true)`. If the URL does not change, the `navigation` config is missing.

## `UI.HeaderInfo.Title` — use a business-meaningful field, not a FK or UUID

`UI.HeaderInfo.Title.Value` is the main label shown in the Object Page header and the List Report row when no other identifier is available. If this points to a foreign key like `customerID`, the Object Page title becomes "C001", "C006" — which makes the app look like a Customer list, not a Sales Order.

**Rule:** use a human-readable business field as `Title`:
- For Sales Orders: `customerName` or a generated `orderNumber`
- For a Purchase Request: `description` or `requestorName`
- For a Project: `projectName`

Use `Description` for a secondary identifier (e.g., `customerID` or `statusCode`).

```cds
// WRONG — title = "C001", looks like Customer management
UI.HeaderInfo: {
  Title:       { Value: customerID },
  Description: { Value: statusName }
}

// CORRECT — title = "Acme GmbH" (Sales Order for Acme GmbH)
UI.HeaderInfo: {
  Title:       { Value: customerName },
  Description: { Value: customerID }
}
```

## Tooling guidance

Prefer SAP Fiori tools-aligned structures when:
- The user wants a real FE app, not just preview
- The project follows standard FE app scaffolding
- Navigation, page maps, and annotations should follow SAP's default scaffolding

After generation, inspect what the generator actually produced:
- `app/<app>/webapp/manifest.json` — check `mainService.uri`
- Generated `README.md` and `package.json` — watch for unexpected workspace settings
- Whether the generator added `cds-plugin-ui5` or watch scripts to the CAP root
- Correct the `mainService.uri` if the generator used a generic path instead of the real CAP endpoint

## Development URL — always use $fiori-preview first

**Rule:** For development validation of any CAP FE app, use `$fiori-preview` as the primary URL — not the standalone `index.html`.

```
http://localhost:PORT/$fiori-preview/<ServiceName>/<EntitySet>#preview-app
```

Examples:
```
http://localhost:4004/$fiori-preview/NotificationAdminService/NotificationRules#preview-app
http://localhost:4004/$fiori-preview/CatalogService/Books#preview-app
```

**Why:** `$fiori-preview` serves UI5 from the CAP server's local node_modules — no CDN, no tracking prevention, no auth challenge race condition. Standalone `index.html` with `sapui5.hana.ondemand.com` CDN fails silently in Edge and other browsers when Tracking Prevention blocks cross-origin storage for the CDN domain. This causes UI5 module loading to fail with a cascade of errors and a white screen — even when `$metadata` returns 200 and the backend is correct.

**Anti-pattern to avoid:** Building a standalone `index.html` that loads UI5 from CDN and declaring the UI complete without visual verification in a browser. The `$metadata` returning 200 does NOT mean the UI renders.

**When to build a real standalone app instead:**
- The target deployment is not CAP dev mode (e.g., Fiori Launchpad, BTP, ABAP)
- In those cases: serve UI5 from a platform-managed source, not from the CDN in index.html

## Standalone index.html — correct async init pattern (Gap #5)

When building a standalone `index.html` (e.g., for non-development deployment), the initialization must follow this pattern exactly:

**Wrong — inline `sap.ui.require` with `async=true`:**
```html
<script src="...sap-ui-core.js" data-sap-ui-async="true" ...></script>
<script>
  sap.ui.require(['sap/m/Shell', ...], function(Shell) { ... })  <!-- FAILS: sap not yet defined -->
</script>
```

**Correct — `data-sap-ui-oninit` pointing to a module file:**
```html
<script id="sap-ui-bootstrap"
  src="https://sapui5.hana.ondemand.com/resources/sap-ui-core.js"
  data-sap-ui-async="true"
  data-sap-ui-oninit="module:myapp/namespace/index"
  data-sap-ui-resourceroots='{"myapp.namespace": "./"}'
></script>
```

```js
// webapp/index.js — loaded by UI5 only after core is ready
sap.ui.define(['sap/m/Shell', 'sap/ui/core/ComponentContainer'], function(Shell, ComponentContainer) {
  new Shell({ app: new ComponentContainer({ name: 'myapp.namespace', manifest: true, async: true }) })
    .placeAt('content')
})
```

With `async=true`, the inline `<script>` runs before UI5 defines `sap.ui.require`. Using `data-sap-ui-oninit` guarantees the module executes only after UI5 core is ready.

## Custom webapp without Component.js breaks the FLP shell (Gap #7)

When a CAP project has a custom `app/<name>/webapp/manifest.json`, CAP's dev server registers that component in the Fiori Launchpad shell (FLP). If `Component.js` is missing from `webapp/`, navigating to that tile in the FLP (including when reached via `$fiori-preview`) triggers:

> **"No se ha podido abrir la aplicación porque no se ha podido cargar el componente SAP UI5 de la aplicación"**

**Why:** The FLP resolves the app tile by `sap.app.id` in `manifest.json`, then tries to load `Component.js` relative to the webapp root. No `Component.js` → component load fails → FLP shows the error dialog. This happens even if the `$fiori-preview` URL itself is correct.

**Two valid approaches — choose one, do not mix:**

### Option A — Annotations only, no custom webapp (recommended for development validation)

Use only `app/<name>.cds` annotations. No `webapp/` folder needed. `$fiori-preview` generates its own component internally.

```
app/
  notifications-admin.cds    ← CDS annotations only, no webapp/
```

### Option B — Full custom webapp (required for production or custom layout)

If a `webapp/` folder exists with `manifest.json`, it MUST include `Component.js`:

```js
// app/<name>/webapp/Component.js — required, minimal
sap.ui.define(['sap/fe/core/AppComponent'], function(AppComponent) {
  'use strict'
  return AppComponent.extend('<sap.app.id from manifest>', {
    metadata: { manifest: 'json' }
  })
})
```

The `extend()` argument must exactly match `sap.app.id` in `manifest.json`.

**What does NOT work:** `manifest.json` + `index.html` + `index.js` but no `Component.js`. The Shell-based loader always resolves the component by class name, not by the init script.

**Checklist when adding a custom webapp:**
- [ ] `Component.js` exists alongside `manifest.json`
- [ ] `extend('<id>')` matches `sap.app.id` exactly
- [ ] `manifest.json → sap.ui5.dependencies.libs` includes `sap.fe.templates`
- [ ] `manifest.json → sap.ui5.routing.config.routerClass` is `sap.fe.core.AppRouter`
- [ ] At least one `sap.fe.templates.ListReport` or `ObjectPage` target is configured

## Local validation checklist

Do not close the task just because files exist in `app/`. Validate:

1. CAP starts with the annotations and `app/` assets included
2. **First visual check: open `/$fiori-preview/<ServiceName>/<EntitySet>#preview-app` — not the standalone index.html**
3. `app/<app>/webapp/manifest.json` is served correctly
4. `mainService.uri` points to the real CAP endpoint (e.g., `/odata/v4/CatalogService/`)
5. Service `$metadata` responds with expected entities and annotations
6. For transactional FE apps, inspect `$metadata` for `DraftRoot`, `DraftNode`, `IsActiveEntity`
7. If child create is expected, verify compositions (not just associations) are exposed
8. If another CAP app runs on the default port, validate on an isolated port

If no browser is available in the current session:
- Validate static resources and `$metadata` over HTTP
- Say so explicitly — do not claim visual navigation was verified

## Multi-entity app: multiple List Reports in one manifest (Gap #24)

When a single role manages several unrelated entity sets (e.g., ComplianceOfficer manages
`ComplianceRules`, `ComplianceEvaluations`, and `RiskProfiles`), one FE app manifest can
host multiple List Report routes. The default pattern (`":?query:"`) lands on the primary
entity; additional entity sets get distinct route patterns.

```json
"routing": {
  "routes": [
    { "pattern": ":?query:",                   "name": "ComplianceRulesList",       "target": "ComplianceRulesList" },
    { "pattern": "ComplianceRules({key}):?query:", "name": "ComplianceRulesObjectPage", "target": "ComplianceRulesObjectPage" },
    { "pattern": "evaluations:?query:",        "name": "ComplianceEvaluationsList", "target": "ComplianceEvaluationsList" },
    { "pattern": "risk-profiles:?query:",      "name": "RiskProfilesList",          "target": "RiskProfilesList" },
    { "pattern": "RiskProfiles({key}):?query:", "name": "RiskProfilesObjectPage",   "target": "RiskProfilesObjectPage" }
  ],
  "targets": {
    "ComplianceRulesList": {
      "type": "Component", "name": "sap.fe.templates.ListReport",
      "options": { "settings": { "entitySet": "ComplianceRules",
        "navigation": { "ComplianceRules": { "detail": { "route": "ComplianceRulesObjectPage" } } }
      }}
    },
    "ComplianceEvaluationsList": {
      "type": "Component", "name": "sap.fe.templates.ListReport",
      "options": { "settings": { "entitySet": "ComplianceEvaluations" } }
    },
    "RiskProfilesList": {
      "type": "Component", "name": "sap.fe.templates.ListReport",
      "options": { "settings": { "entitySet": "RiskProfiles",
        "navigation": { "RiskProfiles": { "detail": { "route": "RiskProfilesObjectPage" } } }
      }}
    }
  }
}
```

**Navigation between sections:** the user changes the URL hash manually or you add external
links. FE does not generate a side-nav automatically in this setup. For production, embed
the app in a Fiori Launchpad; for dev, navigate via URL fragment.

**Pitfalls:**
- `sap.app.id`, the `data-sap-ui-resourceroots` namespace in `index.html`, and the
  `AppComponent.extend("compliance.Component")` namespace in `Component.js` must all match.
  Mismatch → silent load failure (white screen).
- Each app must have its own unique `sap.app.id`. Reusing the same ID as another app causes
  conflicting module registration.
- Read-only entity sets (no `@odata.draft.enabled`) render a List Report without Edit/Create
  toolbar buttons automatically — no extra annotation needed.
- **Route ordering is critical.** The catch-all `":?query:"` pattern matches ANY hash — put it
  LAST. Specific patterns (`"evaluations:?query:"`, `"risk-profiles:?query:"`) must come before it.
  Symptom of wrong order: "Invalid resource path 'ComplianceService.evaluations'" — FE receives
  control via the catch-all and tries to resolve the hash segment as an entity name.

## Cross-app navigation in standalone dev mode (no Fiori Launchpad)

In production, a Fiori Launchpad provides tiles for each app/section. In standalone dev
(plain `cds watch`), there is no built-in tile navigation. Options:

| Approach | Notes |
|---|---|
| `app/index.html` custom launcher | Best: create a simple HTML with links grouped by role. CAP serves it at `/index.html`. |
| CAP welcome page (`localhost:4004`) | Lists web apps automatically — no descriptions or role grouping. |
| URL hash navigation | Direct hash links (`#ComplianceEvaluations`, `#RiskProfiles`) — developer-only. |

**Pattern — `app/index.html` mini-launchpad:**
```html
<!-- app/index.html — served by cds watch at /index.html -->
<a href="/sales-orders/webapp/index.html">Sales Orders (SalesRep/Manager)</a>
<a href="/compliance/webapp/index.html">Compliance Rules (ComplianceOfficer)</a>
<a href="/compliance/webapp/index.html#ComplianceEvaluations">Evaluation Audit</a>
<a href="/compliance/webapp/index.html#RiskProfiles">Risk Profiles</a>
```

This file is a plain HTML launcher, not a FE app — no manifest, no Component.js needed.
CAP serves everything under `app/` as static files.

## Service-level security boundary between role-specific apps (Gap #24 continued)

`@requires` on the service enforces role-based access at the OData endpoint level:

```cds
@path: '/api/sales'
service SalesOrderService @(requires: ['SalesRep', 'Manager', 'Admin']) { ... }

@path: '/api/compliance'
service ComplianceService @(requires: ['ComplianceOfficer', 'Admin']) { ... }
```

- `compliance1` (ComplianceOfficer) calling `/api/sales/` → **403** — enforced before any handler runs.
- `salesrep1` (SalesRep) calling `/api/compliance/` → **403** — same.
- The FE app's manifest `dataSource.uri` pointing to the correct service ensures the app
  only ever calls its permitted endpoint.

This boundary holds even if a user modifies the browser request — the `@requires` check runs
server-side on every OData request. It is NOT just a UI-level restriction.

## Manual browser validation checklist

When the user can open the app:
1. App opens without blank screens or unexpected popups
2. Main list or object page renders with real data or intentional empty state
3. Expected role can read every filter catalog and value help without `403`
4. Draft create and activation work if the app is transactional
5. Mandatory fields behave as required by the CDS contract
6. Computed/read-only fields are not presented as editable inputs
7. Child tables behave correctly as editable or readonly per role and flow
8. Bound actions appear only for expected role and state

## When annotations are enough, and when they are not

Stay with annotations and service design for:
- Object page layout and facets
- List report columns and filters
- Bound actions
- Draft enablement
- Readonly vs editable behavior
- Value helps and code lists
- Role-specific projections and navigation targets

Escalate to a UI extension only when:
- FE standard behavior is confirmed and still not acceptable for the product UX
- A filter, dialog, or action flow cannot be made correct with service metadata and annotations alone
- The user explicitly wants behavior more custom than FE floorplans provide

Before proposing an extension, state clearly which FE behavior is standard and why annotations are no longer sufficient.

## Anti-patterns

- Stopping at backend work when the user asked for UI
- Generating `manifest.json` without checking the real service URI
- Trusting a generated `manifest.json` without verifying `mainService.uri` matches the actual endpoint
- Trying to fix missing FE create/edit behavior in `index.html` when the real issue is draft or capabilities in metadata
- Assuming Fiori Elements will work without useful annotations
- Moving business rules into the UI that belong in CAP
- Confusing static asset availability with full visual validation
- Treating Fiori preview as proof that the FE app is fully usable
