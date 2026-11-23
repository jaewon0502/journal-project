'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const digest = f => createHash('sha256').update(readFileSync(f)).digest('hex');

async function main() {
  const reader = path.resolve(process.argv[2] || 'docs/reader');
  const fixturePath = path.join(__dirname, 'holdout.json');
  const fixture = require(fixturePath);
  const fixtureHash = digest(fixturePath);
  const ruleHash = digest(path.join(__dirname, '..', 'ui-rule.json'));
  assert.equal(fixtureHash, '09b371de9a1371825fcfb84213d93c7fc2a81afd8063680069eaf6859861f4a3');
  assert.equal(ruleHash, 'c3803305c82cfc9d2af9eb8f3b810851e5d33db0d2184156be74607719176dba');
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(pathToFileURL(path.join(reader, 'factcheck.html')).href);
    await page.locator('#article').fill('자료에서 확인한다.');
    await page.locator('#article-form [type=submit]').click();
    for (const id of ['sources-panel', 'finder']) {
      const panel = page.locator('#' + id);
      if (await panel.getAttribute('open') === null) await panel.locator(':scope > summary').click();
    }
    const results = [];
    for (const {id, source, query, gold} of fixture.queries) {
      const lines = fixture.sources[source].lines;
      await page.locator('#document-text').fill(lines.join('\n'));
      await page.locator('#document-query').fill(query);
      await page.locator('#find-passages').click();
      const candidates = [], visible = [];
      for (const card of await page.locator('#finder-results .source').all()) {
        const strong = await card.locator(':scope > strong').textContent();
        const n = Number(/(\d+)문단/u.exec(strong)[1]);
        assert.equal(await card.locator(':scope > blockquote').textContent(), lines[n - 1]);
        candidates.push(n);
        if (!(await card.locator('xpath=ancestor::details[not(@open)]').count()) && await card.isVisible()) visible.push(n);
      }
      const status = await page.locator('#finder-status').innerText();
      const foldLabels = await page.locator('#finder-results > details:not([open]) > summary').allInnerTexts();
      results.push({id, gold, candidates, visible, foldLabels, status});
    }
    assert.deepEqual(errors, []);
    const files = ['factcheck.html','factcheck-ui.js','evidence-search.js','evidence-trend.js','evidence-finder.js','evidence-period.js','evidence-columns.js'];
    console.log(JSON.stringify({fixtureHash, ruleHash, hashes: Object.fromEntries(files.map(f => [f,digest(path.join(reader,f))])),
      browser:browser.version(), results}, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
