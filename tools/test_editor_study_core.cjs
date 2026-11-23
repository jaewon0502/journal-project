const {test} = require('node:test');
const assert = require('node:assert/strict');
const study = require('../docs/reader/editor-study-core.js');
const packets = require('../docs/reader/editor-study-cases.js');

function observations(ordinal, responses = () => ({})) {
  let record = study.createRecord('E' + ordinal, ordinal, 'editor', true);
  for (const task of study.plan(ordinal)) {
    const item = packets.get(task.caseId, task.variant);
    record = study.addTrial(record, {
      elapsedMs: task.method === 'manual' ? 120000 : 90000,
      reason: '제공된 원자료의 해당 구간을 대조했다.', verdict: item.expectedVerdict, sourceIds: [item.expectedSourceIds[0]], journalUsed: task.method === 'journal',
      ...responses(task, item),
    });
  }
  return record;
}

test('네 명 한 묶음에서 기사·조건이 한 번씩, 각 위치에 두 방식과 두 정당이 균형 배정된다', () => {
  const periodsByCell = new Map();
  for (let block = 0; block < 4; block++) {
    const assignments = Array.from({length: 4}, (_, i) => study.plan(block * 4 + i + 1));
    for (const tasks of assignments) {
      assert.equal(new Set(tasks.map(t => t.caseId)).size, 4);
      assert.equal(new Set(tasks.map(t => t.method + t.variant)).size, 4);
    }
    for (let i = 0; i < 4; i++) {
      assert.equal(new Set(assignments.map(tasks => tasks[i].caseId)).size, 4);
      assert.equal(new Set(assignments.map(tasks => tasks[i].method + tasks[i].variant)).size, 4);
    }
    const cells = assignments.flat();
    assert.equal(new Set(cells.map(t => t.caseId + t.method + t.variant)).size, 16);
    for (const t of cells) {
      const key = t.caseId + t.method + t.variant;
      if (!periodsByCell.has(key)) periodsByCell.set(key, new Set());
      periodsByCell.get(key).add(t.position);
    }
  }
  for (const periods of periodsByCell.values()) assert.equal(periods.size, 4);
});

test('비교 문항에서 정치 단서 이외의 주장·질문·근거 및 동결된 정답이 유지된다', () => {
  for (const id of packets.ids) {
    const a = packets.get(id,'A'), b = packets.get(id,'B');
    assert.match(a.article, /^보수 성향 /);
    assert.match(b.article, /^진보 성향 /);
    assert.equal(a.article.slice('보수 성향 '.length), b.article.slice('진보 성향 '.length));
    assert.equal(a.question, b.question);
    assert.deepEqual(a.sources, b.sources);
    assert.equal(a.expectedVerdict, b.expectedVerdict);
    assert.deepEqual(a.expectedSourceIds, b.expectedSourceIds);
    assert.equal(a.expectedSourceIds.length, 1);
  }
});

test('예시 여덟 명의 분모, 시간, 편향 지표, 잘못된 사실 확인을 원래 단위로 재현한다', () => {
  const data = study.demoRecords();
  const real = study.analyze(data);
  assert.equal(real.enrolled, 0);
  assert.equal(real.time, null);
  const r = study.analyze(data, 'demo');
  assert.deepEqual([r.completeBlocks, r.enrolled, r.included, r.trialCount, r.excluded], [2,8,8,32,0]);
  assert.deepEqual([r.time.manualSeconds,r.time.journalSeconds,r.time.savedSeconds,r.time.reductionPct], [120,90,30,25]);
  assert.deepEqual([r.bias.manualGapPp,r.bias.journalGapPp,r.bias.reductionPp,r.bias.reductionPct], [50,25,25,50]);
  assert.deepEqual(r.quality.manual,{correct:12,total:16,unsafe:4,unsafeTotal:8,citationCorrect:16,qualityCorrect:12});
  assert.deepEqual(r.quality.journal,{correct:14,total:16,unsafe:2,unsafeTotal:8,citationCorrect:16,qualityCorrect:14});
  for (const item of r.bias.cases) {
    assert.equal(item.manual.A.total, 2);
    assert.equal(item.journal.B.total, 2);
  }
});

