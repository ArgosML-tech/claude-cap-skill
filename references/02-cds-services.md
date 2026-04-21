# CDS and services: practical checklist

## CDS foundations

CDS is the foundation for:
- Entities and types
- Associations and compositions
- Queries and projections
- Expressions and constraints
- Annotations
- Service contracts

## When to use projections

Use a service projection when you want to:
- Expose a subset of the model
- Rename or simplify the API surface
- Avoid coupling the service to internal persistence
- Control which associations or fields are exposed

## Associations vs compositions in service contracts

When the domain model contains associations or compositions:
- Decide explicitly which relationships belong in the public service contract
- Expose only the relationships consumers actually need
- Do not assume every internal relationship should become public API

Rule of thumb:
- Expose **associations** when the consumer needs navigable related master data
- Expose **compositions** when the consumer needs the child lifecycle as part of the aggregate contract

## Validating exposed relationships

When a service exposes associations or compositions:
- Validate the projection, not only the base entity
- Test the exposed contract with `?$expand=...`
- Confirm that related entities are also exposed in the same service when needed

Typical failure pattern:
- Model the relationship correctly in `db/*.cds`
- Forget to expose or align it in `srv/*.cds`
- Assume OData navigation will still behave as expected

## Services as usage contracts

- **Service** = contract for consumers
- **Domain model** = internal semantics
- **Handler** = exception or targeted extension

Design services as use-case APIs, not as mechanical mirrors of the physical model.

## Generic providers

If the service fits standard behavior, CAP covers automatically:
- CRUD
- Search (`$search`)
- Pagination (`$top`, `$skip`)
- Basic input validation

Do not reimplement these in handlers unless there is a clear business reason.

## Actions and functions

Use them when the case does not fit pure CRUD.

- `action` → has side effects (persists or changes state)
- `function` → pure read or calculation, no side effects

Typical action examples:
- Approve a document
- Recalculate a status
- Execute a cross-cutting business operation

## Minimal modeling example

```cds
namespace my.bookshop;

entity Books {
  key ID    : UUID;
      title : String(200);
      stock : Integer;
}

service CatalogService {
  entity Books as projection on my.bookshop.Books;
  action submitOrder(book : UUID, quantity : Integer) returns String;
}
```

## Service-only (virtual) fields

If a service needs to return a computed value that does not exist in persistence:
- Declare it as a `virtual` element or service-only element
- Do not model it like a real column of the persistent entity
- Validate that the generated SQL does not try to read that column

Risk pattern:
```cds
// WRONG — priceCategory is not persisted
extend projection CatalogService.Products with {
  priceCategory : String  // missing @Core.Computed or virtual
}
```

CAP may generate SQL that tries to read `priceCategory` from the underlying table and fail with `no such column`.

Fix: annotate as `@Core.Computed` or use `virtual priceCategory : String` in the base entity.

## Auto-exposing entities with `@cds.autoexpose`

Use `@cds.autoexpose` when an entity should be automatically included in any service that references it through an association — typically used for shared code lists and value catalogs:

```cds
@cds.autoexpose
@readonly
entity Genres : sap.common.CodeList {
  key ID : Integer;
}

entity Books {
  genre : Association to Genres;
}

// Any service that exposes Books will automatically include Genres
service CatalogService {
  entity Books as projection on my.bookshop.Books;
  // Genres is auto-exposed as @readonly — no need to declare it explicitly
}
```

Auto-exposed entities are always read-only (`@readonly`). Explicitly auto-exposed entities (via `@cds.autoexpose`) can be accessed directly. Implicitly auto-exposed entities (compositions) can only be reached via navigation paths.

## When to model an action

Use an `action` when the operation:
- Expresses a clear domain intent
- Does not fit well as generic CREATE, UPDATE, or DELETE
- Needs its own parameters
- May involve transactional logic or business-specific rules

Example: applying a discount → better modeled as `discountProduct(percent)` than a PATCH.

## Action validation in tests

When validating an action:
1. Execute the action
2. Perform a follow-up GET
3. Validate the final observable state

Do not depend solely on the immediate action response containing every virtual or enriched field.

## Gap descubierto — 2026-04-16

**Área:** G6 — validate-metadata.js no resuelve correctamente paths de servicios con acrónimos todo-mayúsculas
**Síntoma:** El script transforma `BERService` → `b-e-r` en lugar de `ber` al derivar el service slug para `$metadata`
**Causa:** El regex de conversión PascalCase-to-kebab trata cada letra de un acrónimo como una palabra separada
**Fix aplicado:** Verificación manual de `$metadata` vía `curl`. El endpoint `/odata/v4/ber/$metadata` es correcto y retorna 200 con todas las entidades y acciones

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-19

**Área:** G2 — redirection target requerido con dos proyecciones sobre la misma entidad
**Síntoma:** CDS compilation error "can't auto-redirect" al tener `ExtractionScenarios` y `ScenarioActions` como dos proyecciones sobre `db.ExtractionScenario` en el mismo servicio
**Causa:** CAP no puede resolver automáticamente el destino de redirections de asociaciones cuando hay dos proyecciones sobre la misma entidad base en el mismo servicio
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-19

**Área:** G3 — return types de acciones bound deben referenciar proyecciones del servicio
**Síntoma:** CDS error "No artifact has been found with name ExtractionRun" en `returns ExtractionRun`
**Causa:** las acciones bound deben referenciar las entidades como se llaman dentro del servicio (proyecciones), no el nombre del dominio (`ExtractionRun` no existe en el servicio; existe `ExtractionRuns`)
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-19

**Área:** G4 — S4Mock entities con @cds.persistence.exists no se despliegan en SQLite
**Síntoma:** `totalExtracted = 0` en todos los tests de runExtraction. Los registros de S4Mock no se cargaban aunque los CSVs existían.
**Causa:** las entidades en `srv/external/s4-mock.cds` tenían `@cds.persistence.exists` — esta anotación indica a CAP que la entidad existe en un DB externo, NO la despliega en SQLite, y NO carga los CSVs de `srv/external/data/`
**Fix aplicado:** (see build-log for details)

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.

## Gap descubierto — 2026-04-21

**Área:** [Servicio CDS] Sintaxis incorrecta para bound action en proyección
**Síntoma:** CDS compiler: `Element "action" has not been found in entity:UploadService.DataStaging/column:processUpload`
**Causa:** La sintaxis `entity E as projection on db.E { action foo() ... }` no es válida. Las acciones bound no van dentro del cuerpo de columnas.
**Fix aplicado:** Usar el bloque `actions { }` separado: `entity E as projection on db.E actions { action foo() returns String; };`

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.
