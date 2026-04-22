# CAP BTP Plugins y Servicios Gestionados

Plugins oficiales de `@cap-js` que se integran automáticamente en el runtime CAP mediante el mecanismo `cds-plugin`. Instalar + anotar el modelo = funcionalidad activada, sin wiring manual.

---

## `@cap-js/audit-logging` — Audit Log automático

### Instalación

```bash
npm add @cap-js/audit-logging
```

Auto-detectado como plugin. En local, escribe al console. En producción, conecta al SAP Audit Log Service (configurar en `package.json` via VCAP).

### Anotaciones `@PersonalData` — GDPR compliance

Separar en un archivo dedicado `srv/data-privacy.cds`:

```cds
using { sap.capire.incidents as my } from './services';

// DataSubject — la persona cuyos datos se gestionan
annotate my.Customers with @PersonalData: {
  EntitySemantics: 'DataSubject',
  DataSubjectRole: 'Customer',
} {
  ID           @PersonalData.FieldSemantics: 'DataSubjectID';
  firstName    @PersonalData.IsPotentiallyPersonal;
  lastName     @PersonalData.IsPotentiallyPersonal;
  email        @PersonalData.IsPotentiallyPersonal;
  phone        @PersonalData.IsPotentiallyPersonal;
  creditCardNo @PersonalData.IsPotentiallySensitive;  // nivel más alto — audit en cada lectura
}

// DataSubjectDetails — entidad relacionada que también tiene datos del sujeto
annotate my.Addresses with @PersonalData: {
  EntitySemantics: 'DataSubjectDetails'
} {
  customer      @PersonalData.FieldSemantics: 'DataSubjectID';  // FK al DataSubject
  city          @PersonalData.IsPotentiallyPersonal;
  postCode      @PersonalData.IsPotentiallyPersonal;
  streetAddress @PersonalData.IsPotentiallyPersonal;
}
```

**Semánticas de `EntitySemantics`:**
- `DataSubject` — la entidad principal de la persona (típicamente el "Customer")
- `DataSubjectDetails` — entidades relacionadas con datos de la misma persona

**Semánticas de campo:**
- `DataSubjectID` — clave que identifica al sujeto
- `IsPotentiallyPersonal` — campo personal (nombre, email, teléfono) → audit en modificación
- `IsPotentiallySensitive` — campo sensible (tarjeta, salud) → audit en CADA LECTURA

### Qué genera automáticamente

| Operación | Audit log generado |
|---|---|
| `READ` con `IsPotentiallySensitive` | `SensitiveDataRead` |
| `CREATE` / `UPDATE` con `IsPotentiallyPersonal` | `PersonalDataModified` |
| `DELETE` de DataSubject | `PersonalDataDeleted` |

### Audit log personalizado en `server.js`

Para eventos no cubiertos automáticamente (ej. 403 Forbidden):

```js
// server.js — en la raíz del proyecto CAP
const cds = require('@sap/cds')
let audit

cds.on('served', async () => {
  audit = await cds.connect.to('audit-log')
})

cds.on('bootstrap', app => {
  app.use((req, res, next) => {
    req.on('close', () => {
      if (res.statusCode === 403) {
        audit.tx(async () => {
          await audit.log('SecurityEvent', {
            data: {
              user: cds.context.user?.id || 'unknown',
              action: `Unauthorized access to "${req.originalUrl}"`
            },
            ip: req.ip
          })
        })
      }
    })
    next()
  })
})

module.exports = cds.server  // obligatorio
```

---

## `@cap-js/change-tracking` — Change Tracking automático

### Instalación

```bash
npm add @cap-js/change-tracking
```

Plugin auto-detectado. Genera entidad `Changes` y la expone en el servicio donde está configurado.

### Anotaciones `@changelog`

```cds
// En el archivo de servicios o en un archivo separado de anotaciones
annotate ProcessorService.Incidents with @changelog: {
  keys: [ customer.name, createdAt ]  // campos que identifican el contexto del cambio
} {
  title    @changelog;
  status   @changelog;
  customer @changelog: [ customer.name ];  // expandir el valor del campo relacionado
};

annotate ProcessorService.Incidents.conversation with @changelog: {
  keys: [ author, timestamp ]
} {
  message  @changelog;
}
```

**`keys`:** campos de contexto que aparecen en el log junto al cambio (ej. nombre del cliente, fecha). No son PKs — son "display keys" para que el log sea legible.

### Qué genera automáticamente

- Entidad `ChangeView` o similar expuesta en el servicio
- Registro de OLD/NEW value en cada `UPDATE` de campos anotados con `@changelog`
- Visible en el Object Page de Fiori en sección "Change History"

---

## `@cap-js/attachments` — Gestión de adjuntos

### Instalación

```bash
npm add @cap-js/attachments
```

### Uso en modelo

```cds
using { Attachments } from '@cap-js/attachments';

extend entity Incidents with {
  attachments : Composition of many Attachments;
}
```

El plugin maneja upload/download/delete contra SAP Object Store (en producción) o filesystem (en local).

---

## Resumen de plugins `@cap-js`

| Plugin | npm | Anotación principal | Qué activa |
|---|---|---|---|
| Audit logging | `@cap-js/audit-logging` | `@PersonalData` | Audit automático GDPR |
| Change tracking | `@cap-js/change-tracking` | `@changelog` | Historial de cambios |
| Attachments | `@cap-js/attachments` | `Composition of many Attachments` | Upload/download de ficheros |
| HANA | `@cap-js/hana` | (ninguna) | DB HANA en producción |
| SQLite | `@cap-js/sqlite` | (ninguna) | DB SQLite en desarrollo |

Todos son **cds-plugins** — se activan solo con instalarlos, sin configuración adicional en la mayoría de casos.
