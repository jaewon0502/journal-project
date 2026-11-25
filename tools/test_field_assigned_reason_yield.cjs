const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const core = require('../docs/reader/field-review-core.js');
const key = require('../experiments/cross-party-review/coordinator-key.json');
const task = key.tasks[0];
const basis = {caseId:key.caseId, articleUrl:key.articleUrl, ...task};

function slot(id, method = 'manual', extras = {}) {
  return {participant:'private-' + id, method, caseId:key.caseId, articleUrl:key.articleUrl,
    taskId:task.id, prompt:task.prompt, ...extras};
}
function entry(row, reasonGrade, trialEdits = {}, gradeEdits = {}) {
  return {basis, locationGrade:'yes', verdictGrade:'yes', reasonGrade, trial:core.validate({
    format:core.format, id:'id-' + row.participant, participant:row.participant, method:row.method,
    caseId:row.caseId, articleUrl:row.articleUrl, taskId:row.taskId, prompt:row.prompt,
    kind:'editor', status:'completed', recovered:false, split:false, kitVersion:'a'.repeat(64),
    phaseMs:{search:row.method === 'manual' ? 90000 : 30000, locate:0, decide:0}, found:'found',
    documentUrl:'https://example.org/report', locator:'private-table', verdict:task.verdict,
    reason:'private-reason', ...trialEdits
  }), ...gradeEdits};
}

test('이유까지 일치하는 전체 배정 성공률에서 실제 사용·복원·미회신·근거 변경과 이중 실패를 구별한다', () => {
  const ids = ['restored','bad-location-and-reason','bad-reason','no-reason','withdrawn','wrong-task','repeat','missing','no-key'];
  const rows = ids.map(id => slot(id, 'journal'));
  const entries = [
    entry(rows[0], 'yes', {method:'manual', recovered:true}),
    entry(rows[1], 'no', {}, {locationGrade:'no'}),
    entry(rows[2], 'no', {}, {locationGrade:''}),
    entry(rows[3], ''), entry(rows[4], 'yes', {status:'withdrawn'}),
    entry(rows[5], 'yes', {prompt:'다른 과제'}), entry(rows[6], 'yes'),
    entry(rows[8], 'yes', {}, {basis:null})
  ];
  const repeated = new Set([entries[6].trial.id]);
  const result = core.allocationReport(rows, entries, repeated);
  const [comparison] = result.assignmentComparisons;
  assert.equal(comparison.journal.assigned, 9);
  assert.equal(comparison.journal.crossover, 1);
  assert.deepEqual(comparison.journal.yieldBounds, {verified:3, failed:1, withdrawn:1, unknown:4});
  assert.deepEqual(comparison.journal.reasonYieldBounds,
    {verified:1, failedQuality:1, failedReason:1, withdrawn:1, unknown:5});
  assert.equal(comparison.reasonDifference, null);
  assert.equal(result.deadlineAssigned, 0);
  const manual = slot('comparison', 'manual', {targetSeconds:120});
  const withBoth = core.allocationReport([...rows, manual], [...entries, entry(manual, 'yes')], repeated);
  const difference = withBoth.assignmentComparisons[0].reasonDifference;
  assert.equal(withBoth.deadlineAssigned, 1);
  assert.equal(withBoth.deadlineComparisons[0].withReason.difference, null);
  assert.ok(Math.abs(difference.low - 100 * (1/9 - 1)) < 1e-9);
  assert.ok(Math.abs(difference.high - 100 * (6/9 - 1)) < 1e-9);
});

test('시간 목표가 없는 명부도 진행자 집계 화면에서 0%p와 이유 포함 −100%p 차이를 모두 표시한다', async t => {
  const rows = [slot('m'), slot('j', 'journal')];
  const entries = rows.map((row,i) => entry(row, i ? 'no' : 'yes'));
  const [version] = core.compareTimes(core.group(entries))[0].byVersion;
  assert.deepEqual([version.manualMs, version.journalMs], [90000, 30000]);
  const read = name => fs.readFileSync(path.join(__dirname,'../docs/reader',name), 'utf8');
  const {window} = new JSDOM(read('field-summary.html'), {url:'https://example.org/field-summary.html', runScripts:'outside-only'});
  t.after(() => window.close());
  window.eval(read('field-review-core.js'));
  window.eval(read('field-time-report.js'));
  window.eval(read('field-summary.js'));
  const el = id => window.document.getElementById(id);
  async function upload(id, value) {
    const input = el(id);
    Object.defineProperty(input, 'files', {configurable:true, value:[new window.File([JSON.stringify(value)], 'fixture.json')]});
    await input.onchange({target:input});
  }
  await upload('roster-file', {format:core.assignmentFormat, assignments:rows});
  await upload('imports', {format:'journal-field-grades-v1', entries});
  const results = el('allocation-yield');
  assert.equal(results.textContent, '');
  el('toggle-results').click();
  const basic = results.querySelector('.assignment-basic'), strict = results.querySelector('.assignment-with-reason');
  assert.match(basic.querySelector('strong').textContent, / 0\.0%p$/);
  assert.match(strict.querySelector('strong').textContent, / -100\.0%p$/);
  assert.match(strict.textContent, /저널 · 검증 성공률 0\.0% \(배정 1건\).*판단 이유 불일치 1건/);
  assert.match(el('allocation-deadlines').textContent, /목표 시간이 없어/);
  assert.doesNotMatch(results.textContent, /private-/);
  el('toggle-results').click();
  assert.equal(results.textContent, '');
});
