const {test} = require('node:test');
const assert = require('node:assert/strict');
const study = require('../docs/reader/editor-study-core.js');
const portable = require('../docs/reader/editor-study-resume.js');

const id = 'EA123456789ABCDEF';
const invite = {participantId:id, ordinal:1};
function participant(n = 0) {
  let record = study.createRecord(id, 1, 'editor', true);
  for (const task of study.plan(1).slice(0, n)) {
    record = study.addTrial(record, {elapsedMs:1000, verdict:'insufficient', sourceIds:[],
      reason:'실험 중 제출한 근거', journalUsed:task.method === 'journal'});
  }
  return record;
}
function local(record, changes = {}) {
  const task = study.plan(1)[record.trials.length];
  return {id, state:'paused', activeMs:1500.3, recoveredMs:null, partialTime:false, segmentAt:null,
    stage:'locate', phaseMs:{select:700, locate:800}, phaseOmitted:false, used:task?.method === 'journal',
    verdict:'insufficient', source:'doc-1', reason:' 작성 중인 근거\n다음 문장 ', ...changes};
}
const jsonCopy = value => JSON.parse(JSON.stringify(value));

test('한 사람의 휴식 시점, 단계 시간, 작성 중인 판정과 이미 제출한 회차를 새 기기로 옮긴다', () => {
  for (let index = 0; index < 4; index++) {
    const record = participant(index), current = local(record);
    const saved = portable.create(record, current), opened = portable.read(jsonCopy(saved), invite);
    assert.deepEqual(opened.record, record);
    assert.deepEqual(saved.task, study.plan(1)[index]);
    assert.equal(opened.session.activeMs, 1500);
    assert.equal(opened.session.segmentAt, null);
    assert.deepEqual(opened.session.phaseMs, {select:700, locate:800});
    assert.equal(opened.session.partialTime, false);
    assert.equal(opened.session.used, current.used);
    assert.equal(opened.session.source, 'doc-1');
    assert.equal(opened.session.reason, current.reason);
    assert.equal(opened.session.state, 'paused');
    assert.deepEqual(portable.create(opened.record, opened.session), saved);
    current.phaseMs.select++;
    assert.equal(saved.session.phaseMs.select, 700);
    assert.throws(() => study.validateRecord(saved));
  }
});

test('실행 중 또는 중단된 구간은 저장한 활동 시간만 옮기고 이전 벽시계 복원값을 빼며 휴식 시간을 추가하지 않는다', () => {
  const record = participant(1);
  for (const state of ['running', 'interrupted', 'paused']) {
    const current = local(record, {state, activeMs:45034.3, recoveredMs:30000, phaseMs:null, stage:null,
      segmentAt:9000});
    const saved = portable.create(record, current), opened = portable.read(saved, invite);
    const partial = state !== 'paused';
    assert.equal(opened.session.activeMs, partial ? 15034 : 45034);
    assert.equal(opened.session.recoveredMs, partial ? 0 : 30000);
    assert.equal(opened.session.partialTime, partial);
    assert.equal(opened.session.state, 'paused');
    assert.equal(opened.session.segmentAt, null);
    assert.equal(opened.session.phaseMs, null);
    assert.equal(opened.session.reason, current.reason);
    assert.deepEqual(portable.create(record, opened.session), saved);
  }
});

test('예전 개인 파일은 완료 판정을 그대로 보존하고 미완료 다음 과제는 시간이 불확실한 상태로만 재개한다', () => {
  for (let n = 0; n <= 4; n++) {
    const record = participant(n);
    const {session, record:returned} = portable.read(record, invite);
    assert.deepEqual(returned, record);
    assert.equal(session.state, n === 4 ? 'done' : 'ready');
    assert.equal(session.partialTime, n !== 4);
    assert.equal(session.activeMs, 0);
    assert.equal(session.reason, '');
    assert.deepEqual(portable.read(portable.create(returned, session), invite), {session, record});
  }
  const stopped = {...participant(2), withdrawn:true, withdrawalTask:null};
  const opened = portable.read(stopped, invite);
  assert.equal(opened.session.state, 'withdrawn');
  assert.deepEqual(opened.record, stopped);
  const sealed = portable.create(stopped, opened.session);
  assert.equal(sealed.task, null);
  assert.throws(() => portable.read({...sealed, task:study.plan(1)[2]}, invite));
});

test('초대 코드·회차가 일치해야 하며 집계 백업·모의 기록·다른 회차·잘못된 시간·초안은 받아들이지 않는다', () => {
  const record = participant(1), saved = portable.create(record, local(record));
  for (const change of [
    v => v.version++, v => v.format += '-unknown', v => v.session.state = 'running',
    v => v.task.method = study.plan(1)[1].method === 'journal' ? 'manual' : 'journal',
    v => v.task.position++, v => v.task.variant = 'extra', v => v.record.kind = 'demo',
    v => v.record.participantId = 'wrong', v => v.record.ordinal++, v => v.record.withdrawn = true,
    v => v.record.trials[0].reason = '', v => v.record.trials[0].notes = '연구자용',
    v => v.sourceKey = '연구자용', v => v.session.position = 4,
    v => v.session.activeMs++, v => v.session.phaseMs.locate = -1, v => v.session.stage = 'unknown',
    v => delete v.session.phaseMs.select, v => v.session.recoveredMs = 2000,
    v => v.session.phaseMs.other = 0, v => v.session.partialTime = true, v => v.session.source = 'doc-999',
    v => v.session.verdict = 'other', v => v.session.reason = '가'.repeat(4001), v => v.session.state = 'done',
    v => {v.session.phaseMs = null; v.session.stage = 'decide';}
  ]) {
    const mutated = jsonCopy(saved); change(mutated);
    assert.throws(() => portable.read(mutated, invite));
  }
  for (const input of [{type:'journal-editor-study-collection-v1', records:[record]}, [record],
    {...record, invitations:[invite]}, {...record, kind:'demo', editorAttested:false}]) {
    assert.throws(() => portable.read(input, invite));
  }
  assert.throws(() => portable.read(saved, {...invite, ordinal:12}));
  assert.throws(() => portable.read(record, {...invite, participantId:'E123456789ABCDEF0'}));
  assert.throws(() => portable.create(record, {...local(record), id:'different'}));
  assert.throws(() => portable.create(record, {...local(record), activeMs:NaN}));
  assert.ok(!JSON.stringify(saved).includes('expectedVerdict'));
  assert.throws(() => portable.create(record, {...local(record), state:'ready'}));
  assert.throws(() => portable.create(record, {...local(record), partialTime:'yes'}));
});
