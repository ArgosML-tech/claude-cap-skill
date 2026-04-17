#!/usr/bin/env node
/**
 * validate-metadata.js
 *
 * Validates FE wiring for a CAP project in two passes:
 *   Pass 1 (static)  — file structure + manifest.json checks. No server needed.
 *   Pass 2 (HTTP)    — $metadata endpoint checks. Requires --port and a running cds watch.
 *
 * Usage:
 *   node scripts/validate-metadata.js \
 *     --project-dir ./my-cap-app \
 *     --service CatalogService \
 *     --entities Products,Categories \
 *     [--port 4004] \
 *     [--draft]
 *
 * Exit codes:
 *   0  all checks passed
 *   1  one or more checks failed
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(name) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

function hasFlag(name) {
  return args.includes(name)
}

const projectDir = getArg('--project-dir') ?? '.'
const serviceName = getArg('--service')
const rawEntities = getArg('--entities') ?? ''
const port = getArg('--port') ? Number(getArg('--port')) : null
const checkDraft = hasFlag('--draft')

if (!serviceName) {
  console.error('ERROR: --service is required')
  process.exit(1)
}

const expectedEntities = rawEntities.split(',').map(s => s.trim()).filter(Boolean)

// ── Helpers ───────────────────────────────────────────────────────────────────

const results = []

function pass(check, detail = '') {
  results.push({ status: 'PASS', check, detail })
  console.log(`  ✓ ${check}${detail ? ' — ' + detail : ''}`)
}

function fail(check, detail = '') {
  results.push({ status: 'FAIL', check, detail })
  console.log(`  ✗ ${check}${detail ? ' — ' + detail : ''}`)
}

function warn(check, detail = '') {
  results.push({ status: 'WARN', check, detail })
  console.log(`  ⚠ ${check}${detail ? ' — ' + detail : ''}`)
}

// ── Pass 1: Static checks ─────────────────────────────────────────────────────

console.log('\n── Pass 1: Static structure checks ─────────────────────────────')

// Find app directories
const appDir = join(projectDir, 'app')
let appDirs = []

if (existsSync(appDir)) {
  try {
    appDirs = readdirSync(appDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => join(appDir, e.name))
  } catch {
    // ignore
  }

  // Also check for .cds annotation files (annotations-only pattern)
  const cdsPaths = readdirSync(appDir).filter(f => f.endsWith('.cds'))
  if (cdsPaths.length > 0) {
    pass('CDS annotations file found in app/', cdsPaths.join(', '))
  }
} else {
  warn('app/ directory not found', 'FE checks may not apply')
}

// Check each webapp app dir
let manifestFound = false

for (const dir of appDirs) {
  const webappDir = join(dir, 'webapp')
  const manifestPath = join(webappDir, 'manifest.json')
  const componentPath = join(webappDir, 'Component.js')
  const appLabel = relative(projectDir, dir)

  if (!existsSync(webappDir)) {
    warn(`${appLabel}: no webapp/ folder`, 'annotations-only pattern — no further checks needed')
    continue
  }

  // manifest.json existence
  if (!existsSync(manifestPath)) {
    fail(`${appLabel}: manifest.json missing`, manifestPath)
    continue
  }

  manifestFound = true
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    fail(`${appLabel}: manifest.json is invalid JSON`, e.message)
    continue
  }

  pass(`${appLabel}: manifest.json is valid JSON`)

  // Required top-level keys
  for (const key of ['sap.app', 'sap.ui5']) {
    if (!manifest[key]) {
      fail(`${appLabel}: manifest.json missing key "${key}"`)
    } else {
      pass(`${appLabel}: manifest.json has "${key}"`)
    }
  }

  // sap.app.id
  const appId = manifest['sap.app']?.id
  if (!appId) {
    fail(`${appLabel}: sap.app.id missing in manifest.json`)
  } else {
    pass(`${appLabel}: sap.app.id = "${appId}"`)
  }

  // mainService
  const dataSources = manifest['sap.app']?.dataSources ?? {}
  const mainService = dataSources['mainService'] ?? dataSources[Object.keys(dataSources)[0]]
  if (!mainService) {
    fail(`${appLabel}: no dataSources found in manifest.json`)
  } else {
    const uri = mainService.uri ?? ''
    if (!uri) {
      fail(`${appLabel}: mainService.uri is empty`)
    } else {
      // Heuristic: uri should end with / and contain the service name (case-insensitive)
      const uriLower = uri.toLowerCase()
      const serviceNameLower = serviceName.toLowerCase()
      if (!uriLower.includes(serviceNameLower.replace('service', '')) && !uriLower.includes('odata')) {
        warn(`${appLabel}: mainService.uri "${uri}" may not match service "${serviceName}"`)
      } else {
        pass(`${appLabel}: mainService.uri = "${uri}"`)
      }
    }
  }

  // routerClass
  const routerClass = manifest['sap.ui5']?.routing?.config?.routerClass
  if (routerClass !== 'sap.fe.core.AppRouter') {
    fail(`${appLabel}: routerClass should be "sap.fe.core.AppRouter", found "${routerClass ?? 'undefined'}"`)
  } else {
    pass(`${appLabel}: routerClass = sap.fe.core.AppRouter`)
  }

  // sap.fe.templates in deps
  const libs = manifest['sap.ui5']?.dependencies?.libs ?? {}
  if (!libs['sap.fe.templates']) {
    fail(`${appLabel}: "sap.fe.templates" missing from sap.ui5.dependencies.libs`)
  } else {
    pass(`${appLabel}: sap.fe.templates in dependencies`)
  }

  // At least one ListReport or ObjectPage target
  const targets = manifest['sap.ui5']?.routing?.targets ?? {}
  const feTargets = Object.values(targets).filter(t =>
    typeof t.name === 'string' &&
    (t.name.includes('ListReport') || t.name.includes('ObjectPage'))
  )
  if (feTargets.length === 0) {
    fail(`${appLabel}: no sap.fe.templates.ListReport or ObjectPage targets found`)
  } else {
    pass(`${appLabel}: ${feTargets.length} FE target(s) configured`)
  }

  // navigation config in ListReport targets (common omission)
  const lrTargets = Object.values(targets).filter(t =>
    typeof t.name === 'string' && t.name.includes('ListReport')
  )
  for (const lrt of lrTargets) {
    const nav = lrt.options?.settings?.navigation
    if (!nav || Object.keys(nav).length === 0) {
      warn(
        `${appLabel}: ListReport target "${lrt.name ?? ''}" has no navigation config`,
        'Row click will not navigate to ObjectPage without it — see references/09-cap-frontend-fiori.md'
      )
    } else {
      pass(`${appLabel}: ListReport navigation config present`)
    }
  }

  // Component.js
  if (!existsSync(componentPath)) {
    fail(`${appLabel}: Component.js missing`, 'Required when webapp/ and manifest.json exist')
  } else {
    pass(`${appLabel}: Component.js exists`)

    // Check sap.app.id matches extend() arg
    const componentSrc = readFileSync(componentPath, 'utf8')
    const extendMatch = componentSrc.match(/AppComponent\.extend\(\s*['"]([^'"]+)['"]/)?.[1]
    if (!extendMatch) {
      warn(`${appLabel}: could not detect extend() argument in Component.js`)
    } else if (appId && extendMatch !== appId) {
      fail(
        `${appLabel}: Component.js extend("${extendMatch}") does not match sap.app.id "${appId}"`,
        'These must be identical'
      )
    } else {
      pass(`${appLabel}: Component.js extend() matches sap.app.id`)
    }
  }
}

// ── Pass 2: HTTP $metadata checks ─────────────────────────────────────────────

if (port) {
  console.log('\n── Pass 2: HTTP $metadata checks ───────────────────────────────')

  // Derive service path: try common conventions
  // CatalogService → /odata/v4/catalog/ or /catalog/
  // Also try the original service name in case @path is set explicitly (e.g. @path: 'UrgentProcurementService')
  const serviceSlug = serviceName
    .replace(/Service$/, '')
    .replace(/([A-Z])/g, (_, c, i) => (i > 0 ? '-' : '') + c.toLowerCase())

  const candidatePaths = [
    `/odata/v4/${serviceName}/`,           // exact name as declared in @path (most reliable)
    `/odata/v4/${serviceSlug}/`,           // kebab-case without "Service" suffix
    `/odata/v4/${serviceSlug.toLowerCase()}/`,
    `/${serviceSlug}/`,
  ]

  let metadataXml = null
  let usedPath = null

  for (const path of candidatePaths) {
    const url = `http://localhost:${port}${path}$metadata`
    try {
      const resp = await fetch(url)
      if (resp.ok) {
        metadataXml = await resp.text()
        usedPath = path
        break
      }
    } catch {
      // server not reachable on this path, continue
    }
  }

  if (!metadataXml) {
    fail(
      `$metadata not reachable on port ${port}`,
      `Tried: ${candidatePaths.map(p => p + '$metadata').join(', ')}`
    )
  } else {
    pass(`$metadata reachable at ${usedPath}$metadata`)

    // Check each expected entity
    for (const entity of expectedEntities) {
      if (metadataXml.includes(`Name="${entity}"`)) {
        pass(`Entity "${entity}" present in $metadata`)
      } else {
        fail(`Entity "${entity}" NOT found in $metadata`)
      }
    }

    // Draft checks
    if (checkDraft) {
      const draftMarkers = ['DraftRoot', 'DraftNode', 'IsActiveEntity', 'HasDraftEntity']
      for (const marker of draftMarkers) {
        if (metadataXml.includes(marker)) {
          pass(`Draft marker "${marker}" present in $metadata`)
        } else {
          fail(`Draft marker "${marker}" NOT found in $metadata — draft may not be enabled`)
        }
      }
    }

    // UI annotation hints (check EDMX for UI namespace)
    if (metadataXml.includes('UI.LineItem') || metadataXml.includes('com.sap.vocabularies.UI.v1.LineItem')) {
      pass('UI.LineItem annotation present in $metadata')
    } else {
      warn(
        'UI.LineItem annotation not detected in $metadata',
        'List Report may render empty — check app/*.cds annotations'
      )
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n── Summary ──────────────────────────────────────────────────────')
const passed = results.filter(r => r.status === 'PASS').length
const failed = results.filter(r => r.status === 'FAIL').length
const warned = results.filter(r => r.status === 'WARN').length

console.log(`  Passed: ${passed}  Failed: ${failed}  Warnings: ${warned}`)

if (failed > 0) {
  console.log('\nFailed checks:')
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  ✗ ${r.check}${r.detail ? '\n    ' + r.detail : ''}`)
  })
  process.exit(1)
}

if (warned > 0 && !port) {
  console.log('\nRun again with --port 4004 (and cds watch running) to validate $metadata.')
}

process.exit(0)
