#!/usr/bin/env node
/**
 * close-learning-loop.js
 *
 * Reads build-log.md from a completed CAP build, maps each incident to the
 * most relevant reference file, appends a "Gap discovered" section to that
 * reference, and writes a new entry to agent-evolution.md.
 *
 * Usage:
 *   node scripts/close-learning-loop.js \
 *     --build-log ./my-cap-app/build-log.md \
 *     --evolution-log agent-evolution.md \
 *     --references-dir references/
 *
 * The script is idempotent for identical (symptom + reference) pairs:
 *   if the same gap text already appears in the reference, it is not added again.
 *
 * Exit codes:
 *   0  completed (even if no gaps found)
 *   1  error reading required files
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(name) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

const buildLogPath = resolve(getArg('--build-log') ?? './build-log.md')
const evolutionLogPath = resolve(getArg('--evolution-log') ?? 'agent-evolution.md')
const referencesDir = resolve(getArg('--references-dir') ?? 'references')

// ── Validate inputs ───────────────────────────────────────────────────────────

if (!existsSync(buildLogPath)) {
  console.log(`No build-log.md found at ${buildLogPath}`)
  console.log('Nothing to learn from this session.')
  process.exit(0)
}

// ── Parse build-log.md ────────────────────────────────────────────────────────

const buildLogContent = readFileSync(buildLogPath, 'utf8')

// Check if empty / clean build
if (
  buildLogContent.includes('Sin incidencias') ||
  buildLogContent.includes('no incidents') ||
  buildLogContent.toLowerCase().includes('no issues')
) {
  console.log('Build log reports no incidents. Knowledge base is up to date.')
  process.exit(0)
}

// Extract incidents — look for markdown sections: ### [area] with sub-bullets
// Supports both structured (Síntoma/Causa/Fix) and free-form incident entries.

const incidentSectionRegex = /###\s+([^\n]+)\n([\s\S]+?)(?=\n###|\n##|\n#|$)/g
const incidents = []

let match
while ((match = incidentSectionRegex.exec(buildLogContent)) !== null) {
  const area = match[1].trim()
  const body = match[2].trim()

  if (!body || area.toLowerCase().includes('sin incidencia') || area.toLowerCase().includes('no incident')) {
    continue
  }

  // Extract structured fields if present
  const symptom = extractField(body, ['Síntoma', 'Sintoma', 'Symptom', 'symptom'])
  const cause = extractField(body, ['Causa', 'Cause', 'cause'])
  const fix = extractField(body, ['Fix aplicado', 'Fix', 'fix'])
  const candidateRef = extractField(body, ['Reference candidata', 'Reference', 'Referencia candidata', 'Referencia'])

  incidents.push({ area, body, symptom, cause, fix, candidateRef })
}

// Fallback: if no structured sections, treat the whole log as one free-form incident
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

// ── Map incidents to references ───────────────────────────────────────────────

// Keyword → reference file mapping (order matters — more specific first)
const REFERENCE_MAP = [
  { file: '09-cap-frontend-fiori.md',       keywords: ['manifest', 'fiori', 'frontend', 'fe ', ' fe', 'webapp', 'component.js', 'listReport', 'objectpage', 'annotation', 'ui.lineitem', 'playwright', 'white screen', 'pantalla blanca', 'shell', 'navigation config', 'routing'] },
  { file: '04-security-auth.md',            keywords: ['auth', 'authorization', 'autorizaci', 'role', 'rol', '@requires', '@restrict', 'jwt', 'xsuaa', '403', 'forbidden', 'credentials'] },
  { file: '03-node-handlers.md',            keywords: ['handler', 'before', 'after', 'on(', '.on(', 'srv.on', 'cds.on', 'req.user', 'req.data', 'javascript', 'typescript', 'js handler'] },
  { file: '10-cap-external-services.md',    keywords: ['external', 'edmx', 's/4', 'destination', 'remote', 'cds import', 'a2x'] },
  { file: '05-testing-deployment.md',       keywords: ['test', 'deploy', 'jest', 'mocha', 'cds.test', 'cloud foundry', 'kyma', 'mtx'] },
  { file: '11-cds-modeling-guardrails.md',  keywords: ['cuid', 'managed', 'composition', 'association', 'aspect', 'type', 'enum', 'csv', 'seed'] },
  { file: '02-cds-services.md',             keywords: ['service', 'srv', 'projection', 'expose', 'action', 'function', 'odata'] },
  { file: '12-role-driven-visibility-singletons.md', keywords: ['visibility', 'singleton', 'visibility', 'role-driven', 'singleton'] },
  { file: '00-spec-intake.md',              keywords: ['spec', 'especific', 'intake', 'greenfield', 'domain', 'entity extraction'] },
  { file: '01-cap-core.md',                 keywords: ['cap', 'cds', 'layer', 'declarative', 'generic behavior', 'crud'] },
]

function mapToReference(incident) {
  // 1. Explicit candidate reference in the log takes priority
  if (incident.candidateRef) {
    const normalized = incident.candidateRef.toLowerCase()
    for (const { file } of REFERENCE_MAP) {
      if (normalized.includes(file) || normalized.includes(file.replace('.md', ''))) {
        return file
      }
    }
  }

  // 2. Keyword scoring across all incident text
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

// ── Write gaps to references ──────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0]
const evolutionEntries = []
let totalWritten = 0

for (const incident of incidents) {
  const refFile = mapToReference(incident)
  const refPath = join(referencesDir, refFile)

  if (!existsSync(refPath)) {
    console.log(`  ⚠ Reference file not found: ${refFile} — skipping`)
    continue
  }

  const refContent = readFileSync(refPath, 'utf8')

  // Build gap section
  const symptomText = incident.symptom ?? incident.area
  const causeText = incident.cause ?? '(see build-log for details)'
  const fixText = incident.fix ?? '(see build-log for details)'

  const gapSection = `
## Gap descubierto — ${today}

**Área:** ${incident.area}
**Síntoma:** ${symptomText}
**Causa:** ${causeText}
**Fix aplicado:** ${fixText}

> Añadido automáticamente por close-learning-loop.js. Revisar y refinar manualmente si el patrón es generalizable.
`

  // Idempotency: don't add if same symptom text already in the file
  if (refContent.includes(symptomText.slice(0, 60))) {
    console.log(`  → Already documented in ${refFile}: "${symptomText.slice(0, 60)}..."`)
    continue
  }

  appendFileSync(refPath, gapSection, 'utf8')
  totalWritten++
  console.log(`  ✓ Gap appended to ${refFile}: "${symptomText.slice(0, 70)}"`)

  evolutionEntries.push({
    area: incident.area,
    symptom: symptomText,
    fix: fixText,
    targetRef: refFile,
  })
}

// ── Write to agent-evolution.md ───────────────────────────────────────────────

if (evolutionEntries.length > 0) {
  let evolutionSection = `\n## Iteration ${today}\n`

  for (const entry of evolutionEntries) {
    evolutionSection += `- **Hallazgo:** ${entry.symptom}\n`
    evolutionSection += `- **Fix:** ${entry.fix}\n`
    evolutionSection += `- **Reference actualizada:** \`${entry.targetRef}\`\n`
    evolutionSection += `- **Reusable:** sí — registrado desde build-log automático\n\n`
  }

  if (!existsSync(evolutionLogPath)) {
    writeFileSync(evolutionLogPath, `# Agent evolution log\n${evolutionSection}`, 'utf8')
  } else {
    // Deduplication: skip if this exact date block already exists
    const existing = readFileSync(evolutionLogPath, 'utf8')
    const alreadyHasToday = existing.includes(`## Iteration ${today}`) &&
      evolutionEntries.some(e => existing.includes(e.symptom.slice(0, 50)))

    if (!alreadyHasToday) {
      appendFileSync(evolutionLogPath, evolutionSection, 'utf8')
    } else {
      console.log(`  → agent-evolution.md already has today's entries — skipping`)
    }
  }

  console.log(`\n  ✓ agent-evolution.md updated with ${evolutionEntries.length} entry(ies)`)
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Learning loop closed ─────────────────────────────────────────`)
console.log(`  Incidents processed: ${incidents.length}`)
console.log(`  Gaps written to references: ${totalWritten}`)
console.log(`  Evolution log: ${evolutionLogPath}`)

if (totalWritten === 0 && incidents.length > 0) {
  console.log('\n  All gaps were already documented. Knowledge base is up to date.')
}
