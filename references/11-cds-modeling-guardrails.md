# CDS Modeling Guardrails

Use this reference when the task is CDS-heavy: entities, views, projections, associations, compositions, aspects, annotations, or compiler errors.

## Views and projections

Prefer projections in services when:
- The service should expose a stable API over an internal persistence model
- The consumer only needs a subset of fields
- Names should be simplified or business-oriented
- Internal relationships should be hidden or redirected

Prefer a persistence view (in `db/`) only when the model itself really needs that derived shape — not just the API.

Practical rule:
- `db/*.cds` → domain and persistence semantics
- `srv/*.cds` → exposure and contract semantics

Do not expose a persistent entity directly just because it already exists.

## Associations vs compositions — choose deliberately

| Use | When |
|---|---|
| `composition` | The child belongs to the lifecycle of the parent aggregate |
| `association` | The target is reference or master data with its own independent lifecycle |

This choice matters beyond pure modeling:
- Draft create flows in Fiori Elements depend on **compositions** for child create — associations do not support this
- Deletion cascades differ
- `$expand` behavior is easier to reason about when the relationship matches the business lifecycle

Rules:
- "Items of a request" → likely a composition
- "Supplier of a product" → likely an association

Practical validation:
- If FE child create on the object page is required, test through the draft navigation path
- If create through draft navigation fails for an association, revisit the aggregate boundary in CDS rather than patching the UI

## Aspects — reduce duplication, align invariants

Good candidates for aspects:
- Technical keys and IDs
- Audit fields (use `managed` from `@sap/cds/common` instead of custom)
- Reusable status or validity fields
- Common business substructures reused in multiple entities

If the same group of fields appears twice, check whether an aspect should exist.

Do not create aspects just to be clever — use them when they reduce duplication or align invariants across entities.

## Local code lists and reusable catalogs

When FE needs a fixed-value or business-owned value help:

Good candidates:
- Assessment types, request categories, internal classifications, domain-owned statuses

Pattern:
```cds
using { sap } from '@sap/cds/common';

entity AssessmentTypes : sap.common.CodeList {
  key code        : String(20);
      criticality : Integer;
}
```

- Expose as a readonly projection in the service
- Consume from the FE root through an association and CDS annotations
- Use `Common.ValueListWithFixedValues: true`

Rule:
- Values belong to the application domain → model a local catalog
- Values belong to an external master-data domain → keep them as associations or external service catalogs

## Annotations — keep concerns in the right layer

| Layer | What belongs here |
|---|---|
| `db/*.cds` | Core domain semantics, `@assert.range`, `@mandatory` at domain level |
| `srv/*.cds` | Public-service semantics, `@readonly`, `@restrict`, `@requires` |
| `app/*.cds` | Fiori/UI semantics: `UI.*`, `Common.*` annotations |

Do not mix UI annotation concerns in `db/*.cds` or security concerns in `app/*.cds`.

## Compiler messages are modeling hints

When a CDS compiler error appears, use this sequence:
1. Identify whether the message is about name resolution, type mismatch, redirection, association targets, or annotation placement
2. Inspect `db/*.cds` and `srv/*.cds` before touching handlers
3. Check whether the service contract still matches the base entity after recent changes
4. Re-evaluate composition vs association if the issue is a relationship
5. Check whether an aspect is missing if the same field cluster keeps drifting

If the compiler complains about a relationship, the fix belongs in CDS, not in JavaScript.

## Projection aliases are scoped to the service that declares them

When a service projection declares a column alias (e.g., `status.code as statusCode`), that alias exists **only** within the projection of that service. A second service projecting the same base entity cannot reference the alias — it must navigate from the base entity's actual structure.

```cds
// SalesOrderService declares:
entity SalesOrderDrafts as projection on db.SalesOrderDrafts {
  status.code as statusCode   // alias exists only in SalesOrderService
}

// ComplianceService projects from the same base entity:
entity ComplianceEvaluations as projection on db.ComplianceEvaluations {
  order.status.code  as orderStatus  // ✅ navigate from base entity
  // order.statusCode as orderStatus  // ❌ alias not in scope here
};
```

Compiler error when this goes wrong:
```
[ERROR] Target entity "db.SalesOrderDrafts" has no element "statusCode"
```

Fix: always navigate from the base entity's actual element path, not from another service's projection alias.

## Redirections and exposed targets

When a service exposes an association:
- Verify the target is also exposed where needed
- Confirm the redirection is intentional
- Test the service contract with navigation or `$expand`

Typical failure:
- Base model has the association
- Service projection keeps the element
- But the exposed target is missing or mismatched
- FE or OData navigation behaves unexpectedly

## Implicit FK columns in explicit service projections

When a CDS entity has an `Association` (e.g., `template: Association to NotificationTemplate`), CDS auto-generates a FK column `template_ID` in the database. However, this FK is **implicit** — it does not exist as a named element in the base entity's CDS definition.

**Problem:** In a service projection with an explicit column list, referencing the implicit FK by name causes a compiler error:

```cds
// db/schema.cds
entity NotificationRule : cuid {
  template : Association to NotificationTemplate;  // generates template_ID implicitly
}

// srv/admin-service.cds — WRONG
entity NotificationRules as projection on db.NotificationRule {
  ID, entityName, toStatus, template_ID, template  // ← COMPILE ERROR: "Element 'template_ID' has not been found"
};
```

