const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../docs/reader/field-review-core.js');
const key = require('../experiments/cross-party-review/coordinator-key.json');
const task = key.tasks[0];
const basis = {caseId:key.caseId, articleUrl:key.articleUrl, ...task};

function slot(code, method = 'manual', changes = {}) {
  return {participant:'private-' + code, caseId:key.caseId, articleUrl:key.articleUrl,
    taskId:task.id, prompt:task.prompt, method, targetSeconds:120, ...changes};
}

function response(assignment, elapsedMs, trialChanges = {}, gradeChanges = {}) {
  const {participant, caseId, articleUrl, taskId, prompt, method} = assignment;
  const trial = core.validate({format:core.format, id:'trial-' + participant, participant, caseId,
    articleUrl, taskId, prompt, method, kind:'editor', status:'completed', kitVersion:'a'.repeat(64),
    recovered:false, split:false, phaseMs:{search:elapsedMs, locate:0, decide:0},
    found:'found', locator:'private-location', documentUrl:'https://example.org/table',
    verdict:task.verdict, reason:'private-reason', ...trialChanges});
  return {trial, basis, expected:basis.verdict, locationGrade:'yes',
    verdictGrade:trial.verdict === basis.verdict ? 'yes' : 'no', ...gradeChanges};
}

test('같은 배정에서 목표 시간을 추가·삭제·교체할 수 없고 초를 밀리초로 정확하게 저장한다', () => {
  const assigned = slot('one');
  const {targetSeconds, ...legacy} = assigned;
  const file = rows => ({format:core.assignmentFormat, assignments:rows});
  const maxSeconds = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
  for (const seconds of [1, 120, maxSeconds]) {
    const row = {...assigned, targetSeconds:seconds};
    assert.deepEqual(core.mergeAssignments([row], [file([row])]), [row]);
  }
  assert.deepEqual(core.mergeAssignments([], [file([legacy])]), [legacy]);
  for (const value of [null, undefined, false, '', '120', 0, -1, 0.5, NaN, Infinity, maxSeconds + 1]) {
    assert.throws(() => core.mergeAssignments([], [file([{...assigned, targetSeconds:value}])]), /시간/);
  }
  for (const [before, after] of [[legacy, assigned], [assigned, legacy], [assigned, {...assigned, targetSeconds:121}]])
    assert.throws(() => core.mergeAssignments([before], [file([after])]), /배정/);
});

test('120초 이내 검증 성공은 평소 도구 2/4, 저널 병행 0/4이고 완료 평균은 저널 병행이 더 빠르다', () => {
  const slots = Array.from({length:8}, (_, i) => slot(i, i < 4 ? 'manual' : 'journal'));
  const seconds = [90, 90, 300, 300, 130, 130, 130, 10];
  const returns = slots.map((a, i) => response(a, seconds[i] * 1000,
    [2, 3, 7].includes(i) ? {verdict:'contradicted'} : {}));
  const report = core.allocationReport(slots, returns, new Set());
  const [result] = report.deadlineComparisons;
  assert.equal(report.deadlineAssigned, 8);
  assert.deepEqual(result.manual, {assigned:4, verified:2, failedQuality:2, overTime:0, withdrawn:0, unknown:0});
  assert.deepEqual(result.journal, {assigned:4, verified:0, failedQuality:1, overTime:3, withdrawn:0, unknown:0});
  assert.deepEqual(result.difference, {low:-50, high:-50});
  const [time] = core.compareTimes(report.groups)[0].byVersion;
  assert.deepEqual([time.manualMs, time.journalMs], [195000, 100000]);
  assert.deepEqual([time.perVerified.manualMs, time.perVerified.journalMs], [390000, 400000/3]);
  assert.deepEqual(report.assignmentComparisons[0].difference, {low:25, high:25});
  assert.doesNotMatch(JSON.stringify(result), /private-|trial-/u);
});

