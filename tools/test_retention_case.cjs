const {test} = require('node:test');
const assert = require('node:assert/strict');
const blind = require('../docs/reader/blind-revision.js');
const agreement = require('../docs/reader/revision-agreement.js');
const series = require('../docs/reader/revision-series.js');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const example = require('../docs/reader/revision-evidence-example.js');
const cases = require('../docs/reader/retention-case.js');
const rubric = require('../docs/reader/article-rubric.js');

async function summary(items) {
  const pair = await blind.resolveBundle(items);
  return series.makeRecord(agreement.compare(...pair), pair[0].key);
}
const kept = {before:1, after:1, status:'retained', reason:'두 판본과 조사표에서 대상 시설 100곳과 운영 시간 연장 시설 20곳을 대조했다.'};

test('기존 여섯 파일에서 만든 진행자 대조 기록 하나로 원자료·개별 판단과 사후 판단을 복원한다', async () => {
  const inputs = await example.files(), record = await summary(inputs);
  const saved = await cases.create(record, inputs.map(i => ({...i, name:'로컬/기사/' + i.name})), [kept]);
  const opened = cases.read(JSON.parse(JSON.stringify(saved)));
  assert.equal(saved.version, 5);
  assert.deepEqual(saved.contextNotes, []);
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

test('예전 v1·v2 진행자 파일은 같은 판정을 복원하고 새 파일은 여섯 원자료로 계산한 v7 요약에 묶는다', async () => {
  const items = (await example.files()).map(({name, data}) => ({name, data}));
  // Generated with the released v3 writer and the deterministic six-file library exercise.
  for (const [version, reviewId, checksum] of [
    [1, 'd84450c81cbaf6819e0fbdcf7429c585d2e26c6d9d3a3b68a940cada59811b59', '0f5d1623bb44c2a2d31f83eca7897029097b55d99b73d07d05994cbb8a1f1def'],
    [2, 'fcb545af96902982e2798cd4a91654254b9efb40e59dce06c82097d76be928e4', 'c245137d7222f6d10f834115c3e16cf95e092d1786f9bbaead9dc53c0e0b5461']
  ]) {
    const archive = {format:'journal-retention-case', version, items, notes:[kept], reviewId, checksum,
      evidenceDigest:'0c7287d7171a677583dbc7264db7bead549d3c3035513bcf3598b52c3c3fae92'};
    const opened = cases.read(JSON.parse(JSON.stringify(archive)));
    const rebuilt = await summary(opened.items);
    assert.equal(rebuilt.version, 7);
    assert.deepEqual(cases.verify(archive, rebuilt), [kept]);
    assert.deepEqual(cases.verifyAll(archive, rebuilt), {notes:[kept], contextNotes:[]});
    const legacy = {...rebuilt, version:version + 2};
    if (version === 1) delete legacy.factContext;
    assert.throws(() => cases.verify(archive, legacy), /현재 기준/);
    const upgraded = await cases.create(legacy, opened.items, opened.notes);
    assert.equal(upgraded.version, 5);
    assert.equal(upgraded.reviewId, series.reviewId(rebuilt, 7));
    assert.notEqual(upgraded.reviewId, archive.reviewId);
    assert.deepEqual(cases.verify(upgraded, rebuilt), [kept]);
    assert.throws(() => cases.verify(upgraded, legacy));
  }
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
    v => { v.version = 1; delete v.contextNotes; },
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
  const changedCore = structuredClone(record);
  changedCore.factContext.beforeCore[0] = 1;
  assert.equal(series.reviewId(changedCore, 3), series.reviewId(record, 3));
  assert.notEqual(series.reviewId(changedCore), series.reviewId(record));
  await assert.rejects(() => cases.create(changedCore, items, [kept]), /다시 계산한 평가/);
  assert.throws(() => cases.verify(saved, changedCore), /요약이 일치하지/);
  const changedFiles = structuredClone(items);
  const original = changedFiles.find(i => i.data.blindReview?.slot === 'B').data;
  original.articleAssessment.coreRowIds.push(engine.report(original.article, original.sources, original.receipts).rows[0].id);
  assert.deepEqual(await summary(changedFiles), changedCore);
  await assert.rejects(() => cases.create(record, changedFiles, [kept]), /다시 계산한 평가/);
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
    factMatches:[[0, 0], [1, null], [2, 1], [3, null], [4, null], [5, null]],
    factContext:{beforeCore:[0,0,0,0,0,0], afterCore:[0,0,0], matches:[[0,0],[2,1]]}};
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
  const old = {...record, version:2}; delete old.factMatches; delete old.factContext;
  assert.throws(() => cases.verify(saved, old));
  await assert.rejects(() => cases.create(old, inputs, []));
});

test('대응 없는 공동 핵심 구절은 입장의 유지·변화·대응 미확인과 재검토 대기를 구분한다', () => {
  const fixture = require('../experiments/core-quote-revision/series-summary.json');
  const row = (outcome, flag = 'none') => ({outcome, flag});
  const record = {...fixture,
    facts:{before:[row('limited'), row('excluded'), row('quotedConflict','quote'), row('disputed'),
      row('pending'), row('supported'), row('limited'), row('limited')], after:[row('limited'), row('pending')]},
    factMatches:[[5,null]], factContext:{beforeCore:[2,2,2,2,2,2,1,2], afterCore:[0,2], matches:[[7,0]]}};
  const notes = [
    {before:0, after:0, status:'retained', reason:'수정본에도 발언 주체와 찬성 입장이 남았다.'},
    {before:1, after:1, status:'changed', reason:'수정본에서는 발언 주체가 달라졌다.'},
    {before:2, after:null, status:'absent', reason:'수정본 전문에서 원래 반론에 대응하는 구절을 찾지 못했다.'},
    {before:3, after:0, status:'pending', reason:''}
  ];
  assert.deepEqual(cases.validateContextNotes(record, notes), notes);
  assert.deepEqual(cases.summarizeContext(record, notes), {total:5,retained:1,changed:1,absent:1,pending:2});
  assert.deepEqual(cases.summarizeContext(record, []), {total:5,retained:0,changed:0,absent:0,pending:5});
  for (const invalid of [
    {...notes[0], before:5}, {...notes[0], before:6}, {...notes[0], before:7},
    {...notes[0], before:2**53}, {...notes[0], after:2**53}, {...notes[0], after:2}, {...notes[0], after:-1},
    {...notes[0], after:null}, {...notes[1], after:null}, {...notes[2], after:1},
    {...notes[0], reason:'   '}, {...notes[0], reason:'x\x00y'}, {...notes[2], status:'notFound'}
  ]) assert.throws(() => cases.validateContextNotes(record, [invalid]));
  assert.throws(() => cases.validateContextNotes(record, [notes[2], notes[2]]), /겹칩니다/);
  assert.throws(() => cases.validateNotes(record, [notes[0]]), /자동 대조/);
});

test('입장 대조와 사실 대조를 한 진행자 파일에 보관하고 같은 여섯 입력에서만 둘 다 복원한다', async () => {
  const input = require('../experiments/core-quote-revision/coordinator-case.json');
  // Released v3 archive with the original private checksum and public v5 identity.
  const prior = {format:cases.format, version:3, items:input.items, notes:[],
    reviewId:'6e262c689d8f4554dedaeaf150e9709f94261c36f5185379d87764fd13d9df6d',
    evidenceDigest:'b34920c8aa4a56db5196ac193017e00e12412fd7d4ff2d57ec0a928388a8c855',
    checksum:'2313b1a6b2557ee913c8997af4df1ca7bb93b6059a9bc79cd40c2a35264d2779'};
  const {items} = cases.read(prior);
  const original = await summary(items);
  assert.deepEqual(cases.verifyAll(prior, original), {notes:[],contextNotes:[]});
  assert.deepEqual(cases.verifyLegacyMatchNotes(prior, {...original,version:5}), []);
  const otherMatches = structuredClone(original);
  otherMatches.factContext.matches.push([3,3]);
  assert.throws(() => cases.verifyAll(prior, otherMatches), err => err.code === 'legacy-review-changed');
  assert.throws(() => cases.verifyLegacyMatchNotes(prior, {...otherMatches,version:5}), /일치하지/);
  for (const {data:work} of items) {
    if (work.receipts?.[2].status !== 'fact') continue;
    // Keep the revised budget fact open as well as the original opposition quote.
    const row = engine.prepare(work.article, work.sources).rows[0];
    work.receipts[0] = engine.decide(row, {status:'held', acknowledged:true, sourceIds:[],
      reason:'예산 재확인을 기다리는 편집자 ' + work.blindReview.pairId}, work.sources);
    work.articleAssessment = rubric.save(engine.report(work.article, work.sources, work.receipts), work.sources, work.articleAssessment);
  }
  const record = await summary(items);
  const notes = [{before:0, after:0, status:'open', reason:'예산 검토를 이어가야 한다.'}];
  const contextNotes = [{before:3, after:3, status:'changed', reason:'야당 의원의 비판 자리에 여당 의원의 찬성 발언이 실렸다.'}];
  const saved = await cases.create(record, items, notes, contextNotes);
  assert.equal(saved.version, 5);
  const copy = JSON.parse(JSON.stringify(saved)), parsed = cases.read(copy);
  assert.deepEqual(cases.verifyAll(copy, await summary(parsed.items)), {notes,contextNotes});
  assert.deepEqual(cases.verify(copy, record), notes);
  assert.equal(saved.reviewId, series.reviewId(record, 7));
  assert.throws(() => cases.verifyLegacyMatchNotes(saved, {...record,version:5}), /이전 구절 대응/);
  assert.throws(() => cases.verifyLegacyMatchNotes(prior, {...record,version:5}), /이전 구절 대응/);
  assert.throws(() => cases.verify(saved, original), /요약이 일치하지/);
  assert.throws(() => series.summarize([saved]));
  const legacy = {...record, version:3};
  delete legacy.factContext;
  await assert.rejects(cases.create(legacy, items, notes, contextNotes), /핵심 구절 대응/);
  for (const mutate of [
    a => { a.contextNotes[0].reason += '수정'; }, a => { a.contextNotes[0].before = 1; },
    a => { a.contextNotes[0].after = 1; }, a => { a.contextNotes[0].status = 'retained'; },
    a => { a.contextNotes = []; }, a => { delete a.contextNotes; }, a => { a.version = 3; }
  ]) {
    const changed = structuredClone(saved);
    mutate(changed);
    assert.throws(() => cases.read(changed));
  }
  const reloaded = await cases.create(record, parsed.items, parsed.notes, parsed.contextNotes);
  assert.deepEqual(reloaded, saved);
  const invalid = structuredClone(saved);
  invalid.contextNotes[0].before = 0;
  const fields = n => [n.before,n.after,n.status,n.reason];
  invalid.checksum = engine.digestValue([invalid.format, invalid.version, invalid.reviewId, invalid.evidenceDigest,
    invalid.notes.map(fields),invalid.contextNotes.map(fields)]);
  assert.throws(() => cases.verify(invalid, record), /원본 핵심 구절/);
});
