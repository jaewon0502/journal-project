const {test} = require('node:test');
const assert = require('node:assert/strict');
const study = require('../docs/reader/editor-study-core.js');

const a = 'a'.repeat(64), b = 'b'.repeat(64);
function participant(ordinal, versions, partial = false) {
  let record = study.createRecord('E'+ordinal, ordinal, 'editor', true);
  for (const [index, version] of versions.entries()) {
    const task = study.plan(ordinal)[index];
    const observation = {
      elapsedMs: task.method === 'manual' ? 120000 : 90000,
      journalUsed: task.method === 'journal', reason:'모의 회차의 근거를 대조했다.', sourceIds:[],
      verdict: task.method === 'manual' && task.variant === 'A' ? 'supported' : 'insufficient'
    };
    if (version !== undefined) observation.kitVersion = version;
    if (partial && index === 0) Object.assign(observation,{elapsedMs:null,observedMs:33000,phaseMs:null});
    record = study.addTrial(record,observation);
  }
  return record;
}
const four = version => Array(4).fill(version);

test('회차와 미제출 중단 과제의 실제 판본을 보존하고 식별자를 엄격하게 검증한다', () => {
  const row = participant(1,[a,null,undefined]);
  const ready = study.validateRecord({...row, kitVersion:b});
  assert.deepEqual(ready,row);
  assert.equal(ready.trials[0].kitVersion,a);
  assert.equal(ready.trials[1].kitVersion,null);
  assert.equal(Object.hasOwn(ready.trials[2],'kitVersion'),false);
  const stopped = {...row,withdrawn:true,withdrawalTask:{...study.plan(1)[3],elapsedMs:2000,partial:false,kitVersion:b}};
  assert.deepEqual(study.validateRecord(stopped),stopped);
  assert.equal(study.kitVersion(a),a);
  for (const invalid of [undefined,'','A'.repeat(64),'f'.repeat(63),'0'.repeat(65),a+'\n',123,true]) {
    assert.equal(study.kitVersion(invalid),null);
    assert.throws(()=>study.validateRecord({...row,trials:[{...row.trials[0],kitVersion:invalid}]}),/배포본/);
    assert.throws(()=>study.validateRecord({...stopped,withdrawalTask:{...stopped.withdrawalTask,kitVersion:invalid}}),/배포본/);
  }
});

test('같은 회차를 덮어쓰거나 과거 회차 판본을 추정하지 않고 미상 표기와 기존 단계 보완만 병합한다', () => {
  const known = participant(1,[a,b]);
  assert.deepEqual(study.mergeRecords([participant(1,[a])],[known]),[known]);
  for (const different of [participant(1,[b]),participant(1,[null]),participant(1,[undefined])]) {
    for (const [first,second] of [[known,different],[different,known]])
      assert.throws(()=>study.mergeRecords([first],[second]),/같은 참가자·회차의 배포본/);
  }
  const legacy = participant(1,[undefined]), unknown = participant(1,[null]);
  legacy.trials[0].phaseMs={select:40000,locate:40000,decide:40000};
  for (const [first,second] of [[legacy,unknown],[unknown,legacy]]) {
    const [result] = study.mergeRecords([first],[second]);
    assert.deepEqual(result.trials[0],{...legacy.trials[0],kitVersion:null});
  }
  const withdrawal = {...study.plan(1)[1],elapsedMs:1000,partial:true};
  const stopped = task => ({...legacy,withdrawn:true,withdrawalTask:task});
  for (const [first,second] of [[undefined,null],[null,undefined]]) {
    const tasks=[first,second].map(x=>x===undefined?withdrawal:{...withdrawal,kitVersion:x});
    const [result]=study.mergeRecords([stopped(tasks[0])],[stopped(tasks[1])]);
    assert.deepEqual(result.withdrawalTask,{...withdrawal,kitVersion:null});
  }
  for (const x of [null,b,undefined]) {
    const task=x===undefined?withdrawal:{...withdrawal,kitVersion:x};
    const one=stopped({...withdrawal,kitVersion:a}), other=stopped(task);
    assert.throws(()=>study.mergeRecords([one],[other]),/중단/);
    assert.throws(()=>study.mergeRecords([other],[one]),/중단/);
  }
});

test('같은 판본의 원래 네 사람을 유지하며 정치 단서 지표·시간의 서로 다른 적격 조건을 지킨다', () => {
  const rows = [
    ...[1,2,3,4].map(n=>participant(n,four(a))),
    ...[5,6,7,8].map(n=>participant(n,four(b),n===5)),
    ...[9,10,11,12].map(n=>participant(n,four(a)))
  ];
  const original = study.analyze(rows);
  assert.deepEqual([original.completeBlocks,original.trialCount,original.timing.trialCount],[3,48,32]);
  const {blocks,editions} = study.analyzeEditions([...rows].reverse());
  assert.deepEqual(blocks, [a,b,a].map((kitVersion,i)=>({block:i+1,state:'verified',kitVersion})));
  const [first,second] = editions;
  assert.deepEqual(first.blockNumbers,[1,3]);
  assert.deepEqual([first.analysis.trialCount,first.analysis.time.reductionPct,first.analysis.bias.reductionPp],[32,25,100]);
  assert.deepEqual(second.blockNumbers,[2]);
  assert.deepEqual([second.analysis.trialCount,second.analysis.time,second.analysis.bias.reductionPp],[16,null,100]);
  assert.deepEqual(study.analyzeEditions(rows,'demo'),{blocks:[],editions:[]});
});

test('혼합 판본·구형 회차·중단된 원래 묶음을 구분하고 서로 다른 묶음에서 네 명을 모아 재배정하지 않는다', () => {
  const plan=[
    [a,a,b,b], [b,b,a,a], [a,a,a,null], [undefined,undefined,undefined,undefined],
    [a,b,null,a], [a,a,a]
  ];
  const rows=plan.flatMap((versions,block)=>versions.map((v,i)=>participant(block*4+i+1,four(v))));
  rows.push({...participant(24,[a,a,b]),withdrawn:true});
  // Same editor and completed record can include different editions after a device transfer.
  rows.push(...[25,26,27,28].map(n=>participant(n,n===25?[a,a,b,a]:four(a))));
  const aggregate=study.analyze(rows);
  assert.equal(aggregate.completeBlocks,6);
  assert.equal(aggregate.time.reductionPct,25);
  const editions=study.analyzeEditions(rows);
  assert.deepEqual(editions.blocks.map(x=>x.state),['mixed','mixed','unknown','unknown','mixed','incomplete','mixed']);
  assert.ok(editions.blocks.every(block=>block.kitVersion===null));
  assert.deepEqual(editions.editions,[]);
});
