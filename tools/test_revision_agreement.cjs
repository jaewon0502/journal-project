const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const engine = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const comparison = require('../docs/reader/article-compare-core.js');
const blind = require('../docs/reader/blind-revision.js');
const {compare} = require('../docs/reader/revision-agreement.js');

function work(article, version) {
  const source = {id:'budget', title:'예산표', url:'https://office.example/budget', version,
    locator:'1쪽 확정액', excerpt:'사업비 10억 원'};
  return {format:workspace.schema, article, articleDraft:article, sources:[source], demo:false, rowDrafts:[], receipts:[],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(k => [k, '']))}};
}
const manuscripts = () => [work('사업비는 20억 원이다.\n예산표의 확정액은 10억 원이다.', '초판'),
  work('사업비는 10억 원이다.\n예산표의 확정액은 10억 원이다.', '수정판')];

function rate(work, levels) {
  const report = engine.report(work.article, work.sources, work.receipts);
  const [row, other] = report.rows;
  const source = work.sources[0];
  const ratings = Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, level === 'na'
    ? {level, reason:'이 기사에는 비교할 두 주체가 없다.'}
    : {level, rowId:row.id, quote:row.text, compareRowId:other.id, compareQuote:other.text, sourceId:source.id,
      sourceQuote:source.excerpt, reason:'예산표와 기사 서술을 대조했다.', impact:'독자가 확정액을 다르게 이해한다.'}]));
  work.articleAssessment = rubric.save(report, work.sources, {coreRowIds:[], ratings});
}

// Fixed, distinct assignment bytes exercise both blind slot mappings without depending on chance.
const blindScript = readFileSync(require.resolve('../docs/reader/blind-revision.js'), 'utf8');
async function assignment(editor, [beforeLevels, afterLevels] = [{}, {}], articles = manuscripts(), edit = () => {}) {
  const context = {JournalWorkspaceSnapshot:workspace, TextEncoder, crypto:{
    getRandomValues(bytes) { return bytes.fill(editor); }, subtle:webcrypto.subtle
  }};
  vm.runInNewContext(blindScript, context);
  const {key, packets} = await context.JournalBlindRevision.prepare(...articles);
  const before = packets[key.mapping.before.slot], after = packets[key.mapping.after.slot];
  edit(before, after);
  rate(before, beforeLevels);
  rate(after, afterLevels);
  return {key, ...await blind.resolve(key, packets.B, packets.A)};
}

const ratio = (numerator, denominator) => ({numerator, denominator, pct:denominator ? 100 * numerator / denominator : null});
const individual = review => comparison.compare(workspace.read(review.before), workspace.read(review.after), 'revision');

function recordRow(work, decision) {
  const row = engine.report(work.article, work.sources).rows[0];
  work.receipts = [engine.decide(row, {acknowledged:true, reason:'구간과 원자료를 대조했다.',
    sourceIds:[work.sources[0].id], ...decision}, work.sources)];
}

test('각 편집자·판본의 빈 파일, 작성 중인 구절·편향 평가, 변조된 저장 기록을 구분한다', async () => {
  const first = await assignment(0), second = await assignment(1);
  const row = engine.report(first.before.article, first.before.sources).rows[0];
  first.before.articleAssessment.coreRowIds = [row.id];
  first.before.articleAssessmentDraft = {binding:first.before.articleAssessment.binding, entries:{wording:{reason:''}}};
  first.before.rowDrafts = [{rowId:row.id, data:{status:'', reason:'', sourceIds:[], factSpan:'', opinionSpan:''}}];
  recordRow(first.after, {status:'held'});
  first.after.receipts[0].checksum = '다른 체크섬';
  const editing = engine.report(second.before.article, second.before.sources).rows[0];
  second.before.rowDrafts = [{rowId:editing.id, data:{status:'held', reason:'자료 회신 전', sourceIds:[], factSpan:'', opinionSpan:''}}];
  second.after.articleAssessmentDraft = {binding:second.after.articleAssessment.binding, entries:{wording:{level:'1'}}};
  assert.deepEqual(compare(first, second).missingReturns, [
    {editor:0, role:'before', state:'empty'}, {editor:1, role:'before', state:'draft'},
    {editor:0, role:'after', state:'invalid'}, {editor:1, role:'after', state:'draft'}
  ]);
  second.after.articleAssessmentDraft.binding = '이전 판본';
  assert.deepEqual(compare(first, second).missingReturns.at(-1), {editor:1, role:'after', state:'invalid'});
});

