# CAP Node.js runtime detection

## Use Glob and Grep tools directly

Do not ask the user to paste `ls` or `cat` output. Use the tools available in Claude Code:

```
Glob: package.json             → verify @sap/cds dependency
Glob: db/**/*.cds              → confirm domain model exists
Glob: srv/**/*.{js,ts,cds}     → confirm service files
Glob: app/**/manifest.json     → confirm FE apps
Grep: "@sap/cds"               → in package.json
Grep: "cds watch"              → in package.json scripts
```

## CAP Node.js signals

Look for several of these indicators:

| Signal | What it confirms |
|---|---|
| `package.json` with `@sap/cds` | CAP Node.js dependency declared |
| Scripts: `cds watch`, `cds serve` | Standard CAP startup commands |
| Folders `db/`, `srv/`, `app/`, `test/` | Conventional CAP project layout |
| Files `srv/*.js` or `srv/*.ts` | Handler implementations |
| Config: `.cdsrc.json`, `.cdsrc.yaml`, or `cds` section in `package.json` | CDS runtime configuration |

If most of these signals are missing, say so explicitly before proposing CAP-specific solutions.

## Pre-check before scaffolding or installation advice

Verify before proposing commands or dependencies:
- Real read/write access to the working folder
- Output of `node -v` and `npm -v` (ask the user to run if not inferable)
- Whether `package.json`, `package-lock.json`, or `node_modules` already exist
- Whether the goal is a real project or a skill test/proving ground
- Whether a SQLite scenario requires `cds deploy` before endpoints are usable

## BAS and remote dev spaces

If the work happens in SAP Business Application Studio or another remote dev space:
- Do not assume the first folder with a `package.json` is the real CAP project
- Verify that the working folder contains actual model files (`db/*.cds`, `srv/*.cds`)
- If `cds serve` reports `loaded model from 0 file(s)`, treat it as a path or workspace validation failure first
- If tests fail with `no such table`, diagnose missing schema deployment before changing CDS or handlers

## Greenfield projects

Before creating a minimal CAP app:
1. Verify reasonable compatibility between the Node.js version and the planned dependencies
2. Confirm that proposed package versions exist in npm (check registry metadata)
3. Do not present commands like `cds watch` or `cds serve` if you have not declared the package that provides them
4. If file-based SQLite is used, validate the `cds deploy` step before testing endpoints
5. If you cannot verify startup in the current session, say so explicitly — do not present the solution as confirmed

## Proving-ground mode

If the user is iterating between:
- A project repo used as a proving ground (runtime validation, execution, smoke tests)
- A separate repo used as the skill source (persistent improvements)

Then:
1. Identify both repos from the current task
2. State which is for runtime validation and which is for persistent skill improvements
3. Avoid hardcoding any local path from previous sessions
4. If a failure reveals a gap in the skill instructions, fix the skill first before iterating on the test project
