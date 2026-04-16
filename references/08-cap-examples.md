# Practical SAP CAP examples

Adapt these to the real namespace, service names, runtime, and repo conventions.

---

## CDS: projections and field control

```cds
namespace my.bookshop;

entity Books {
  key ID        : UUID;
      title     : String(200);
      stock     : Integer;
      costPrice : Decimal(9,2);   // internal — not exposed
}

service CatalogService {
  entity Books as projection on my.bookshop.Books {
    ID,
    title,
    stock
    // costPrice intentionally excluded
  };
}
```

---

## CDS: associations and compositions

```cds
namespace my.store;

entity Categories {
  key ID   : UUID;
      name : String(80);
      items : Association to many Products on items.category = $self;
}

entity Products {
  key ID       : UUID;
      title    : String(100);
      category : Association to Categories;
      reviews  : Composition of many ProductReviews on reviews.product = $self;
}

entity ProductReviews {
  key ID      : UUID;
      product : Association to Products;
      rating  : Integer;
      comment : String(500);
}

service CatalogService {
  entity Categories     as projection on my.store.Categories;
  entity Products       as projection on my.store.Products;
  entity ProductReviews as projection on my.store.ProductReviews;
}
```

Validate: `GET /odata/v4/CatalogService/Products?$expand=category,reviews`

---

## CDS: local code list for FE value help

```cds
using { sap } from '@sap/cds/common';

entity AssessmentTypes : sap.common.CodeList {
  key code        : String(20);
      criticality : Integer;
}

entity SupplierRiskReviews {
  key ID             : UUID;
      assessmentType : Association to AssessmentTypes;
}

service RiskService {
  entity SupplierRiskReviews as projection on my.risk.SupplierRiskReviews;

  @readonly
  entity AssessmentTypes as projection on my.risk.AssessmentTypes;
}
```

```cds
annotate RiskService.SupplierRiskReviews with {
  assessmentType_code @mandatory @(
    Common.ValueListWithFixedValues : true,
    Common.ValueList : {
      CollectionPath : 'AssessmentTypes',
      Parameters : [
        { $Type : 'Common.ValueListParameterInOut',
          LocalDataProperty : assessmentType_code,
          ValueListProperty : 'code' },
        { $Type : 'Common.ValueListParameterDisplayOnly',
          ValueListProperty : 'name' }
      ]
    }
  );
}
```

---

## Actions and functions: CDS + handler

```cds
service CatalogService {
  entity Books as projection on my.bookshop.Books;

  action   submitOrder(book : UUID, quantity : Integer) returns String;
  function stockFor(book : UUID) returns Integer;
}
```

```js
const cds = require('@sap/cds')

module.exports = cds.service.impl(function () {
  this.on('stockFor', async req => {
    const { book } = req.data
    const row = await SELECT.one.from('my.bookshop.Books').where({ ID: book })
    if (!row) req.reject(404, 'Book not found')
    return row.stock
  })

  this.on('submitOrder', async req => {
    const { book, quantity } = req.data
    if (!quantity || quantity <= 0) req.reject(400, 'Quantity must be positive')

    const tx = cds.transaction(req)
    const row = await tx.run(SELECT.one.from('my.bookshop.Books').where({ ID: book }))
    if (!row) req.reject(404, 'Book not found')
    if (row.stock < quantity) req.reject(409, 'Insufficient stock')

    await tx.run(
      UPDATE('my.bookshop.Books').set({ stock: row.stock - quantity }).where({ ID: book })
    )
    return 'Order accepted'
  })
})
```

---

## Declarative security

```cds
service AdminService @(requires: 'Admin') {
  entity Books as projection on my.bookshop.Books;
}

annotate AdminService.Books with @restrict: [
  { grant: 'READ',                to: 'Viewer' },
  { grant: ['READ', 'WRITE'],     to: 'Editor' }
];
```

### Instance-level restriction with `managed`