test('편집자가 실제 기록한 보류·부분 확인·의견과 해당 없음은 각각 회수한 판정으로 인정한다', async () => {
  const articles = [work('시범 노선은 승인됐고, 전 노선은 검토 중이다.\n예산안이다.', '초판'),
    work('이 결정은 무책임하다.\n지출 내역이다.', '수정판')];
  const first = await assignment(0, [{}, {standards:'na'}], articles);
  const second = await assignment(1, undefined, articles);
  recordRow(first.before, {status:'held'});
  recordRow(second.before, {status:'partial', factSpan:'시범 노선은 승인됐고'});
  recordRow(second.after, {status:'opinion', sourceIds:[]});
  const joint = compare(first, second);
  assert.deepEqual(joint.missingReturns, []);
  assert.equal(joint.paired, 0);
  assert.equal(joint.facts.before[0].outcome, 'pending');
  first.before.rowDrafts.push({rowId:first.before.receipts[0].rowId, data:{status:'held',
    reason:'근거를 다시 대조하는 중', sourceIds:[], factSpan:'', opinionSpan:''}});
  first.after.articleAssessment.ratings.standards.reason = '';
  assert.deepEqual(compare(first, second).missingReturns, [
    {editor:0, role:'before', state:'draft'}, {editor:0, role:'after', state:'invalid'}
  ]);
});

test('편집자별 개선율이 모두 100%여도 개선한 기준이 다르면 공동 개선은 0/0이다', async () => {
  const first = await assignment(0, [{wording:2, omission:0}, {wording:1, omission:0}]);
  const second = await assignment(1, [{wording:0, omission:3}, {wording:0, omission:1}]);
  for (const editor of [first, second]) assert.deepEqual(individual(editor).bias.improved, ratio(1, 1));
  const result = compare(first, second);
  assert.deepEqual(result.improved, ratio(0, 0));
  assert.deepEqual(result.worsened, ratio(0, 0));
  assert.deepEqual([result.total, result.paired, result.unpaired, result.disagreed], [4, 2, 2, 2]);
});

test('서로 반대인 A·B 배정, 판본별로 다른 원자료, 로컬 자료 번호와 중복 등록을 처리한다', async () => {
  const first = await assignment(0, [{wording:2, framing:1, omission:3, standards:0}, {wording:1, framing:2, omission:2, standards:1}]);
  const second = await assignment(1, [{wording:3, framing:0, omission:2, standards:1}, {wording:0, framing:3, omission:3, standards:0}],
    manuscripts(), (before, after) => {
      for (const w of [before, after]) {
        w.sources[0].id = '편집자2-자료';
        w.sources.push({...w.sources[0], id:'같은 자료'});
      }
    });
  assert.notEqual(first.key.mapping.before.slot, second.key.mapping.before.slot);
  assert.notEqual(first.key.mapping.before.sourcesSha256, first.key.mapping.after.sourcesSha256);
  assert.equal(second.sourceChanged, false);
  const result = compare(first, second);
  assert.equal(result.demo, false);
  assert.deepEqual([result.paired, result.unpaired, result.disagreed], [4, 0, 0]);
  assert.deepEqual(result.improved, ratio(1, 2));
  assert.deepEqual(result.worsened, ratio(1, 2));
  assert.deepEqual(result.dimensions.map(d => d.first.change), ['improved', 'worsened', 'high', 'low']);
  assert.deepEqual(result.dimensions[0], {id:'wording', title:'표현과 발언 귀속',
    first:{before:2, after:1, change:'improved'}, second:{before:3, after:0, change:'improved'}});
});

