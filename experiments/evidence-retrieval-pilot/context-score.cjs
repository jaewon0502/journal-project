'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

function hash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function main() {
  const readerDir = path.resolve(process.argv[2] || 'docs/reader');
  const fixtureHash = hash(path.join(__dirname, 'holdout.json'));
  const ruleHash = hash(path.join(__dirname, 'context-rule.json'));
  assert.equal(fixtureHash, '14be8517e99104ff7a4d3b7ec4b1344ed3ddfeaa75961c92015898f97f27723a');
  assert.equal(ruleHash, 'a81c68aa2b95d426649261c97fa97ccc4adb9e0f0b1e437f5920993fdd15aa5f');
  const fixture = require('./holdout.json');
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(pathToFileURL(path.join(readerDir, 'factcheck.html')).href);
    await page.locator('#article').fill('자료에서 인상률을 확인한다.');
    await page.locator('#article-form [type=submit]').click();
    for (const id of ['sources-panel', 'finder']) {
      const panel = page.locator('#' + id);
      if (await panel.getAttribute('open') === null) await panel.locator(':scope > summary').click();
    }

    const results = [];
    for (const { id, gold, query, source } of fixture.queries.filter(row => row.gold.length)) {
      const { lines } = fixture.sources[source];
      await page.locator('#document-text').fill(lines.join('\n'));
      await page.locator('#document-query').fill(query);
      await page.locator('#find-passages').click();
      const cards = page.locator('#finder-results > .source');
      const centers = [], visibleContext = new Set();
      assert(await cards.count() <= 3);
      for (const card of await cards.all()) {
        const heading = await card.locator(':scope > strong').innerText();
        const center = Number(/(\d+)문단/u.exec(heading)[1]);
        const normalize = text => text.replace(/\s+/gu, ' ').trim();
        assert.equal(normalize(await card.locator(':scope > blockquote').innerText()), normalize(lines[center - 1]));
        centers.push(center);
        for (const row of await card.locator('ol > li[value]').all()) {
          if (!(await row.isVisible()) || await row.locator('xpath=ancestor::details[not(@open)]').count()) continue;
          const n = Number(await row.getAttribute('value'));
          const numbered = await row.evaluate(el => getComputedStyle(el).listStyleType !== 'none');
          if (numbered && n !== center && normalize(await row.locator('.verbatim').innerText()) === normalize(lines[n - 1])) visibleContext.add(n);
        }
      }
      const centerHit = centers.some(n => gold.includes(n));
      results.push({ id, centers, visibleContext: [...visibleContext], centerHit,
        contextOnly: !centerHit && gold.some(n => visibleContext.has(n)) });
    }
    assert.deepEqual(errors, [], 'Reader threw an error during search');
    const centerHits = results.filter(row => row.centerHit).length;
    const contextOnly = results.filter(row => row.contextOnly).length;
    console.log(JSON.stringify({ fixtureHash, ruleHash, finderHash: hash(path.join(readerDir, 'evidence-finder.js')),
      uiHash: hash(path.join(readerDir, 'factcheck-ui.js')), browser: browser.version(),
      metrics: { answerable: results.length, centerHits, centerMisses: results.length - centerHits, contextOnly,
        centerOrVisibleContext: centerHits + contextOnly }, results }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
