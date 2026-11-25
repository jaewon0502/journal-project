const {test} = require('node:test');
const assert = require('node:assert/strict');
const field = require('../docs/reader/field-review-core.js');

function fixture(fasterEditorsMiss = true) {
  const slots = [], records = [];
  for (const [index, article] of ['A', 'B'].entries()) {
    const caseId = 'synthetic-' + article, articleUrl = 'https://example.org/mock-' + article;
    const edition = (index ? 'b' : 'a').repeat(64);
    const task = {caseId, articleUrl, id:'check', prompt:'가상 집행표의 지출액을 확인하세요.', verdict:'contradicted',
      reference:{document:'가상 집행표 ' + article, locator:'1쪽'}};
    for (const [person, participant] of ['private-1','private-2','private-3','private-4'].entries()) {
      const manual = (person < 2) !== Boolean(index), faster = person % 2 === 0;
      const method = manual ? 'manual' : 'journal';
      const a = {participant, caseId, articleUrl, taskId:task.id, prompt:task.prompt, method, assignedKitVersion:edition};
      const wrong = !manual && (faster === fasterEditorsMiss);
      slots.push(a);
      const trial = field.validate({format:field.format, ...a, id:participant + article, kind:'editor', status:'completed',
        kitVersion:edition, recovered:false, split:false, journalUse:manual ? 'no' : 'yes',
        phaseMs:{search:(manual ? (faster ? 100 : 20) : 50) * 1000, locate:0, decide:0}, found:'found',
        documentUrl:'https://example.org/표', locator:'private-citation', reason:'private-reason',
        verdict:wrong ? 'supported' : task.verdict});
      records.push({trial, basis:structuredClone(task), expected:task.verdict, locationGrade:'yes', verdictGrade:wrong ? 'no':'yes'});
    }
  }
  return {slots, records, repeated:new Set()};
}
function evaluate({slots, records, repeated}) {
  const roster = field.mergeAssignments([], [{format:field.assignmentFormat, assignments:slots}]);
  return field.allocationReport(roster, records, repeated);
}
function get(data) { return evaluate(data).editorCrossover; }

test('같은 기사별 평균과 성공률에서도 누가 빨라지면서 반박된 주장을 채택했는지 구분한다', () => {
  const {editorCrossover:fastLost, ...first} = evaluate(fixture());
  const {editorCrossover:slowLost, ...second} = evaluate(fixture(false));
  assert.deepEqual(first, second);
  assert.deepEqual(fastLost, {assignedEditors:4, pairedAssignments:4, completeEditors:4, comparedEditors:4,
    faster:2, sameTime:0, slower:2, fasterQuality:{fewer:2, same:0, more:0}, fasterUnsafe:{eligible:2, more:2},
    manualMeanMs:60000, journalMeanMs:50000, savedMs:10000, savedPct:100/6,
    successfulWork:{bothPassed:0, failedPairs:2, pendingPairs:2, changedStandards:0, comparedEditors:0,
      phaseEditors:0, time:null, phaseTimes:null}});
  assert.deepEqual(slowLost, {...fastLost, fasterQuality:{fewer:0, same:2, more:0}, fasterUnsafe:{eligible:2, more:0}});
  for (const privateText of ['private-', 'synthetic-', 'https:', '가상']) assert.ok(!JSON.stringify(fastLost).includes(privateText));
  const reversed = fixture(); reversed.slots.reverse(); reversed.records.reverse();
  assert.deepEqual(get(reversed), fastLost);
});

function reasonSample(speed) {
  const load = name => structuredClone(require('../experiments/field-reason-time/' + name + '.json'));
  return {slots:load('synthetic-roster').assignments, records:load('synthetic-grades-' + speed + '-pass').entries,
    repeated:new Set()};
}

test('전체 평균이 같은 두 현장 예시에서 양쪽 모두 이유까지 맞힌 편집자의 시간과 단계를 구분한다', () => {
  for (const [speed, expected] of [['slow', -20000], ['fast', 80000]]) {
    const result = get(reasonSample(speed)), success = result.successfulWork;
    assert.equal(result.savedMs, 30000);
    assert.deepEqual([success.bothPassed,success.failedPairs,success.pendingPairs,success.comparedEditors,success.phaseEditors], [2,2,0,2,2]);
    assert.equal(success.time.savedMs, expected);
    assert.equal(success.phaseTimes.search.savedMs + success.phaseTimes.locate.savedMs + success.phaseTimes.decide.savedMs, expected);
    const reversed = reasonSample(speed);
    reversed.slots.reverse(); reversed.records.reverse();
    assert.deepEqual(get(reversed), result);
  }
});

