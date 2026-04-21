#!/usr/bin/env node
/**
 * validate-fe.js
 *
 * Validates Fiori Elements rendering using Playwright headless Chromium.
 * Opens /$fiori-preview/<ServiceName>/<EntitySet>#preview-app and checks:
 *   1. No white screen (FE shell mounted)
 *   2. No system error dialogs
 *   3. List Report shows column headers (UI.LineItem rendered)
 *   4. Row click navigates to ObjectPage (if rows exist)
 *
 * Prerequisites:
 *   npm install playwright @playwright/test
 *   npx playwright install chromium
 *   cds watch running on the target port
 *
 * Usage:
 *   node scripts/validate-fe.js \
 *     --port 4004 \
 *     --service CatalogService \
 *     --entity Products \
 *     [--app-url /my-app/webapp/index.html#my-app-id]  optional: override target URL
 *     [--screenshot] \
 *     [--timeout 30000] \
 *     [--credentials user:pass]
 *
 * Exit codes:
 *   0  all checks passed
 *   1  one or more checks failed
 *   2  Playwright not available (install it to enable visual validation)
 */

// Check Playwright availability before doing anything else
let chromium, expect
try {
  const pw = await import('playwright')
  chromium = pw.chromium
} catch {
  console.log('⚠ Playwright not available.')
  console.log('  Install with: npm install playwright && npx playwright install chromium')
  console.log('  Skipping visual FE validation.')
  process.exit(2)
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(name) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

function hasFlag(name) {
  return args.includes(name)
}

const port = Number(getArg('--port') ?? '4004')
const serviceName = getArg('--service')
const entityName = getArg('--entity')
const appUrlOverride = getArg('--app-url')    // optional: test standalone URL instead of $fiori-preview
const takeScreenshot = hasFlag('--screenshot')
const timeout = Number(getArg('--timeout') ?? '30000')
const credentials = getArg('--credentials') ?? 'admin:'   // default: mocked auth

if (!serviceName || !entityName) {
  console.error('ERROR: --service and --entity are required')
  process.exit(1)
}

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

// ── Build URL ─────────────────────────────────────────────────────────────────

// By default use $fiori-preview (works without Component.js, verifies metadata annotations).
// When --app-url is supplied, test the standalone app instead — required to verify
// manifest.json settings like creationMode that $fiori-preview ignores.
const previewUrl = appUrlOverride
  ? `http://localhost:${port}${appUrlOverride}`
  : `http://localhost:${port}/$fiori-preview/${serviceName}/${entityName}#preview-app`

console.log(`\n── Playwright FE Validation ──────────────────────────────────────`)
console.log(`  URL:     ${previewUrl}`)
console.log(`  Timeout: ${timeout}ms`)
console.log('')

// ── Encode Basic Auth credentials for manifest injection ──────────────────────
// CAP mocked auth sends 403 (not 401) to OData V4 requests without credentials.
// $fiori-preview handles this at server side, but the OData model still needs creds.
const [credUser, credPass = ''] = credentials.split(':')
const basicAuthHeader = `Basic ${Buffer.from(`${credUser}:${credPass}`).toString('base64')}`

// ── Launch Playwright ─────────────────────────────────────────────────────────

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
})

const context = await browser.newContext({
  // Set Basic Auth so OData V4 model includes credentials on every request
  httpCredentials: { username: credUser, password: credPass },
  extraHTTPHeaders: { Authorization: basicAuthHeader },
  // Ignore HTTPS cert errors (local dev)
  ignoreHTTPSErrors: true,
})

const page = await context.newPage()

// Capture console errors for diagnosis
const consoleErrors = []
page.on('console', msg => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text())
  }
})

// Capture failed requests
const failedRequests = []
page.on('requestfailed', req => {
  failedRequests.push({ url: req.url(), failure: req.failure()?.errorText })
})

// ── Navigate ──────────────────────────────────────────────────────────────────

try {
  const response = await page.goto(previewUrl, {
    waitUntil: 'networkidle',
    timeout,
  })

  if (!response || !response.ok()) {
    fail(`Page load failed`, `HTTP ${response?.status()} ${response?.statusText()}`)
    await browser.close()
    process.exit(1)
  }

  pass('Page loaded', `HTTP ${response.status()}`)
} catch (e) {
  fail('Page navigation failed', e.message)
  await browser.close()
  process.exit(1)
}

// ── Check 1: Not a white screen ───────────────────────────────────────────────

// FE shell mounted: look for sapMShell or sapUiShell or any sap-specific element
const shellLocator = page.locator('.sapMShell, .sapUiShell, [data-sap-ui-comp], .sapFDynamicPageContent').first()

try {
  await shellLocator.waitFor({ state: 'attached', timeout: timeout / 2 })
  pass('FE shell is mounted (no white screen)')
} catch {
  // Check if body has ANY visible content
  const bodyText = await page.locator('body').innerText().catch(() => '')
  if (bodyText.trim().length < 10) {
    fail(
      'White screen detected — FE shell did not mount',
      'Common causes: missing sap.m.Shell in Component.js, CDN blocked by tracking prevention, UI5 bootstrap failed. Use $fiori-preview (not standalone index.html)'
    )
  } else {
    warn('Shell selector not found but page has content', 'May be using a non-standard shell wrapper')
  }
}