test('원래 배정과 밀리초 경계를 지키고 복원·미채점·누락이 있는 차이의 범위를 계산한다', () => {
  const manual = ['boundary', 'over', 'paused', 'ended'].map(id => slot(id));
  const journal = ['crossed', 'pending', 'wrong', 'absent'].map(id => slot(id, 'journal'));
  const returns = [
    response(manual[0], 0, {phaseMs:{search:80001, locate:39998, decide:1}}),
    response(manual[1], 0, {phaseMs:{search:80001, locate:39998, decide:2}}, {locationGrade:''}),
    response(manual[2], 120001, {recovered:true}),
    response(manual[3], 8000, {status:'withdrawn', recovered:true}),
    response(journal[0], 110000, {method:'manual', journalUse:'no'}),
    response(journal[1], 90000, {}, {locationGrade:''}),
    response(journal[2], 120001, {recovered:true, verdict:'contradicted'})
  ];
  const {deadlineComparisons:[result], all} = core.allocationReport([...manual, ...journal], returns, new Set());
  assert.equal(all.crossover, 1);
  assert.deepEqual(result.manual, {assigned:4, verified:1, failedQuality:0, overTime:1, withdrawn:1, unknown:1});
  assert.deepEqual(result.journal, {assigned:4, verified:1, failedQuality:1, overTime:0, withdrawn:0, unknown:2});
  assert.deepEqual(result.difference, {low:-25, high:50});
});

test('독립 기준 없이 내린 수동 채점, 다른 과제의 기준과 반복·연습·잘못된 응답으로 성공을 만들지 않는다', () => {
  const slots = ['unkeyed', 'failed-unkeyed', 'expected-only', 'wrong-source', 'unlocated', 'repeat',
    'practice', 'wrong-task', 'known-failure', 'outside-budget', 'malformed-key'].map(id => slot(id));
  const manualGrades = {basis:null, expected:''};
  const returns = [
    response(slots[0], 100, {}, manualGrades),
    response(slots[1], 200, {}, {...manualGrades, locationGrade:'no', verdictGrade:'no'}),
    response(slots[2], 300, {}, {basis:null}),
    response(slots[3], 400, {}, {basis:{...basis, articleUrl:'https://example.org/other'}}),
    response(slots[4], 1000, {found:'missing', recovered:true}, manualGrades),
    response(slots[5], 1000),
    response(slots[6], 1000, {kind:'practice'}),
    response(slots[7], 1000, {prompt:'다른 과제'}),
    response(slots[8], 150000, {recovered:true}, {locationGrade:'no'}),
    response(slots[9], 150000, {}, manualGrades),
    response(slots[10], 1000, {}, {basis:{...basis, reference:{}}}),
    response(slot('outside'), 1000)
  ];
  const report = core.allocationReport(slots, returns, new Set([returns[5].trial.id]));
  const [result] = report.deadlineComparisons;
  assert.equal(report.outsideRoster, 1);
  assert.deepEqual(result.manual, {assigned:11, verified:0, failedQuality:2, overTime:1, withdrawn:0, unknown:8});
  assert.equal(result.journal.assigned, 0);
  assert.equal(result.difference, null);
});

test('기사·사례·과제·문장·시간 기준별로 분모를 나누고 기존 명부에는 목표 시간을 추정하지 않는다', () => {
  const {targetSeconds, ...legacy} = slot('old');
  const slots = [legacy, slot('first'), slot('cutoff', 'journal', {targetSeconds:121}),
    slot('article', 'journal', {articleUrl:'https://example.org/other'}),
    slot('case', 'journal', {caseId:'other-case'}), slot('task', 'journal', {taskId:'other-task'}),
    slot('prompt', 'journal', {prompt:'다른 문장'})];
  const report = core.allocationReport(slots, [response(legacy, 1000, {targetSeconds:120})], new Set());
  assert.equal(report.all.assigned, 7);
  assert.equal(report.deadlineAssigned, 6);
  assert.equal(report.deadlineComparisons.length, 6);
  assert.ok(report.deadlineComparisons.every(r => r.manual.unknown + r.journal.unknown === 1 && r.difference === null));
  assert.deepEqual(core.allocationReport([legacy], [], new Set()).deadlineComparisons, []);
});