test('성공자와 단계별 기록에도 양방향 배정 균형이 필요하고 기준 설명 변경이나 이유 미채점은 절감으로 해석하지 않는다', () => {
  const data = reasonSample('slow');
  const firstSuccess = data.records.find(e => e.trial.method === 'journal' && e.reasonGrade === 'yes');
  firstSuccess.trial.split = false;
  let success = get(data).successfulWork;
  assert.equal(success.comparedEditors, 2);
  assert.equal(success.phaseTimes, null);
  assert.equal(success.phaseEditors, 0);
  const original = firstSuccess.basis.explanation;
  firstSuccess.basis.explanation += ' 수정된 기준';
  success = get(data).successfulWork;
  assert.equal(success.changedStandards, 2);
  assert.equal(success.time, null);
  firstSuccess.basis.explanation = original;
  firstSuccess.reasonGrade = '';
  success = get(data).successfulWork;
  assert.deepEqual([success.bothPassed, success.failedPairs, success.pendingPairs, success.comparedEditors], [1,2,1,0]);
  assert.equal(success.time, null);
  firstSuccess.locationGrade = 'no';
  assert.equal(get(data).successfulWork.failedPairs, 3);
});

test('시간 차이와 판정·위치의 동시 성공을 각각 계산하고 다른 종류의 정답은 오승인 증가 분모에서 뺀다', () => {
  const data = fixture(false);
  for (const e of data.records) {
    if (e.basis.caseId === 'synthetic-A') e.expected = e.basis.verdict = 'insufficient';
    e.trial.verdict = e.basis.verdict;
    e.verdictGrade = 'yes';
    if (e.trial.participant === 'private-1' && e.trial.method === 'manual') e.locationGrade = 'no';
    if (e.trial.participant === 'private-3' && e.trial.method === 'manual') e.trial.phaseMs.search = 50000;
  }
  const actual = get(data);
  assert.deepEqual([actual.faster, actual.sameTime, actual.slower], [1,1,2]);
  assert.deepEqual(actual.fasterQuality, {fewer:0, same:0, more:1});
  assert.deepEqual(actual.fasterUnsafe, {eligible:0, more:0});
});

test('정상 완료한 타이머의 0밀리초와 반올림하면 같은 근접 시간도 정확히 비교한다', () => {
  const data = fixture();
  for (const e of data.records) {
    e.trial.phaseMs = {search:0, locate:0, decide:0};
    if (e.trial.participant === 'private-1') {
      e.trial.phaseMs.search = Number.MAX_SAFE_INTEGER;
      e.trial.phaseMs.locate = e.trial.method === 'manual' ? 2 : 1;
    }
  }
  const result = get(data);
  assert.deepEqual([result.completeEditors, result.comparedEditors, result.faster, result.sameTime, result.slower], [4,4,1,3,0]);
});

test('평소 시간이 0이면 시간 차이를 보존하고 절감률은 산출하지 않는다', () => {
  const data = fixture();
  for (const {trial} of data.records) trial.phaseMs.search = trial.method === 'manual' ? 0 : 5;
  const result = get(data);
  assert.deepEqual([result.slower, result.savedMs, result.savedPct], [4, -5, null]);
});

test('반대 배정의 예정 인원과 자격 있는 인원이 각각 같아야 하며 남은 사람 중 일부만 골라 집계하지 않는다', () => {
  const data = fixture();
  data.records.splice(0,1);
  assert.deepEqual([get(data).completeEditors, get(data).comparedEditors], [3,0]);
  data.records = data.records.filter(e => e.trial.id !== 'private-3B');
  assert.deepEqual([get(data).completeEditors, get(data).comparedEditors], [2,2]);
  data.slots = data.slots.filter(a => a.participant !== 'private-1');
  assert.deepEqual([get(data).pairedAssignments, get(data).completeEditors, get(data).comparedEditors], [3,2,0]);
});

test('예정 판본 확인·온전한 시간·방식 일치·기준 채점·단일 회수가 모두 필요하다', () => {
  const changes = [
    (data, e) => { e.trial.kitVersion = '9'.repeat(64); },
    (data, e) => { e.trial.startedKitVersion = e.trial.kitVersion; e.trial.kitVersion = null; },
    (data, e) => { e.trial.journalUse = 'yes'; },
    (data, e) => { delete e.trial.journalUse; },
    (data, e) => { e.trial.method = 'journal'; },
    (data, e) => { e.trial.recovered = true; },
    (data, e) => { e.trial.status = 'withdrawn'; },
    (data, e) => { e.trial.kind = 'practice'; },
    (data, e) => { e.locationGrade = ''; },
    (data, e) => { e.verdictGrade = 'no'; },
    (data, e) => { delete e.basis; },
    (data, e) => { e.basis.prompt += '변경'; },
    (data, e) => { data.repeated.add(e.trial.id); },
    (data, e) => { data.records.push({...e, trial:{...e.trial,id:'another-return'}}); },
    (data, e) => { data.records.push({...e, trial:{...e.trial,id:'other',caseId:'other',articleUrl:'https://example.org/C'}}); }
  ];
  for (const change of changes) {
    const d = fixture(); change(d, d.records[0]);
    const r = get(d);
    assert.deepEqual([r.completeEditors, r.comparedEditors, r.manualMeanMs], [3,0,null], String(change));
  }
});