// ── Check 2: No error dialogs ─────────────────────────────────────────────────

// SAP error dialogs: sap.m.Dialog with error type, or MessageBox
const errorDialog = page.locator('[role="dialog"] .sapMDialogHeader .sapMTitle').first()

let dialogTitle = null
try {
  dialogTitle = await errorDialog.innerText({ timeout: 3000 })
} catch {
  // no dialog — good
}

if (dialogTitle) {
  const isError = /error|fehler|err/i.test(dialogTitle)
  if (isError) {
    const dialogBody = await page.locator('[role="dialog"] .sapMDialogScroll').innerText().catch(() => '')
    fail(`Error dialog detected: "${dialogTitle}"`, dialogBody.slice(0, 200))
  } else {
    warn(`Dialog visible: "${dialogTitle}"`, 'May be expected (e.g. draft discard confirmation)')
  }
} else {
  pass('No error dialogs detected')
}

// ── Check 3: List Report has columns ─────────────────────────────────────────

// FE List Report renders a table with column headers
// Look for MDCTable column headers or SmartTable
const columnHeaders = page.locator('.sapMListTblHeaderCell, .sapUiTableCell.sapUiTableHeaderCell, [role="columnheader"]')

let headerCount = 0
try {
  await columnHeaders.first().waitFor({ state: 'visible', timeout: timeout / 2 })
  headerCount = await columnHeaders.count()
  pass(`List Report rendered with ${headerCount} column header(s)`)
} catch {
  fail(
    'No table column headers found',
    'List Report may have no UI.LineItem annotations, or the entity set is not exposed in $metadata'
  )
}

// ── Check 3b: Create button visible in List Report toolbar ───────────────────

// The Create button is rendered as a sap.m.Button with text matching common
// labels (Create / Crear / Neu / Créer). @UI.CreateHidden: false is required
// for non-draft entities; without it FE hides the button silently.
const createBtn = page.locator(
  'button.sapMBtn',
  { hasText: /^(Create|Crear|Neu|Créer|New)$/i }
).first()

try {
  const visible = await createBtn.isVisible({ timeout: 3000 })
  if (visible) {
    pass('Create button visible in List Report toolbar')
  } else {
    fail(
      'Create button NOT visible in List Report toolbar',
      'Add @UI.CreateHidden: false to the entity annotations — FE hides Create by default for non-draft entities'
    )
  }
} catch {
  fail(
    'Create button NOT visible in List Report toolbar',
    'Add @UI.CreateHidden: false to the entity annotations — FE hides Create by default for non-draft entities'
  )
}

// ── Screenshot (List Report state, before row click) ─────────────────────────

if (takeScreenshot) {
  const screenshotPath = `fe-validation-${serviceName}-${entityName}-list-${Date.now()}.png`
  await page.screenshot({ path: screenshotPath, fullPage: false })
  console.log(`\n  Screenshot (List Report): ${screenshotPath}`)
}

// ── Check 4: Row click navigates to ObjectPage ────────────────────────────────

// Only if there are actual data rows.
// FE List Report empty state renders as tr.sapMListNoData (not sapMLIB), so
// selecting tr.sapMLIB safely excludes the empty-state placeholder.
const dataRows = page.locator('tr.sapMLIB, .sapMListItem').filter({ hasNot: page.locator('.sapMListNoData') })

let rowCount = 0
try {
  rowCount = await dataRows.count()
} catch {
  rowCount = 0
}

if (rowCount === 0) {
  warn(
    'No data rows found — row click navigation not tested',
    'Seed CSV data to test ObjectPage navigation. Check db/data/*.csv files.'
  )
} else {
  const initialUrl = page.url()
  try {
    await dataRows.first().click({ timeout: 5000 })
    // Wait for URL change (navigation to ObjectPage)
    await page.waitForFunction(
      (originalUrl) => window.location.href !== originalUrl,
      initialUrl,
      { timeout: 8000 }
    )
    const newUrl = page.url()
    // ObjectPage URL should contain IsActiveEntity
    if (newUrl.includes('IsActiveEntity')) {
      pass('Row click navigated to ObjectPage', newUrl)
    } else {
      warn('URL changed after row click but IsActiveEntity not in URL', `New URL: ${newUrl}`)
    }
  } catch {
    fail(
      'Row click did not navigate to ObjectPage',
      'Common cause: missing "navigation" config in ListReport target in manifest.json — see references/09-cap-frontend-fiori.md'
    )
  }
}

// ── Screenshot (ObjectPage state, after row click) ───────────────────────────

if (takeScreenshot) {
  const screenshotPath = `fe-validation-${serviceName}-${entityName}-objectpage-${Date.now()}.png`
  await page.screenshot({ path: screenshotPath, fullPage: false })
  console.log(`  Screenshot (ObjectPage): ${screenshotPath}`)
}

// ── Console errors summary ────────────────────────────────────────────────────

if (consoleErrors.length > 0) {
  const relevantErrors = consoleErrors.filter(e =>
    /failed|error|cannot|could not|404|403|500/i.test(e)
  ).slice(0, 5)

  if (relevantErrors.length > 0) {
    warn(
      `${consoleErrors.length} browser console error(s)`,
      relevantErrors.join('\n    ')
    )
  }
}

// ── Cleanup & summary ─────────────────────────────────────────────────────────

await browser.close()

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

process.exit(0)
