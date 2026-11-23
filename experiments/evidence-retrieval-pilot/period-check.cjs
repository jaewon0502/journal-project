'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const fixturePath = path.join(__dirname, 'period-holdout.json');
const fixture = require(fixturePath);
const digest = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
const label = (year, month) => year + '년' + (month ? ' ' + Number(month) + '월' : '');
const wageRun = process.argv.includes('--wage');
const reader = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'docs/reader');
const fixtureHash = digest(fixturePath);
assert.equal(fixtureHash, '361e2ace39b0f015adf80929efc37e5c678f67727364a9ec9eb628f83695703b');

async function searchCards(page, lines, query) {
  await page.locator('#document-text').fill(lines.join('\n'));
  await page.locator('#document-query').fill(query);
  await page.locator('#find-passages').click();
  const observed = new Map();
  for (const card of await page.locator('#finder-results > .source').all()) {
    const h = await card.locator(':scope > strong').innerText();
    const number = Number(/(\d+)문단/u.exec(h)[1]);
    const normalize = text => text.replace(/\s+/gu, ' ').trim();
    assert.equal(normalize(await card.locator(':scope > blockquote').innerText()), normalize(lines[number - 1]));
    const warnings = card.locator(':scope > .callout:visible');
    observed.set(number, await warnings.allInnerTexts());
  }
  return observed;
}

async function check() {
  const browser = await chromium.launch({channel: 'chrome'});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(pathToFileURL(path.join(reader, 'factcheck.html')).href);
    await page.locator('#article').fill('지진의 발생 시각을 확인한다.');
    await page.locator('#article-form [type=submit]').click();
    for (const id of ['sources-panel', 'finder']) {
      const panel = page.locator('#' + id);
      if (await panel.getAttribute('open') === null) await panel.locator(':scope > summary').click();
    }
    if (wageRun) {
      const sourceFile = path.join(__dirname, 'holdout.json');
      const sourceHash = digest(sourceFile);
      assert.equal(sourceHash, '14be8517e99104ff7a4d3b7ec4b1344ed3ddfeaa75961c92015898f97f27723a');
      const original = require(sourceFile);
      const lines = original.sources.wage.lines;
      const results = [];
      let manualRecovery = null;
      for (const {id, query, gold} of original.queries.filter(q => q.source === 'wage' && q.gold.length)) {
        const observed = await searchCards(page, lines, query);
        results.push({id, gold, cards: [...observed].map(([paragraph, warnings]) => ({paragraph, warnings}))});
        if (id === 'w2' && !observed.has(7) && [...observed.keys()][0] === 6 && observed.get(6)?.length) {
          const first = page.locator('#finder-results > .source').first();
          const details = first.locator('details');
          assert.equal(await details.getAttribute('open'), null);
          await details.getByText('주변 원문 확인', {exact: true}).click();
          const target = details.locator('input[type=radio][value="7"]');
          await target.waitFor({state: 'visible', timeout: 3000});
          await target.check();
          await details.getByRole('button', {name: '선택한 행을 발췌문으로 사용'}).click();
          assert.equal(await page.locator('#source-excerpt').inputValue(), lines[6]);
          manualRecovery = {id, firstCandidate: 6, expansions: 1, selectedParagraph: 7, excerptMatchedExactly: true};
        }
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ fixtureHash: sourceHash, periodHash: digest(path.join(reader, 'evidence-period.js')),
        uiHash: digest(path.join(reader, 'factcheck-ui.js')), finderHash: digest(path.join(reader, 'evidence-finder.js')),
        browser: browser.version(), results, manualRecovery }, null, 2));
      return;
    }
    const results = [];
    for (const probe of fixture.probes) {
      const lines = probe.sourceForm === 'full' ? [fixture.fullRow] : fixture.lines;
      const observed = await searchCards(page, lines, probe.query);
      for (const target of probe.targets) {
        const warnings = observed.get(target) || [];
        let pass = null;
        if (observed.has(target) && probe.type !== 'exploratoryRankFirst') {
          if (['wrongYear', 'wrongMonth'].includes(probe.type)) {
            const [year, month] = lines[target - 1].slice(0, 7).split('-');
            const parts = /질문에 적힌 시점은 (.+?), 이 행 첫 칸은 (.+?)입니다/u.exec(warnings[0] || '');
            const validSource = [label(year, month)];
            if (probe.type === 'wrongYear') validSource.push(label(year));
            pass = warnings.length === 1 && !!parts && parts[1] === label(...probe.asked) && validSource.includes(parts[2]);
          } else {
            pass = warnings.length === 0;
          }
        }
        results.push({ id: probe.id, type: probe.type, target, candidateOrder: [...observed.keys()], returned: observed.has(target), warnings, pass });
      }
    }
    assert.deepEqual(errors, []);
    const metrics = {};
    for (const type of new Set(results.map(r => r.type))) {
      const entries = results.filter(r => r.type === type);
      metrics[type] = { intended: entries.length, returned: entries.filter(r => r.returned).length,
        passed: type === 'exploratoryRankFirst' ? null : entries.filter(r => r.pass === true).length,
        warned: entries.filter(r => r.warnings.length).length };
    }
    console.log(JSON.stringify({ fixtureHash, periodHash: digest(path.join(reader, 'evidence-period.js')),
      uiHash: digest(path.join(reader, 'factcheck-ui.js')), finderHash: digest(path.join(reader, 'evidence-finder.js')),
      browser: browser.version(), metrics, results }, null, 2));
  } finally {
    await browser.close();
  }
}
check().catch(error => { console.error(error); process.exitCode = 1; });
