const {test} = require('node:test');
const assert = require('node:assert/strict');
const blind = require('../docs/reader/blind-revision.js');
const agreement = require('../docs/reader/revision-agreement.js');
const series = require('../docs/reader/revision-series.js');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const example = require('../docs/reader/revision-evidence-example.js');
const cases = require('../docs/reader/retention-case.js');

async function summary(items) {
  const pair = await blind.resolveBundle(items);
  return series.makeRecord(agreement.compare(...pair), pair[0].key);
}
const kept = {before:1, after:1, status:'retained', reason:'두 판본과 조사표에서 대상 시설 100곳과 운영 시간 연장 시설 20곳을 대조했다.'};

test('기존 여섯 파일에서 만든 진행자 대조 기록 하나로 원자료·개별 판단과 사후 판단을 복원한다', async () => {
  const inputs = await example.files(), record = await summary(inputs);
  const saved = await cases.create(record, inputs.map(i => ({...i, name:'로컬/기사/' + i.name})), [kept]);
  const opened = cases.read(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(opened.items, inputs.map(({name, data}) => ({name, data})));
  assert.equal(opened.reviewId, series.reviewId(record));
  assert.ok(saved.items.every(i => !Object.hasOwn(i, 'raw') && !i.name.includes('/')));
  assert.deepEqual(await summary(opened.items), record);
  assert.deepEqual(cases.verify(saved, await summary(opened.items)), [kept]);
  assert.deepEqual(cases.summarize(record, []), {autoRetained:0, manualRetained:0, changed:0, notFound:0, open:1, total:1});
  assert.deepEqual(cases.summarize(record, opened.notes), {autoRetained:0, manualRetained:1, changed:0, notFound:0, open:0, total:1});
  assert.equal(series.summarize([record]).articles[0].factTrace.retained, 0);
  assert.throws(() => series.summarize([saved]), /형식/);
  assert.throws(() => cases.read(record), /진행자가 저장한/);
  const originalSource = saved.items.find(i => i.data.sources).data.sources[0].excerpt;
  inputs.find(i => i.data.sources).data.sources[0].excerpt = '원래 입력을 수정';
  opened.items.find(i => i.data.sources).data.sources[0].excerpt = '열어 본 사본을 수정';
  opened.notes[0].reason = '대조 메모 편집 중';
  assert.equal(saved.items.find(i => i.data.sources).data.sources[0].excerpt, originalSource);
  assert.equal(saved.notes[0].reason, kept.reason);
});

test('식별값은 파일 이름·순서와 JSON 키 순서에 의존하지 않고 자료·판정 이유·수기 기록 변경을 감지한다', async () => {
  const items = await example.files(), record = await summary(items);
  const saved = await cases.create(record, items, [kept]);
  function reordered(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(reordered);
    return Object.fromEntries(Object.entries(value).reverse().map(([key, val]) => [key, reordered(val)]));
  }
  const reorderedArchive = reordered(saved);
  reorderedArchive.items.reverse().forEach(item => { item.name = '같은 이름.json'; });
  const opened = cases.read(reorderedArchive);
  assert.deepEqual(cases.verify(reorderedArchive, await summary(opened.items)), [kept]);
  for (const mutate of [
    v => { v.items.find(i => i.data.receipts?.length).data.receipts[0].reason += ' 추가'; },
    v => { v.items.find(i => i.data.sources).data.sources[0].excerpt += ' 추가'; },
    v => { v.items.find(i => i.data.sources).data.sources.reverse(); },
    v => { v.notes[0].reason += ' 추가'; },
    v => { v.notes[0].status = 'open'; },
    v => { v.notes[0].after = 0; },
    v => { v.reviewId = '0'.repeat(64); }
  ]) {
    const changed = structuredClone(saved);
    mutate(changed);
    assert.throws(() => cases.read(changed), /달라졌습니다/);
  }
  const wrong = structuredClone(record);
  wrong.dimensions[0].first.before = 3;
  assert.deepEqual(series.summarize([wrong]).improved, series.summarize([record]).improved);
  assert.throws(() => cases.verify(saved, wrong), /요약이 일치하지/);
  await assert.rejects(() => cases.create(wrong, items, [kept]), /다시 계산한 평가/);
  const dirty = structuredClone(items);
  dirty.find(i => i.data.sources).data.sources[0].excerpt += ' 추가';
  await assert.rejects(() => cases.create(record, dirty, []), /배포 후 등록된 원자료/);
  await assert.rejects(() => cases.create(record, [items[0], ...items.slice(2)], []), /네 개와 대응표 두 개/);
  await assert.rejects(() => cases.create(record, [items[0], items[0], ...items.slice(2)], []), /대응표|묶음/);
  await assert.rejects(() => cases.create(record, [{name:'다른.json', data:record}, ...items.slice(1)], []), /작업 파일과 대응표/);
  assert.throws(() => cases.read({...saved, article:'끼워 넣은 값'}), /진행자가 저장한/);
  const extra = structuredClone(saved);
  extra.items[0].path = '별도경로';
  assert.throws(() => cases.read(extra), /작업 파일과 대응표/);
});

test('수기 유지는 두 편집자의 수정본 전체 지지에만 연결하며 자동 유지·미처리·보류를 따로 센다', async () => {
  const base = await summary(await example.files());
  const supported = {outcome:'supported', flag:'none'}, pending = {outcome:'pending', flag:'none'};
  const record = {...base, facts:{before:Array(6).fill(supported), after:[supported, pending, supported]},
    factMatches:[[0, 0], [1, null], [2, 1], [3, null], [4, null], [5, null]]};
  const notes = [
    {...kept, before:5, after:2}, {...kept, before:1, after:2},
    {before:2, after:1, status:'changed', reason:'수정본은 지원 예상치인지 확정치인지 밝히지 않았다.'},
    {before:3, after:null, status:'notFound', reason:'지원 규모가 나온 설명과 표 전체를 다시 읽었다.'},
    {before:4, after:1, status:'open', reason:''}
  ];
  assert.deepEqual(cases.validateNotes(record, notes), notes);
  assert.deepEqual(cases.summarize(record, notes), {autoRetained:1, manualRetained:2, changed:1, notFound:1, open:1, total:6});
  assert.deepEqual(cases.summarize(record, []), {autoRetained:1, manualRetained:0, changed:0, notFound:0, open:5, total:6});
  assert.deepEqual(cases.validateNotes(record, [{before:1, after:null, status:'open', reason:'자료를 더 읽을 예정'}]),
    [{before:1, after:null, status:'open', reason:'자료를 더 읽을 예정'}]);
  for (const invalid of [
    [{...kept, before:0}], [{...kept, before:-1}], [{...kept, before:6}], [{...kept, before:'2'}],
    [{...kept, after:null}], [{...kept, after:1}], [{...kept, after:3}], [{...kept, after:0.5}],
    [{...kept, after:2}, {...kept, after:2}], [{...kept, status:'notFound'}], [{...kept, status:'changed', after:null}],
    [{...kept, status:'auto'}], [{...kept, after:2, reason:'\n.\t'}], [{...kept, reason:null}],
    [{...kept, reason:'문장\0오류'}], [{...kept, source:'사적 메모'}], [{}], [null]
  ]) assert.throws(() => cases.validateNotes(record, invalid));
});

test('현장 형식의 자료와 연습 자료는 서로의 판단을 복원할 수 없다', async () => {
  const source = {id:'table', title:'지원 표', url:'https://local.example/support', version:'1판', locator:'표 1', excerpt:'가구 300, 설명회 2시'};
  const work = article => ({format:workspace.schema, article, articleDraft:article, sources:[source], receipts:[], rowDrafts:[],
    demo:false, sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(k => [k, '']))}});
  const inputs = [];
  for (const editor of ['첫째', '둘째']) {
    const {key, packets} = await blind.prepare(work('지원 대상은 300가구다.'), work('설명회는 2시에 열린다.'));
    for (const packet of Object.values(packets)) {
      const row = engine.prepare(packet.article, packet.sources).rows[0];
      packet.receipts = [engine.decide(row, {status:'fact', acknowledged:true,
        sourceIds:[packet.sources[0].id], reason:editor + '가 표 1을 대조했다.'}, packet.sources)];
    }
    for (const [i, data] of [key, packets.A, packets.B].entries()) inputs.push({name:editor + i + '.json', data});
  }
  const record = await summary(inputs), demo = await example.files();
  assert.equal(record.demo, false);
  const note = {before:0, after:null, status:'notFound', reason:'수정본에는 시간 한 건만 실려 있었다.'};
  const saved = await cases.create(record, inputs, [note]);
  assert.deepEqual(cases.verify(saved, await summary(cases.read(saved).items)), [note]);
  await assert.rejects(() => cases.create(record, demo, []), /연습·실제/);
  const old = {...record, version:2}; delete old.factMatches;
  assert.throws(() => cases.verify(saved, old));
  await assert.rejects(() => cases.create(old, inputs, []));
});
