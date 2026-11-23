'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const fixtureFile = path.join(__dirname, 'holdout.json');
const fixtureSha = hash(fixtureFile);
assert.equal(fixtureSha, '5b509ff0d910320f33806afca105bd2abf23ed84e33bef9c757f063173b7823c');
const fixture = require(fixtureFile);

async function observeGroup(browser, reader, group) {
  const {bundle, rotation, label} = group;
  const records = fixture.orders[rotation].map(index => fixture.bundles[bundle][index]);
  const claims = fixture.claims.filter(claim => claim.bundle === bundle);
  const texts = claims.map(claim => fixture.prefixes[label] + claim.text);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  page.on('dialog', d => d.accept());
  try {
    await page.goto(pathToFileURL(path.join(reader, 'factcheck.html')).href);
    await page.locator('#article').fill(texts.join('\n'));
    await page.locator('#article-form [type=submit]').click();
    const panel = page.locator('#sources-panel');
    if (await panel.getAttribute('open') === null) await panel.locator(':scope > summary').click();
    for (const [slot, record] of records.entries()) {
      for (const field of ['title','version','locator','excerpt']) {
        await page.locator('#source-' + field).fill(record[field]);
      }
      await page.locator('#source-url').fill('https://source-order.invalid/' + fixture.slotIds[slot]);
      await page.locator('#source-save').click();
    }
    assert.equal(await page.locator('#row-list button').count(), claims.length);
    const rows = [];
    for (const [index, claim] of claims.entries()) {
      await page.locator('#row-list button').nth(index).click();
      assert.equal(await page.locator('#row-text').textContent(), texts[index]);
      const openLabels = await page.locator('#row-sources > .source:has(> details[open]) > label span:first-of-type').allTextContents();
      assert(openLabels.length <= 1, 'More than one open document');
      const opened = openLabels.length ? records.find(record => {
        const text = openLabels[0];
        return text === record.title || text === record.title + ' · ' + record.version;
      })?.key : null;
      assert.ok(!openLabels.length || opened, 'Unknown open-document label');
      const shownAlerts = await page.locator('#row-sources > .callout:visible').allInnerTexts();
      assert.equal(await page.locator('#row-sources > .source').count(), records.length);
      rows.push({
        id: claim.id, gold: claim.gold, bundle, rotation, label,
        warningText: shownAlerts, opened, suggested: await page.locator('#row-sources .badge').count(),
        checkedSources: await page.locator('#row-sources input:checked').count(),
        verdict: await page.locator('#verdict').inputValue(), acknowledged: await page.locator('#acknowledged').isChecked(),
        attributionContent: await page.locator('#content-status').inputValue()
      });
    }
    assert.deepEqual(errors, []);
    return rows;
  } finally { await page.close(); }
}

function summary(rows) {
  const answerable = rows.filter(r => r.gold);
  const controls = rows.filter(r => !r.gold);
  return {
    count: rows.length, positiveCount: answerable.length, controlCount: controls.length,
    correctFirstOpened: answerable.filter(r => r.opened === r.gold).length,
    positiveWarnings: answerable.filter(r => r.warningText.length).length,
    positiveNoOpen: answerable.filter(r => !r.opened).length,
    controlWarnings: controls.filter(r => r.warningText.length).length,
    controlNoOpen: controls.filter(r => !r.opened).length,
    controlWarnedAndNoOpen: controls.filter(r => r.warningText.length && !r.opened).length,
    withCheckedSource: rows.filter(r => r.checkedSources).length,
    withVerdict: rows.filter(r => r.verdict).length,
    withAcknowledgement: rows.filter(r => r.acknowledged).length,
    withVerifiedAttributionContent: rows.filter(r => r.attributionContent !== 'unverified').length
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw Error('Usage: node observe-ui-retest.cjs reader-dir expected-engine-sha256 expected-ui-sha256');
  const [directory, engineSha, uiSha] = args;
  const reader = path.resolve(directory);
  assert.equal(hash(path.join(reader, 'factcheck-engine.js')), engineSha);
  assert.equal(hash(path.join(reader, 'factcheck-ui.js')), uiSha);
  const htmlSha = hash(path.join(reader, 'factcheck.html'));
  const groups = [];
  for (const bundle of Object.keys(fixture.bundles)) {
    for (const rotation of fixture.orders.keys()) {
      for (const label of Object.keys(fixture.prefixes)) groups.push({bundle, rotation, label});
    }
  }
  const browser = await chromium.launch({channel:'chrome'});
  try {
    const rows = [];
    for (let start = 0; start < groups.length; start += 3) {
      const batch = await Promise.all(groups.slice(start, start+3).map(group => observeGroup(browser, reader, group)));
      rows.push(...batch.flat());
    }
    assert.equal(new Set(rows.map(r => [r.id,r.rotation,r.label].join('/'))).size, 72);
    const summaryByClaim = Object.fromEntries(fixture.claims.map(c => [c.id, summary(rows.filter(r => r.id === c.id))]));
    console.log(JSON.stringify({stage:'post-disclosure UI retest', fixtureSha, engineSha, uiSha, htmlSha,
      browser:browser.version(), summary:summary(rows), summaryByClaim, rows}, null, 2));
  } finally {await browser.close();}
}
main().catch(e => {console.error(e); process.exitCode=1;});
