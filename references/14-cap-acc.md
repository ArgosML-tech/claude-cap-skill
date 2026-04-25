# cap-acc: CAP accelerator / monorepo

## Qué es cap-acc

`cap-acc` es un monorepo de herramientas para acelerar el desarrollo de proyectos SAP CAP. No es una aplicación CAP de negocio.

Sus componentes principales:

- **`packages/cli`** — CLI `capx`: comandos interactivos y no interactivos para generar proyectos CAP, añadir features, validar configuraciones.
- **`packages/lib`** — Librería de soporte compartida: generadores, plantillas, helpers reutilizados por el CLI y otros paquetes.
- **`packages/cap-ops`** — Hardening operacional: scripts de build, deploy, lint y validación para proyectos CAP generados.
- **`packages/starters/`** — Starter templates: cada starter puede ser un workspace npm propio (por ejemplo `packages/starters/integration-service`) con su `package.json` independiente, o simplemente una carpeta de plantillas; verificar la estructura real antes de asumir. `capx` los usa como base al generar proyectos CAP.
- **`playground/`** — Entorno de validación: proyecto(s) CAP generados por el CLI para verificar que los starters producen output correcto.
- **`package.json` raíz** — Workspace npm con `"workspaces": ["packages/*", "playground"]`.

## Qué NO es

- No es una app CAP de negocio (no tiene dominio, entidades de negocio, ni servicios propios).
- No debe seguir automáticamente el playbook greenfield de `references/06-task-playbooks.md`.
- No debe generar `db/`, `srv/`, `app/` en la raíz del repo como si fuese una app destino.
- No debe ejecutarse `cds build` en la raíz salvo que el repo lo defina explícitamente en sus scripts.
- No debe aplicarse validación Fiori Elements (`validate-metadata.js`) al repo raíz.

## Detección

Un repo es cap-acc (o monorepo accelerator análogo) si cumple **todas** estas condiciones:

1. `package.json` raíz tiene `"workspaces"` definido.
2. Existe al menos uno de: `packages/cli`, `packages/lib`, `packages/starters`.
3. No hay `db/schema.cds` ni `srv/*.cds` en la raíz.

Si se cumplen, **no aplicar el playbook greenfield**. Leer esta reference primero.

## Estructura esperada

```
package.json              ← workspace root (npm workspaces)
packages/
  cli/                    ← CLI capx
    package.json
    src/
    bin/capx.js
  lib/                    ← librería de soporte
    package.json
    src/
  cap-ops/                ← hardening ops
    package.json
    scripts/
  starters/               ← starter templates por tipo; cada uno puede ser
    integration-service/  ←   un workspace npm propio con package.json
    fiori-app/            ←   o una carpeta de plantillas sin package.json
    crud-service/         ←   verificar estructura real antes de asumir
    ...
playground/               ← proyectos generados para validación
  package.json
  test-generators.js      ← si existe; puede tener otro nombre
```

## Comandos de diagnóstico

```bash
# Instalar todo el workspace
npm install

# Compilar todos los paquetes
npm run build

# Ejecutar tests del workspace
npm test

# Enlazar el CLI localmente para pruebas
npm link --workspace=packages/cli

# Verificar que el CLI responde
capx --help

# Smoke test de generators en playground (si test-generators.js existe)
cd playground && node test-generators.js   # ajustar al script real del repo
```

## Cómo revisar cap-acc

### CLI (`packages/cli`)

- ¿El CLI tiene modo no interactivo (`--no-interactive` o flags equivalentes)?
- ¿Todos los comandos tienen `--help` funcional?
- ¿Los comandos de generación son idempotentes (ejecutar dos veces no rompe el output)?
- ¿Existe un comando de diagnóstico de entorno (`capx doctor` o equivalente) que verifique Node, npm y CDS tooling?

### Generators y starters (`packages/lib`, `packages/starters`)

- ¿El starter genera un proyecto que pasa `npx cds build` sin errores?
- ¿El starter genera un proyecto que pasa `npm test` con al menos un test verde?
- ¿Las plantillas usan versiones pinadas o rangos seguros de `@sap/cds`?
- ¿Los starters son distinguibles entre sí (no hay un starter genérico que cubre todo)?

### Playground

- ¿El proyecto generado en `playground/` está actualizado respecto al starter actual?
- ¿Existe un script de smoke test en playground (`test-generators.js` u otro nombre)? Si existe, ¿cubre el flujo completo de generación?
- ¿El playground distingue entre output de plantilla y output de proyecto real?

### Compatibilidad

- ¿Funciona con la versión de Node/npm declarada en `engines` del `package.json` raíz?
- ¿Los starters son compatibles con `@sap/cds@9` (driver SQLite `@cap-js/sqlite@^2`, test harness `@cap-js/cds-test@^0`)?

## Primeras tareas recomendadas al abrir cap-acc

Si no hay contexto previo del repo, hacer en este orden:

1. **Diagnóstico de entorno** — si existe `capx doctor` o un comando equivalente, ejecutarlo. Si no existe, implementarlo o sustituir con `capx --version && node --version && npm --version && npx cds --version`.
2. **Revisar matriz MVP vs. production** para el starter `integration-service` (u otro principal): ¿qué features están completas, cuáles son stub?
3. **Tests de CLI en modo no interactivo** — confirmar que los comandos son automatizables sin TTY
4. **Documentación de arquitectura del monorepo** — ¿existe un `ARCHITECTURE.md` o sección equivalente en el README raíz?
5. **Smoke test de proyecto generado** — generar un proyecto desde el starter principal, ejecutar `cds build` + `npm test`, verificar que pasa

## Qué evitar

- No aplicar `validate-metadata.js` al repo raíz — solo aplica a proyectos CAP generados dentro de `playground/` o en `workspace/`.
- No ejecutar `cds build` en la raíz del monorepo salvo que esté en los scripts del `package.json` raíz.
- No editar proyectos dentro de `playground/` sin distinguir si el fix va en la **plantilla** (`packages/starters/`) o en el **output generado** (`playground/`). Fixes en `playground/` directamente no se propagan a futuros proyectos.
- No mezclar fixes del starter con ajustes del playground en el mismo commit.
- No abrir múltiples cambios en paralelo sin un plan secuencial claro — los cambios en `packages/lib` pueden romper varios starters a la vez.

## Referencia cruzada

- Para proyectos CAP generados por cap-acc: aplicar referencias normales (`01-cap-core.md`, etc.) al proyecto generado, no al monorepo.
- Para auth y usuarios mock en proyectos generados: ver `references/04-security-auth.md`.
- Para validación Fiori Elements de proyectos generados: ver `references/09-cap-frontend-fiori.md`.
