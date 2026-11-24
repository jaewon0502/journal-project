// Node 24, from the repository root (jsdom is resolved from this script's checkout):
// Set FIXTURE to the frozen JSON path, then create two empty archive directories.
//   BASE=$(mktemp -d)
//   CANDIDATE=$(mktemp -d)
//   git archive f0abc60 docs/reader | tar -x -C "$BASE"
//   git archive 3b301a0 docs/reader | tar -x -C "$CANDIDATE"
//   node experiments/evidence-retrieval-transfer/matrix-external/score.cjs "$BASE/docs/reader" "$FIXTURE"
// Run the same command with "$CANDIDATE/docs/reader". JSON goes to stdout.
'use strict';
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const label = text => text.trim().normalize('NFKC').replace(/\s+/gu, ' ');
const year = text => /^(?:[12]\d{3})\s*(?:년(?:도)?)?$/u.test(label(text));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function reference(fixture) {
  assert.ok(fixture.source && Array.isArray(fixture.lines) && Array.isArray(fixture.cases));
  assert.ok(fixture.lines.every(line => typeof line === 'string' && !/[\r\n\u2028\u2029]/u.test(line)));
  const rows = fixture.lines.filter(line => line.trim());
  const cells = rows.map(row => row.split('\t'));
  const answered = fixture.cases.filter(item => item.expected !== null);
  assert.ok(answered.length, 'at least one labeled matrix cell required');
  const firstGold = Math.min(...answered.map(item => item.expected.row));
  // Identify the printed year header from the frozen TSV, independent of both readers.
  // An ambiguous or unfamiliar header requires an explicit source annotation.
  const headers = cells.slice(0, firstGold - 1).flatMap((row, index) =>
    row.slice(1).filter(year).length >= 2 ? [index + 1] : []);
  assert.equal(headers.length, 1, 'cannot identify a unique printed year header before the gold data');
  const header = headers[0], headings = cells[header - 1];
  const ids = new Set();
  for (const {id, query, expected} of fixture.cases) {
    assert.ok(id && !ids.has(id) && typeof query === 'string' && query.trim());
    ids.add(id);
    if (expected === null) continue;
    const {row, col, value} = expected;
    assert.ok(Number.isInteger(row) && row > header && row <= cells.length);
    assert.ok(Number.isInteger(col) && col >= 2 && col <= headings.length && year(headings[col - 1]));
    assert.ok(typeof value === 'string' && value.length > 0);
    assert.equal(cells[row - 1][col - 1]?.trim(), value, id + ': gold must match the printed value');
  }
  return {rows, cells, header, headings};
}

function openPage(folder) {
  const errors = [], console = new VirtualConsole();
  console.on('jsdomError', err => errors.push(err.message));
  const html = readFileSync(path.join(folder, 'factcheck.html'));
  const digest = createHash('sha256').update(html);
  const dom = new JSDOM(html, {url:'https://journal.example/factcheck.html', runScripts:'outside-only', virtualConsole:console});
  const w = dom.window, doc = w.document;
  const el = id => doc.getElementById(id);
  let exported;
  w.TextEncoder = TextEncoder;
  w.confirm = () => true;
  w.URL.createObjectURL = blob => { exported = blob; return 'blob:journal'; };
  w.URL.revokeObjectURL = () => {};
  doc.addEventListener('click', event => { if (event.target.closest('a[download]')) event.preventDefault(); });
  for (const tag of doc.querySelectorAll('script[src]')) {
    const name = tag.getAttribute('src');
    const js = readFileSync(path.join(folder, name));
    digest.update('\0' + name + '\0').update(js);
    w.eval(js.toString('utf8'));
  }
  function set(id, value) {
    el(id).value = value;
    el(id).dispatchEvent(new w.Event('input', {bubbles:true}));
  }
  async function checkWork() {
    assert.equal(el('verdict').value, '');
    assert.equal(el('acknowledged').checked, false);
    exported = undefined;
    el('save-work').click();
    assert.ok(exported, 'workspace JSON was not exported');
    const text = await new Promise((resolve, reject) => {
      const reader = new w.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exported);
    });
    const work = JSON.parse(text);
    assert.deepEqual(work.sources, []);
    assert.deepEqual(work.receipts, []);
  }
  return {w, el, set, checkWork, digest:digest.digest('hex'), close:() => { w.close(); assert.deepEqual(errors, []); }};
}

const coordinates = / \(머리글 (\d+)문단 · 자료 (\d+)문단 · 왼쪽에서 (\d+)번째 열\)$/u;

