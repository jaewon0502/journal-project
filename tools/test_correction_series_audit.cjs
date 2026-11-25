const {test} = require('node:test');
const assert = require('node:assert/strict');
const {audit} = require('../docs/reader/correction-series-audit.js');
const retention = require('../docs/reader/retention-case.js');
const series = require('../docs/reader/revision-series.js');
const blind = require('../docs/reader/blind-revision.js');
const agreement = require('../docs/reader/revision-agreement.js');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const library = require('../docs/reader/revision-evidence-example.js');

async function rebuild(items) {
  const reviews = await blind.resolveBundle(items);
  return series.makeRecord(agreement.compare(...reviews), reviews[0].key);
}

async function schoolCase(label, uniqueReason = '') {
  const work = text => ({format:workspace.schema, article:text, articleDraft:text, demo:true, receipts:[], rowDrafts:[],
    sources:[{id:'table',title:'비공개 가상 원자료',url:'https://example.invalid/private-reference',version:'1판',locator:'표 1',
      excerpt:'참여한 학교는 두 곳이다. 별도 계획은 아직 없다.'}],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(field => [field,'']))}});
  const before = work(label + ' 학교는 4곳이 참여했다.\n추가 계획을 확정했다.');
  const after = work(label + ' 학교는 2곳이 참여했다.\n다음 계획도 확정됐다.');
  const items = [];
  for (const editor of [1,2]) {
    const {key, packets} = await blind.prepare(before, after);
    items.push({name:'private-key-' + editor, data:key});
    for (const role of ['before','after']) {
      const packet = packets[key.mapping[role].slot];
      packet.receipts = engine.prepare(packet.article, packet.sources).rows.map((row,i) => engine.decide(row,
        {status:role === 'after' && i === 0 ? 'fact' : 'contradicted', sourceIds:[packet.sources[0].id], acknowledged:true,
          reason:'검토자 ' + editor + '의 비공개 판단 사유 ' + uniqueReason}, packet.sources));
      items.push({name:'private-return-' + editor + role, data:packet});
    }
  }
  return {items, record:await rebuild(items)};
}
const corrected = {before:0,after:0,status:'corrected',reason:'비공개 제목을 표와 대조했다.'};
const persists = {before:1,after:1,status:'persists',reason:'비공개 추가 계획에 같은 오류가 남았다.'};
function historical(record, version, identity) {
  const r = {...record,version};
  delete r.priorReviewIds;
  delete r.biasEvidenceSha256;
  if (version < 4) delete r.factContext;
  if (version < 3) delete r.factMatches;
  if (version < 2) delete r.facts;
  if (identity) {
    r.before = {...r.before,articleSha256:engine.digestValue(identity + '-original')};
    r.after = {...r.after,articleSha256:engine.digestValue(identity + '-revised')};
  }
  return r;
}

