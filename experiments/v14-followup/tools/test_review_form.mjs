/** Actual Chromium UI checks. Every input is synthetic UI-test data, never a human review.
 * Needs Playwright on NODE_PATH; optional BROWSER_EXECUTABLE selects an installed Chromium.
 * No server or external request is used. The HTML is opened with file://.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const htmlPath = path.join(root, 'experiments/v14-followup/review.html');
const key = 'journal-v14-followup-K01-P3-human-draft-schema2';
const fields = ['necessity', 'meaning', 'evidence', 'contextSafety', 'preservationImportance'];
const results = [];
const errors = [];
const externalRequests = [];
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined});

async function newPage(init) {
  const context = await browser.newContext({acceptDownloads: true});
  await context.route(/^https?:/, route => { externalRequests.push(route.request().url()); return route.abort(); });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(htmlPath).href);
  return page;
}
async function snapshot(page) {
  return page.evaluate(() => ({
    judgments: [...document.querySelectorAll('input[type=radio]:checked')].map(input => [input.name, input.value]),
    reviewedAt: document.getElementById('reviewedAt').value,
    exposure: document.getElementById('priorAiExposure').value,
    unverified: document.getElementById('unverified').value,
    comments: document.getElementById('comments').value
  }));
}
async function exportDraft(page) {
  const waiting = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await waiting;
  assert.equal(download.suggestedFilename(), 'journal-v14-K01-P3-review-draft-schema2.json');
  const data = JSON.parse(await readFile(await download.path(), 'utf8'));
  await download.delete();
  assert.equal(data.recordType, 'human-review-draft');
  return data;
}
const clone = value => structuredClone(value);
try {
  const page = await newPage();
  assert.equal(await page.locator('input[type=radio]').count(), 15);
  assert.equal(await page.locator('input[type=radio][checked]').count(), 0);
  assert.equal(await page.locator('input[type=radio]:checked').count(), 0);
  assert.deepEqual(await snapshot(page), {judgments: [], reviewedAt: '', exposure: '', unverified: '', comments: ''});
  assert.equal(await page.locator('#ai-review').getAttribute('open'), null);
  assert.equal(await page.locator('script[src],link[rel=stylesheet],img,iframe,form').count(), 0);
  assert.equal(await page.locator('input[name=contextSafety]').count(), 3);
  const target = JSON.parse(await page.locator('#review-target').textContent());
  const canonical = JSON.stringify(Object.fromEntries(Object.keys(target).sort().map(name => [name, target[name]])));
  const targetHash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  assert.equal(await page.locator('#target-hash').textContent(), targetHash);
  assert.equal(await page.locator('#source-excerpt').textContent(), target.sourceExcerpt);
  assert.equal(await page.locator('#proposed-text').textContent(), target.proposedText);
  assert.equal(await page.locator('#evidence-locator').textContent(), target.evidenceLocator);
  const empty = await exportDraft(page);
  assert.equal(empty.schemaVersion, 2);
  assert.equal(empty.reviewTarget, 'K01/P3');
  assert.equal(empty.reviewTargetHash, targetHash);
  assert.deepEqual(empty.judgments, Object.fromEntries(fields.map(name => [name, null])));
  assert.equal(empty.reviewedAt, null);
  assert.equal(empty.priorAiExposureSelfReport, null);
  assert.equal(empty.interactionSessions[0].firstJudgmentAt, null);
  assert.equal(empty.interactionSessions[0].aiFirstOpenedAt, null);
  results.push('Empty defaults; distinct human axes; exact target payload/hash; valid empty-draft JSON download');

  for (const [name, value] of Object.entries({necessity:'필요', meaning:'보존됨', evidence:'불확실', contextSafety:'안전하지 않음', preservationImportance:'낮음'})) {
    await page.locator(`input[name="${name}"][value="${value}"]`).check();
  }
  await page.locator('#reviewedAt').fill('2026-10-03T15:00:00+09:00');
  await page.locator('#priorAiExposure').selectOption('no');
  await page.locator('#unverified').fill('UI TEST ONLY — 합성 미확인 자료');
  await page.locator('#comments').fill('UI TEST ONLY — 합성 판단, 실제 사람 응답 아님');
  const beforeAi = await snapshot(page);
  await page.locator('#ai-review summary').click();
  assert.deepEqual(await snapshot(page), beforeAi, 'Opening AI must not fill or change human data');
  let exported = await exportDraft(page);
  assert.equal(exported.interactionSessions[0].aiFirstOpenPhase, 'after_first_judgment');
  assert.equal(exported.interactionSessions[0].judgmentChangesAfterAiOpened, 0);
  await page.locator('input[name=contextSafety][value="불확실"]').check();
  await page.locator('#comments').fill('UI TEST ONLY — AI 열기 뒤 합성 변경');
  await page.locator('#priorAiExposure').selectOption('unsure');
  await page.locator('#save').click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  assert.equal(saved.interactionSessions[0].judgmentChangesAfterAiOpened, 1);
  assert.equal(saved.interactionSessions[0].narrativeChangesAfterAiOpened, 1);
  assert.equal(saved.interactionSessions[0].metadataChangesAfterAiOpened, 1);
  assert.equal(saved.judgments.meaning, '보존됨');
  assert.equal(saved.judgments.preservationImportance, '낮음');
  assert.equal(saved.reviewedAt, '2026-10-03T15:00:00+09:00');
  assert.equal(saved.priorAiExposureSelfReport, 'unsure');
  assert.equal(await page.evaluate(() => localStorage.getItem('journal-v14-human-review-draft-v1')), null);
  const savedInputs = await snapshot(page);
  await page.reload();
  assert.deepEqual(await snapshot(page), {judgments: [], reviewedAt: '', exposure: '', unverified: '', comments: ''});
  await page.locator('#restore').click();
  assert.deepEqual(await snapshot(page), savedInputs);
  exported = await exportDraft(page);
  assert.equal(exported.interactionSessions.length, 2);
  assert.equal(exported.interactionSessions[1].firstJudgmentAt, null);
  assert.equal(exported.interactionSessions[1].restoredDraftCount, 1);
  assert.equal(exported.interactionSessions[1].aiFirstOpenedAt, null);
  await page.locator('#ai-review summary').click();
  exported = await exportDraft(page);
  assert.equal(exported.interactionSessions[1].aiFirstOpenPhase, 'before_first_judgment');
  assert.equal(exported.interactionSessions[0].aiFirstOpenPhase, 'after_first_judgment');
  results.push('Human input/save/reload/manual restore; no auto restore; no AI auto-fill; separate restored-session and current-session exposure traces');
  results.push('AI opened after first judgment and edits after opening counted; meaning preservation and preservation importance remain distinct');

  const mutations = [
    ['wrong target', data => { data.reviewTarget = 'K01/P2'; }],
    ['wrong hash', data => { data.reviewTargetHash = '0'.repeat(64); }],
    ['old schema', data => { data.schemaVersion = 1; }],
    ['wrong document', data => { data.documentId = 'journal-v14'; }],
    ['wrong record type', data => { data.recordType = 'completed-review'; }],
    ['invalid judgment enum', data => { data.judgments.contextSafety = 'yes'; }],
    ['missing judgment', data => { delete data.judgments.preservationImportance; }],
    ['wrong text type', data => { data.comments = []; }],
    ['invalid review time', data => { data.reviewedAt = '2026-02-30T12:00:00Z'; }],
    ['invalid exposure', data => { data.priorAiExposureSelfReport = false; }],
    ['invalid interaction count', data => { data.interactionSessions[0].judgmentChangesAfterAiOpened = -1; }],
    ['missing interaction field', data => { delete data.interactionSessions[0].aiFirstOpenPhase; }],
    ['duplicate session id', data => { data.interactionSessions.push(clone(data.interactionSessions[0])); }],
    ['unexpected root field', data => { data.confirmedHumanReviews = 1; }],
    ...Object.keys(saved).map(name => [`missing ${name}`, data => { delete data[name]; }])
  ];
  const untouched = await snapshot(page);
  for (const [label, mutate] of mutations) {
    const invalid = clone(saved); mutate(invalid);
    await page.evaluate(({key, invalid}) => localStorage.setItem(key, JSON.stringify(invalid)), {key, invalid});
    await page.locator('#restore').click();
    assert.match(await page.locator('#message').textContent(), /복원하지 못했습니다/);
    assert.deepEqual(await snapshot(page), untouched, `${label} must not overwrite current inputs`);
  }
  await page.evaluate(key => localStorage.setItem(key, '{invalid JSON'), key);
  await page.locator('#restore').click();
  assert.deepEqual(await snapshot(page), untouched);
  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.locator('#restore').click();
  assert.match(await page.locator('#message').textContent(), /저장 초안이 없습니다/);
  assert.deepEqual(await snapshot(page), untouched);
  results.push(`Strict restore rejection preserves current input for ${mutations.length} invalid schemas/targets plus malformed JSON and missing storage`);

  await page.locator('#reviewedAt').fill('2026-02-30T15:00:00+09:00');
  await page.locator('#save').click();
  assert.match(await page.locator('#message').textContent(), /유효한 ISO 8601/);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
  await page.locator('#reviewedAt').fill('');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No page overflow at ${width}px`);
  }
  results.push('Invalid entered date rejected without saving; 320/390/768/1440px page width checked');

  const aiFirst = await newPage();
  await aiFirst.locator('#ai-review summary').click();
  await aiFirst.locator('input[name=necessity][value="불확실"]').check();
  const firstExport = await exportDraft(aiFirst);
  assert.equal(firstExport.interactionSessions[0].aiFirstOpenPhase, 'before_first_judgment');
  assert.equal(firstExport.interactionSessions[0].judgmentChangesAfterAiOpened, 1);
  const narrativeFirst = await newPage();
  await narrativeFirst.locator('#comments').fill('UI TEST ONLY — 서술부터 입력');
  await narrativeFirst.locator('#ai-review summary').click();
  assert.equal((await exportDraft(narrativeFirst)).interactionSessions[0].aiFirstOpenPhase, 'after_first_judgment');
  results.push('AI-before-first-judgment case and narrative-first case recorded honestly');

  const unavailable = await newPage(() => {
    Storage.prototype.setItem = () => { throw new DOMException('UI TEST ONLY', 'SecurityError'); };
    Storage.prototype.getItem = () => { throw new DOMException('UI TEST ONLY', 'SecurityError'); };
  });
  await unavailable.locator('#comments').fill('UI TEST ONLY — storage unavailable');
  await unavailable.locator('#save').click();
  assert.match(await unavailable.locator('#message').textContent(), /브라우저 저장에 실패/);
  await unavailable.locator('#restore').click();
  assert.match(await unavailable.locator('#message').textContent(), /복원하지 못했습니다/);
  const unavailableExport = await exportDraft(unavailable);
  assert.equal(unavailableExport.comments, 'UI TEST ONLY — storage unavailable');
  results.push('Unavailable localStorage reports failure; input remains and JSON export still works');

  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  const html = await readFile(htmlPath);
  const evidence = {
    evidenceType: 'synthetic-browser-ui-test-only', actualHumanReviewCount: 0, testedAt: new Date().toISOString(),
    browser: await browser.version(), transport: 'local file://; no server',
    targetSha256: targetHash, htmlSha256: createHash('sha256').update(html).digest('hex'),
    externalHttpRequests: externalRequests.length, javascriptErrors: errors.length,
    passedChecks: results,
    limitations: [
      'Synthetic inputs exercise UI behavior only; no person response, semantic validation, blinded evaluation, or comparison completion.',
      'file:// persistence passed in this tested Chromium environment; other browsers, private modes, and previews may differ.',
      'Reference hyperlinks were preserved but not opened; source truth and current availability were not reverified.'
    ]
  };
  await writeFile(path.join(root, 'experiments/v14-followup/tools/review-form-browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({passedChecks: results.length, externalHttpRequests: 0, javascriptErrors: 0, targetSha256: targetHash}));
} finally {
  await browser.close();
}