**Why:** In CDS, the implicit FK (`template_ID`) is accessible at the database level but not as a first-class named element in the domain model. Explicit projections can only reference elements that are declared in the source entity.

**Fix — use `excluding` to drop unwanted fields instead of listing the ones you want:**

```cds
// CORRECT — keep everything, exclude only what should not be exposed
entity MyNotifications as projection on db.NotificationLog
  excluding { errorMessage, activationKey };
```

This works because `*` (implied by `excluding`) expands after the implicit FKs are resolved. The `excluding` pattern is the idiomatic CAP way to hide specific fields from a projection without enumerating the entire column list.

**Rule:** If a projection needs to hide 1–3 fields from a large entity, prefer `excluding`. Only use an explicit column list when the projection genuinely needs fewer than half the fields OR when renaming/redirecting is required for those specific fields.

## Modeling checklist before closing a CDS task

- Should this be a projection instead of a direct exposure?
- Is this relationship really a composition or only an association?
- Is there a repeated field cluster that should be an aspect?
- Are annotations placed in the layer that owns the concern?
- Is the compiler error pointing to the model rather than to runtime code?

## Good defaults

- Start in CDS, then expose, then code handlers
- Prefer projections over leaking persistence
- Prefer compositions for owned children
- Prefer associations for master data and external references
- Use aspects to reduce duplication
- Let compiler messages steer you back to the model before touching handlers

## Gap descubierto — 2026-04-17

**Área:** [Modelado CDS] `case` es palabra reservada en CDS
**Síntoma:** CDS compiler error: `'case' is a reserved word - write '![case]' instead` en todas las entidades hijo (CaseApprovals, CaseAttachments, CaseComments, CaseEventLogs).
**Causa:** El campo de back-reference a la entidad padre se llamaba `case` — coincide con la keyword de JS/CDS.
**Fix aplicado:** Renombrar `case` → `caseRef` en todas las entidades hijo y en todas las cláusulas `on` de las Compositions. Actualizar `case_ID` → `caseRef_ID` en el handler JS.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-17

**Área:** [Modelado CDS] `sap.common.CodeList` tiene clave String(11) — incompatible con códigos largos
**Síntoma:** Códigos de estado como `PENDING_UNIT_APPROVAL` (21 chars) exceden el límite de 11 chars de `sap.common.CodeList`.
**Causa:** La definición de `CodeList` en `@sap/cds/common` usa `key code: String(11)`.
**Fix aplicado:** Definir aspecto personalizado `CatalogBase { key code: String(40); name: String(150); }` en lugar de extender `CodeList`. Eliminar import de `sap.common.CodeList`.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-17

**Área:** [Modelado CDS] `default` en Association es ilegal
**Síntoma:** `status: Association to CaseStatuses default 'DRAFT'` falla — CDS no soporta default directo en Associations sin FK explícita.
**Causa:** Las Associations en CDS no admiten `default` en la forma abreviada.
**Fix aplicado:** Eliminar `default 'DRAFT'` de la Association; establecer el estado inicial en el handler `before CREATE` vía `req.data.status_code ??= 'DRAFT'`.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-20

**Área:** Schema / Tipos CDS
**Síntoma:** Error de compilación `Mismatched 'enum'` al usar `@assert.range enum { }` inline en un campo
**Causa:** CAP CDS no soporta la sintaxis `field : Type @assert.range enum { ... }` inline. Las enumeraciones deben definirse como tipos explícitos separados.
**Fix aplicado:** Definir `type ContractStatus : String(20) enum { ... }` y usar el tipo en el campo.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-21

**Área:** [Fase 7 — UI] @assert.range enum en annotate bloque compilation
**Síntoma:** `cds build` fallaba con `Mismatched 'enum'` en `app/template-admin.cds`.
**Causa:** La sintaxis `@assert.range enum { Word; HTML; }` en bloque `annotate` es inválida. Los enum types en CDS se declaran en el modelo (`db/`), no en anotaciones inline.
**Fix aplicado:** Eliminar `@assert.range` — la validación de valores del motor se delega al handler si fuera necesaria.

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-22

**Área:** `@mandatory` vs custom handler validation en draft entities
**Síntoma:** Test `rejects blank title on activate` devolvía "400 - Provide the missing value." en vez de "title must not be blank". El test fallaba al verificar `/title/i` en el mensaje.
**Causa:** La anotación `@mandatory` en el CDS intercepta tanto strings vacíos como strings de solo espacios durante `draftActivate`, con un mensaje genérico de CAP que no nombra el campo. El handler custom `before('SAVE')` nunca llega a ejecutarse para ese campo porque `@mandatory` lanza el error primero.
**Fix aplicado:** Eliminar `@mandatory` del campo `title` en el CDS y dejar que el handler propio gestione toda la validación con mensajes de dominio específicos.
**Regla generalizable:** No combinar `@mandatory` con validación custom en el handler para el mismo campo — elige uno. Si necesitas mensajes de error específicos, no uses `@mandatory`; si solo necesitas presencia, usa `@mandatory` sin handler. Si testeas mensajes custom, usa strings de solo espacios (`'   '`) para bypasear `@mandatory` (que solo intercepta `''` y `null`). Pero lo más limpio es omitir `@mandatory` y dejar el handler como único punto de validación.

> Añadido desde cap-acc build — 2026-04-22.
