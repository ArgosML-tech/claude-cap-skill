# claude-cap-skill

Kit de orquestación para [Claude Code](https://claude.ai/code) especializado en SAP Cloud Application Programming Model (CAP).

---

## Qué es y qué no es

**Es:**
- Un conjunto de instrucciones operativas (`CLAUDE.md`), conocimiento técnico (`references/`) y scripts de validación (`scripts/`) que guían a Claude Code para construir proyectos SAP CAP de principio a fin.
- Un mecanismo para capturar y acumular aprendizaje técnico de builds reales.

**No es:**
- Una aplicación CAP.
- Un starter CAP listo para producción.
- Una librería npm de runtime.
- Un sustituto del criterio experto en SAP CAP.

---

## Qué problema resuelve

Sin este kit, Claude Code improvisa decisiones de diseño CAP, mezcla capas, omite validaciones y no registra lo que aprende. Con él:

- El agente sigue un flujo **declarative-first**: CDS y anotaciones antes que handlers.
- Se fuerza el ciclo **build → test → fix** antes de declarar algo completo.
- La UI Fiori Elements se valida con un protocolo de 3 pasos antes de declararse terminada.
- Las incidencias se registran en `build-log.md` y el conocimiento se acumula en `references/`.

---

## Requisitos

- Node.js >= 20
- npm
- [Claude Code](https://claude.ai/code) instalado — seguir la [documentación oficial](https://docs.anthropic.com/en/docs/claude-code/getting-started). Si usas npm: `npm install -g @anthropic-ai/claude-code`
- Playwright (opcional, para validación visual headless)
- SAP CAP tooling instalado cuando se use con proyectos CAP reales (`npm install -g @sap/cds-dk`)

---

## Instalación

```bash
git clone https://github.com/ArgosML-tech/claude-cap-skill.git
cd claude-cap-skill
npm install
npm run install:playwright   # descarga Chromium headless (~150 MB, solo una vez)
```

---

## Modos de uso

### Uso A — Proyecto CAP greenfield

Clonar este repositorio como carpeta base del nuevo proyecto y abrir Claude Code desde ahí:

```bash
git clone https://github.com/ArgosML-tech/claude-cap-skill.git mi-proyecto-cap
cd mi-proyecto-cap
npm install
claude
```

Claude lee `CLAUDE.md` automáticamente desde el directorio de trabajo. Proporcionar la spec del dominio y el agente construirá el proyecto dentro de `workspace/<nombre-proyecto>/` (carpeta en `.gitignore`).

### Uso B — Integrar en un proyecto CAP existente

Copiar los archivos del kit al proyecto existente. **No sobrescribir el `package.json` del proyecto.**

```bash
cp CLAUDE.md /ruta/proyecto/
cp -r references /ruta/proyecto/
cp -r scripts /ruta/proyecto/
cp -r .claude /ruta/proyecto/
```

Abrir Claude Code desde la raíz del proyecto destino:

```bash
cd /ruta/proyecto
claude
```

### Uso C — Auditoría de cap-acc u otro acelerador CAP

`cap-acc` es un monorepo/CLI/acelerador CAP, no una aplicación CAP estándar. Existe ahora una reference específica (`references/14-cap-acc.md`) con estructura esperada, comandos de diagnóstico, qué evitar y primeras tareas recomendadas. En ese caso usar el skill como guía de auditoría y mejora, no como generador greenfield.

Prompt de ejemplo:

```
Lee CLAUDE.md y references/. Revisa cap-acc como producto/CLI CAP accelerator.
No modifiques archivos. Dame diagnóstico, riesgos y próximos cambios.
```

---

## Estructura del repositorio

```
CLAUDE.md                       ← instrucciones de orquestación para Claude Code
references/                     ← base de conocimiento operativo CAP
  00-spec-intake.md             ← intake y checklist para proyectos nuevos
  01-cap-core.md                ← arquitectura, decisiones de layer, catalog de defaults
  02-cds-services.md            ← servicios CDS, proyecciones, actions
  03-node-handlers.md           ← handlers Node.js, patrones y antipatrones
  04-security-auth.md           ← auth, roles, mocked users, restricciones
  05-testing-deployment.md      ← testing con cds.test, despliegue
  06-task-playbooks.md          ← playbooks por tipo de tarea (greenfield, debug, FE...)
  07-runtime-detection.md       ← detección de runtime CAP antes de actuar
  08-cap-examples.md            ← ejemplos canónicos CAP
  09-cap-frontend-fiori.md      ← Fiori Elements, manifest, draft lifecycle, validación
  10-cap-external-services.md   ← servicios externos, S/4, mocking
  11-cds-modeling-guardrails.md ← guardrails de modelado CDS
  12-role-driven-visibility-singletons.md ← visibilidad por rol, singletons
  13-btp-plugins-services.md    ← plugins BTP (@cap-js) y servicios gestionados
  14-cap-acc.md                 ← monorepo CAP accelerator (cap-acc, CLI capx)
scripts/
  validate-metadata.js          ← validación estática y $metadata de la UI FE
  validate-fe.js                ← validación visual headless con Playwright
  close-learning-loop.js        ← cierra el aprendizaje: build-log → references
agent-evolution.md              ← log acumulativo de aprendizaje entre sesiones
.claude/settings.json           ← permisos de herramientas para Claude Code
package.json                    ← dependencias del kit (Playwright)
```

---

## Scripts disponibles

| Script | Qué hace |
|---|---|
| `npm run validate:static` | Validación estática de la UI FE (sin servidor). Verifica manifest.json, Component.js, routing config. |
| `npm run validate:metadata` | Igual que `validate:static`. Acepta `--port` para validar también el endpoint `$metadata`. |
| `npm run validate:fe` | Validación visual headless con Playwright. Requiere servidor CAP corriendo. |
| `npm run learn` | Ejecuta `close-learning-loop.js` para transferir incidencias del build-log a `references/`. |
| `npm run install:playwright` | Descarga el navegador Chromium para validación headless. |

---

## Protocolo de validación Fiori Elements

No declarar una UI FE como completa sin pasar al menos los pasos 1 y 2.

**Paso 1 — Validación estática** (sin servidor, siempre primero):

```bash
node scripts/validate-metadata.js \
  --project-dir ./workspace/mi-app \
  --service CatalogService \
  --entities Products,Categories \
  [--draft]
```

Verifica: `manifest.json`, `Component.js`, `sap.app.id`, `mainService.uri`, `sap.fe.templates` en deps, targets `ListReport`/`ObjectPage`, y consistencia del `extend()` en `Component.js`.

**Paso 2 — Validación `$metadata`** (con servidor CAP corriendo):

```bash
npx cds watch &
sleep 5
node scripts/validate-metadata.js \
  --project-dir ./workspace/mi-app \
  --service CatalogService \
  --entities Products,Categories \
  --port 4004 \
  [--draft]
```

Verifica: accesibilidad del endpoint OData, presencia de entidades en el XML, marcadores de draft si aplica, y anotaciones `UI.LineItem`.

**Paso 3 — Validación visual** (si Playwright está disponible):

```bash
node scripts/validate-fe.js \
  --port 4004 \
  --service CatalogService \
  --entity Products \
  --screenshot
```

Verifica: shell FE montado, ausencia de diálogos de error, columnas de List Report visibles, navegación a Object Page funcional.

Si Playwright no está disponible, el agente lo indica explícitamente y no declara la UI como completamente validada.

---

## Learning loop

Al terminar cualquier build, el agente genera `build-log.md` en el proyecto construido y ejecuta `close-learning-loop.js`. El flujo tiene dos fases:

**Fase 1 — Propuesta (por defecto):**

```bash
node scripts/close-learning-loop.js \
  --build-log ./workspace/mi-app/build-log.md \
  --evolution-log agent-evolution.md \
  --references-dir references/
```

El script:
1. Lee las incidencias del `build-log.md`.
2. Descarta gaps fuera de ámbito CAP (Python, Dockerfile, FastAPI, etc.).
3. Deduplica por hash estable — no por texto.
4. Escribe propuestas revisables en `proposed-reference-updates.md` con estado `proposed`.
5. Registra una entrada en `agent-evolution.md` como `propuesto (pendiente revisión)`.

**`references/` no se toca en este paso.**

**Fase 2 — Aplicar tras revisión humana:**

Revisar `proposed-reference-updates.md`. Si las propuestas son generalizables a otros proyectos CAP, aplicarlas:

```bash
node scripts/close-learning-loop.js \
  --build-log ./workspace/mi-app/build-log.md \
  --evolution-log agent-evolution.md \
  --references-dir references/ \
  --apply-to-references
```

Solo entonces se añaden secciones `## Gap descubierto — <fecha>` a los archivos de `references/`.

**Importante:** el conocimiento bruto de un build concreto no es automáticamente conocimiento generalizable. Revisar `proposed-reference-updates.md` antes de aplicar.

---

## Seguridad y permisos

`.claude/settings.json` define qué herramientas puede usar Claude Code en este repositorio:

- **Permitido:** `npm install`, `npm run *`, `npx cds *`, `npx playwright *`, `node scripts/*`, comandos `git` de solo lectura, lectura/escritura dentro de `./`.
- **Denegado explícitamente:** `git push`, `cf`, `btp`, `npm publish`, `curl`, comandos destructivos (`rm -rf`), acceso a `.env`, `secrets/`, `~/.ssh`, `~/.aws`, `~/.config`, y directorio `.git`.

Cualquier deploy a entornos no locales (Cloud Foundry, Kyma, BTP) y cualquier operación con credenciales reales requiere aprobación humana explícita. El agente está configurado para parar y pedir confirmación en esos casos.

---

## Limitaciones conocidas

- **No sustituye criterio experto CAP.** Las referencias contienen decisiones operativas probadas, pero CAP evoluciona y algunas pueden quedarse obsoletas ante nuevas versiones.
- **No garantiza production-readiness.** Los proyectos generados son correctos para desarrollo local y pruebas. BTP real (XSUAA, destinations, HANA, approuter, deployment) requiere tratamiento explícito y revisión humana.
- **El learning loop no filtra tecnologías ajenas a CAP.** Si se usa el kit en proyectos mixtos, pueden colarse gaps de Python, Docker u otras tecnologías en referencias CAP. Revisar y depurar manualmente.
- **cap-acc necesita una reference específica.** No existe todavía `references/14-cap-acc.md`. Hasta que exista, usarlo en modo auditoría (Uso C) es lo correcto.
- **Playwright es opcional.** Sin él, la validación visual (Paso 3) no se ejecuta. El agente lo indica explícitamente; no asume éxito visual sin haberlo verificado.