function readCues(text, cardRow, ref) {
  // Both pinned UIs print these diagnostics as direct card paragraphs. Raw
  // blockquotes, surrounding paragraphs and unopened pickers are never cues.
  if (text.includes(' · 원문 값 ')) {
    const address = coordinates.exec(text);
    assert.ok(address, 'unsupported cell locator: ' + text);
    const head = text.slice(0, address.index);
    const matrix = /^(.+) 행 · (.+) 열 · 원문 값 (.+)$/u.exec(head);
    const annual = !matrix && /^(.+) · (.+) · 원문 값 (.+)$/u.exec(head);
    assert.ok(matrix || annual, 'unsupported cell cue: ' + text);
    const [,rowLabel, heading, value] = matrix || annual;
    return [{kind:matrix ? 'matrix' : 'annual', text, cardRow, rowLabel, heading, value,
      header:Number(address[1]), row:Number(address[2]), col:Number(address[3])}];
  }
  if (text.startsWith('연도 머리글(')) {
    const grouped = /^연도 머리글\((\d+)문단\) 기준 · (.+)$/u.exec(text);
    assert.ok(grouped, 'unsupported year heading cue: ' + text);
    return grouped[2].split(' / ').map(part => {
      const m = /^(\d{4})년 · (\d+)번째 수치 열 (.+)$/u.exec(part);
      assert.ok(m, 'unsupported numeric-column cue: ' + part);
      const numericColumn = Number(m[2]);
      const header = Number(grouped[1]);
      const yearColumns = (ref.cells[header - 1] || []).flatMap((h,i) => year(h) ? [i + 1] : []);
      return {kind:'numeric-column', text:part, cardRow, header, row:cardRow, numericColumn,
        col:yearColumns[numericColumn - 1] ?? null, heading:m[1], value:m[3]};
    });
  }
  assert.ok(!text.startsWith('같은 묶음의 '), 'comparison-cell diagnostics require a different reference format: ' + text);
  return [];
}

function grade(cue, expected, ref) {
  if (!expected) return 'wrong';
  const {row, col, value} = expected;
  if (cue.cardRow !== row || cue.row !== row || cue.col !== col ||
      cue.value !== value || cue.header !== ref.header) return 'wrong';
  const heading = label(ref.headings[col - 1]);
  if (cue.kind === 'numeric-column') {
    // The legacy number counts numeric columns only, and does not print a
    // physical-column locator or repeat the row heading. Preserve partial credit.
    return heading.slice(0,4) === cue.heading ? 'incomplete' : 'wrong';
  }
  return label(cue.rowLabel) === label(ref.cells[row - 1][0]) &&
    label(cue.heading) === heading ? 'exact' : 'wrong';
}

function observe(area, ref, expected) {
  return [...area.querySelectorAll('.source')].map(card => {
    const m = /^붙여넣은 본문 (\d+)문단$/u.exec(card.querySelector(':scope > strong').textContent);
    assert.ok(m);
    const row = Number(m[1]), excerpt = card.querySelector(':scope > blockquote').textContent;
    assert.equal(excerpt, ref.rows[row - 1], 'candidate excerpt must preserve the whole printed line');
    for (const li of card.querySelectorAll('details ol li')) {
      assert.equal(li.querySelector('.verbatim').textContent, ref.rows[li.value - 1], 'context excerpt');
    }
    const cues = [...card.querySelectorAll(':scope > p')].flatMap(p => readCues(p.textContent, row, ref))
      .map(cue => ({...cue, grade:grade(cue, expected, ref)}));
    // Limit the visibility check to the result panel; the user opened the finder.
    const folded = Boolean(card.parentElement.closest('#finder-results details:not([open])'));
    return {row, excerpt, folded, cues};
  });
}

