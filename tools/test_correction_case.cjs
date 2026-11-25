const {test} = require('node:test');
const assert = require('node:assert/strict');
const blind = require('../docs/reader/blind-revision.js');
const agreement = require('../docs/reader/revision-agreement.js');
const series = require('../docs/reader/revision-series.js');
const engine = require('../docs/reader/factcheck-engine.js');
const library = require('../docs/reader/revision-evidence-example.js');
const retention = require('../docs/reader/retention-case.js');

async function summary(items) {
  const pair = await blind.resolveBundle(items);
  return series.makeRecord(agreement.compare(...pair), pair[0].key);
}

const corrected = {before:0, after:0, status:'corrected', reason:'원본 제목의 모든 도서관을 조사 대상 100곳 중 20곳으로 바로잡았다.'};
const kept = {before:1, after:1, status:'retained', reason:'두 판본의 본문과 운영 조사표에서 기간을 확인했다.'};
const fields = notes => notes.map(n => [n.before,n.after,n.status,n.reason]);

test('모의 도서관 기사 제목의 오류는 진행자가 대응을 확인한 뒤에 정정으로 세고 원래 유지 기록과 함께 복원한다', async () => {
  const items = await library.files(), record = await summary(items);
  assert.equal(record.facts.before[0].outcome,'contradicted');
  assert.equal(record.facts.after[0].outcome,'supported');
  const pending = {total:1,corrected:0,persists:0,absent:0,unresolved:0,pending:1};
  assert.deepEqual(retention.summarizeCorrections(record, []), pending);
  const archive = await retention.create(record, items, [kept], [], [corrected]);
  assert.equal(archive.version, 7);
  assert.equal(archive.reviewId, series.reviewId(record));
  const copy = JSON.parse(JSON.stringify(archive));
  assert.deepEqual(retention.read(copy).correctionNotes, [corrected]);
  const reopened = await summary(retention.read(copy).items);
  const notes = retention.verifyAll(copy, reopened);
  assert.deepEqual(notes, {notes:[kept],contextNotes:[],correctionNotes:[corrected]});
  assert.deepEqual(retention.summarizeCorrections(reopened, notes.correctionNotes), {...pending, corrected:1, pending:0});
  assert.deepEqual(retention.summarizeCorrections(reopened, []), pending);
  assert.equal(Object.hasOwn(reopened, 'correctionNotes'), false);
  assert.deepEqual(await retention.create(reopened,copy.items,notes.notes,notes.contextNotes,notes.correctionNotes), copy);
  const legacy = await retention.create(record, items, [kept]);
  assert.equal(legacy.version, 6);
  assert.deepEqual(retention.verifyAll(legacy, record), {notes:[kept],contextNotes:[]});
  const {biasEvidenceSha256, ...oldFields} = record;
  await assert.rejects(retention.create({...oldFields,version:7},items,[],[],[corrected]), /현재 기준/);
});

test('핵심 발언의 맥락과 원본 기사 주장의 정정을 같은 여섯 파일에서 서로 다른 기록으로 검증한다', async () => {
  const historical = require('../experiments/core-quote-revision/coordinator-case.json');
  const items = retention.read(historical).items;
  const record = await summary(items);
  const context = {before:3,after:3,status:'changed',reason:'야당 비판 대신 여당 찬성이 실렸다.'};
  const correction = {before:2,after:2,status:'corrected',reason:'회의록과 일치하는 의견 수렴과 운영 시간 변경을 확인했다.'};
  const saved = await retention.create(record,items,[],[context],[correction]);
  assert.deepEqual(retention.verifyAll(saved,record), {notes:[],contextNotes:[context],correctionNotes:[correction]});
  assert.deepEqual(retention.summarizeContext(record,[context]), {total:1,retained:0,changed:1,absent:0,pending:0});
  assert.equal(retention.summarizeCorrections(record,[correction]).corrected, 1);
});

