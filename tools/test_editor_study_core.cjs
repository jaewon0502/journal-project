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
  assert.deepEqual(r.quality.manual,{correct:12,total:16,unsafe:4,unsafeTotal:8,citationCorrect:16,qualityCorrect:12,
    adoptions:{total:12,verified:8,otherSource:0,contradicted:{accepted:2,eligible:4},insufficient:{accepted:2,eligible:4}}});
  assert.deepEqual(r.quality.journal,{correct:14,total:16,unsafe:2,unsafeTotal:8,citationCorrect:16,qualityCorrect:14,
    adoptions:{total:10,verified:8,otherSource:0,contradicted:{accepted:1,eligible:4},insufficient:{accepted:1,eligible:4}}});
  for (const item of r.bias.cases) {
    assert.equal(item.manual.A.total, 2);
    assert.equal(item.journal.B.total, 2);
  }
});

test('모의 채택에서 정답률과 오승인율이 같아도 두 방식이 서로 다른 오류를 낸다', () => {
  const records = study.adoptionDemoRecords();
  assert.equal(study.analyze(records).quality, null);
  const r = study.analyze(records, 'demo');
  assert.deepEqual([r.included, r.time.manualSeconds, r.time.journalSeconds, r.time.reductionPct], [4,120,60,50]);
  assert.deepEqual([r.bias.manualGapPp,r.bias.journalGapPp], [0,0]);
  for (const method of ['manual','journal']) {
    const q = r.quality[method], a = q.adoptions;
    assert.deepEqual([q.correct,q.total,q.unsafe,q.unsafeTotal,a.verified,a.total,a.otherSource], [6,8,2,4,4,6,0]);
    assert.deepEqual(a, r.timedQuality[method].adoptions);
    assert.deepEqual([a.contradicted.eligible,a.insufficient.eligible], [2,2]);
  }
  assert.deepEqual([r.quality.manual.adoptions.contradicted.accepted, r.quality.journal.adoptions.contradicted.accepted], [0,2]);
  assert.deepEqual([r.quality.manual.adoptions.insufficient.accepted, r.quality.journal.adoptions.insufficient.accepted], [2,0]);
});

test('채택된 응답이 없거나 맞는 주장을 다른 근거로 채택한 경우 분모와 근거를 구분한다', () => {
  const records = [1,2,3,4].map(i => observations(i, (task, gold) => {
    if (task.method === 'manual') return {verdict:'opinion', sourceIds:[]};
    const other = gold.sources.find(s => !gold.expectedSourceIds.includes(s.id)).id;
    return {verdict:'supported', sourceIds:task.variant === 'A' ? [other] : []};
  }));
  const q = study.analyze(records).quality;
  assert.deepEqual(q.manual.adoptions, {total:0,verified:0,otherSource:0,
    contradicted:{accepted:0,eligible:2},insufficient:{accepted:0,eligible:2}});
  assert.deepEqual(q.journal.adoptions, {total:8,verified:0,otherSource:4,
    contradicted:{accepted:2,eligible:2},insufficient:{accepted:2,eligible:2}});
});

test('등록한 8명의 답 31건과 마지막 가능한 네 판정에서 격차 변화의 두 끝값을 재현한다', () => {
  const records = study.missingCueDemoRecords();
  const report = study.analyze(records, 'demo');
  assert.deepEqual([report.bias.reductionPp, report.trialCount, report.recordedTrials], [100, 16, 31]);
  const expected = {registeredBlocks:2, submitted:31, assigned:32, missing:1, minReductionPp:-50, maxReductionPp:-37.5};
  assert.deepEqual(report.missingAnswerBounds, expected);
  const last = records.at(-1);
  const stopped = {...last, withdrawn:true, withdrawalTask:null};
  assert.deepEqual(study.analyze([...records.slice(0,-1), stopped], 'demo').missingAnswerBounds, expected);
  for (const verdict of ['supported','contradicted','opinion','insufficient']) {
    const done = study.addTrial(last, {elapsedMs:1, verdict, reason:'마지막 판정', sourceIds:[], journalUsed:true});
    const all = study.analyze([...records.slice(0,-1), done], 'demo');
    assert.equal(all.bias.reductionPp, verdict === 'supported' ? -37.5 : -50);
    assert.deepEqual(all.missingAnswerBounds, {...expected, submitted:32, missing:0,
      minReductionPp:all.bias.reductionPp, maxReductionPp:all.bias.reductionPp});
  }
  assert.equal(study.analyze(records).missingAnswerBounds, null);
});

test('미제출 네 건의 가능한 조합과 비교하고 등록이 일부인 묶음의 과제는 더하지 않는다', () => {
  const full = [1,2,3,4].map(i => observations(i));
  const partial = full.map(r => ({...r, trials:r.trials.slice(0,-1)}));
  const report = study.analyze([...partial, observations(6)]);
  const bounds = report.missingAnswerBounds;
  assert.equal(report.bias, null);
  assert.deepEqual([bounds.registeredBlocks,bounds.submitted,bounds.assigned,bounds.missing], [1,12,16,4]);
  const allOutcomes = Array.from({length:16}, (_, flags) => {
    const completed = partial.map((r, i) => study.addTrial(r, {...full[i].trials[3], verdict:flags & (1 << i) ? 'supported' : 'opinion'}));
    return study.analyze(completed).bias.reductionPp;
  });
  assert.deepEqual([bounds.minReductionPp,bounds.maxReductionPp], [Math.min(...allOutcomes),Math.max(...allOutcomes)]);
  const blank = full.map(r => ({...r, trials:[]}));
  assert.deepEqual(study.analyze(blank).missingAnswerBounds, {registeredBlocks:1, assigned:16, submitted:0, missing:16,
    minReductionPp:-100, maxReductionPp:100});
  assert.equal(study.analyze([]).missingAnswerBounds, null);
});