test('과제나 판본·목표가 다른 참여자를 역방향으로 엮지 않고 같은 기사 재노출을 제외한다', () => {
  for (const mutate of [
    d => { d.slots[0].targetSeconds = 777; },
    d => { d.records[0].basis.reference.locator = '재채점으로 바뀐 기준'; },
    d => { d.slots[0].assignedKitVersion = d.records[0].trial.kitVersion = '9'.repeat(64); }
  ]) {
    const data = fixture(); mutate(data); assert.equal(get(data).comparedEditors, 0);
  }
  const extra = fixture();
  extra.slots.push({...extra.slots[0],caseId:'extra',articleUrl:'https://example.org/C'});
  assert.deepEqual([get(extra).assignedEditors, get(extra).pairedAssignments, get(extra).comparedEditors], [4,3,0]);
  for (const mutate of [
    d => { d.slots[4].articleUrl = d.slots[0].articleUrl + '?utm_source=other'; },
    d => { d.slots[4].caseId = d.slots[0].caseId; }
  ]) {
    const data = fixture(); mutate(data);
    // Normal roster import rejects duplicates; a direct caller also cannot include these pairs.
    assert.throws(() => evaluate(data), /배정/);
    const result = field.allocationReport(data.slots, data.records, data.repeated).editorCrossover;
    assert.equal(result.pairedAssignments, 3); assert.equal(result.comparedEditors, 0);
  }
});

test('교차 집계는 결과를 열었을 때만 인원수를 보여 주고 참여 코드를 표시하지 않는다', async t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const {JSDOM} = require('jsdom');
  const reader = name => fs.readFileSync(path.join(__dirname, '../docs/reader', name), 'utf8');
  for (const fastLost of [true, false]) {
    const {slots, records} = fixture(fastLost);
    const {window} = new JSDOM(reader('field-summary.html'), {runScripts:'outside-only', url:'https://example.org/field-summary.html'});
    t.after(() => window.close());
    window.eval(reader('field-review-core.js'));
    window.eval(reader('field-time-report.js'));
    window.eval(reader('field-summary.js'));
    const el = id => window.document.getElementById(id);
    async function load(id, data) {
      const target = el(id);
      const file = new window.File([JSON.stringify(data)], '예시.json', {type:'application/json'});
      Object.defineProperty(target, 'files', {value:[file], configurable:true});
      await target.onchange({target});
    }
    await load('roster-file', {format:field.assignmentFormat, assignments:slots, synthetic:true});
    assert.match(el('roster-status').textContent, /모의 명부/);
    await load('imports', {format:'journal-field-grades-v1', entries:records, synthetic:true});
    assert.match(el('status').textContent, /가상으로 만든 현업형/);
    assert.ok(!Object.keys(window.sessionStorage).some(key => window.sessionStorage.getItem(key).includes('private-')));
    await load('roster-file', {format:field.assignmentFormat, assignments:slots});
    await load('imports', {format:'journal-field-grades-v1', entries:records});
    const panel = el('editor-crossover');
    assert.equal(panel.textContent, '');
    el('toggle-results').click();
    assert.match(panel.textContent, /교차 배정 비교에 포함된 편집자 4명/);
    assert.match(panel.textContent, /평소 도구 60.0초 · 저널 병행 50.0초 · 10.0초 절감 \(16.7%\)/);
    assert.match(panel.textContent, new RegExp('하나 이상이 틀린 편집자 ' + (fastLost ? 2 : 0) + '명'));
    assert.match(panel.textContent, new RegExp('저널에서는 채택한 편집자 ' + (fastLost ? 2 : 0) + '명'));
    assert.ok(!panel.textContent.includes('private-'));
    const leak = window.document.createElement('p');
    leak.textContent = 'private-live-note';
    panel.append(leak);
    let blob;
    window.URL.createObjectURL = value => { blob = value; return 'blob:local-example'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = () => {};
    panel.querySelector('button').click();
    const html = await blob.text();
    assert.match(html, /양쪽 모두 성공 0명/);
    assert.doesNotMatch(html, /private-|synthetic-|https:|<script/i);
    el('toggle-results').click();
    assert.equal(panel.textContent, '');
  }
});
