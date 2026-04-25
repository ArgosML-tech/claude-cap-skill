#!/usr/bin/env node
/**
 * close-learning-loop.js
 *
 * Reads build-log.md from a completed CAP build, maps each incident to the
 * most relevant reference file, and by default writes reviewable proposals to
 * proposed-reference-updates.md rather than modifying references/ directly.
 *
 * Usage (safe/default — proposes only):
 *   node scripts/close-learning-loop.js \
 *     --build-log ./my-cap-app/build-log.md \
 *     --evolution-log agent-evolution.md \
 *     --references-dir references/
 *
 * Usage (apply — writes gaps to references/ after human review):
 *   node scripts/close-learning-loop.js \
 *     --build-log ./my-cap-app/build-log.md \
 *     --evolution-log agent-evolution.md \
 *     --references-dir references/ \
 *     --apply-to-references
 *
 * Deduplication:
 *   Uses a stable hash of (candidateRef + symptom + cause) — not a text slice.
 *   If the same hash already exists in proposed-reference-updates.md or in
 *   agent-evolution.md, the entry is skipped.
 *
 * Out-of-scope filter:
 *   Gaps mentioning non-CAP technologies (Python, Dockerfile, FastAPI, pandas,
 *   pytest, requirements.txt) are marked out-of-scope and excluded from
 *   references/ proposals.
 *
 * Exit codes:
 *   0  completed (even if no gaps found)
 *   1  error reading required files
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(name) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

function hasFlag(name) {
  return args.includes(name)
}

const buildLogPath        = resolve(getArg('--build-log')       ?? './build-log.md')
const evolutionLogPath    = resolve(getArg('--evolution-log')   ?? 'agent-evolution.md')
const referencesDir       = resolve(getArg('--references-dir')  ?? 'references')
const proposalsPath       = resolve(getArg('--proposals-file')  ?? 'proposed-reference-updates.md')
const applyToReferences   = hasFlag('--apply-to-references')

// ── Validate inputs ───────────────────────────────────────────────────────────

if (!existsSync(buildLogPath)) {
  console.log(`No build-log.md found at ${buildLogPath}`)
  console.log('Nothing to learn from this session.')
  process.exit(0)
}

// ── Parse build-log.md ────────────────────────────────────────────────────────

const buildLogContent = readFileSync(buildLogPath, 'utf8')

if (
  buildLogContent.includes('Sin incidencias') ||
  buildLogContent.includes('no incidents') ||
  buildLogContent.toLowerCase().includes('no issues')
) {
  console.log('Build log reports no incidents. Knowledge base is up to date.')
  process.exit(0)
}

const incidentSectionRegex = /###\s+([^\n]+)\n([\s\S]+?)(?=\n###|\n##|\n#|$)/g
const incidents = []

let match
while ((match = incidentSectionRegex.exec(buildLogContent)) !== null) {
  const area = match[1].trim()
  const body = match[2].trim()

  if (!body || area.toLowerCase().includes('sin incidencia') || area.toLowerCase().includes('no incident')) {
    continue
  }

  const symptom      = extractField(body, ['Síntoma', 'Sintoma', 'Symptom', 'symptom'])
  const cause        = extractField(body, ['Causa', 'Cause', 'cause'])
  const fix          = extractField(body, ['Fix aplicado', 'Fix', 'fix'])
  const candidateRef = extractField(body, ['Reference candidata', 'Reference', 'Referencia candidata', 'Referencia'])

  incidents.push({ area, body, symptom, cause, fix, candidateRef })
}

if (incidents.length === 0 && buildLogContent.length > 100) {
  incidents.push({
    area: 'Build (free-form)',
    body: buildLogContent,
    symptom: null,
    cause: null,
    fix: null,
    candidateRef: null,
  })
}

if (incidents.length === 0) {
  console.log('No parseable incidents found in build-log.md.')
  process.exit(0)
}

console.log(`\nFound ${incidents.length} incident(s) to process.`)

// ── Out-of-scope filter ───────────────────────────────────────────────────────

const OUT_OF_SCOPE_SIGNALS = ['python', 'dockerfile', 'fastapi', 'pandas', 'pytest', 'requirements.txt']

function isOutOfScope(incident) {
  const text = [incident.area, incident.symptom ?? '', incident.cause ?? '', incident.body]
    .join(' ').toLowerCase()
  return OUT_OF_SCOPE_SIGNALS.some(sig => text.includes(sig))
}

// ── Reference mapping ─────────────────────────────────────────────────────────

const REFERENCE_MAP = [
  { file: '09-cap-frontend-fiori.md',                   keywords: ['manifest', 'fiori', 'frontend', 'fe ', ' fe', 'webapp', 'component.js', 'listReport', 'objectpage', 'annotation', 'ui.lineitem', 'playwright', 'white screen', 'pantalla blanca', 'shell', 'navigation config', 'routing'] },
  { file: '04-security-auth.md',                        keywords: ['auth', 'authorization', 'autorizaci', 'role', 'rol', '@requires', '@restrict', 'jwt', 'xsuaa', '403', 'forbidden', 'credentials'] },
  { file: '03-node-handlers.md',                        keywords: ['handler', 'before', 'after', 'on(', '.on(', 'srv.on', 'cds.on', 'req.user', 'req.data', 'javascript', 'typescript', 'js handler'] },
  { file: '10-cap-external-services.md',                keywords: ['external', 'edmx', 's/4', 'destination', 'remote', 'cds import', 'a2x'] },
  { file: '05-testing-deployment.md',                   keywords: ['test', 'deploy', 'jest', 'mocha', 'cds.test', 'cloud foundry', 'kyma', 'mtx'] },
  { file: '11-cds-modeling-guardrails.md',              keywords: ['cuid', 'managed', 'composition', 'association', 'aspect', 'type', 'enum', 'csv', 'seed'] },
  { file: '02-cds-services.md',                         keywords: ['service', 'srv', 'projection', 'expose', 'action', 'function', 'odata'] },
  { file: '12-role-driven-visibility-singletons.md',    keywords: ['visibility', 'singleton', 'role-driven'] },
  { file: '00-spec-intake.md',                          keywords: ['spec', 'especific', 'intake', 'greenfield', 'domain', 'entity extraction'] },
  { file: '01-cap-core.md',                             keywords: ['cap', 'cds', 'layer', 'declarative', 'generic behavior', 'crud'] },
]

function mapToReference(incident) {
  if (incident.candidateRef) {
    const normalized = incident.candidateRef.toLowerCase()
    for (const { file } of REFERENCE_MAP) {
      if (normalized.includes(file) || normalized.includes(file.replace('.md', ''))) {
        return file
      }
    }
  }

  const text = [incident.area, incident.body].join(' ').toLowerCase()
  let bestScore = 0
  let bestFile = '01-cap-core.md'

  for (const { file, keywords } of REFERENCE_MAP) {
    const score = keywords.filter(kw => text.includes(kw.toLowerCase())).length
    if (score > bestScore) {
      bestScore = score
      bestFile = file
    }
  }

  return bestFile
}

function extractField(text, names) {
  for (const name of names) {
    const regex = new RegExp(`\\*\\*${name}[:\\*]*\\*\\*\\s*([^\\n]+)`, 'i')
    const m = text.match(regex)
    if (m) return m[1].trim()
  }
  return null
}

// ── Stable hash for deduplication ────────────────────────────────────────────

function incidentHash(refFile, symptom, cause) {
  const input = [refFile, symptom ?? '', cause ?? '']
    .map(s => s.toLowerCase().trim())
    .join('|')
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

// ── Load existing proposals for dedup ────────────────────────────────────────

const existingProposalsContent = existsSync(proposalsPath)
  ? readFileSync(proposalsPath, 'utf8')
  : ''

const existingEvolutionContent = existsSync(evolutionLogPath)
  ? readFileSync(evolutionLogPath, 'utf8')
  : ''

function hashAlreadyRecorded(hash) {
  return existingProposalsContent.includes(hash) || existingEvolutionContent.includes(hash)
}

// ── Process incidents ─────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0]
const newProposals = []
const evolutionEntries = []
let totalApplied = 0
let totalProposed = 0
let totalSkipped = 0
let totalOutOfScope = 0

for (const incident of incidents) {
  const symptomText  = incident.symptom ?? incident.area
  const causeText    = incident.cause   ?? '(see build-log for details)'
  const fixText      = incident.fix     ?? '(see build-log for details)'
  const refFile      = mapToReference(incident)
  const hash         = incidentHash(refFile, symptomText, causeText)
  const outOfScope   = isOutOfScope(incident)

  if (outOfScope) {
    totalOutOfScope++
    console.log(`  ⊘ Out-of-scope (non-CAP technology): "${symptomText.slice(0, 70)}"`)
    continue
  }

  if (hashAlreadyRecorded(hash)) {
    totalSkipped++
    console.log(`  → Already recorded (hash ${hash}): "${symptomText.slice(0, 60)}..."`)
    continue
  }

  if (applyToReferences) {
    // Write directly to the reference file
    const refPath = join(referencesDir, refFile)

    if (!existsSync(refPath)) {
      console.log(`  ⚠ Reference file not found: ${refFile} — skipping`)
      continue
    }

    const gapSection = `
## Gap descubierto — ${today}

**Área:** ${incident.area}
**Síntoma:** ${symptomText}
**Causa:** ${causeText}
**Fix aplicado:** ${fixText}
**Hash:** ${hash}

> Añadido por close-learning-loop.js --apply-to-references. Revisar y refinar manualmente si el patrón es generalizable.
`
    appendFileSync(refPath, gapSection, 'utf8')
    totalApplied++
    console.log(`  ✓ Gap applied to ${refFile}: "${symptomText.slice(0, 70)}"`)

    evolutionEntries.push({ area: incident.area, symptom: symptomText, fix: fixText, targetRef: refFile, hash, status: 'applied' })
  } else {
    // Propose only — stage for proposed-reference-updates.md
    newProposals.push({ area: incident.area, symptom: symptomText, cause: causeText, fix: fixText, refFile, hash })
    totalProposed++
    console.log(`  → Proposed for ${refFile}: "${symptomText.slice(0, 70)}"`)

    evolutionEntries.push({ area: incident.area, symptom: symptomText, fix: fixText, targetRef: refFile, hash, status: 'proposed' })
  }
}

// ── Write proposed-reference-updates.md ──────────────────────────────────────

if (newProposals.length > 0) {
  let proposalBlock = ''

  for (const p of newProposals) {
    proposalBlock += `
## Gap — ${today} — ${p.refFile}

- **Área:** ${p.area}
- **Síntoma:** ${p.symptom}
- **Causa:** ${p.cause}
- **Fix aplicado:** ${p.fix}
- **Reference candidata:** \`${p.refFile}\`
- **Estado:** proposed
- **Hash:** ${p.hash}

> Revisar antes de aplicar. Ejecutar con --apply-to-references solo cuando el patrón sea generalizable a otros proyectos CAP.
`
  }

  if (!existsSync(proposalsPath)) {
    writeFileSync(proposalsPath, `# Proposed reference updates\n\nRevisar cada entrada. Para aplicar:\n\n\`\`\`bash\nnode scripts/close-learning-loop.js --build-log <log> --apply-to-references\n\`\`\`\n${proposalBlock}`, 'utf8')
  } else {
    appendFileSync(proposalsPath, proposalBlock, 'utf8')
  }

  console.log(`\n  ✓ ${newProposals.length} proposal(s) written to ${proposalsPath}`)
}

// ── Write to agent-evolution.md ───────────────────────────────────────────────

if (evolutionEntries.length > 0) {
  let evolutionSection = `\n## Iteration ${today}\n`

  for (const entry of evolutionEntries) {
    const statusLabel = entry.status === 'applied' ? 'aplicado' : 'propuesto (pendiente revisión)'
    evolutionSection += `- **Hallazgo:** ${entry.symptom}\n`
    evolutionSection += `- **Fix:** ${entry.fix}\n`
    evolutionSection += `- **Reference candidata:** \`${entry.targetRef}\`\n`
    evolutionSection += `- **Estado:** ${statusLabel}\n`
    evolutionSection += `- **Hash:** ${entry.hash}\n\n`
  }

  if (!existsSync(evolutionLogPath)) {
    writeFileSync(evolutionLogPath, `# Agent evolution log\n${evolutionSection}`, 'utf8')
  } else {
    const alreadyHasToday = existingEvolutionContent.includes(`## Iteration ${today}`) &&
      evolutionEntries.some(e => existingEvolutionContent.includes(e.hash))

    if (!alreadyHasToday) {
      appendFileSync(evolutionLogPath, evolutionSection, 'utf8')
    } else {
      console.log(`  → agent-evolution.md already has today's entries — skipping`)
    }
  }

  console.log(`  ✓ agent-evolution.md updated with ${evolutionEntries.length} entry(ies)`)
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Learning loop closed ─────────────────────────────────────────`)
console.log(`  Incidents processed : ${incidents.length}`)
console.log(`  Out-of-scope skipped: ${totalOutOfScope}`)
console.log(`  Already recorded    : ${totalSkipped}`)

if (applyToReferences) {
  console.log(`  Gaps applied to references/: ${totalApplied}`)
} else {
  console.log(`  Proposals staged    : ${totalProposed}`)
  if (totalProposed > 0) {
    console.log(`\n  Review proposals in: ${proposalsPath}`)
    console.log(`  To apply after review, re-run with --apply-to-references`)
  }
}