```cds
using { managed } from '@sap/cds/common';

entity ProductReviews : managed {
  key ID   : UUID;
      text : String;
}

annotate CatalogService.ProductReviews with @restrict: [
  { grant: 'READ',             to: ['admin', 'cds.ExtensionDeveloper'] },
  { grant: 'CREATE',           to: ['admin', 'cds.ExtensionDeveloper'] },
  { grant: ['UPDATE','DELETE'], to: 'admin' },
  { grant: ['UPDATE','DELETE'], to: 'cds.ExtensionDeveloper', where: 'createdBy = $user' }
];
```

---

## Testing: standard style (node:test + assert.strict)

```js
const cds = require('@sap/cds')
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

describe('CatalogService', () => {
  const app = cds.test(__dirname + '/..')

  it('lists books', async () => {
    const { data } = await app.get('/odata/v4/CatalogService/Books')
    assert.equal(Array.isArray(data.value), true)
  })

  it('rejects invalid submitOrder', async () => {
    const res = await app.post('/odata/v4/CatalogService/submitOrder', {
      book: '00000000-0000-0000-0000-000000000001',
      quantity: 0
    })
    assert.ok(res.status >= 400)
  })
})
```

### Auth test with mocked users

```js
describe('AdminService auth', () => {
  const app = cds.test(__dirname + '/..')

  it('forbids non-admin users', async () => {
    const res = await app
      .as({ id: 'alice', roles: ['Viewer'] })
      .post('/odata/v4/AdminService/Books', { title: 'Test' })
    assert.equal(res.status, 403)
  })

  it('allows admin users', async () => {
    const res = await app
      .as({ id: 'bob', roles: ['Admin'] })
      .get('/odata/v4/AdminService/Books')
    assert.equal(res.status, 200)
  })
})
```

---

## Draft-enabled entities

```cds
using { cuid, managed } from '@sap/cds/common';

entity Orders : cuid, managed {
  customerName : String(100);
  status       : String(30);
  items        : Composition of many OrderItems on items.order = $self;
}

entity OrderItems : cuid, managed {
  order    : Association to Orders;
  product  : String(100);
  quantity : Integer;
}

service SalesService {
  @odata.draft.enabled
  entity Orders as projection on my.sales.Orders;
}
```

### CDS annotations for draft root

```cds
annotate SalesService.Orders with {
  customerName @mandatory;
  status       @readonly;
}
```

### Draft lifecycle test

```js
it('creates, activates, and reads a draft order', async () => {
  const created = await app.post('/odata/v4/SalesService/Orders', {
    customerName: 'Draft Corp', status: 'Open'
  })
  assert.equal(created.data.IsActiveEntity, false)

  const activated = await app.post(
    `/odata/v4/SalesService/Orders(ID=${created.data.ID},IsActiveEntity=false)/SalesService.draftActivate`,
    {}
  )
  assert.equal(activated.data.IsActiveEntity, true)

  const readBack = await app.get(
    `/odata/v4/SalesService/Orders(ID=${created.data.ID},IsActiveEntity=true)`
  )
  assert.equal(readBack.status, 200)
  assert.equal(readBack.data.customerName, 'Draft Corp')
})
```

---

## Bound action on draft and active entities

```cds
@odata.draft.enabled
entity OrderRequests as projection on my.store.OrderRequests actions {
  action setProcessingStatus(status : String(30)) returns OrderRequests;
};
```

```js
const applyStatus = async req => {
  const tx = cds.transaction(req)
  await tx.run(UPDATE(req.subject).set({ status: req.data.status }))
  return tx.run(SELECT.one.from(req.subject))
}

this.on('setProcessingStatus', 'OrderRequests', applyStatus)
this.on('setProcessingStatus', 'OrderRequests.drafts', applyStatus)
```

FE annotation to render the action button:

```cds
annotate SalesService.OrderRequests with @(
  UI.LineItem : [
    { Value : customerName },
    { Value : status },
    { $Type  : 'UI.DataFieldForAction',
      Action : 'SalesService.setProcessingStatus',
      Label  : 'Set Status' }
  ]
);
```

---

## NEW handler overwrites POST payload fields

