import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  httpCredentials: { username: 'alice', password: 'alice' },
  extraHTTPHeaders: { Authorization: 'Basic ' + Buffer.from('alice:alice').toString('base64') }
});
const page = await ctx.newPage();

const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text().substring(0, 500));
});

// Navigate directly to a draft ObjectPage
const url = 'http://localhost:4004/urgent-procurement-ui/webapp/index.html#/Cases(ID=11111111-0001-0001-0001-000000000001,IsActiveEntity=false)';
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

await page.screenshot({ path: 'pw-attach-objectpage.png', fullPage: false });
console.log('URL:', page.url());

// Find Adjuntos tab
const tabs = await page.locator('[role=tab]').all();
const tabTexts = await Promise.all(tabs.map(t => t.innerText()));
console.log('Tabs:', tabTexts);

// Click on Adjuntos tab
const adjuntosTab = page.locator('[role=tab]', { hasText: 'Adjuntos' });
if (await adjuntosTab.count() > 0) {
  await adjuntosTab.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'pw-attach-tab.png', fullPage: false });
}

// Find the Crear button in Adjuntos section
const crearBtns = await page.locator('button', { hasText: /^Crear$/ }).all();
console.log('Crear buttons found:', crearBtns.length);

for (let i = 0; i < crearBtns.length; i++) {
  const isDisabled = await crearBtns[i].isDisabled();
  const isVisible = await crearBtns[i].isVisible();
  console.log(`Crear[${i}]: visible=${isVisible} disabled=${isDisabled}`);
}

// Try clicking the last Crear (child table Crear, not the main one)
if (crearBtns.length > 0) {
  const btn = crearBtns[crearBtns.length - 1];
  await btn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'pw-attach-after-crear.png', fullPage: false });
  console.log('After Crear click URL:', page.url());
}

console.log('\nCONSOLE ERRORS:');
errors.slice(0, 10).forEach(e => console.log(e));

await browser.close();
