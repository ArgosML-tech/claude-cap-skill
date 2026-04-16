# Spec intake: de especificación a plan de build

> Leer este archivo cuando el usuario proporcione una especificación de proyecto CAP completa
> (no una tarea puntual). Una especificación puede ser: un enunciado de requisitos, un documento
> de diseño, una lista de entidades y reglas de negocio, o una descripción de dominio.

---

## Señales de que recibes una especificación (no una tarea puntual)

- El mensaje describe un dominio completo, no un cambio concreto
- Menciona múltiples entidades, roles, o servicios
- Incluye reglas de negocio, flujos de aprobación, o integraciones
- No hay un proyecto CAP existente que modificar
- El usuario dice "constrúyelo", "impleméntalo completo", o similar

Si no estás seguro: comprueba si hay un proyecto CAP ya existente en el directorio de trabajo
con `package.json` que contenga `@sap/cds`. Si existe, es una tarea puntual sobre un proyecto
existente — usa el flujo estándar. Si no existe, es una spec de proyecto nuevo.

---

## Fase 0: extracción de la spec

Antes de escribir una sola línea de código, extrae de la especificación las siguientes categorías.
Si algo no está en la spec, aplica el catálogo de decisiones por defecto (ver `01-cap-core.md`).

### 0.1 Dominio y namespace

- ¿Cuál es el nombre del proyecto / dominio?
- Derivar el namespace CDS: `com.<dominio>` (todo minúsculas, sin guiones)
- Derivar el nombre del paquete npm: `<dominio>-app` o el que indique la spec

### 0.2 Entidades del dominio

Para cada entidad identificada en la spec, extraer:
- Nombre (sustantivo singular, PascalCase)
- Campos con tipo CDS aproximado
- Relaciones con otras entidades (¿es una composición de ciclo de vida o una referencia?)
- Si es draft-enabled (¿el usuario crea y edita registros de forma incremental antes de confirmar?)
- Si es un code list (@cds.autoexpose @readonly — valores fijos de catálogo)

**Ordenar las entidades por dependencia:**
1. Code lists primero (no dependen de nada)
2. Entidades maestras (RiskProfiles, etc.)
3. Entidades principales con composiciones
4. Entidades hijo (items, evaluaciones — composición children)

### 0.3 Roles de usuario

Para cada rol en la spec:
- Nombre del rol (PascalCase, sin espacios)
- Qué entidades puede leer / crear / modificar / eliminar
- Si tiene restricciones de instancia (e.g. solo sus propios registros, solo su salesOrg)
- Si puede ejecutar acciones específicas

### 0.4 Servicios

Regla por defecto: un servicio por cluster de roles con responsabilidades similares.
- Si dos roles tienen acceso a entidades completamente distintas → servicios separados
- Si comparten las mismas entidades con distintos permisos → mismo servicio con @restrict

Para cada servicio identificar:
- Nombre (PascalCase + "Service")
- Path OData (`/api/<nombre-en-minúsculas>`)
- Roles que requiere (`@requires`)
- Entidades que expone

### 0.5 Acciones y funciones

Para cada operación de dominio que NO encaja en CRUD estándar:
- ¿Es una acción (modifica estado, POST) o función (solo lectura, GET)?
- ¿Es bound (sobre una instancia) o unbound (sobre el servicio)?
- Qué estado transiciona (si aplica)
- Qué roles la pueden ejecutar
- Si requiere un campo virtual para @Core.OperationAvailable en Fiori Elements

### 0.6 Reglas de negocio

Para cada regla:
- ¿Se puede expresar como anotación CDS (`@assert.unique`, `@mandatory`, `@assert.range`)?
- ¿Requiere un handler (`before CREATE`, `before SAVE`, etc.)?
- ¿Bloquea el flujo (req.reject) o solo advierte?

### 0.7 Integraciones externas

Para cada sistema externo:
- Nombre del sistema y tipo de API (OData v2, OData v4, REST)
- ¿Hay un .edmx disponible o hay que mockear la interfaz?
- ¿Es lectura (enriquecimiento) o escritura (A2X submission)?
- ¿Cuándo se llama (en SAVE, en una acción específica)?

### 0.8 Requisitos UI

- ¿Se pide Fiori Elements? (si la spec menciona List Report, Object Page, o "UI SAP")
- ¿Cuántas apps? ¿Una por rol o una compartida?
- ¿Acciones bound visibles como botones? → necesitarán virtual fields

### 0.9 Requisitos de testing

- ¿Hay escenarios de negocio críticos mencionados explícitamente?
- ¿Hay flujos de error que la spec pide validar?
- Por defecto: tests para happy path + error path + auth por cada servicio

---

## Fase 0 output: el plan de build

Antes de escribir código, producir este plan en texto y mostrárselo al usuario brevemente
(no es una solicitud de confirmación — es transparencia sobre lo que se va a hacer):

```
PLAN DE BUILD

Namespace: com.<dominio>
Servicios: <lista>
Entidades: <lista en orden de dependencia>
Roles: <lista>
Fases:
  1. Entorno (package.json, .cdsrc.json, estructura)
  2. Schema (db/schema.cds + seed CSVs)
  3. Servicios CDS (srv/*.cds)
  4. Auth (@requires + @restrict)
  5. Handlers (srv/*.js — solo donde hay lógica real)
  6. Tests (test/*.test.js)
  7. UI (app/ — si la spec lo pide)
Gaps detectados en la spec (decisiones por defecto aplicadas):
  - <gap 1>: se usará <default>
  - <gap 2>: se usará <default>
```

---

## Protocolo de gaps en la spec

Cuando la spec no especifica algo, NO preguntes al usuario — aplica el default del catálogo
(ver `01-cap-core.md`, sección "Default Decisions Catalog") y anótalo en el plan.

**Excepción — preguntar siempre:**
- Si la spec menciona integración con un sistema SAP externo real (S/4HANA, BTP) y no hay
  credenciales ni EDMX disponible → preguntar antes de crear el mock
- Si hay ambigüedad en las reglas de negocio que puede llevar a dos diseños radicalmente
  distintos → describir las dos opciones y pedir decisión

Para todo lo demás: decide y avanza.

---

## Señal de completitud de la fase 0

La fase 0 está completa cuando puedes responder SÍ a todas estas preguntas:
- ¿Tengo la lista completa de entidades en orden de dependencia?
- ¿Tengo los roles con sus permisos específicos?
- ¿Tengo los servicios identificados con sus paths?
- ¿Tengo las acciones con sus transiciones de estado?
- ¿He aplicado el catálogo de defaults para todos los gaps?
- ¿He producido el plan de build?
