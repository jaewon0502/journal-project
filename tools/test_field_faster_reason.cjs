const {test} = require('node:test');
const assert = require('node:assert/strict');
const field = require('../docs/reader/field-review-core.js');
const roster = require('../experiments/field-reason-time/synthetic-roster.json');
const answers = require('../experiments/field-reason-time/synthetic-grades-slow-pass.json');

const empty = {total:0, manualOnly:0, journalOnly:0, bothPassed:0, bothFailed:0,
  pending:0, changedStandards:0, unbalanced:0};

function fixture(fastManualOnly = true) {
  const records = structuredClone(answers.entries);
  for (const entry of records) {
    const fast = ['SYNTHETIC-01','SYNTHETIC-03'].includes(entry.trial.participant);
    const manual = entry.trial.method === 'manual';
    entry.reasonGrade = manual === (fast === fastManualOnly) ? 'yes' : 'no';
    entry.trial.reason = answers.entries.find(other => other.trial.taskId === entry.trial.taskId &&
      other.reasonGrade === entry.reasonGrade).trial.reason;
  }
  return {assignments:structuredClone(roster.assignments), records};
}

function evaluate({assignments, records}, onFasterReasonPair, repeated = new Set()) {
  return field.allocationReport(field.mergeAssignments([], [{format:field.assignmentFormat, assignments}]),
    records.map(entry => ({...entry, trial:field.validate(entry.trial)})), repeated, onFasterReasonPair);
}

function row(data, participant, method) {
  return data.records.find(({trial}) => trial.participant === 'SYNTHETIC-0' + participant && trial.method === method);
}

test('같은 30% 절감과 같은 과제별 성공 수에서 빨라진 두 사람의 이유 합격 방향이 뒤집힌다', () => {
  const reports = [true, false].map(manual => evaluate(fixture(manual)));
  for (const [index, report] of reports.entries()) {
    const cross = report.editorCrossover;
    assert.equal(cross.savedPct, 30);
    assert.deepEqual(cross.fasterQuality, {fewer:0, same:2, more:0});
    assert.equal(cross.successfulWork.bothPassed, 0);
    assert.equal(cross.successfulWork.failedPairs, 4);
    assert.deepEqual(cross.fasterReason, {...empty, total:2, [index ? 'journalOnly' : 'manualOnly']:2});
  }
  const previous = reports.map(({editorCrossover, ...report}) => {
    const {fasterReason, ...existingCrossover} = editorCrossover;
    return {...report, editorCrossover:existingCrossover};
  });
  assert.deepEqual(previous[0], previous[1]);
  const reordered = fixture();
  reordered.assignments.reverse();
  reordered.records.reverse();
  assert.deepEqual(evaluate(reordered).editorCrossover, reports[0].editorCrossover);
});

test('같은 사람의 실패·성공·미채점을 구별하고 빠른 사람은 한 번씩 센다', () => {
  const data = fixture();
  for (const {trial} of data.records) if (trial.method === 'journal') trial.phaseMs = {search:1, locate:0, decide:0};
  row(data, 1, 'journal').reasonGrade = 'yes'; // both passed
  row(data, 2, 'journal').locationGrade = 'no'; // manual reason already failed
  row(data, 3, 'manual').reasonGrade = ''; // failure on one side cannot identify the other side
  assert.deepEqual(evaluate(data).editorCrossover.fasterReason, {...empty, total:4, bothPassed:1,
    bothFailed:1, pending:1, journalOnly:1});
});

