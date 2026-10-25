const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const failures = [];
  const prefix = '/tensorboard/viewer-acceptance/';
  page.on('response', r => {
    if (r.url().includes('/data/') && !r.ok()) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', r => {
    if (r.url().includes('/data/')) failures.push(`${r.failure()?.errorText} ${r.url()}`);
  });
  try {
    await page.goto(`http://127.0.0.1:6006${prefix}`, {waitUntil:'networkidle'});
    for (const name of ['Scalars', 'Images', 'Graphs']) {
      const tab = page.getByRole('tab', {name, exact:true});
      await tab.click();
      await page.waitForLoadState('networkidle');
      if (!new URL(page.url()).pathname.startsWith(prefix)) throw Error(`Escaped prefix: ${page.url()}`);
      if (await page.getByText('Failed to fetch runs', {exact:false}).count()) throw Error('Failed to fetch runs');
    }
    if (failures.length) throw Error(JSON.stringify(failures));
    console.log('Browser scalar/image/graph navigation retained path prefix; all data requests passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