test('빈 자료·중도탈락·빠진 배정은 시간 0이나 편향 감소로 해석하지 않는다', () => {
  assert.equal(study.analyze([]).quality, null);
  assert.equal(study.analyze([]).timedQuality, null);
  const partial = observations(3);
  partial.trials.pop();
  const records = [observations(1), observations(2), partial];
  const r = study.analyze(records);
  assert.deepEqual([r.enrolled,r.completed,r.included,r.excluded,r.recordedTrials,r.trialCount], [3,2,0,3,11,0]);
  assert.deepEqual(r.blocks, [{block:1,enrolled:3,completed:2,included:false,missingOrdinals:[4],unfinishedOrdinals:[3],withdrawnOrdinals:[]}]);
  assert.equal(r.bias, null);
  assert.equal(r.missingAnswerBounds, null);
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

test('표기별 채택률 격차의 크기와 오승인율이 같아도 기사별 방향이 뒤바뀔 수 있다', () => {
  const {bias, quality} = study.analyze(study.cueReversalDemoRecords(), 'demo');
  assert.deepEqual([bias.manualGapPp,bias.journalGapPp,bias.reductionPp], [50,50,0]);
  assert.deepEqual(bias.gapAndQuality, {cases:4, narrowed:0, narrowedUnsafeEligible:0,
    narrowedWithMoreUnsafe:0, narrowedWithFewerVerified:0, narrowedWithMoreUnsafeBothLabels:0});
  assert.deepEqual(bias.directionReversals, {comparedCases:4,reversedCases:2,byExpectedVerdict:{
    supported:{comparedCases:2,reversedCases:0},contradicted:{comparedCases:1,reversedCases:1},insufficient:{comparedCases:1,reversedCases:1}}});
  assert.deepEqual(bias.cases.filter(row=>row.directionReversed).map(row=>[row.caseId,row.manual.signedGapPp,row.journal.signedGapPp]),
    [['repair',100,-100],['permits',-100,100]]);
  for (const group of Object.values(quality.byVariant)) {
    assert.deepEqual([group.manual.unsafe, group.manual.unsafeTotal, group.journal.unsafe, group.journal.unsafeTotal], [1,2,1,2]);
  }
  const records = [1,2,3,4].map(i=>observations(i, t=>{
    const adopted = t.caseId === 'transit' ? t.variant === (t.method === 'manual' ? 'A' : 'B')
      : t.caseId === 'filing' ? t.variant === 'A'
      : t.variant === 'A' && t.method === (t.caseId === 'repair' ? 'manual' : 'journal');
    return {verdict:adopted ? 'supported' : 'insufficient'};
  }));
  const ties = study.analyze(records).bias;
  assert.deepEqual(ties.cases.filter(row=>row.directionReversed).map(row=>row.caseId), ['transit']);
  assert.deepEqual(ties.directionReversals.byExpectedVerdict.supported, {comparedCases:2,reversedCases:1});
  assert.equal(study.analyze(records.slice(0,3)).bias, null);
});

test('성향 표기별 정확도 합계가 같아도 같은 오답에 모인 사례를 구분한다', () => {
  const records = [1,2,3,4].map(i => observations(i, t => {
    const wrongBudget = t.caseId === 'repair' && (t.method === 'journal' || t.variant === 'A');
    const wrongPermits = t.caseId === 'permits' && t.method === 'manual' && t.variant === 'B';
    return wrongBudget || wrongPermits ? {verdict:'supported'} : {};
  }));
  const result = study.analyze([...records, observations(5)]);
  assert.equal(result.bias.reductionPp, 50);
  for (const group of [result.quality, ...Object.values(result.quality.byVariant)]) {
    const {adoptions:manual, ...manualTotals} = group.manual;
    const {adoptions:journal, ...journalTotals} = group.journal;
    assert.deepEqual(journalTotals, manualTotals);
    assert.equal(journal.total, manual.total);
  }
  const budget = result.bias.cases.find(row => row.caseId === 'repair');
  const permits = result.bias.cases.find(row => row.caseId === 'permits');
  assert.deepEqual(result.bias.gapAndQuality, {cases:4, narrowed:2, narrowedUnsafeEligible:2,
    narrowedWithMoreUnsafe:1, narrowedWithFewerVerified:1, narrowedWithMoreUnsafeBothLabels:0});
  assert.deepEqual([budget.moreUnsafeOnNarrowing, budget.moreUnsafeBothLabelsOnNarrowing, budget.fewerVerifiedOnNarrowing],
    [true, false, true]);
  assert.deepEqual([permits.moreUnsafeOnNarrowing, permits.moreUnsafeBothLabelsOnNarrowing, permits.fewerVerifiedOnNarrowing],
    [false, false, false]);
  assert.deepEqual([budget.gapReductionPp, permits.gapReductionPp], [100,100]);
  assert.deepEqual(budget.qualityDrops, ['correct','qualityCorrect']);
  assert.deepEqual(permits.qualityDrops, []);
  assert.deepEqual([budget.quality.manual.unsafe, budget.quality.manual.unsafeTotal,
    budget.quality.journal.unsafe, budget.quality.journal.unsafeTotal], [1,2,2,2]);
  assert.equal(budget.quality.byVariant.A.manual.qualityCorrect, 0);
  assert.equal(budget.quality.byVariant.B.manual.qualityCorrect, 1);
  for (const variant of ['A','B']) {
    const arm = budget.quality.byVariant[variant].journal;
    assert.deepEqual([arm.correct, arm.citationCorrect, arm.qualityCorrect, arm.total], [0,1,0,1]);
  }
});

test('판정과 근거 각각의 적중 수가 같아도 둘을 함께 맞힌 응답이 줄면 해당 사례를 표시한다', () => {
  const records = [1,2,3,4].map(i => observations(i, t => {
    if (t.caseId !== 'repair') return {};
    if (t.method === 'manual') return t.variant === 'A' ? {verdict:'supported', sourceIds:['doc-1']} : {};
    return t.variant === 'A' ? {verdict:'insufficient'} : {sourceIds:['doc-1']};
  }));
  const row = study.analyze(records).bias.cases.find(c => c.caseId === 'repair');
  assert.deepEqual(row.qualityDrops, ['qualityCorrect']);
  assert.equal(row.quality.manual.qualityCorrect, 1);
  assert.equal(row.quality.journal.qualityCorrect, 0);
});

test('격차가 좁아진 같은 기사에서 양쪽 표기의 오승인이 모두 늘었는지 따로 센다', () => {
  const records = Array.from({length:8}, (_, i) => observations(i + 1, t => {
    if (t.caseId === 'repair') {
      const unsafe = t.method === 'journal' || (t.variant === 'A' && i < 4);
      return unsafe ? {verdict:'supported'} : {};
    }
    if (t.caseId === 'transit' && (t.method === 'journal' || t.variant === 'B')) return {verdict:'insufficient'};
    return {};
  }));
  const {bias} = study.analyze(records);
  assert.deepEqual(bias.gapAndQuality, {cases:4, narrowed:2, narrowedUnsafeEligible:1,
    narrowedWithMoreUnsafe:1, narrowedWithFewerVerified:2, narrowedWithMoreUnsafeBothLabels:1});
  const repair = bias.cases.find(row => row.caseId === 'repair');
  assert.equal(repair.moreUnsafeBothLabelsOnNarrowing, true);
  assert.deepEqual(['A','B'].map(v => [repair.quality.byVariant[v].manual.unsafe, repair.quality.byVariant[v].journal.unsafe]),
    [[1,2],[0,2]]);
  const transit = bias.cases.find(row => row.caseId === 'transit');
  assert.deepEqual([transit.quality.manual.unsafeTotal, transit.moreUnsafeOnNarrowing, transit.fewerVerifiedOnNarrowing],
    [0, false, true]);
  assert.deepEqual(study.analyze(records.slice(0,7)).bias.gapAndQuality, study.analyze(records.slice(0,4)).bias.gapAndQuality);
  assert.equal(study.analyze(records.slice(0,3)).bias, null);
});

test('판정 적중이 그대로인 사례에서 대표 근거와 동시 일치 감소를 따로 집계한다', () => {
  for (const wrongSourceLabel of ['A','B']) {
    const records = [1,2,3,4].map(i => observations(i, t => {
      if (t.caseId !== 'repair') return {};
      const answer = {};
      if (t.variant === 'A') answer.verdict = t.method === 'manual' ? 'supported' : 'insufficient';
      if (t.method === 'journal' && t.variant === wrongSourceLabel) answer.sourceIds = ['doc-1'];
      return answer;
    }));
    // Interrupted clocks still provide valid submitted judgments in a complete block.
    const partial = records[0].trials[0];
    partial.elapsedMs = null; partial.observedMs = 1000; partial.phaseMs = null;
    const result = study.analyze(records);
    assert.equal(result.time, null);
    const row = result.bias.cases.find(c => c.caseId === 'repair');
    assert.equal(row.gapReductionPp, 100);
    assert.deepEqual([row.quality.manual.correct, row.quality.journal.correct], [1,1]);
    assert.deepEqual(row.qualityDrops, wrongSourceLabel === 'A' ? ['citationCorrect'] : ['citationCorrect','qualityCorrect']);
  }
});

test('같은 문서 번호도 기사와 방식별로 집계하고 대표 근거를 고르지 않은 응답을 분모에 남긴다', () => {
  const data = [1,2,3,4,5].map(i => observations(i, t => {
    if (t.caseId === 'repair') {
      return {sourceIds:t.method === 'manual' || t.variant === 'A' ? ['doc-1'] : []};
    }
    if (t.caseId === 'permits') return {sourceIds:t.method === 'manual' ? [] : ['doc-2']};
    return {};
  }));
  const rows = study.analyze(data).bias.cases;
  const budget = rows.find(r => r.caseId === 'repair').sourceChoices;
  const permits = rows.find(r => r.caseId === 'permits').sourceChoices;
  assert.deepEqual(budget.manual, {byId:{'doc-1':2,'doc-2':0,'doc-3':0}, none:0, total:2});
  assert.deepEqual(budget.journal, {byId:{'doc-1':1,'doc-2':0,'doc-3':0}, none:1, total:2});
  assert.deepEqual(permits.manual, {byId:{'doc-1':0,'doc-2':0,'doc-3':0}, none:2, total:2});
  assert.deepEqual(permits.journal, {byId:{'doc-1':0,'doc-2':2,'doc-3':0}, none:0, total:2});
  assert.deepEqual(budget.gapPp, {manual:0, journal:100});
  assert.deepEqual(permits.gapPp, {manual:0, journal:0});
  assert.equal(budget.byVariant.B.journal.none, 1);
  for (const row of rows) for (const method of ['manual','journal']) {
    const arm = row.sourceChoices[method], [anchor] = packets.get(row.caseId, 'A').expectedSourceIds;
    assert.equal(Object.values(arm.byId).reduce((sum, count) => sum + count, arm.none), arm.total);
    assert.equal(arm.total, row.quality[method].total);
    assert.equal(arm.byId[anchor], row.quality[method].citationCorrect);
    for (const variant of ['A','B']) {
      const cell = row.sourceChoices.byVariant[variant][method];
      assert.equal(cell.total, row[method][variant].total);
      assert.equal(Object.values(cell.byId).reduce((sum, count) => sum + count, cell.none), cell.total);
      assert.equal(cell.byId[anchor], row.quality.byVariant[variant][method].citationCorrect);
    }
  }
});

test('틀린 자료의 방식별 합계와 판정이 같아도 정당 표기에 따라 선택이 갈리면 분포 차이가 나타난다', () => {
  function compare(splitBlocks) {
    const records = Array.from({length:9}, (_, i) => observations(i + 1, t => {
      if (t.caseId !== 'repair') return {};
      const block = Math.floor(i / 4);
      const split = t.method === 'journal' && block < splitBlocks;
      const choseRequest = split ? t.variant === 'A' : block === 0;
      return {sourceIds:[choseRequest ? 'doc-1' : 'doc-2']};
    }));
    const interrupted = records[0].trials[0];
    interrupted.elapsedMs = null;
    interrupted.observedMs = 100;
    interrupted.phaseMs = null;
    const result = study.analyze(records);
    assert.equal(result.included, 8);
    assert.equal(result.timing.included, 4);
    return result.bias.cases.find(row => row.caseId === 'repair');
  }
  const balanced = compare(0), partlySplit = compare(1), split = compare(2);
  for (const row of [partlySplit, split]) {
    assert.deepEqual(row.quality, balanced.quality);
    for (const method of ['manual','journal']) assert.deepEqual(row[method], balanced[method]);
  }
  for (const method of ['manual','journal']) assert.deepEqual(balanced.sourceChoices[method], split.sourceChoices[method]);
  assert.deepEqual(balanced.sourceChoices.gapPp, {manual:0, journal:0});
  assert.deepEqual(partlySplit.sourceChoices.gapPp, {manual:0, journal:50});
  assert.deepEqual(split.sourceChoices.gapPp, {manual:0, journal:100});
  assert.deepEqual(split.sourceChoices.byVariant.A.journal, {byId:{'doc-1':2,'doc-2':0,'doc-3':0}, none:0, total:2});
  assert.deepEqual(split.sourceChoices.byVariant.B.journal, {byId:{'doc-1':0,'doc-2':2,'doc-3':0}, none:0, total:2});
});

test('판정·자료 선택과 정확도가 각각 같아도 두 선택의 연결이 달라진 기사와 셀을 찾는다', () => {
  const records = study.verdictSourceDemoRecords();
  const control = structuredClone(records);
  for (const t of control.flatMap(record => record.trials)) {
    if (t.caseId === 'repair' && t.method === 'journal' && t.variant === 'B')
      t.sourceIds = [t.verdict === 'supported' ? 'doc-1' : 'doc-2'];
  }
  const baseline = study.analyze(control, 'demo');
  const changed = study.analyze(records, 'demo');
  assert.deepEqual(changed.quality, baseline.quality);
  const original = baseline.bias.cases.find(row => row.caseId === 'repair');
  const repair = changed.bias.cases.find(row => row.caseId === 'repair');
  for (const key of ['manual','journal','quality','sourceChoices']) assert.deepEqual(repair[key], original[key]);
  assert.deepEqual(changed.bias.verdictSourceAssociation, {comparedCases:4,
    manual:{differentCases:0,equalMarginalsWithGap:0}, journal:{differentCases:1,equalMarginalsWithGap:1}});
  assert.deepEqual(original.verdictSourceAssociation.journal, {gapPp:0,totalA:2,totalB:2,differences:[]});
  assert.deepEqual(repair.verdictSourceAssociation.journal, {gapPp:100,totalA:2,totalB:2,differences:[
    {verdict:'supported',sourceId:'doc-1',countA:1,countB:0}, {verdict:'supported',sourceId:'doc-2',countA:0,countB:1},
    {verdict:'opinion',sourceId:'doc-1',countA:0,countB:1}, {verdict:'opinion',sourceId:'doc-2',countA:1,countB:0}
  ]});
  assert.equal(study.analyze(records.slice(0,3),'demo').bias, null);
  assert.equal(study.analyze(records).bias, null);
});

test('대표 근거 미선택도 조합으로 세고, 시간이 누락된 완성 묶음과 미완성 묶음을 구별한다', () => {
  const records = Array.from({length:9}, (_, i) => observations(i+1, t => {
    if (i === 0 && t.position === 1) return {elapsedMs:null, observedMs:100};
    if (i < 4 && t.caseId === 'repair' && t.method === 'journal' && t.variant === 'B') return {sourceIds:[]};
    return {};
  }));
  const result = study.analyze(records);
  assert.equal(result.included,8);
  assert.equal(result.timing.included,4);
  const row = result.bias.cases.find(row => row.caseId === 'repair');
  assert.deepEqual(row.verdictSourceAssociation.journal, {gapPp:50,totalA:2,totalB:2,differences:[
    {verdict:'contradicted',sourceId:'doc-3',countA:2,countB:1},
    {verdict:'contradicted',sourceId:null,countA:0,countB:1}
  ]});
  assert.deepEqual(result.bias.verdictSourceAssociation.journal, {differentCases:1,equalMarginalsWithGap:0});
});

test('세 묶음에서 같은 1표 차이는 비율 반올림 때문에 격차 감소로 처리되지 않는다', () => {
  for (const higherJournalLabel of ['A','B']) {
    const data = Array.from({length:12}, (_, index) => observations(index + 1, t => {
      if (t.caseId !== 'repair') return {};
      const supported = t.method === 'manual' ? t.variant === 'A' && index < 4 : t.variant === higherJournalLabel || index < 8;
      return supported ? {verdict:'supported'} : {};
    }));
    const row = study.analyze(data).bias.cases.find(c => c.caseId === 'repair');
    assert.deepEqual([row.manual.A.endorsed, row.manual.B.endorsed], [1,0]);
    assert.equal(row.journal[higherJournalLabel].endorsed, 3);
    assert.equal(row.gapReductionPp, 0);
    assert.deepEqual(row.qualityDrops, []);
    assert.equal(row.moreUnsafeOnNarrowing, false);
    assert.equal(row.moreUnsafeBothLabelsOnNarrowing, false);
  }
});

test('같은 전체 격차가 여러 사례로 옮겨도 사실 채택과 판정 분포 변화는 정확히 0이다', () => {
  const votes = {manual:[0,2,3,1], journal:[0,2,2,2]};
  const data = Array.from({length:12}, (_, index) => observations(index + 1, t => {
    const groupsEndorsing = votes[t.method][packets.ids.indexOf(t.caseId)];
    return {verdict:t.variant === 'A' && Math.floor(index / 4) < groupsEndorsing ? 'supported' : 'insufficient'};
  }));
  const b = study.analyze(data).bias;
  assert.deepEqual([b.manualGapPp, b.journalGapPp, b.reductionPp, b.reductionPct], [50,50,0,0]);
  assert.deepEqual(b.distribution, {manualGapPp:50, journalGapPp:50, reductionPp:0});
  const deleted = [0,1,2].map(skip => study.analyze(data.filter((_, i) => Math.floor(i / 4) !== skip)).bias.reductionPp);
  assert.deepEqual(b.leaveOneBlockOut, {blocks:3, minReductionPp:Math.min(...deleted), maxReductionPp:Math.max(...deleted)});
});

test('시간 절감률은 참가자별 두 방식의 평균 시간 차이에 같은 가중치를 준 뒤 계산한다', () => {
  const manual = [10,30,30,30], journal = [30,20,20,20];
  const records = [1,2,3,4].map(i => observations(i,t => ({elapsedMs: 1000 * (t.method === 'manual' ? manual[i-1] : journal[i-1])})));
  const r = study.analyze(records);
  assert.deepEqual([r.time.manualSeconds,r.time.journalSeconds,r.time.reductionPct], [25,22.5,10]);
  assert.deepEqual(r.time.editorPairs.map(row => row.savedSeconds), [-20,10,10,10]);
});

test('시간이 온전한 4인 묶음을 차례로 제외하면 전체 절감률의 방향이 뒤집히는 경우를 찾는다', () => {
  const records = Array.from({length:8}, (_, i) => observations(i + 1, t => ({
    elapsedMs:t.method === 'manual' ? 60000 : (i < 4 ? 10000 : 90000)
  })));
  const interrupted = [13,14,15,16].map(i => observations(i, t => i === 13 && t.position === 1
    ? {elapsedMs:null, observedMs:500} : {elapsedMs:1000}));
  const time = study.analyze([...records, observations(9), ...interrupted]).time;
  assert.equal(time.reductionPct, 100 / 6);
  assert.deepEqual(time.leaveOneBlockOut, {blocks:2, estimates:2, minReductionPct:-50,
    maxReductionPct:250 / 3, reversesDirection:true});
  assert.equal(study.analyze(records.slice(0, 7)).time.leaveOneBlockOut, null);
});

test('묶음 제외 절감률은 남은 시간의 합으로 재계산하고 변화 없는 결과를 반전으로 세지 않는다', () => {
  const durations = [[10000,10000], [40000,40000], [100000,50000]];
  const records = Array.from({length:12}, (_, i) => observations(i + 1, t => ({
    elapsedMs:durations[Math.floor(i / 4)][t.method === 'manual' ? 0 : 1]
  })));
  const range = study.analyze(records).time.leaveOneBlockOut;
  assert.deepEqual(range, {blocks:3, estimates:3, minReductionPct:0,
    maxReductionPct:500 / 11, reversesDirection:false});
});

test('단계별 수동 시간이 0인 제외 결과는 생략하고 전체와 유효 결과의 방향을 비교한다', () => {
  const records = Array.from({length:8}, (_, i) => observations(i + 1, t => {
    const elapsedMs = t.method === 'manual' ? 120000 : 90000;
    const select = i < 4 ? (t.method === 'manual' ? 60000 : 10000) : (t.method === 'manual' ? 0 : 90000);
    return {phaseMs:{select, locate:elapsedMs - select, decide:0}};
  }));
  const {select, decide} = study.analyze(records).phases.byStage;
  assert.ok(select.reductionPct < 0);
  assert.deepEqual(select.leaveOneBlockOut, {blocks:2, estimates:1,
    minReductionPct:250 / 3, maxReductionPct:250 / 3, reversesDirection:true});
  assert.equal(decide.reductionPct, null);
  assert.equal(decide.leaveOneBlockOut, null);
});

test('시간이 일부만 남은 답은 품질과 정당 비교에 쓰고 전체 시간은 온전한 4인 묶음으로 비교한다', () => {
  const partial = {elapsedMs:null, observedMs:1500, phaseMs:null};
  const records = Array.from({length:8}, (_, i) => observations(i + 1, t =>
    i === 0 && t.position === 1 ? partial : {elapsedMs:i < 4 ? 5000 : (t.method === 'manual' ? 1000 : 500)}));
  for (const n of [4, 8]) {
    const result = study.analyze(records.slice(0, n));
    assert.deepEqual(result.timing, {included:n-4, trialCount:(n-4)*4, partialTrials:1, observedMs:1500});
    assert.equal(result.trialCount, n * 4);
    assert.equal(result.quality.manual.qualityCorrect, n * 2);
    assert.equal(result.bias.cases[0].manual.A.total, n / 4);
    assert.equal(result.time?.reductionPct ?? null, n === 4 ? null : 50);
  }
  assert.deepEqual(study.mergeRecords(records, JSON.parse(JSON.stringify(records))), records);
  for (const bad of [{observedMs:-1}, {observedMs:undefined}, {phaseMs:{select:0,locate:0,decide:0}}, {elapsedMs:1500}]) {
    assert.throws(() => observations(1, () => ({...partial, ...bad})), /시간/);
  }
});

test('사실 채택률이 같아도 근거 부족과 반박을 정당 표기에 따라 다르게 썼다면 네 판정 분포에 나타난다', () => {
  const records = Array.from({length:8}, (_, i) => observations(i + 1, (task, item) => {
    const swap = task.caseId === 'permits' && task.method === 'manual' && task.variant === 'B' && i < 4;
    return {verdict:swap ? 'contradicted' : item.expectedVerdict};
  }));
  const b = study.analyze(records).bias;
  assert.deepEqual([b.manualGapPp, b.journalGapPp], [0,0]);
  assert.deepEqual(b.distribution, {manualGapPp:12.5, journalGapPp:0, reductionPp:12.5});
  const task = b.cases.find(c => c.caseId === 'permits');
  assert.equal(task.manual.distributionGapPp, 50);
  assert.deepEqual(task.manual.A.counts, {supported:0, contradicted:0, insufficient:2, opinion:0});
  assert.deepEqual(task.manual.B.counts, {supported:0, contradicted:1, insufficient:1, opinion:0});
  assert.equal(study.analyze(records.slice(0, 3)).bias, null);
});

test('전체 정답 수가 같아도 시간을 잰 묶음에서 실패한 검토까지 합산해 성공 한 건당 시간을 계산한다', () => {
  const records = Array.from({length:8}, (_, index) => observations(index + 1, (task, item) => {
    const time = index === 4 && task.position === 1 ? {elapsedMs:null, observedMs:250} :
      {elapsedMs:task.method === 'manual' ? 10000 : 5000};
    const failedMethod = index < 4 ? 'journal' : 'manual';
    if (index % 4 === 0 || task.method !== failedMethod) return time;
    // Positive cases lack the cited evidence; negative cases have the right citation but the wrong verdict.
    return item.expectedVerdict === 'supported' ? {...time, sourceIds:[]} : {...time, verdict:'supported'};
  }));
  const result = study.analyze(records);
  assert.equal(result.timing.included, 4);
  assert.deepEqual([result.quality.manual.qualityCorrect, result.quality.journal.qualityCorrect], [10,10]);
  assert.deepEqual([result.quality.journal.adoptions.contradicted.eligible, result.quality.journal.adoptions.insufficient.eligible], [4,4]);
  assert.equal(result.time.reductionPct, 50);
  assert.deepEqual(result.timedQuality, {
    manual:{total:8, correct:8, citationCorrect:8, verified:8, unsafe:0, unsafeTotal:4, elapsedMs:80000,
      adoptions:{total:4,verified:4,otherSource:0,contradicted:{accepted:0,eligible:2},insufficient:{accepted:0,eligible:2}},
      secondsPerVerified:10, meanVerifiedSeconds:10, meanFailedSeconds:null},
    journal:{total:8, correct:5, citationCorrect:5, verified:2, unsafe:3, unsafeTotal:4, elapsedMs:40000,
      adoptions:{total:7,verified:1,otherSource:3,contradicted:{accepted:1,eligible:2},insufficient:{accepted:2,eligible:2}},
      secondsPerVerified:20, meanVerifiedSeconds:5, meanFailedSeconds:5},
    perVerified:{savedSeconds:-10, reductionPct:-100},
    faster:{total:4, fewerVerified:3, sameVerified:1, moreVerified:0}, fasterJournalSuccessCounts:[3,0,1]
  });
  assert.equal(study.analyze(records.slice(4)).timedQuality, null);
  assert.deepEqual(study.analyze([...records, ...records, observations(9), ...study.demoRecords()]).timedQuality,
    result.timedQuality);
  assert.equal(study.analyze(study.demoRecords()).timedQuality, null);
  assert.equal(study.analyze(study.demoRecords(), 'demo').timedQuality.manual.verified, 12);
});

test('방식별 성공 수와 총시간이 같아도 성공과 실패에 쓴 시간을 구분한다', () => {
  for (const journalSuccessSeconds of [95,5]) {
    const records = [1,2,3,4].map(i => observations(i, (task, item) => {
      const verified = ['transit','filing'].includes(task.caseId);
      const seconds = task.method === 'manual' ? (verified ? 80 : 120) :
        (verified ? journalSuccessSeconds : 100 - journalSuccessSeconds);
      return {elapsedMs:seconds * 1000, sourceIds:verified ? [item.expectedSourceIds[0]] : []};
    }));
    const {time, timedQuality:{manual, journal, faster}} = study.analyze(records);
    assert.deepEqual([time.manualSeconds, time.journalSeconds, faster.sameVerified], [100,50,4]);
    assert.deepEqual([manual.verified, journal.verified, manual.secondsPerVerified, journal.secondsPerVerified], [4,4,200,100]);
    assert.deepEqual([manual.meanVerifiedSeconds, manual.meanFailedSeconds], [80,120]);
    assert.deepEqual([journal.meanVerifiedSeconds, journal.meanFailedSeconds], [journalSuccessSeconds,100-journalSuccessSeconds]);
  }
});

test('검증 성공이 0건이면 해당 방식의 성공당 시간과 절감률의 분모가 없음을 표시한다', () => {
  for (const zeroMethods of [['manual'], ['journal'], ['manual','journal']]) {
    const records = [1,2,3,4].map(i => observations(i, t => zeroMethods.includes(t.method) ? {sourceIds:[]} : {}));
    const {manual, journal, perVerified} = study.analyze(records).timedQuality;
    assert.deepEqual([manual.secondsPerVerified, journal.secondsPerVerified],
      [zeroMethods.includes('manual') ? null : 120, zeroMethods.includes('journal') ? null : 90]);
    assert.deepEqual([manual.elapsedMs, journal.elapsedMs], [960000,720000]);
    for (const [method, arm, seconds] of [['manual', manual, 120], ['journal', journal, 90]]) {
      assert.deepEqual([arm.meanVerifiedSeconds, arm.meanFailedSeconds], zeroMethods.includes(method) ? [null, seconds] : [seconds, null]);
    }
    assert.deepEqual(perVerified, {savedSeconds:null, reductionPct:null});
  }
});

test('결과별 평균은 편집자가 그 결과로 제출한 과제마다 한 건씩 센다', () => {
  const records = [1,2,3,4].map(i => {
    let journalCount = 0;
    return observations(i, (task, item) => {
      if (task.method === 'manual') return {};
      journalCount++;
      const verified = i === 1 || (i === 2 && journalCount === 1);
      return {elapsedMs:i * 10000, sourceIds:verified ? [item.expectedSourceIds[0]] : []};
    });
  });
  const {journal} = study.analyze(records).timedQuality;
  assert.deepEqual([journal.verified, journal.meanVerifiedSeconds], [3,40/3]);
  assert.deepEqual([journal.total - journal.verified, journal.meanFailedSeconds], [5,32]);
});

test('빠른 편집자는 두 검토의 합이 1밀리초라도 작은 사람만 포함하고 검증 성공 건수 변화를 센다', () => {
  for (const lastDuration of [1999, 2000]) {
    const records = [1,2,3,4].map(i => {
      const journalDurations = i === 4 ? [1,lastDuration] : [1200,799];
      return observations(i, t => ({
        elapsedMs:t.method === 'manual' ? 1000 : journalDurations.shift(),
        ...((i === 1 && t.method === 'journal') || (i === 3 && t.method === 'manual') ? {sourceIds:[]} : {})
      }));
    });
    assert.deepEqual(study.analyze(records).timedQuality.faster, {total:3, fewerVerified:1, sameVerified:1, moreVerified:1});
  }
});

test('성공 건수의 전후 변화가 같아도 빨라진 사람들이 실제로 검증한 과제 수를 구분한다', () => {
  const groups = [true,false].map(fasterCorrect => study.analyze([1,2,3,4].map(i => observations(i, (t, item) => ({
    elapsedMs:t.method === 'manual' ? 120000 : i <= 2 ? 90000 : 150000,
    sourceIds:(i <= 2) === fasterCorrect ? [item.expectedSourceIds[0]] : []
  })))).timedQuality);
  for (const group of groups) {
    assert.deepEqual(group.faster, {total:2, fewerVerified:0, sameVerified:2, moreVerified:0});
    assert.deepEqual([group.manual.verified, group.journal.verified], [4,4]);
  }
  assert.deepEqual(groups.map(q => q.fasterJournalSuccessCounts), [[0,0,2], [2,0,0]]);
  const mixed = study.analyze([1,2,3,4].map(i => {
    let journalTrials = 0;
    return observations(i, t => t.method === 'journal' && journalTrials++ === 0 ? {sourceIds:[]} : {});
  }));
  assert.deepEqual(mixed.timedQuality.fasterJournalSuccessCounts, [0,4,0]);
});

test('두 과제의 시간 합이 안전한 정수 범위를 넘어도 1밀리초 차이를 같은 방향으로 계산한다', () => {
  const records = [1,2,3,4].map(i => {
    let journalTrials = 0;
    return observations(i, t => ({elapsedMs:Number.MAX_SAFE_INTEGER - 1 -
      (t.method === 'journal' && journalTrials++ === 0 ? 1 : 0)}));
  });
  const result = study.analyze(records);
  assert.equal(result.time.savedSeconds, 0.0005);
  assert.equal(result.time.fasterEditors, 4);
  assert.equal(result.timedQuality.perVerified.savedSeconds, 0.0005);
  assert.deepEqual(result.timedQuality.fasterJournalSuccessCounts, [0,0,4]);
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

test('전체 동시 일치율이 같아도 어느 기사 표기에서 근거를 잃었는지 비교한다', () => {
  const records = [1,2,3,4].map(i => observations(i, (t, gold) => {
    const omitSource = t.method === 'manual' ? t.variant === 'B' : t.variant === 'A';
    return {verdict:t.method === 'manual' && t.variant === 'B' ? 'supported' : gold.expectedVerdict,
      sourceIds:omitSource ? [] : gold.expectedSourceIds};
  }));
  const r = study.analyze(records);
  assert.equal(r.bias.reductionPp, 50);
  assert.deepEqual([r.quality.manual.qualityCorrect, r.quality.journal.qualityCorrect], [4,4]);
  const {A,B} = r.quality.byVariant;
  assert.deepEqual([A.manual.qualityCorrect, A.journal.qualityCorrect, B.manual.qualityCorrect, B.journal.qualityCorrect], [4,0,0,4]);
  assert.deepEqual([B.manual.correct, B.manual.citationCorrect, B.manual.unsafe, B.manual.unsafeTotal, B.manual.total], [2,0,2,2,4]);
  for (const method of ['manual','journal']) {
    for (const key of ['total','correct','citationCorrect','qualityCorrect','unsafe','unsafeTotal']) {
      assert.equal(A[method][key] + B[method][key], r.quality[method][key]);
    }
    const a = A[method].adoptions, b = B[method].adoptions, all = r.quality[method].adoptions;
    for (const key of ['total','verified','otherSource']) assert.equal(a[key] + b[key], all[key]);
    for (const key of ['contradicted','insufficient']) {
      assert.equal(a[key].accepted + b[key].accepted, all[key].accepted);
      assert.equal(a[key].eligible + b[key].eligible, all[key].eligible);
    }
  }
  // A record from an incomplete later block cannot change a label's denominator.
  assert.deepEqual(study.analyze([...records, observations(5)]).quality.byVariant, r.quality.byVariant);
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

test('각 단계는 네 명 모두 기록한 묶음에서만 비교하고 이전 전체 시간과 예시를 보존한다', () => {
  function timed(i) {
    return observations(i, task => ({phaseMs: task.method === 'manual'
      ? {select:30000,locate:60000,decide:30000} : {select:20000,locate:45000,decide:25000}}));
  }
  const records = Array.from({length:8}, (_, i) => timed(i+1));
  records[1].trials[0].phaseMs = null;
  delete records[2].trials[2].phaseMs;
  const result = study.analyze(records.concat(study.demoRecords()));
  assert.equal(result.included,8);
  assert.equal(result.phases.availableTrials,30);
  assert.deepEqual([result.phases.included,result.phases.completeBlocks,result.phases.trialCount],[4,1,16]);
  assert.deepEqual(study.stages.map(s=>result.phases.byStage[s].savedSeconds),[10,15,5]);
  assert.deepEqual(result.phases.byStage.locate.editorPairs.map(p=>p.participantId),['E5','E6','E7','E8']);
  assert.equal(study.analyze(records.slice(0,4)).phases.byStage,null);
  assert.equal(study.analyze(study.demoRecords()).phases.availableTrials,0);
  assert.equal(study.analyze(study.demoRecords(),'demo').phases.included,8);
});

test('JSON의 단계 시간은 합계를 검증하고 기존 v1 내보내기와 합칠 때 보존한다', () => {
  const old = observations(1);
  const enriched = structuredClone(old);
  enriched.trials[0].phaseMs = {select:40000,locate:40000,decide:40000};
  const partial = {...enriched, trials:enriched.trials.slice(0,1)};
  for (const pair of [[old,partial],[partial,old]]) assert.deepEqual(study.mergeRecords([pair[0]],[pair[1]]),[enriched]);
  for (const bad of [{select:1,locate:2},[], {select:1.5,locate:0,decide:119998.5},
    {select:120001,locate:-1,decide:0},{select:4,locate:5,decide:6},
    {select:40000,locate:40000,decide:40000, extra:0}]) {
    const changed=structuredClone(enriched); changed.trials[0].phaseMs=bad;
    assert.throws(()=>study.validateRecord(changed),/단계/);
  }
  const missed=structuredClone(enriched); missed.trials[0].phaseMs=null;
  assert.throws(()=>study.mergeRecords([missed],[enriched]),/서로 다른/);
});

test('중단 확정 파일은 진행본과 합쳐도 종료 상태를 유지하고 중단 뒤 응답을 거절한다', () => {
  const full = observations(1), partial = {...full, trials:full.trials.slice(0, 2)};
  const stopped = {...partial, withdrawn:true};
  const early = {...partial, trials:partial.trials.slice(0,1)};
  for (const earlier of [partial, early]) {
    assert.deepEqual(study.mergeRecords([stopped], [earlier]), [stopped]);
    assert.deepEqual(study.mergeRecords([earlier], [stopped]), [stopped]);
  }
  for (const pair of [[full, stopped], [stopped, full]]) {
    assert.throws(() => study.mergeRecords([pair[0]], [pair[1]]), /중단/);
  }
  assert.throws(() => study.addTrial(stopped, full.trials[2]), /중단/);
  assert.throws(() => study.validateRecord({...full, withdrawn:true}), /중단/);
  assert.throws(() => study.validateRecord({...partial, withdrawn:'true'}), /중단/);
  const result = study.analyze([stopped, observations(2), {...observations(3), trials:[]}]);
  assert.equal(result.withdrawn, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.included, 0);
  assert.deepEqual(result.blocks[0].withdrawnOrdinals, [1]);
});

test('미제출 과제의 배정과 시간은 양방향 병합에서 보존되며 모순된 기록은 거절한다', () => {
  const active = {...observations(1), trials:[]};
  const legacy = {...active, withdrawn:true}, between = {...legacy, withdrawalTask:null};
  const task = {...study.plan(1)[0], elapsedMs:2345, partial:false};
  const started = {...legacy, withdrawalTask:task};
  for (const known of [between, started]) for (const prior of [legacy, active, known]) {
    assert.deepEqual(study.mergeRecords([prior],[known]), [known]);
    assert.deepEqual(study.mergeRecords([known],[prior]), [known]);
  }
  for (const conflicting of [between, {...legacy, withdrawalTask:{...task, elapsedMs:1000}},
    {...legacy, withdrawalTask:{...task, partial:true}}]) {
    assert.throws(() => study.mergeRecords([conflicting],[started]), /중단/);
    assert.throws(() => study.mergeRecords([started],[conflicting]), /중단/);
  }
  for (const invalid of [{...active, withdrawalTask:null}, {...active, withdrawalTask:task},
    ...[{position:2},{caseId:'other'},{variant:'B'},{method:'journal'},{elapsedMs:-1},{elapsedMs:null},{partial:1}]
      .map(delta => ({...legacy, withdrawalTask:{...task, ...delta}}))]) {
    assert.throws(() => study.validateRecord(invalid));
  }
});

test('중단 과제에서 확인한 시간과 미확인 기록은 완성 묶음의 시간·판정·단계 통계와 독립적이다', () => {
  const cohort = [1,2,3,4].map(i => observations(i));
  const stopped = i => ({...observations(i), trials:[], withdrawn:true});
  const withTask = (i, elapsedMs, partial) => ({...stopped(i), withdrawalTask:{...study.plan(i)[0], elapsedMs, partial}});
  const extra = [withTask(5,2234,false), withTask(6,0,true), {...stopped(7),withdrawalTask:null}, stopped(8)];
  const before = study.analyze(cohort), after = study.analyze([...cohort, ...extra]);
  assert.equal(after.withdrawn,4);
  assert.equal(after.withdrawalWork.unknown,1);
  assert.equal(after.withdrawalWork.betweenTasks,1);
  for (const [method, stats] of Object.entries(after.withdrawalWork.byMethod)) {
    const tasks = extra.map(r => r.withdrawalTask).filter(t => t?.method === method);
    assert.deepEqual(stats, {tasks:tasks.length, elapsedMs:tasks.reduce((n,t) => n+t.elapsedMs,0), partial:tasks.filter(t => t.partial).length});
  }
  for (const k of ['time','phases','quality','bias','trialCount','recordedTrials']) assert.deepEqual(after[k], before[k]);
});

test('묶음 안에서 둘이 중단해도 네 과제를 마친 각 편집자의 관측 방향은 남는다', () => {
  const records = study.unfinishedBlockDemoRecords();
  const a = study.analyze([...records, records[0]], 'demo');
  assert.equal(a.time.reductionPct, 50);
  assert.equal(a.timing.included, 4);
  assert.equal(a.timingCoverage.total, 4);
  assert.deepEqual(a.individualCompletionTiming, {
    registeredEditors:12, completedEditors:10, unfinishedEditors:2, outsideCompleteBlocks:6,
    directions:{total:10, faster:4, slower:6, unchanged:0, unknown:0, possibleFaster:4}
  });
  const alone = study.analyze(records.slice(4, 7),'demo');
  assert.equal(alone.time, null);
  assert.equal(alone.individualCompletionTiming.outsideCompleteBlocks, 3);
  assert.equal(alone.individualCompletionTiming.directions.slower, 3);
  const none = study.analyze([records[7]],'demo');
  assert.equal(none.individualCompletionTiming.directions, null);
  assert.equal(none.individualCompletionTiming.unfinishedEditors, 1);
});

test('한 사람의 큰 절감이 과반 편집자의 증가를 가려도 개인별 중앙값과 인원은 방향을 보존한다', () => {
  const journal = [10000, 110000, 120000, 130000];
  const records = [1,2,3,4].map(ordinal => observations(ordinal, task => ({
    elapsedMs:task.method === 'manual' ? 100000 : journal[ordinal - 1]
  })));
  const time = study.analyze(records).time;
  assert.equal(time.reductionPct,7.5);
  assert.equal(time.medianSavedSeconds,-15);
  assert.deepEqual([time.fasterEditors, time.unchangedEditors, time.slowerEditors], [1, 0, 3]);

  // Different pairs whose integer durations have exactly equal totals.
  const equal = [1,2,3,4].map(ordinal => {
    const durations = {manual:[1200,1250], journal:[1150,1300]};
    return observations(ordinal, task => ({elapsedMs:durations[task.method].shift()}));
  });
  const ties = study.analyze(equal).time;
  assert.equal(ties.unchangedEditors,4);
  assert.equal(ties.medianSavedSeconds,0);
});

test('전체시간 비교에서 빠진 편집자도 관측 시간만으로 증가가 확정되면 인원에 포함한다', () => {
  const records = Array.from({length:12}, (_, i) => {
    let interrupted = false;
    return observations(i + 1, task => {
      if ((i === 4 || i === 8) && task.method === 'journal' && !interrupted) {
        interrupted = true;
        return {elapsedMs:null, observedMs:120000};
      }
      const manual = task.method === 'manual';
      return {elapsedMs:manual === (i < 4) ? 120000 : 60000};
    });
  });
  const a = study.analyze([...records, observations(13), records[4], ...study.demoRecords()]);
  assert.equal(a.time.reductionPct, 50);
  assert.equal(a.timing.included, 4);
  assert.deepEqual(a.timingCoverage, {total:12, faster:4, slower:8, unchanged:0, unknown:0, possibleFaster:4});
  assert.equal(study.analyze(records.slice(2, 4)).timingCoverage, null);
});

test('한쪽 하한 동률, 양쪽 중단과 1밀리초 차이를 구분해 가능한 단축 인원을 센다', () => {
  const partial = ms => ({elapsedMs:null, observedMs:ms});
  const full = ms => ({elapsedMs:ms});
  const max = Number.MAX_SAFE_INTEGER;
  const pairs = [
    [partial(10), full(10)], [full(10), partial(10)], [partial(5), partial(20)], [full(10), full(10)],
    [partial(11), full(10)], [full(8), partial(3)], [partial(0), full(5)], [full(max), full(max - 1)]
  ];
  const records = pairs.map(([manual, journal], i) => {
    const arms = {manual:[manual, full(i === 7 ? max : 40)], journal:[journal, full(i === 7 ? max : 40)]};
    return observations(i + 1, task => arms[task.method].shift());
  });
  const a = study.analyze(records);
  assert.equal(a.time, null);
  assert.deepEqual(a.timingCoverage, {total:8, faster:2, slower:0, unchanged:1, unknown:5, possibleFaster:6});
  const minimum = [1, 2, 3, 4].map(ordinal => observations(ordinal, task =>
    ordinal === 1 && task.method === 'journal' && task.variant === 'A' ? partial(0) : full(1)));
  assert.deepEqual(study.analyze(minimum).timingCoverage,
    {total:4, faster:0, slower:0, unchanged:3, unknown:1, possibleFaster:0});
});

test('한 묶음 제외 범위는 남은 사례별 분모에서 재계산하며 격차 방향이 바뀔 수 있다', () => {
  // Half of the cases reverse A and B, so pooling across different articles would hide every gap.
  const contrast = {manual:[1,1,-1], journal:[1,0,-1]};
  const records = Array.from({length:12}, (_, index) => observations(index + 1, task => {
    const sign = packets.ids.indexOf(task.caseId) % 2 === 0 ? 1 : -1;
    const side = contrast[task.method][Math.floor(index / 4)] * sign;
    return {verdict:(side === 1 && task.variant === 'A') || (side === -1 && task.variant === 'B') ? 'supported' : 'insufficient'};
  }));
  const orphan = observations(17);
  const output = study.analyze([...records, orphan, ...study.demoRecords()]);
  assert.equal(output.completeBlocks, 3);
  assert.ok(Math.abs(output.bias.reductionPp - 100/3) < 1e-9);
  assert.deepEqual(output.bias.leaveOneBlockOut, {blocks:3, minReductionPp:-50, maxReductionPp:50});
  const reruns = [0,1,2].map(block => study.analyze(records.filter((_, i) => Math.floor(i / 4) !== block)).bias.reductionPp);
  assert.deepEqual(reruns, [-50,0,50]);
  assert.equal(study.analyze([orphan]).bias, null);
  assert.equal(study.analyze(records.slice(0,7)).bias.leaveOneBlockOut, null);
  assert.deepEqual(study.analyze(study.demoRecords(),'demo').bias.leaveOneBlockOut, {blocks:2, minReductionPp:0, maxReductionPp:50});
});