test('0초에서 동률이거나 느려졌으면 제외하고 1ms 빨라진 편집자와 배정 방향 불균형을 남긴다', () => {
  const data = fixture();
  for (const method of ['manual', 'journal']) row(data, 1, method).trial.phaseMs = {search:0, locate:0, decide:0};
  row(data, 3, 'manual').trial.phaseMs = {search:1, locate:0, decide:0};
  row(data, 3, 'journal').trial.phaseMs = {search:0, locate:0, decide:0};
  const cross = evaluate(data).editorCrossover;
  assert.deepEqual([cross.sameTime, cross.slower, cross.faster], [1,2,1]);
  assert.deepEqual(cross.fasterReason, {...empty, total:1, manualOnly:1, unbalanced:1});
  data.records.splice(data.records.indexOf(row(data, 4, 'journal')), 1);
  assert.equal(evaluate(data).editorCrossover.comparedEditors, 0);
  assert.equal(evaluate(data).editorCrossover.fasterReason, undefined);
});

test('달라진 설명은 해당 과제쌍의 빠른 편집자만 대조 보류로 두고 다른 판본은 별도 집계한다', () => {
  const changed = fixture(), unchanged = fixture(false);
  row(changed, 2, 'journal').basis.explanation += ' 다른 분모로 계산한다.';
  for (const a of unchanged.assignments) {
    a.participant += '-new';
    a.assignedKitVersion = 'c'.repeat(64);
  }
  for (const {trial} of unchanged.records) {
    trial.participant += '-new';
    trial.id += '-new';
    trial.kitVersion = 'c'.repeat(64);
  }
  const data = {assignments:[...changed.assignments, ...unchanged.assignments], records:[...changed.records, ...unchanged.records]};
  assert.deepEqual(evaluate(data).editorCrossover.fasterReason, {...empty, total:4, changedStandards:2, journalOnly:2});
});

test('설명이나 이유 점수가 없는 과거 답안은 채점할 근거가 남은 범위에서만 분류한다', () => {
  const data = fixture();
  delete row(data, 1, 'manual').basis.explanation;
  assert.deepEqual(evaluate(data).editorCrossover.fasterReason, {...empty, total:2, pending:1, manualOnly:1});
  for (const entry of data.records) delete entry.basis.explanation;
  assert.equal(evaluate(data).editorCrossover.fasterReason, undefined);
});

test('진행자에게는 확정한 빠른 답안 두 건의 ID만 전달하고 결과 숫자에는 ID를 넣지 않는다', () => {
  const data = fixture();
  for (const {trial} of data.records) if (trial.method === 'journal') trial.phaseMs = {search:1, locate:0, decide:0};
  row(data, 1, 'journal').reasonGrade = 'yes';
  row(data, 2, 'journal').locationGrade = 'no';
  const categories = ['bothPassed','bothFailed','manualOnly','journalOnly'];
  const callbacks = [];
  const cross = evaluate(data, pair => callbacks.push(pair)).editorCrossover;
  assert.deepEqual(callbacks, categories.map((category, i) => ({category, manualId:row(data, i + 1, 'manual').trial.id,
    journalId:row(data, i + 1, 'journal').trial.id})));
  assert.deepEqual(cross, evaluate(data).editorCrossover);
  for (const {trial} of data.records) assert.ok(!JSON.stringify(cross).includes(trial.id));
  row(data, 3, 'manual').reasonGrade = '';
  callbacks.length = 0;
  evaluate(data, pair => callbacks.push(pair));
  assert.deepEqual(callbacks.map(p => p.category), ['bothPassed','bothFailed','journalOnly']);
  row(data, 4, 'manual').basis.explanation += ' 다른 분모를 사용한다.';
  callbacks.length = 0;
  evaluate(data, pair => callbacks.push(pair));
  assert.deepEqual(callbacks, []);
});

test('중복 회신이나 반복 노출로 제외된 편집자의 답안을 열 수 없다', () => {
  const data = fixture();
  const first = row(data, 1, 'manual');
  data.records.push(structuredClone(first));
  const third = row(data, 3, 'journal'), callbacks = [];
  const cross = evaluate(data, pair => callbacks.push(pair), new Set([third.trial.id])).editorCrossover;
  assert.equal(cross.comparedEditors, 2);
  assert.equal(cross.faster, 0);
  assert.deepEqual(callbacks, []);
});