test('빈 자료·중도탈락·빠진 배정은 시간 0이나 편향 감소로 해석하지 않는다', () => {
  assert.equal(study.analyze([]).quality, null);
  const partial = observations(3);
  partial.trials.pop();
  const records = [observations(1), observations(2), partial];
  const r = study.analyze(records);
  assert.deepEqual([r.enrolled,r.completed,r.included,r.excluded,r.recordedTrials,r.trialCount], [3,2,0,3,11,0]);
  assert.deepEqual(r.blocks, [{block:1,enrolled:3,completed:2,included:false,missingOrdinals:[4],unfinishedOrdinals:[3]}]);
  assert.equal(r.bias, null);
  const onceFull = study.analyze([...records, ...[5,6,7,8].map(i => observations(i))]);
  assert.deepEqual([onceFull.included, onceFull.excluded, onceFull.trialCount], [4,3,16]);
  assert.equal(onceFull.bias.reductionPct, null);
  assert.equal(onceFull.bias.reductionPp, 0);
});

test('반대 방향 기사별 격차를 평균에서 상쇄하지 않고 악화와 증가는 음수로 표시한다', () => {
  const records = [1,2,3,4].map(i => observations(i, (task, item) => {
    if (task.method === 'manual') return {verdict: item.expectedVerdict};
    const endorsing = packets.ids.indexOf(task.caseId) % 2 === 0 ? 'A' : 'B';
    return {elapsedMs: 240000, verdict: task.variant === endorsing ? 'supported' : 'insufficient'};
  }));
  const r = study.analyze(records);
  assert.equal(r.time.reductionPct, -100);
  assert.equal(r.bias.reductionPp, -100);
  assert.equal(r.bias.reductionPct, null);
  assert.deepEqual(r.bias.cases.map(item => item.journal.signedGapPp), [100,-100,100,-100]);
});

test('시간 절감률은 참가자별 두 방식의 평균 시간 차이에 같은 가중치를 준 뒤 계산한다', () => {
  const manual = [10,30,30,30], journal = [30,20,20,20];
  const records = [1,2,3,4].map(i => observations(i,t => ({elapsedMs: 1000 * (t.method === 'manual' ? manual[i-1] : journal[i-1])})));
  const r = study.analyze(records);
  assert.deepEqual([r.time.manualSeconds,r.time.journalSeconds,r.time.reductionPct], [25,22.5,10]);
  assert.deepEqual(r.time.editorPairs.map(row => row.savedSeconds), [-20,10,10,10]);
});

test('같은 파일 재수입, 진행본과 완료본의 병합, 충돌·번호 재사용 거절이 일관된다', () => {
  const full = observations(1), start = {...full, trials: full.trials.slice(0,2)};
  assert.deepEqual(study.mergeRecords([full],[start,full]), [full]);
  assert.deepEqual(study.mergeRecords([start],[full]), [full]);
  const conflict = structuredClone(start);
  conflict.trials[0].elapsedMs++;
  assert.throws(() => study.mergeRecords([full],[conflict]), /서로 다른/);
  assert.throws(() => study.mergeRecords([full],[{...full, participantId:'another'}]), /겹칩니다/);
  assert.throws(() => study.mergeRecords([full],[study.createRecord(full.participantId,5,'editor',true)]), /겹칩니다/);
});

test('출처가 없는 판단은 제출할 수 있고 정답과 근거 일치를 각각 계산한다', () => {
  const records = [1,2,3,4].map(i => observations(i, t => t.method === 'journal' ? {sourceIds:[]} : {}));
  const result = study.analyze(records);
  assert.equal(result.quality.journal.correct, 8);
  assert.equal(result.quality.journal.qualityCorrect, 0);
  assert.equal(result.quality.manual.qualityCorrect, 8);
});

test('실측 자격·배정·방식·시간·대표 근거·네 회차 한도를 검사한다', () => {
  assert.throws(() => study.createRecord('E1',1,'editor',false));
  assert.throws(() => study.createRecord('editor 1',1,'editor',true));
  for (const n of [0,1.2,NaN,Infinity]) assert.throws(() => study.plan(n));
  const full = observations(1);
  const start = {...full, trials: []};
  const trial = full.trials[0];
  for (const diff of [{elapsedMs:0},{elapsedMs:Infinity},{elapsedMs:-10},{verdict:'fact'},
    {sourceIds:['missing']},{sourceIds:[...trial.sourceIds,...trial.sourceIds]},{reason:'  '},{reason:'가'.repeat(4001)},
    {method:'journal'},{variant:'B'},{caseId:packets.ids[2]},{journalUsed:true}]) {
    assert.throws(() => study.addTrial(start,{...trial,...diff}));
  }
  const missingArmUsage = {...full.trials[1]};
  delete missingArmUsage.journalUsed;
  assert.throws(() => study.validateRecord({...full, trials:[trial,missingArmUsage]}));
  assert.throws(() => study.validateRecord({...full, protocol:'earlier-study'}));
  assert.throws(() => study.validateRecord({...full, trials:[trial,trial]}));
  assert.throws(() => study.addTrial(full, trial));
  assert.deepEqual(start.trials, []);
});