test('동일 구절·자동 미대응·발언 내용의 충돌·복사한 판정은 기사 정정의 자동 증거로 세지 않는다', async () => {
  const base = await summary(await library.files());
  const row = (outcome, flag = 'none') => ({outcome,flag});
  const before = [
    ...Array.from({length:5}, () => row('contradicted','article')),
    row('quotedConflict','quote'), row('shared','article'), row('disputed','article'),
    row('pending','article'), row('limited')
  ];
  const after = [row('supported'), row('contradicted','article'), row('quotedConflict','quote'), row('limited')];
  const record = {...base, facts:{before,after}, factMatches:[], factContext:{
    beforeCore:before.map(() => 0), afterCore:after.map(() => 0), matches:[[0,0],[1,1]]
  }};
  assert.deepEqual(retention.summarizeCorrections(record, []), {total:5, corrected:0,persists:0,absent:0,unresolved:0,pending:5});
  const notes = [corrected,
    {before:1,after:1,status:'persists',reason:'수정본에서도 동일한 결산 수치가 모의 원표와 충돌한다.'},
    {before:2,after:null,status:'absent',reason:'두 판본의 전문을 읽었고 이 주장은 수정본에서 찾지 못했다.'},
    {before:3,after:2,status:'unresolved',reason:'수정본에 발언은 남았으나 기사 자체의 주장으로 볼 수 있는지 판단하기 어렵다.'},
    {before:4,after:null,status:'pending',reason:''}];
  assert.deepEqual(retention.summarizeCorrections(record, notes), {total:5, corrected:1,persists:1,absent:1,unresolved:1,pending:1});
  assert.deepEqual(retention.validateCorrectionNotes(record,[{...notes[3],after:null}]), [{...notes[3],after:null}]);
  for (const edit of [
    ...[5,6,7,8,9,100].map(before => ({...corrected,before})),
    ...[1,2,3,null,-1,0.1,50].map(after => ({...corrected,after})),
    ...[0,2,3,null].map(after => ({...notes[1],after})),
    {...notes[2],after:1},{...notes[3],after:50},{...corrected,status:'unsupported'},
    ...notes.slice(0,4).map(n => ({...n,reason:'?!'})),
    {...corrected,reason:'수정\u0000'}]) {
    assert.throws(() => retention.validateCorrectionNotes(record,[edit]));
  }
  assert.throws(() => retention.validateCorrectionNotes(record,[corrected,corrected]),/겹칩니다/);
});

test('정정 기록은 원래 여섯 파일과 판단에 묶이고 체크섬을 다시 썼어도 부적격한 근거를 거부한다', async () => {
  const items = await library.files(), record = await summary(items);
  const archive = await retention.create(record, items, [], [], [corrected]);
  for (const edit of [
    a => {a.correctionNotes[0].reason += ' 바꿈';},
    a => {a.correctionNotes[0].after = 2;},
    a => {a.correctionNotes[0].status = 'unresolved';},
    a => {a.correctionNotes = [];},
    a => {delete a.correctionNotes;},
    a => {a.version = 6;},
    a => {a.items.find(i => i.data.receipts?.length).data.receipts[0].reason += ' 바꿈';}
  ]) {
    const changed = structuredClone(archive);
    edit(changed);
    assert.throws(() => retention.read(changed));
  }
  const falseCorrection = structuredClone(archive);
  falseCorrection.correctionNotes[0].after = 2;
  falseCorrection.checksum = engine.digestValue([falseCorrection.format,7,falseCorrection.reviewId,falseCorrection.evidenceDigest,
    fields(falseCorrection.notes),fields(falseCorrection.contextNotes),fields(falseCorrection.correctionNotes)]);
  assert.throws(() => retention.verifyAll(falseCorrection,record), /두 편집자가 구절 전체/);
  assert.throws(() => retention.verifyLegacyMatchNotes(archive,{...record,version:7}), /이전 구절 대응/);
});
