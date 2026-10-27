const assert = require('assert');
const fs = require('fs');

describe('Exact-source private pipeline namespace switching', () => {
  it('shows A then B then A without reloading and sends only the selected namespace', async () => {
    await browser.url('/#/pipelines');
    await browser.waitUntil(async () => browser.execute(() => !!window.namespaceFixtureHandler?.onNamespaceSelected), { timeout: 60000 });
    const navigation = await browser.execute(() => performance.timeOrigin);
    const evidence = [];
    for (const [index, namespace] of ['fixture-a', 'fixture-b', 'fixture-a'].entries()) {
      const before = fs.existsSync('/tmp/evidence/requests.jsonl') ? fs.readFileSync('/tmp/evidence/requests.jsonl', 'utf8').split('\n').filter(Boolean).length : 0;
      await browser.execute(ns => window.namespaceFixtureHandler.onNamespaceSelected(ns), namespace);
      const other = namespace === 'fixture-a' ? 'fixture-b' : 'fixture-a';
      await browser.waitUntil(async () => browser.execute((ns, excluded) => document.body.innerText.includes(ns + '-only') && !document.body.innerText.includes(excluded + '-only'), namespace, other), { timeout: 60000, timeoutMsg: 'Private inventory did not follow namespace ' + namespace });
      assert.strictEqual(await browser.execute(() => performance.timeOrigin), navigation);
      await browser.saveScreenshot(`/tmp/evidence/${index}-${namespace}.png`);
      const requests = fs.readFileSync('/tmp/evidence/requests.jsonl', 'utf8').split('\n').filter(Boolean).slice(before).map(JSON.parse).filter(record => {
        const url = new URL(record.path, 'http://fixture');
        return /\/pipelines$/.test(url.pathname) && url.searchParams.has('namespace');
      });
      assert(requests.length > 0, 'No real namespace pipeline list request observed');
      for (const record of requests) {
        assert.strictEqual(new URL(record.path, 'http://fixture').searchParams.get('namespace'), namespace);
        assert.strictEqual(record.status, 200);
      }
      evidence.push({ namespace, requests, pageReloaded: false });
    }
    fs.writeFileSync('/tmp/evidence/result.json', JSON.stringify({ outcome: 'passed', applicationSha: 'e2ccfb1022fcdc748d7f4126d33e99b1c8e58e67', dashboardTransport: 'simulated callback; real UI and API', steps: evidence }, null, 2));
  });
  afterEach(async function () {
    if (this.currentTest.state !== 'passed') {
      await browser.saveScreenshot('/tmp/evidence/failure.png');
      fs.writeFileSync('/tmp/evidence/failure.html', await browser.getPageSource());
    }
  });
});
