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

test('고용률의 분모를 잘못 설명하면 목표 시간 내 성공률 차이가 +50%p에서 −50%p로 뒤집힌다', () => {
  const labour = require('../experiments/labour-field-review/coordinator-key.json');
  const task = labour.tasks.find(t => t.id === 'labour-rate');
  const basis = {caseId:labour.caseId, articleUrl:labour.articleUrl, ...task};
  const slots = [0,1,2,3].map(i => slot(i, i < 2 ? 'manual' : 'journal',
    {caseId:labour.caseId, articleUrl:labour.articleUrl, taskId:task.id, prompt:task.prompt}));
  const times = [100000,121000,60000,60000];
  const entries = slots.map((a, i) => response(a, times[i],
    {documentUrl:task.reference.documentUrl, locator:task.reference.locator, verdict:task.verdict,
      reason:i < 2 ? task.explanation : '15~64세 인구만을 분모로 삼았다.'},
    {basis, expected:task.verdict, verdictGrade:'yes', reasonGrade:i < 2 ? 'yes' : 'no'}));
  const {deadlineComparisons:[d]} = core.allocationReport(slots, entries, new Set());
  assert.deepEqual(d.difference, {low:50, high:50});
  assert.deepEqual(d.withReason.manual, {assigned:2, verified:1, failedQuality:0, failedReason:0, overTime:1, withdrawn:0, unknown:0});
  assert.deepEqual(d.withReason.journal, {assigned:2, verified:0, failedQuality:0, failedReason:2, overTime:0, withdrawn:0, unknown:0});
  assert.deepEqual(d.withReason.difference, {low:-50, high:-50});
  assert.doesNotMatch(JSON.stringify(d.withReason), /private-|15~64세/);
});

test('이유 대조와 시간의 불확실성은 처음 배정한 사람을 포함해 계산하고 확정된 실패를 중복 집계하지 않는다', () => {
  const manual = ['exact','missing','other-task','unknown'].map(id => slot(id));
  const journal = ['crossed','wrong','over','withdrawn'].map(id => slot(id, 'journal'));
  const entries = [
    response(manual[0], 120000, {}, {reasonGrade:'yes'}),
    response(manual[2], 30000, {prompt:'다른 과제'}, {reasonGrade:'no'}),
    response(manual[3], 60000, {}, {reasonGrade:''}),
    response(journal[0], 60000, {method:'manual',journalUse:'no'}, {reasonGrade:'yes'}),
    response(journal[1], 120001, {recovered:true}, {reasonGrade:'no'}),
    response(journal[2], 120001, {recovered:true}),
    response(journal[3], 7000, {status:'withdrawn'}, {reasonGrade:'no'})
  ];
  const {deadlineComparisons:[d], all} = core.allocationReport([...manual,...journal], entries, new Set());
  assert.equal(all.crossover, 1);
  assert.deepEqual(d.withReason.manual, {assigned:4, verified:1, failedQuality:0, failedReason:0, overTime:0, withdrawn:0, unknown:3});
  assert.deepEqual(d.withReason.journal, {assigned:4, verified:1, failedQuality:0, failedReason:1, overTime:1, withdrawn:1, unknown:0});
  assert.deepEqual(d.withReason.difference, {low:-75, high:0});
});