The `before('NEW', ...)` handler runs before the draft is created. Any field you assign directly to `req.data` in the NEW handler **overwrites** the field value the client sent in the POST body. This is a common trap when setting default values:

```js
// TRAP — overwrites any netAmount the client sends in the POST
this.before('NEW', 'OrderRequests.drafts', req => {
  req.data.status = 'Draft'
  req.data.netAmount = 0   // ← client's netAmount is silently discarded
})

// CORRECT — only set defaults for fields the client didn't provide
this.before('NEW', 'OrderRequests.drafts', req => {
  req.data.status = 'Draft'
  if (req.data.netAmount == null) req.data.netAmount = 0   // ← preserve client value
})
```

Consequence in tests: if the NEW handler zeroes out `netAmount`, a draft created via POST with a large amount will have `netAmount = 0` until an explicit PATCH is made. A handler that runs on PATCH (e.g., for risk recalculation) will NOT run at creation time — an extra PATCH is needed to trigger it.

## Draft-specific event handlers

Beyond the standard `draftActivate`, CAP fires dedicated events at each step of the draft lifecycle. Register handlers on these when you need to intercept or validate at a specific point:

```js
class OrderRequestService extends cds.ApplicationService {
  init() {
    // When a user starts a brand-new draft
    this.before('NEW', 'OrderRequests.drafts', req => {
      req.data.status = 'Draft'
    })

    // When a user starts editing an existing active entity
    // Note: register on the active entity, NOT on .drafts
    this.before('EDIT', 'OrderRequests', req => {
      console.log('Editing started for', req.params[0])
    })

    // Field-level edit (alias for UPDATE on draft)
    this.before('PATCH', 'OrderRequests.drafts', req => {
      // validate incremental field changes
    })

    // Just before the draft is activated (saved)
    this.before('SAVE', 'OrderRequests.drafts', req => {
      if (!req.data.customerName) req.reject(400, 'Customer name is required before saving')
    })

    // When a user discards a draft
    this.before('DISCARD', 'OrderRequests.drafts', req => {
      console.log('Draft discarded')
    })

    return super.init()
  }
}
```

Summary of draft events:

| Event | Fires when | Register on |
|---|---|---|
| `NEW` | User creates a new draft | `Entity.drafts` |
| `EDIT` | User starts editing an active entity | Active entity (not `.drafts`) |
| `PATCH` | Field-level edit in draft mode | `Entity.drafts` |
| `SAVE` | Draft activation (before `draftActivate` completes) | `Entity.drafts` |
| `DISCARD` / `CANCEL` | User discards the draft | `Entity.drafts` |

Programmatic draft APIs (when you need to trigger draft operations from handler code):

```js
await srv.new(OrderRequests.drafts, data)      // create a new draft
await srv.edit(OrderRequests, { ID: id })       // open existing entity for editing
await srv.save(OrderRequests.drafts, { ID: id }) // activate (save) a draft
await srv.discard(OrderRequests.drafts, { ID: id }) // discard a draft
```

---

## Querying composition children inside a SAVE handler

**Critical pattern**: When a draft-enabled root has composition children (e.g., order items), those items are stored in a **service-prefixed shadow table** during draft mode — NOT in the active entity table. Querying the active entity inside `before('SAVE')` returns 0 rows.

Shadow entity naming convention:
- Table: `ServiceName_ChildEntityName_drafts`
- CDS entity: `ServiceName.ChildEntityName.drafts`

```js
// WRONG — queries the active items table, returns 0 rows during SAVE
const items = await SELECT.from(SalesOrderDraftItems).where({ order_ID: ID })

// CORRECT — queries the draft shadow table using the fully-qualified service entity name
const items = await SELECT.from('SalesOrderService.SalesOrderDraftItems.drafts')
  .where({ order_ID: ID })
```

Also note: in the `before('SAVE')` handler, the entity key is in `req.data.ID`, not in `req.params`:

```js
this.before('SAVE', SalesOrderDrafts.drafts, async req => {
  const ID = req.data?.ID  // ✅ use req.data.ID in SAVE
  // const { ID } = req.params?.[0]  // ❌ req.params may be undefined in SAVE
})
```

To confirm shadow table names before writing handlers, run `cds deploy --to sqlite` and inspect `sqlite_master`:
```js
db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
// → shows ServiceName_ChildName_drafts tables
```

---

## Inserting composition children in draft mode

In draft mode, composition children can **only** be created via navigation from the root draft entity. Direct POST to the child entity set is rejected with 403.

```
// CORRECT — navigate from the draft root
POST /api/sales/SalesOrderDrafts(ID=...,IsActiveEntity=false)/items
{ materialID: 'MAT-001', quantity: 2, unitPrice: 500 }

// WRONG — direct POST to child entity set
POST /api/sales/SalesOrderDraftItems
{ order_ID: '...', materialID: 'MAT-001', quantity: 2 }
// → 403: A draft-enabled entity can only be modified via its root entity
```

In tests, always use the navigation path when working with composition children under a draft root.

---

## Class-based handler (modern style)

The official CAP documentation promotes the class style for new projects. Use whichever style the repo already follows:

```js
const cds = require('@sap/cds')

class CatalogService extends cds.ApplicationService {
  init() {
    const { Books } = this.entities

    this.before('CREATE', Books, req => {
      if (!req.data.title?.trim()) req.reject(400, 'Title is required', 'title')
    })

    this.after('READ', Books, results => results.forEach(book => {
      if (book.stock > 111) book.discount = '11%'
    }))

    this.on('submitOrder', async req => {
      const { book, quantity } = req.data
      if (!quantity || quantity <= 0) req.reject(400, 'Quantity must be positive')
      const tx = cds.transaction(req)
      const row = await tx.run(SELECT.one.from(Books).where({ ID: book }))
      if (!row) req.reject(404, 'Book not found')
      if (row.stock < quantity) req.reject(409, 'Insufficient stock')
      await tx.run(UPDATE(Books).set({ stock: row.stock - quantity }).where({ ID: book }))
      return 'Order accepted'
    })

    return super.init()  // always call super.init()
  }
}

module.exports = { CatalogService }
```

---

## SQL injection safety

```js
const input = req.data.id

// SAFE — tagged template (no parentheses)
SELECT.from `Books` .where `ID = ${input}`

// SAFE — query-by-example object
SELECT.from(Books).where({ ID: input })

// UNSAFE — parentheses convert template to regular string
SELECT.from `Books` .where (`ID = ${input}`)   // ← not a tagged template

// UNSAFE — string concatenation
SELECT.from `Books` .where ('ID = ' + input)   // ← SQL injection risk
```

Never use string concatenation in query conditions. Never wrap tagged template strings in parentheses.

---

## Idiomatic CAP queries

```js
// Single row
const row = await SELECT.one.from('my.bookshop.Books').where({ ID: book })

// Collection with filter and sort
const results = await cds.transaction(req).run(
  SELECT.from('my.bookshop.Books')
    .columns('ID', 'title', 'stock')
    .where({ stock: { '>': 0 } })
    .orderBy('stock desc')
    .limit(10)
)

// Late materialization — single database roundtrip
const authorIds = SELECT `ID` .from `Authors` .where `name like ${'%Brontë%'}`
const books = await SELECT.from `Books` .where `author_ID in ${authorIds}`

// UPSERT
await UPSERT([{ ID: 201, title: 'Wuthering Heights', stock: 12 }]).into('my.bookshop.Books')
```

Only consider raw SQL if:
- CAP does not cover the case
- The database requires a specific capability
- You clearly document the resulting coupling

---

## Choosing an example

| Task | Start from |
|---|---|
| Public API change | CDS projections |
| Business operation | Action or function |
| Access or restriction | `@requires` / `@restrict` |
| Non-trivial logic | `cds.test` test |
| Draft entity | Draft lifecycle test |
| External service | Mocked external pattern (see `references/10-cap-external-services.md`) |
