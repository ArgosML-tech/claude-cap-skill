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

---

## Patrones avanzados de modelado CDS (SAP BTP Developer Guide)

### Elementos calculados (Calculated Elements)

```cds
entity Customers : managed {
  key ID    : String;
  firstName : String;
  lastName  : String;
  name      : String = trim(firstName || ' ' || lastName);  // computed, stored
  email     : EMailAddress;
}
type EMailAddress : String;
type PhoneNumber  : String;
```

- Los elementos calculados se evalúan en la DB y no se almacenan por separado.
- Se referencian como cualquier campo en queries, projections, etc.
- Sintaxis: `field : Type = <expression>`.

### `@assert.format` para validación por regex

```cds
creditCardNo : String(16) @assert.format: '^[1-9]\d{15}$';
```

CAP valida automáticamente el valor contra la regex en CREATE y UPDATE. Si no cumple, devuelve 400.

### `type of managed` — referencias a tipos de aspectos

```cds
entity Incidents : cuid, managed {
  conversation : Composition of many {
    key ID    : UUID;
    timestamp : type of managed : createdAt;  // mismo tipo que el campo createdAt de managed
    author    : type of managed : createdBy;
    message   : String;
  };
}
```

`type of <aspect> : <field>` extrae el tipo de un campo de un aspecto/entidad existente. Útil para consistencia semántica sin duplicar definiciones de tipo.

### Composición inline anónima y CSV

```cds
entity Incidents : cuid, managed {
  conversation : Composition of many {
    key ID    : UUID;
    author    : String;
    message   : String;
  };
}
```

CSV para la composición inline: el archivo se llama `<namespace>-Incidents.conversation.csv` y usa `up__ID` como FK al padre:

```csv
ID,up__ID,author,message
2b23bb4b-...,3b23bb4b-...,Alice,First message
```

### `sap.common.CodeList` con enums, criticality y localización

```cds
using { sap.common.CodeList } from '@sap/cds/common';

entity Status : CodeList {
  key code        : String enum {
        new        = 'N';
        in_process = 'I';
        resolved   = 'R';
        closed     = 'C';
      };
      criticality : Integer;  // usado por Fiori para coloreado semántico (1=error, 2=warning, 3=success)
}

entity Urgency : CodeList {
  key code : String enum {
        high   = 'H';
        medium = 'M';
        low    = 'L';
      };
}
```

- `CodeList` de `@sap/cds/common` añade `name`, `descr` y soporte i18n automático.
- `cds add data` genera también `Status.texts.csv` y `Urgency.texts.csv` — se dejan vacíos hasta tener traducciones.
- Asociación desde la entidad padre: `status : Association to Status default 'N'`.
- CSV de CodeList: columnas `code,descr,criticality` (sin `name`, que es alias de `descr`).

### `@PersonalData` para GDPR / Audit Logging automático

```cds
// srv/data-privacy.cds — en archivo separado para separar concern
annotate Customers with @PersonalData: {
  EntitySemantics: 'DataSubject',
  DataSubjectRole: 'Customer',
} {
  ID           @PersonalData.FieldSemantics: 'DataSubjectID';
  firstName    @PersonalData.IsPotentiallyPersonal;
  lastName     @PersonalData.IsPotentiallyPersonal;
  email        @PersonalData.IsPotentiallyPersonal;
  creditCardNo @PersonalData.IsPotentiallySensitive;
}

annotate Addresses with @PersonalData: {
  EntitySemantics: 'DataSubjectDetails'
} {
  customer      @PersonalData.FieldSemantics: 'DataSubjectID';
  city          @PersonalData.IsPotentiallyPersonal;
  streetAddress @PersonalData.IsPotentiallyPersonal;
}
```

Con `@cap-js/audit-logging` instalado, estas anotaciones activan audit logging automático de lecturas y modificaciones de datos personales. Ver `references/13-btp-plugins-services.md`.

### `@odata.draft.enabled` via annotate en archivo de servicio (no inline)

El patrón recomendado es separar la anotación del modelo de servicio:

```cds
// srv/services.cds
service ProcessorService {
  entity Incidents as projection on my.Incidents;
}

// Separado — permite controlar draft por servicio sin tocar el modelo
annotate ProcessorService.Incidents with @odata.draft.enabled;
annotate ProcessorService with @(requires: 'support');
```

Esto permite que la misma entidad tenga draft en un servicio y no en otro.

### `cds add data` — generar plantillas CSV

```bash
cds add data
```

Genera archivos CSV vacíos en `db/data/` para todas las entidades, con cabeceras correctas. Útil como punto de partida para seed data. Los archivos `.texts.csv` (para CodeList i18n) se dejan vacíos hasta tener traducciones.

## Gap descubierto — 2026-04-23

**Área:** Modelo / Servicio CDS
**Síntoma:** `cds build` falla con "can't auto-redirect" al exponer la misma entidad dos veces en un servicio
**Causa:** `CandidatePairs` y `ReviewablePairs` eran dos proyecciones de `mas.CandidatePairs` — CAP no puede resolver redirecciones de asociaciones cuando hay ambigüedad
**Fix aplicado:** fusionar ambas en una sola entidad `CandidatePairs` con `@readonly` + `actions {}`

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.