test('이유 합격·불합격은 같은 원자료와 설명에 묶이며 위치·판정 실패 및 시간 누락의 우선순위를 지킨다', () => {
  const only = slot('editor');
  const outcome = (time, trial, grades, repeated = false) => {
    const entry = response(only, time, trial, grades);
    const {withReason} = core.allocationReport([only], [entry], new Set(repeated ? [entry.trial.id] : [])).deadlineComparisons[0];
    assert.equal(withReason.difference, null);
    assert.equal(withReason.manual.assigned, 1);
    return Object.keys(withReason.manual).filter(k => k !== 'assigned' && withReason.manual[k] === 1);
  };
  for (const badKey of [null, {...basis,explanation:' '}, {...basis,reference:{}}, {...basis,prompt:'다른 질문'},
    {...basis,caseId:'다른 기사'}, {...basis,articleUrl:'https://other.example/'}, {...basis,id:'다른 과제'}]) {
    for (const reasonGrade of ['yes','no']) {
      assert.deepEqual(outcome(1000, {}, {reasonGrade, basis:badKey}), ['unknown']);
    }
  }
  assert.deepEqual(outcome(120000, {recovered:true}, {reasonGrade:'yes'}), ['unknown']);
  assert.deepEqual(outcome(120000, {recovered:true}, {reasonGrade:'no'}), ['failedReason']);
  assert.deepEqual(outcome(120001, {}, {reasonGrade:'no',locationGrade:'no'}), ['failedQuality']);
  assert.deepEqual(outcome(1000, {found:'missing'}, {reasonGrade:'yes'}), ['failedQuality']);
  assert.deepEqual(outcome(1000, {}, {locationGrade:'',reasonGrade:'yes'}), ['unknown']);
  assert.deepEqual(outcome(1000, {}, {reasonGrade:'no'}, true), ['unknown']);
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
  assert.deepEqual(result.manual, {assigned:4, verified:1, failedQuality:0, overTime:2, withdrawn:1, unknown:0});
  assert.deepEqual(result.journal, {assigned:4, verified:1, failedQuality:1, overTime:0, withdrawn:0, unknown:2});
  assert.deepEqual(result.difference, {low:0, high:50});
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

test('부분 시간은 목표와 같아도 성공을 확정하지 않고 1ms 넘은 경우에만 시간 초과로 센다', () => {
  const durations = [0,119999,120000,120001];
  const rows = durations.map(n => slot(String(n)));
  const entries = rows.map((row, i) => response(row, durations[i], {recovered:true}));
  const report = core.allocationReport(rows, entries, new Set());
  assert.deepEqual(report.deadlineComparisons[0].manual, {assigned:4, verified:0, failedQuality:0, overTime:1, withdrawn:0, unknown:3});
  const [comp] = core.compareTimes(report.groups)[0].byVersion;
  assert.deepEqual(comp.completedMeans.manual, {count:4, minMs:90000, exact:false});
  assert.equal(comp.manualMs, null);
  assert.equal(comp.manual.partialCompleted, 4);
});

test('단계 전환과 휴식에서 밀리초를 반올림해도 정확히 120초의 활동을 초과로 분류하지 않는다', () => {
  let timer = core.timer(0);
  timer = core.tick(timer, 40000.5, 'locate', true);
  timer = core.tick(timer, 80001, 'decide', false);
  // An explicit pause can be stored and reopened in a new clock origin.
  const resumed = core.tick(JSON.parse(JSON.stringify(timer)), 400, 'decide', true);
  const row = slot('on-time');
  function status(extra) {
    const stopped = core.tick(resumed, 400 + 39999 + extra, 'decide', false);
    return core.allocationReport([row], [response(row, 0, {phaseMs:stopped.ms})], new Set()).deadlineComparisons[0].manual;
  }
  assert.equal(status(0).verified, 1);
  assert.equal(status(1).overTime, 1);
  assert.equal(core.validTimer({...timer, remainderMs:3}), false);
});

test('같은 과제·배포본에서 복원된 오답과 중도 종료를 더하면 성공당 투입 시간 차이의 방향이 뒤집힌다', () => {
  const manual = ['ms', 'mw', 'mq'].map(id => slot(id));
  const journal = ['js', 'jw', 'jq'].map(id => slot(id, 'journal'));
  const records = [
    response(manual[0], 30000), response(manual[1], 10000, {found:'missing'}),
    response(manual[2], 20000, {status:'withdrawn'}), response(journal[0], 10000),
    response(journal[1], 100000, {found:'missing', recovered:true}),
    response(journal[2], 150000, {status:'withdrawn', recovered:true})
  ];
  const report = core.allocationReport([...manual, ...journal], records, new Set());
  const [comparison] = core.compareTimes(report.groups)[0].byVersion;
  assert.deepEqual(report.assignmentComparisons[0].difference, {low:0, high:0});
  assert.equal(comparison.perVerified.savedMs, 50000);
  assert.deepEqual(comparison.returnedCost.journal, {completed:2, withdrawn:1, observedMs:260000,
    verified:1, pending:0, partial:2, minMs:260000, maxMs:null});
  assert.deepEqual(comparison.returnedCost.difference, {low:200000, high:null});
  const swapped = records.map(entry => ({...entry, trial:{...entry.trial,
    method:entry.trial.method === 'manual' ? 'journal' : 'manual'}}));
  const [reverse] = core.compareTimes(core.group(swapped))[0].byVersion;
  assert.deepEqual(reverse.returnedCost.difference, {low:null, high:-200000});
});

test('대기 답안은 정수 성공 수로 범위를 계산하고 성공 0건과 복원 후 성공을 구별한다', () => {
  const pending = {locationGrade:''};
  const a = slot('one'), b = slot('two');
  function cost(...entries) { return core.compareTimes(core.group(entries))[0].byVersion[0].returnedCost; }
  const possible = cost(response(a, 1000, {}, pending), response(b, 4000, {}, pending));
  assert.deepEqual(possible.manual, {completed:2, withdrawn:0, observedMs:5000, verified:0, pending:2,
    partial:0, minMs:2500, maxMs:5000});
  assert.equal(possible.difference, null);
  const zero = cost(response(a, 8000, {found:'missing'}), response(b, 2000, {status:'withdrawn'}));
  assert.deepEqual([zero.manual.observedMs, zero.manual.minMs, zero.manual.maxMs], [10000, null, null]);
  assert.equal(zero.journal, null);
  const restored = cost(response(a, 0, {recovered:true}), response(b, 2000, {recovered:true}, pending));
  assert.deepEqual([restored.manual.verified, restored.manual.pending, restored.manual.minMs, restored.manual.maxMs],
    [1, 1, 1000, null]);
  const exact = cost(response(a, 0), response(b, 0, {}, pending));
  assert.deepEqual([exact.manual.minMs, exact.manual.maxMs], [0, 0]);
  const bothUncertain = cost(response(a, 1000, {recovered:true}), response(slot('j', 'journal'), 4000, {recovered:true}));
  assert.deepEqual(bothUncertain.difference, {low:null, high:null});
});

test('회수한 기록의 성공 비용은 배포본을 넘나들지 않고 버전 미확인·성공 미확정이면 방향을 정하지 않는다', () => {
  const versions = ['a'.repeat(64), 'b'.repeat(64), undefined];
  const records = versions.flatMap((kitVersion, i) => [
    response(slot('m' + i), i ? 10000 : 1000, {kitVersion}),
    response(slot('j' + i, 'journal'), i ? 1000 : 10000, {kitVersion})
  ]);
  for (const [index, comparison] of core.compareTimes(core.group(records))[0].byVersion.entries()) {
    assert.equal(comparison.version, versions[index] ?? null);
    const expected = [9000,-9000][index];
    assert.deepEqual(comparison.returnedCost.difference, index < 2 ? {low:expected, high:expected} : null);
    assert.equal(comparison.returnedCost.journal.completed, 1);
  }
  const [unsettled] = core.compareTimes(core.group([records[0], {...records[1], locationGrade:''}]))[0].byVersion;
  assert.equal(unsettled.returnedCost.difference, null);
});

test('판단 이유까지 확인한 성공 비용은 두 항목의 성공과 마감 결과를 보존하고 대기·복원·실패를 반영한다', () => {
  const slots = ['m1','m2','j1','j2'].map((id,i) => slot(id, i < 2 ? 'manual' : 'journal'));
  const returns = slots.map((row,i) => response(row, i < 2 ? 60000 : 40000, {}, {reasonGrade:i === 3 ? 'no' : 'yes'}));
  const compare = entries => core.compareTimes(core.allocationReport(slots, entries, new Set()).groups)[0].byVersion[0];
  const comparison = compare(returns);
  assert.equal(comparison.returnedCost.journal.verified, 2);
  const cost = comparison.returnedCostWithReason;
  assert.equal(cost.journal.verified, 1);
  assert.deepEqual([cost.manual.minMs, cost.journal.minMs, cost.difference], [60000,80000,{low:20000, high:20000}]);
  assert.equal(core.allocationReport(slots, returns, new Set()).deadlineComparisons[0].journal.verified, 2);
  const changed = (i, changes) => returns.map((r,k) => k === i ? {...r,...changes} : r);
  const pending = compare(changed(3, {reasonGrade:''})).returnedCostWithReason;
  assert.deepEqual([pending.journal.verified, pending.journal.pending, pending.difference], [1,1,{low:-20000,high:20000}]);
  const partial = compare(changed(2, {trial:{...returns[2].trial, recovered:true}})).returnedCostWithReason;
  assert.deepEqual([partial.journal.minMs, partial.journal.maxMs, partial.difference], [80000,null,{low:20000,high:null}]);
  const zero = compare(changed(2, {reasonGrade:'no'})).returnedCostWithReason;
  assert.equal(zero.journal.minMs, null);
  assert.equal(zero.journal.pending, 0);
  assert.equal(zero.difference, null);
  for (const invalid of [null, {...basis,prompt:'other prompt'}, {...basis,id:'other-task'}, {...basis,explanation:''}, {...basis, reference:{}}]) {
    const invalidOnly = compare(returns.map(row => ({...row,basis:invalid})));
    assert.equal(invalidOnly.returnedCostWithReason, null);
    const mixedEntries = changed(2, {basis:invalid});
    const mixed = compare(mixedEntries).returnedCostWithReason;
    assert.deepEqual([mixed.journal.verified, mixed.journal.pending], [0,1]);
    const group = core.group(mixedEntries).find(g => g.method === 'journal');
    assert.deepEqual([group.verifiedWithReason, group.reasonOutcomeKnown, group.verifiedReasonFailed, group.verifiedReasonPending],
      [0,1,1,1]);
  }
  const perKit = core.compareTimes(core.group(returns.map((r,i) =>
    i < 2 ? {...r, reasonGrade:'', trial:{...r.trial,kitVersion:'b'.repeat(64)}} : r)))[0].byVersion;
  assert.deepEqual(perKit.map(r => !!r.returnedCostWithReason), [false,true]);
});

test('예정 판본 명부를 보존하고 같은 참여자·기사에 다른 판본이나 과거 미상 배정을 덧씌우지 않는다', () => {
  const hash = 'a'.repeat(64), old = slot('reader'), current = {...old,assignedKitVersion:hash};
  const file = rows => ({format:core.assignmentFormat, assignments:rows});
  assert.deepEqual(core.mergeAssignments([current], [file([current])]),[current]);
  assert.deepEqual(core.mergeAssignments([old], [file([old])]),[old]);
  for (const v of [null,undefined,'','A'.repeat(64),'a'.repeat(63),hash+'\n'])
    assert.throws(()=>core.mergeAssignments([], [file([{...old,assignedKitVersion:v}])]),/배포본 ID/);
  for (const other of [old,{...current,assignedKitVersion:'b'.repeat(64)}]) {
    for (const [a,b] of [[other,current],[current,other]])
      assert.throws(()=>core.mergeAssignments([a],[file([b])]),/예정 배포본/);
  }
  const returned = response(old,1000,{assignedKitVersion:hash});
  assert.equal(Object.hasOwn(returned.trial,'assignedKitVersion'),false);
});

test('같은 예정 판본·과제·목표별로 원래 분모를 지키며 다른 판본의 만점 답안을 성공에 넣지 않는다', () => {
  const planned = 'a'.repeat(64), other = 'b'.repeat(64);
  const issue = (person,method,edition,extra={}) => slot(person,method,{assignedKitVersion:edition,...extra});
  const rows = [issue(1,'manual',planned),issue(2,'journal',planned),issue(3,'manual',other),
    issue(4,'journal',other),slot(5),issue(6,'journal',planned,{targetSeconds:121})];
  const trials = [response(rows[0],5000,{found:'missing'}),response(rows[1],1000,{kitVersion:other},{reasonGrade:'yes'}),
    response(rows[2],1000,{kitVersion:other},{reasonGrade:'yes'}),response(rows[3],120001,{kitVersion:other},{reasonGrade:'yes'}),
    response(rows[4],1000,{kitVersion:planned},{reasonGrade:'yes'})];
  const r = core.allocationReport(rows,trials,new Set());
  assert.equal(r.unknownPlannedEdition,1);
  assert.equal(r.editionDeadlineComparisons.length,3);
  const [a,b,alone] = r.editionDeadlineComparisons;
  assert.deepEqual([a.assignedKitVersion,a.targetSeconds,a.manual.assigned,a.journal.assigned],[planned,120,1,1]);
  assert.deepEqual([a.manual.failedQuality,a.journal.verified,a.journal.unknown,a.journal.editions.differentVersion],[1,0,1,1]);
  assert.deepEqual(a.difference,{low:0,high:100});
  assert.deepEqual([b.assignedKitVersion,b.manual.verified,b.journal.overTime],[other,1,1]);
  assert.deepEqual(b.difference,{low:-100,high:-100});
  assert.equal(alone.difference,null);
  assert.equal(alone.journal.editions.noReturn,1);
  assert.equal(r.deadlineComparisons[0].withReason.journal.verified,1);
});

test('회신 없는 배정·기록 연결 충돌·판본 누락·이종 판본 재개와 동일 판본의 채점 대기를 분리한다', () => {
  const planned = 'a'.repeat(64), other = 'b'.repeat(64);
  const rows = Array.from({length:13},(_,i)=>slot(i,'manual',{assignedKitVersion:planned}));
  const previous = {status:'withdrawn', recovered:true, kitVersion:null, startedKitVersion:planned};
  const entries = [
    response(rows[1],1000,{kitVersion:null}),
    response(rows[2],1000,previous),
    response(rows[3],1000,{kitVersion:other,found:'missing'}),
    response(rows[4],5000,{status:'withdrawn'}),
    response(rows[5],120000,{},{}),
    response(rows[6],150000,{recovered:true},{reasonGrade:'yes'}),
    response(rows[7],5000,{}, {reasonGrade:'no'}),
    response(rows[8],1000,{taskId:'다른 과제'}),
    response(rows[9],1000),response(rows[9],1000,{id:'두 번째'}),
    response(rows[10],120000,{method:'journal'},{reasonGrade:'yes'}),
    response(rows[11],5000,{status:'withdrawn',kitVersion:other}),
    response(rows[12],5000,{recovered:true},{reasonGrade:'yes'})
  ];
  const r=core.allocationReport(rows,entries,new Set()).editionDeadlineComparisons[0].manual;
  assert.deepEqual(r.editions,{matched:6,noReturn:1,unlinked:2,noObservedVersion:1,differentVersion:2,changedOnResume:1});
  assert.deepEqual([r.assigned,r.verified,r.withdrawn,r.overTime,r.failedReason,r.unknown],[13,1,1,1,1,9]);
  assert.equal(r.editions.matched + r.editions.noReturn + r.editions.unlinked + r.editions.noObservedVersion +
    r.editions.differentVersion + r.editions.changedOnResume,r.assigned);
  assert.doesNotMatch(JSON.stringify(r),/private-|trial-/);
});