test('여러 기사 원본 오류를 모두 분모로 세고, 여섯 자료로 복원한 진행자 판단만 정정·지속으로 더한다', async () => {
  const libraryItems = await library.files(), lib = await rebuild(libraryItems);
  const {items,record} = await schoolCase('모의 구역');
  const l = await retention.create(lib, libraryItems, [], [], [corrected]);
  const both = await retention.create(record,items,[],[],[corrected,persists]);
  const records = [lib, record, {...record}, historical(lib,7), historical(lib,2,'other'), historical(lib,1,'no-facts')];
  const clone = structuredClone(l);
  clone.items.reverse().forEach((item,i) => {item.name = '우연히 바뀐 이름 '+i;});
  const all = await audit(records,[l,both,clone]);
  assert.deepEqual(all, {currentArticles:2,olderArticles:2,olderKnownOriginals:1,olderWithoutFacts:1,eligibleArticles:2,
    checkedArchives:2,duplicateArchives:1,missingArchiveArticles:0,missingArchiveOriginals:0,
    totals:{total:3,corrected:2,persists:1,absent:0,unresolved:0,pending:0}});
  for (const hidden of [lib.before.articleSha256, both.checksum, libraryItems[1].name, persists.reason, 'private', '도서관']) {
    assert.ok(!JSON.stringify(all).includes(hidden));
  }
  const missing = await audit(records,[l]);
  assert.deepEqual([missing.totals.total, missing.totals.corrected, missing.totals.pending, missing.missingArchiveOriginals,
    missing.missingArchiveArticles, missing.checkedArchives], [3,1,2,2,1,1]);
  const ordinary = await retention.create(record,items,[]);
  assert.equal(ordinary.version,6);
  const withV6 = await audit(records,[l,ordinary]);
  assert.deepEqual([withV6.totals.pending,withV6.missingArchiveOriginals,withV6.missingArchiveArticles], [2,0,0]);
  const notes = [{before:0,after:null,status:'absent',reason:'원문과 모든 수정 구간에서 찾지 못했다.'},
    {before:1,after:null,status:'unresolved',reason:'수정본 표현만으로는 원래 문장과 대응이 분명하지 않다.'}];
  const changed = await audit([record],[await retention.create(record,items,[],[],notes)]);
  assert.deepEqual(changed.totals,{total:2,corrected:0,persists:0,absent:1,unresolved:1,pending:0});
  assert.deepEqual((await audit([historical(lib,7,'old')],[])).totals,
    {total:0,corrected:0,persists:0,absent:0,unresolved:0,pending:0});
});

test('같은 기사의 다른 사후 판정과 다른 원자료, 연습 구분 변경, 이전 형식의 비공개 파일을 거부한다', async () => {
  const {items,record} = await schoolCase('모의 구역');
  const prior = await retention.create(record,items,[]);
  const selected = await retention.create(record,items,[],[],[corrected]);
  const otherNote = await retention.create(record,items,[],[],[{...corrected,reason:'다른 이유'}]);
  const another = await schoolCase('모의 구역', '같은 판정의 별도 수기 기록');
  assert.equal(series.reviewId(another.record), series.reviewId(record));
  const otherInput = await retention.create(another.record,another.items,[],[],[corrected]);
  for (const duplicate of [prior, otherNote, otherInput]) {
    for (const files of [[duplicate,selected],[selected,duplicate]]) {
      await assert.rejects(audit([record],files), e => e.archiveIndex === 1 && /다른 진행자용/.test(e.message));
    }
  }
  await assert.rejects(audit([record,{...record,demo:false}],[selected]), /연습/);
  await assert.rejects(audit([{...record,demo:false}],[selected]), /짝이 맞지/);
  await assert.rejects(audit([historical(record,7)],[selected]), /짝이 맞지/);
  await assert.rejects(audit([], [selected]), /짝이 맞지/);
  await assert.rejects(audit([record],[{...prior,version:5}]), /현재 기준/);
  const wrong = structuredClone(selected);
  wrong.correctionNotes[0].reason += '변조';
  await assert.rejects(audit([record],[wrong]), /무결성/);
  await assert.rejects(audit([record],[selected,wrong]), /무결성/);
});

test('공개 요약과 직접 만든 체크섬이 일치해도 여섯 원자료로 해당 요약을 재현하지 못하면 거부한다', async () => {
  const {items,record} = await schoolCase('원래 구역');
  const other = await schoolCase('다른 구역');
  const file = await retention.create(record, items, []);
  const forged = {...file, reviewId:series.reviewId(other.record)};
  forged.checksum = engine.digestValue([file.format,6,forged.reviewId,file.evidenceDigest,[],[]]);
  assert.equal(retention.read(forged).reviewId, forged.reviewId);
  await assert.rejects(audit([other.record],[forged]), /다시 계산/);
  const badNotes = await retention.create(record, items, [], [], [corrected]);
  badNotes.correctionNotes[0].after = 1;
  const fields = badNotes.correctionNotes.map(n => [n.before,n.after,n.status,n.reason]);
  badNotes.checksum = engine.digestValue([file.format,7,file.reviewId,file.evidenceDigest,[],[],fields]);
  await assert.rejects(audit([record],[badNotes]), /다시 계산/);
});
