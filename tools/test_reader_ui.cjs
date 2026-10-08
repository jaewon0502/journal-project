/* Integration regressions execute the generated reader in a simulated DOM.
   This does not replace real browser, layout, accessibility or human testing. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../docs/reader/index.html'), 'utf8');
const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/reader-data.json'), 'utf8'));

function setup(t, { mode = 'review', storageFailure = false, localFailure = false, query = '', mobile = false } = {}) {
  const downloads = [], errors = [], scrolls = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, {
    url: `https://reader.example.test/index.html?mode=${mode}${query}`,
    runScripts: 'dangerously', virtualConsole: console,
    beforeParse(w) {
      w.matchMedia = query => ({ matches: mobile && query.includes('max-width:680px'), addEventListener() {}, removeEventListener() {} });
      w.HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ id: this.id, options }); };
      w.URL.createObjectURL = blob => { downloads.push(blob); return `blob:reader-test-${downloads.length}`; };
      w.URL.revokeObjectURL = () => {};
      if (storageFailure) Object.defineProperty(w, 'sessionStorage', { value: {
        getItem: () => null,
        setItem: () => { throw new w.DOMException('No storage space', 'QuotaExceededError'); }
      }});
      if (localFailure) Object.defineProperty(w, 'localStorage', { value: {
        getItem: () => null,
        setItem: () => { throw new w.DOMException('Storage blocked', 'SecurityError'); }
      }});
      w.document.addEventListener('click', event => {
        if (event.target.closest('a[download]')) event.preventDefault();
      });
    }
  });
  const w = dom.window, d = w.document;
  t.after(() => { assert.deepEqual(errors, [], 'No script errors'); w.close(); });
  const get = id => d.getElementById(id);
  const click = id => { get(id).focus(); get(id).click(); };
  const fill = (id, value) => { get(id).value = value; get(id).dispatchEvent(new w.Event('input', { bubbles: true })); };
  const choose = id => { get('review-target').value = id; get('review-target').dispatchEvent(new w.Event('change', { bubbles: true })); };
  const readBlob = blob => new Promise((resolve, reject) => {
    const reader = new w.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blob);
  });
  const exported = async () => { click('export-json'); return JSON.parse(await readBlob(downloads.at(-1))); };
  const unloadBlocked = () => { const event = new w.Event('beforeunload', { cancelable: true }); w.dispatchEvent(event); return event.defaultPrevented; };
  return { w, d, get, click, fill, choose, downloads, exported, readBlob, unloadBlocked, scrolls };
}

test('review starts without prior AI verdicts; source metadata stays neutral', t => {
  const page = setup(t);
  for (const item of source.cases) {
    page.choose(item.id);
    assert.equal(page.get('ai-results').hidden, true);
    assert.equal(page.get('reader').hidden, true);
    const text = page.get('review-sources').textContent;
    for (const evidence of item.evidence) {
      assert.ok(text.includes(evidence.title));
      if (evidence.text && evidence.kind !== 'exact_quote') assert.ok(!text.includes(evidence.text));
      if (evidence.scope_note) assert.ok(!text.includes(evidence.scope_note));
    }
  }
});

test('largest supported draft saves, exports and restores without text loss', async t => {
  const page = setup(t), text = '검'.repeat(100000);
  page.fill('comments', text); page.fill('unverified', text); page.click('save');
  assert.ok(page.get('review-message').classList.contains('success'));
  const value = await page.exported(); assert.equal(value.comments, text); assert.equal(value.unverified, text);
  page.fill('comments', 'changed'); page.click('restore'); page.click('confirm-accept');
  assert.equal(page.get('comments').value, text);
  assert.equal(page.get('unverified').value, text);
});

test('oversized draft cannot overwrite saved input or export an unrestorable file', async t => {
  const page = setup(t);
  page.fill('comments', 'original'); page.click('save');
  const stored = page.w.localStorage.getItem('journal-public-reader-v28-draft-ps-body');
  page.fill('comments', 'x'.repeat(100001)); page.click('save');
  assert.equal(page.get('confirm-box').hidden, true);
  assert.equal(page.w.localStorage.getItem('journal-public-reader-v28-draft-ps-body'), stored);
  page.click('export-json'); page.click('export-text');
  assert.equal(page.downloads.length, 0);
  assert.ok(page.get('review-message').classList.contains('error'));
  assert.equal(page.get('comments').value.length, 100001, 'No silent truncation');
});

test('editing while overwrite confirmation is pending cancels the stale operation', t => {
  const page = setup(t);
  page.fill('comments', 'saved original'); page.click('save');
  const stored = page.w.localStorage.getItem('journal-public-reader-v28-draft-ps-body');
  page.fill('comments', 'replacement'); page.click('save');
  assert.equal(page.get('confirm-box').hidden, false);
  page.fill('comments', '');
  assert.equal(page.get('confirm-box').hidden, true);
  page.get('confirm-accept').click();
  assert.equal(page.w.localStorage.getItem('journal-public-reader-v28-draft-ps-body'), stored);
});

test('cancel returns keyboard focus to the initiating control without data loss', t => {
  const page = setup(t);
  page.fill('comments', 'keep me'); page.click('clear-form');
  assert.equal(page.d.activeElement.id, 'confirm-accept');
  page.click('confirm-cancel');
  assert.equal(page.d.activeElement.id, 'clear-form');
  assert.equal(page.get('comments').value, 'keep me');
});

test('mode and case changes cancel stale clear/overwrite operations', t => {
  const page = setup(t);
  page.fill('comments', 'case A'); page.click('clear-form'); page.click('read-mode');
  assert.equal(page.get('confirm-box').hidden, true);
  page.click('review-mode'); page.choose('plot-area'); page.fill('comments', 'case B');
  page.get('confirm-accept').click();
  assert.equal(page.get('comments').value, 'case B');
  page.choose('ps-body'); assert.equal(page.get('comments').value, 'case A');
});

test('dirty protection covers other cases and only successful save clears it', t => {
  const page = setup(t);
  assert.equal(page.unloadBlocked(), false);
  page.fill('comments', 'remember me'); assert.equal(page.unloadBlocked(), true);
  page.choose('plot-area'); assert.equal(page.unloadBlocked(), true);
  page.choose('ps-body'); page.click('save'); assert.equal(page.unloadBlocked(), false);
  page.fill('comments', 'changed'); assert.equal(page.unloadBlocked(), true);
  page.fill('comments', 'remember me'); assert.equal(page.unloadBlocked(), false);
});

test('failed browser save retains input and unsaved protection', t => {
  const page = setup(t, { localFailure: true });
  page.fill('comments', 'recover through export'); page.click('save');
  assert.equal(page.get('comments').value, 'recover through export');
  assert.ok(page.get('review-message').classList.contains('error'));
  assert.equal(page.unloadBlocked(), true);
});

test('downloading does not claim successful persistence or human submission', async t => {
  const page = setup(t);
  page.fill('comments', 'private note');
  const value = await page.exported();
  assert.equal(value.submitted, false); assert.equal(value.comparisonCompleted, false);
  assert.equal(value.publicHumanReference.participants, 1); assert.equal(value.publicHumanReference.responses, 3);
  assert.equal(value.publicHumanReference.unchanged, true); assert.equal(value.exposure.blindReviewConfirmed, false);
  assert.equal(page.unloadBlocked(), true);
});

test('readable but unwritable exposure storage remains unknown on a fresh load', async t => {
  const page = setup(t, { storageFailure: true });
  assert.equal(page.get('fresh-notice').hidden, true);
  assert.equal(page.get('exposure-notice').hidden, false);
  const value = await page.exported();
  assert.equal(value.exposure.previousExposureUnknown, true);
  page.click('reveal-ai');
  assert.equal((await page.exported()).exposure.aiDetailsRevealed, true);
});

test('revealing results records exposure while switching cases keeps drafts separate', async t => {
  const page = setup(t);
  page.fill('comments', 'first'); page.click('reveal-ai'); page.choose('plot-area');
  assert.equal(page.get('comments').value, ''); assert.equal(page.get('ai-results').hidden, true);
  const value = await page.exported(); assert.equal(value.exposure.aiDetailsRevealed, true);
  page.choose('ps-body'); assert.equal(page.get('comments').value, 'first'); assert.equal(page.get('ai-results').hidden, false);
});

test('embedded source-data export matches the frozen reader exactly', async t => {
  const page = setup(t); page.click('export-source-data');
  const downloaded = JSON.parse(await page.readBlob(page.downloads.at(-1)));
  assert.deepEqual(downloaded, source);
  assert.equal(page.get('export-source-data').getAttribute('href'), null);
});

test('no-result filter hides stale cards and clearing it restores a consistent selection', t => {
  const page = setup(t, { mode: 'read' });
  page.fill('claim-search', 'no-such-evidence-xyz');
  assert.equal(page.get('claim-content').hidden, true);
  assert.equal(page.get('empty-results').hidden, false);
  page.click('clear-search');
  assert.equal(page.get('claim-content').hidden, false);
  const active = page.d.querySelector('.claim-select[aria-current="true"]');
  assert.ok(active); assert.equal(page.get(`case-${active.dataset.id}`).hidden, false);
});

async function importDraft(page, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const input = page.get('import-file');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: Buffer.byteLength(text), text: async () => text }] });
  input.dispatchEvent(new page.w.Event('change', { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
}

test('exported JSON restores to its own case and preserves exposure metadata', async t => {
  const page = setup(t);
  page.choose('plot-area'); page.fill('comments', 'imported reasoning'); page.click('reveal-ai');
  const value = await page.exported();
  const target = setup(t);
  await importDraft(target, value);
  assert.equal(target.get('review-target').value, 'plot-area');
  assert.equal(target.get('comments').value, 'imported reasoning');
  assert.equal((await target.exported()).exposure.previousExposureRecorded, true);
  assert.equal(target.get('ai-results').hidden, true, 'Import does not reveal the AI panel');
});

test('invalid and foreign-version imports never replace existing judgments', async t => {
  const page = setup(t); page.fill('comments', 'keep input');
  const value = await page.exported();
  for (const invalid of ['{broken', { ...value, dataVersion: 'v99' }, { ...value, researchRef: '0'.repeat(40) },
    { ...value, reviewTarget: 'unknown-case' }, { ...value, judgments: { ...value.judgments, meaning: 'invented' } },
    { ...value, comments: 'x'.repeat(100001) }]) {
    await importDraft(page, invalid);
    assert.equal(page.get('comments').value, 'keep input');
    assert.ok(page.get('review-message').classList.contains('error'));
    assert.equal(page.get('confirm-box').hidden, true);
  }
});

test('valid import requires confirmation before overwriting another case draft', async t => {
  const page = setup(t); page.choose('plot-area'); page.fill('comments', 'local unsaved');
  const value = await page.exported(); value.comments = 'replacement';
  page.choose('ps-body'); page.fill('comments', 'unrelated case');
  await importDraft(page, value);
  assert.equal(page.get('confirm-box').hidden, false);
  page.click('confirm-cancel');
  assert.equal(page.get('comments').value, 'unrelated case');
  page.choose('plot-area'); assert.equal(page.get('comments').value, 'local unsaved');
});

test('over-limit paste is rejected whole instead of silently cutting the input', t => {
  const page = setup(t); page.fill('comments', 'keep');
  const input = page.get('comments'); input.setSelectionRange(4, 4);
  const event = new page.w.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'x'.repeat(100000) } });
  input.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true); assert.equal(input.value, 'keep');
  assert.ok(page.get('review-message').classList.contains('error'));
});

test('slow file import cannot replace a newer interaction', async t => {
  const page = setup(t); const value = await page.exported(); value.comments = 'old file';
  let finish;
  const input = page.get('import-file');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 1000, text: () => new Promise(resolve => { finish = resolve; }) }] });
  input.dispatchEvent(new page.w.Event('change', { bubbles: true }));
  page.fill('comments', 'new thought'); finish(JSON.stringify(value));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.get('comments').value, 'new thought');
  assert.equal(page.get('confirm-box').hidden, true);
});

test('deep links restore the selected case and preserve unrelated URL parameters', t => {
  const page = setup(t, { mode: 'review', query: '&case=plot-area&context=shared' });
  assert.equal(page.get('review-target').value, 'plot-area');
  page.choose('maturity-delay');
  let url = new URL(page.w.location.href);
  assert.equal(url.searchParams.get('case'), 'maturity-delay');
  assert.equal(url.searchParams.get('context'), 'shared');
  page.click('read-mode'); url = new URL(page.w.location.href);
  assert.equal(url.searchParams.get('mode'), 'read');
  assert.equal(url.searchParams.get('case'), 'maturity-delay');
  assert.equal(page.get('case-maturity-delay').hidden, false);
});

test('unknown case parameter falls back to a real case without introducing markup', t => {
  const page = setup(t, { query: '&case=%3Cscript%3Ebad%3C%2Fscript%3E' });
  assert.equal(page.get('review-target').value, source.cases[0].id);
  assert.equal(new URL(page.w.location.href).searchParams.get('case'), source.cases[0].id);
});

test('explicit mode changes move focus and scroll to the visible heading', t => {
  const page = setup(t, { mode: 'read' }); page.click('review-mode');
  assert.equal(page.d.activeElement.id, 'review-heading');
  assert.ok(page.scrolls.some(item => item.id === 'review-heading'));
  page.click('read-mode'); assert.equal(page.d.activeElement.id, 'reader-heading');
  assert.ok(page.scrolls.some(item => item.id === 'reader-heading'));
});

test('every case links the actual input article separately from supporting evidence', t => {
  const page = setup(t);
  for (const item of source.cases) {
    const link = page.get(`case-${item.id}`).querySelector('.input-article-link');
    assert.equal(link.href, item.article.url);
    page.choose(item.id);
    const review = page.get('review-input-article');
    assert.equal(review.querySelector('a').href, item.article.url);
    assert.ok(review.textContent.includes(item.article.title));
    assert.ok(!review.textContent.includes(item.article.scope_note), 'Review must not inherit article verdict/synthetic-error notes');
  }
});

test('source access limitations stay visible without leaking source interpretation', t => {
  const page = setup(t);
  for (const item of source.cases) {
    page.choose(item.id);
    for (const evidence of item.evidence.filter(row => row.access_note)) {
      assert.ok(page.get(`case-${item.id}`).textContent.includes(evidence.access_note));
      assert.ok(page.get('review-sources').textContent.includes(evidence.access_note));
      assert.ok(!page.get('review-sources').textContent.includes(evidence.text));
    }
  }
});

test('mobile item navigation starts compact and selection brings the chosen content into view', t => {
  const page = setup(t, { mode: 'read', mobile: true });
  assert.equal(page.get('case-nav-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(page.get('case-nav-panel').hidden, true);
  page.click('case-nav-toggle');
  assert.equal(page.get('case-nav-panel').hidden, false);
  page.d.querySelector('.claim-select[data-id="plot-area"]').click();
  assert.equal(page.get('case-nav-panel').hidden, true);
  assert.equal(page.get('case-plot-area').hidden, false);
  assert.equal(page.d.activeElement.id, 'heading-plot-area');
  assert.ok(page.scrolls.some(item => item.id === 'heading-plot-area'));
  assert.equal(new URL(page.w.location.href).searchParams.get('case'), 'plot-area');
});

test('without JavaScript the full case list and source materials remain readable', () => {
  const dom = new JSDOM(html);
  try {
    const d = dom.window.document;
    assert.equal(d.getElementById('case-nav-panel').hidden, false);
    assert.equal(d.querySelectorAll('.case-card[hidden]').length, 0);
    assert.equal(d.querySelectorAll('.input-article-link').length, source.cases.length);
  } finally { dom.window.close(); }
});