function manual(page, area, expected, ref) {
  const chooser = [...area.querySelectorAll('details')].find(d =>
    d.querySelector(':scope > summary')?.textContent === '원표의 행과 연도 직접 선택');
  if (!chooser) return {available:false};
  assert.equal(chooser.open, false);
  chooser.open = true;
  chooser.dispatchEvent(new page.w.Event('toggle'));
  const selects = [...chooser.querySelectorAll('select')];
  const preview = chooser.querySelector('[aria-live]'), use = chooser.querySelector('button');
  assert.equal(selects.length, 2);
  assert.ok(selects.every(s => s.selectedIndex === 0) && use.disabled && preview.textContent === '',
    'manual coordinates must start unselected');
  if (!expected) return {available:true, attempted:false};
  const {row, col, value} = expected;
  const wanted = [ref.cells[row - 1][0], ref.headings[col - 1]];
  for (const [i, s] of selects.entries()) {
    const options = [...s.options].filter(o => o.index > 0 && label(o.textContent) === label(wanted[i]));
    if (options.length !== 1) return {available:true, attempted:true, exact:false, reason:'missing or ambiguous option', option:wanted[i]};
    s.selectedIndex = options[0].index;
    s.dispatchEvent(new page.w.Event('change'));
    if (i === 0) assert.ok(use.disabled && preview.textContent === '', 'both coordinates must be chosen');
  }
  assert.equal(page.el('source-excerpt').value, '');
  assert.equal(page.el('source-locator').value, '');
  const text = preview.textContent, address = coordinates.exec(text);
  const selection = address && /^직접 선택한 위치 · ‘(.+)’ 행 · ‘(.+)’ 열 · 원문 표기 (.+)$/u.exec(text.slice(0,address.index));
  const previewExact = Boolean(selection && label(selection[1]) === label(wanted[0]) &&
    label(selection[2]) === label(wanted[1]) && selection[3] === value &&
    Number(address[1]) === ref.header && Number(address[2]) === row && Number(address[3]) === col);
  const enabled = !use.disabled;
  if (enabled) use.click();
  const excerpt = page.el('source-excerpt').value, locator = page.el('source-locator').value;
  const picked = /^(?:(.+) · )?‘(.+)’ 행 · ‘(.+)’ 열$/u.exec(locator);
  const captionMatches = !picked?.[1] || ref.rows.slice(0, ref.header - 1).some(line => line.trim() === picked[1]);
  const exact = Boolean(enabled && previewExact && excerpt === ref.rows[row - 1] &&
    picked && captionMatches && label(picked[2]) === label(wanted[0]) && label(picked[3]) === label(wanted[1]));
  return {available:true, attempted:true, exact, preview:text, excerpt, locator};
}

async function runCase(folder, fixture, ref, item) {
  const {id, query, expected} = item;
  const page = openPage(folder), {el, set, checkWork} = page;
  try {
    set('article', query);
    el('article-form').requestSubmit();
    assert.ok(el('row-list').children.length > 0, 'fresh review article required');
    el('go-find').click();
    set('document-text', fixture.lines.join('\n'));
    set('document-query', query);
    await checkWork();
    const reportBefore = el('report-rows').textContent;
    el('find-passages').click();
    const area = el('finder-results');
    const cards = observe(area, ref, expected);
    assert.equal(el('source-excerpt').value, '');
    assert.equal(el('source-locator').value, '');
    assert.equal(el('report-rows').textContent, reportBefore);
    await checkWork();

    const visible = cards.filter(card => !card.folded);
    const cues = visible.flatMap(card => card.cues);
    const exact = cues.some(cue => cue.grade === 'exact'), wrong = cues.some(cue => cue.grade === 'wrong');
    const selection = manual(page, area, expected, ref);
    assert.equal(el('report-rows').textContent, reportBefore);
    await checkWork();
    return {reader:page.digest, result:{id, query, expected, header:ref.header,
      status:el('finder-status').textContent, cards, first:expected ? visible[0]?.row === expected.row : null,
      top3:expected ? visible.slice(0,3).some(c => c.row === expected.row) : null,
      autoExact:exact, anyWrong:wrong, abstained:cues.length === 0, manual:selection}};
  } catch (error) {
    throw new Error(String(id) + ': ' + error.message, {cause:error});
  } finally { page.close(); }
}

async function main() {
  const [folder, file] = process.argv.slice(2);
  assert.ok(folder && file, 'usage: node score.cjs <archived docs/reader directory> <fixture.json>');
  const bytes = readFileSync(file), fixture = JSON.parse(bytes), ref = reference(fixture);
  const cases = [];
  let readerSha256;
  for (const item of fixture.cases) {
    const output = await runCase(folder, fixture, ref, item);
    if (readerSha256) assert.equal(output.reader, readerSha256);
    readerSha256 = output.reader;
    cases.push(output.result);
  }
  const count = predicate => cases.filter(predicate).length;
  const totals = {answerable:count(c => c.expected), controls:count(c => !c.expected),
    first:count(c => c.first), top3:count(c => c.top3), autoExact:count(c => c.autoExact),
    anyWrong:count(c => c.anyWrong), specificOnControls:count(c => !c.expected && !c.abstained),
    withheldAnswerable:count(c => c.expected && c.abstained),
    manualExactWhenWithheld:count(c => c.expected && c.abstained && c.manual.exact)};
  console.log(JSON.stringify({source:fixture.source, fixtureSha256:hash(bytes), readerSha256,
    node:process.version, totals, cases}, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
