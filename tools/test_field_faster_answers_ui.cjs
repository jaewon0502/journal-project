const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {createCase} = require('../experiments/field-reason-time/faster-reasons.cjs');
const roster = require('../experiments/field-reason-time/synthetic-roster.json');

test('교차 배정에서 빨라진 사람의 두 이유를 열고, 숫자 보고서와 배정을 가린 화면에는 답안을 남기지 않는다', async t => {
  const read = name => fs.readFileSync(path.join(__dirname, '../docs/reader', name), 'utf8');
  for (const journalPassed of [false, true]) {
    const {window} = new JSDOM(read('field-summary.html'), {runScripts:'outside-only', url:'https://example.org/field-summary.html'});
    t.after(() => window.close());
    for (const name of ['field-review-core.js', 'field-time-report.js', 'field-summary.js']) window.eval(read(name));
    const el = id => window.document.getElementById(id);
    const load = async (id, data) => {
      const target = el(id);
      Object.defineProperty(target, 'files', {configurable:true, value:[new window.File([JSON.stringify(data)], id + '.json')]});
      await target.onchange({target});
    };
    // Exercise the normal receipt format inside an isolated page with an empty session.
    await load('roster-file', {format:roster.format, assignments:roster.assignments});
    const grades = createCase(journalPassed);
    await load('imports', {format:grades.format, entries:grades.entries});
    assert.equal(el('faster-reason-answers'), null);
    el('toggle-results').click();
    const group = el('faster-reason-answers');
    assert.match(group.textContent, /답안 2쌍/);
    const panel = el('editor-crossover');
    assert.match(panel.textContent, new RegExp('평소 도구에서만 성공 ' + (journalPassed ? 0 : 2) + '명 · 저널에서만 성공 ' + (journalPassed ? 2 : 0) + '명'));
    const cases = group.querySelectorAll('.faster-answer-pair');
    assert.equal(cases.length, 2);
    group.open = true;
    const proofs = [];
    for (const entry of cases) {
      entry.open = true;
      await t.waitFor(() => assert.equal(entry.querySelectorAll('section').length, 2));
      const sections = [...entry.querySelectorAll('section')];
      assert.match(sections[0].textContent, /100\.0초/);
      assert.match(sections[1].textContent, /20\.0초/);
      assert.match(sections[journalPassed ? 0 : 1].textContent, /판단 이유 불일치/);
      for (const s of sections) {
        const line = [...s.querySelectorAll('p')].find(p => p.textContent.startsWith('제출한 판단 이유 · '));
        const reason = line.textContent.slice('제출한 판단 이유 · '.length);
        assert.ok(grades.entries.some(e => e.trial.reason === reason));
        proofs.push(reason);
      }
    }
    let saved;
    window.URL.createObjectURL = blob => { saved = blob; return 'blob:file'; };
    window.URL.revokeObjectURL = () => {};
    window.Blob = Blob;
    window.HTMLAnchorElement.prototype.click = () => {};
    panel.querySelector('button').click();
    const html = await saved.text();
    assert.match(html, /빨라진 편집자가 판단 이유까지/);
    assert.doesNotMatch(html, /SYNTHETIC-|example\.invalid|가상 도서관|가상 대여소|faster-answer-pair/);
    proofs.forEach(reason => assert.ok(!html.includes(reason)));
    el('toggle-results').click();
    assert.equal(el('faster-reason-answers'), null);
    assert.equal(panel.textContent, '');
  }
});
