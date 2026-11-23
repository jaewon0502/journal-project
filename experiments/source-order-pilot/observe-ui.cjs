'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixtureFile = path.join(__dirname, 'holdout.json');
assert.equal(hash(fixtureFile), '5b509ff0d910320f33806afca105bd2abf23ed84e33bef9c757f063173b7823c');
const fixture = require(fixtureFile);

async function main() {
  const reader = path.resolve(process.argv[2]);
  const engineSha = hash(path.join(reader, 'factcheck-engine.js'));
  assert.equal(engineSha, process.argv[3]);
  const browser = await chromium.launch({channel:'chrome'});
  const rows = [];
  const browserErrors = [];
  try {
    for (const [bundle, records] of Object.entries(fixture.bundles)) {
      for (const label of ['party-a', 'party-b']) {
        const page = await browser.newPage();
        page.on('pageerror', e => browserErrors.push(String(e)));
        page.on('dialog', d => d.accept());
        try {
          const claims = fixture.claims.filter(c => c.bundle === bundle);
          const texts = claims.map(c => fixture.prefixes[label] + c.text);
          await page.goto(pathToFileURL(path.join(reader,'factcheck.html')).href);
          await page.locator('#article').fill(texts.join('\n'));
          await page.locator('#article-form [type=submit]').click();
          const sourcesPanel = page.locator('#sources-panel');
          if (await sourcesPanel.getAttribute('open') === null) await sourcesPanel.locator(':scope > summary').click();
          for (const [slot, record] of records.entries()) {
            for (const field of ['title','version','locator','excerpt']) {
              await page.locator('#source-' + field).fill(record[field]);
            }
            await page.locator('#source-url').fill('https://source-order.invalid/' + fixture.slotIds[slot]);
            await page.locator('#source-save').click();
          }
          for (const [index, claim] of claims.entries()) {
            await page.locator('#row-list button').nth(index).click();
            assert.equal(await page.locator('#row-text').textContent(), texts[index]);
            const opened = await page.locator('#row-sources .source:has(details[open]) label span').first().allTextContents();
            const title = opened[0];
            const key = title ? records.find(d => title === d.title || title === d.title + ' · ' + d.version)?.key : null;
            assert.ok(!title || key, 'Unrecognized open document');
            rows.push({
              id: claim.id, label, opened: key,
              suggested: await page.locator('#row-sources .badge').count(),
              checkedSources: await page.locator('#row-sources input:checked').count(),
              verdict: await page.locator('#verdict').inputValue(),
              acknowledged: await page.locator('#acknowledged').isChecked(),
              attributionContent: await page.locator('#content-status').inputValue()
            });
          }
        } finally { await page.close(); }
      }
    }
    assert.deepEqual(browserErrors, []);
    console.log(JSON.stringify({engineSha, browser:browser.version(),
      htmlSha:hash(path.join(reader,'factcheck.html')), uiSha:hash(path.join(reader,'factcheck-ui.js')), rows}, null, 2));
  } finally {await browser.close();}
}
main().catch(e => {console.error(e);process.exitCode=1;});