test('문턱을 넘은 편집자가 한 명이면 분모에만 포함하고 단계 차이를 보여 준다', async () => {
  const first = await assignment(0, [{wording:3, framing:0}, {wording:1, framing:2}]);
  const second = await assignment(1, [{wording:2, framing:1}, {wording:2, framing:0}]);
  const result = compare(first, second);
  assert.equal(result.disagreed, 2);
  assert.deepEqual(result.improved, ratio(0, 1));
  assert.deepEqual(result.worsened, ratio(0, 1));
  assert.deepEqual(result.dimensions[0].second, {before:2, after:2, change:'high'});
});

test('두 편집자 모두 유지로 보면서 중요도만 다르게 매긴 항목은 변화 방향 불일치에서 제외한다', async () => {
  const first = await assignment(0, [{wording:3, framing:0}, {wording:3, framing:1}]);
  const second = await assignment(1, [{wording:0, framing:3}, {wording:0, framing:2}]);
  const result = compare(first, second);
  assert.equal(result.disagreed, 0);
  assert.equal(result.stableSeverityDifferences, 2);
  assert.deepEqual(result.improved, ratio(0, 0));
});

test('해당 없음, 미평가, 작성 중과 사용할 수 없는 평가는 네 점수가 있는 기준에서 제외한다', async () => {
  const first = await assignment(0, [{wording:2, framing:'na', omission:2}, {wording:1, framing:0, omission:1, standards:'na'}]);
  const second = await assignment(1, [{wording:3, framing:1, omission:3}, {wording:0, framing:1, omission:0}]);
  const current = second.after.articleAssessment;
  second.after.articleAssessmentDraft = {binding:current.binding, entries:{wording:{level:'1'}}};
  current.ratings.omission.sourceQuote = '원자료에 없는 구절';
  const result = compare(first, second);
  assert.deepEqual([result.paired, result.unpaired, result.disagreed], [0, 4, 0]);
  assert.deepEqual(result.improved, ratio(0, 0));
  assert.deepEqual(result.worsened, ratio(0, 0));
  assert.deepEqual(result.dimensions[0].second, {before:3, after:null, change:'unpaired'});
  assert.deepEqual(result.dimensions[1].first, {before:'na', after:0, change:'unpaired'});
  assert.deepEqual(result.dimensions[3].first, {before:null, after:'na', change:'unpaired'});
});

test('중복 배포, 다른 기사나 자료, 회수 전 변경, 연습·실제 혼합을 구별한다', async () => {
  const first = await assignment(0);
  const second = await assignment(1);
  assert.throws(() => compare(first, first), /같은 배포/);
  for (const role of [0, 1]) {
    const differentText = manuscripts();
    differentText[role].article += '\n새 설명이 있다.';
    differentText[role].articleDraft = differentText[role].article;
    const differentArticle = await assignment(1, undefined, differentText);
    assert.throws(() => compare(first, differentArticle), /기사 원문/);
    const otherSources = manuscripts();
    otherSources[role].sources[0].excerpt += ' 정오표';
    const differentCatalogue = await assignment(1, undefined, otherSources);
    assert.throws(() => compare(first, differentCatalogue), /원자료 묶음/);
  }
  const changed = await assignment(1, undefined, manuscripts(), (_before, after) => { after.sources[0].version += ' 정오표'; });
  assert.equal(changed.sourceChanged, true);
  assert.throws(() => compare(first, changed), /배포 후 등록된 원자료/);
  const mock = manuscripts().map(w => ({...w, demo:true}));
  const practice = await assignment(1, undefined, mock);
  assert.throws(() => compare(first, practice), /연습 기록끼리/);
  assert.equal(compare(await assignment(0, undefined, mock), practice).demo, true);
  // Re-read both returned versions even when the keys and source flags match.
  assert.throws(() => compare(first, {...second, before:second.after}), /기사 원문이 일치/);
  second.after.sources[0].version += ' 개정';
  assert.throws(() => compare(first, second), /원자료 묶음이 일치/);
});
