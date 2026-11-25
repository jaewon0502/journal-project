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
const {compare, recordFields, summarizeScores} = require('../docs/reader/revision-agreement.js');

function work(article, version) {
  const source = {id:'budget', title:'예산표', url:'https://office.example/budget', version,
    locator:'1쪽 예산표', excerpt:'1차 추정액 20억 원. 확정 사업비 10억 원.'};
  return {format:workspace.schema, article, articleDraft:article, sources:[source], demo:false, rowDrafts:[], receipts:[],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(k => [k, '']))}};
}
const manuscripts = () => [work('사업비는 20억 원이다.\n예산표의 확정액은 10억 원이다.', '초판'),
  work('사업비는 10억 원이다.\n예산표의 확정액은 10억 원이다.', '수정판')];

function rate(work, levels, coreIndexes = []) {
  const report = engine.report(work.article, work.sources, work.receipts);
  const [row, other] = report.rows;
  const source = work.sources[0];
  const ratings = Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, level === 'na'
    ? {level, reason:'이 기사에는 비교할 두 주체가 없다.'}
    : {level, rowId:row.id, quote:row.text, compareRowId:other.id, compareQuote:other.text, sourceId:source.id,
      sourceQuote:source.excerpt, reason:'예산표와 기사 서술을 대조했다.', impact:'독자가 확정액을 다르게 이해한다.',
      ...(id === 'standards' ? {sourceQuote:'1차 추정액 20억 원', compareSourceId:source.id, compareSourceQuote:'확정 사업비 10억 원'} : {})}]));
  work.articleAssessment = rubric.save(report, work.sources, {coreRowIds:coreIndexes.map(i => report.rows[i].id), ratings});
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

function recordRow(work, decision, index = 0) {
  const row = engine.report(work.article, work.sources).rows[index];
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

test('새 주장으로 판정 수가 유지돼도 공동 지지했던 원본 구절과 수정본 위치를 개별적으로 연결한다', async () => {
  const mixedText = '시청은 시범 운영을 마쳤고, 사업은 기대 이상이다.';
  const before = ['첫 보도다.', '참석자는 50명이었다.', mixedText, '조사 결과다.', '두 지역이 포함됐다.',
    '자료는 공개됐다.', '사업비는 10억 원이다.'];
  const after = [...before.slice(0, -1), '접수처는 두 곳이다.'];
  const mixed = {status:'mixed', factSpan:'시청은 시범 운영을 마쳤고', opinionSpan:'사업은 기대 이상이다.'};
  const articles = [work(before.join('\n'), '초판'), work(after.join('\n'), '초판')];
  const reviews = await Promise.all([0, 1].map(editor => assignment(editor, [{wording:2}, {wording:0}], articles,
    (original, revised) => {
      for (const edition of [original, revised]) {
        const statuses = edition === original ? ['fact', 'fact', 'fact', null, 'fact', 'held', 'fact']
          : ['fact', 'held', mixed, 'fact', 'fact', 'fact', 'fact'];
        const rows = engine.prepare(edition.article, edition.sources).rows;
        edition.receipts = rows.flatMap((row, i) => {
          const status = statuses[i];
          if (!status) return [];
          const decision = typeof status === 'string' ? {status} : status;
          return [engine.decide(row, {sourceIds:[edition.sources[0].id], acknowledged:true, reason:'기록 ' + editor + '에서 대조했다.',
            ...decision}, edition.sources)];
        });
      }
    })));
  // Copy one actual saved verdict between editors. That passage no longer has independent support.
  reviews[1].before.receipts[3] = structuredClone(reviews[0].before.receipts[3]);
  rate(reviews[0].before, {wording:2}, [1,3]);
  rate(reviews[1].before, {wording:2}, [3,6]);
  rate(reviews[0].after, {wording:0}, [0]);
  rate(reviews[1].after, {wording:0}, [0,6]);
  const result = compare(...reviews);
  const expected = [[0,0], [1,1], [2,2], [6,null]];
  const expectedContext = {beforeCore:[0,1,0,2,0,0,1], afterCore:[2,0,0,0,0,0,1],
    matches:[[0,0],[1,1],[2,2],[3,3],[4,4]]};
  assert.deepEqual(result.improved, ratio(1,1));
  assert.deepEqual(result.factMatches, expected);
  assert.deepEqual(result.facts.before.map(f => f.outcome), ['supported','supported','supported','pending','shared','pending','supported']);
  assert.deepEqual(result.factMatches.map(([, after]) => after === null ? null : result.facts.after[after].outcome),
    ['supported','pending','limited',null]);
  assert.deepEqual(compare(reviews[1], reviews[0]).factMatches, expected);
  assert.deepEqual(result.factContext, expectedContext);
  assert.deepEqual(compare(reviews[1], reviews[0]).factContext, expectedContext);
  result.factMatches[0][1] = null;
  result.factContext.beforeCore.fill(2);
  result.factContext.matches.length = 0;
  const saved = recordFields(result, reviews[0].key);
  assert.deepEqual(saved.factMatches, expected);
  assert.deepEqual(saved.factContext, expectedContext);
  saved.factMatches[1][1] = 0;
  saved.factContext.afterCore[6] = 0;
  saved.factContext.matches[0][1] = 4;
  assert.deepEqual(recordFields(result, reviews[1].key).factMatches, expected);
  assert.deepEqual(recordFields(result, reviews[1].key).factContext, expectedContext);
});

test('도입부가 추가되면 문맥이 유지된 공동 지지 구절은 수정본에서 옮겨진 순번으로 이어진다', async () => {
  const original = '도입부다.\n지역 현황이다.\n참석자는 50명이었다.\n공식 집계다.';
  const articles = [work(original, '초판'), work('편집 안내다.\n' + original, '초판')];
  const reviews = await Promise.all([0, 1].map(editor => assignment(editor, undefined, articles, (before, after) => {
    const decision = {status:'fact', reason:'편집자 ' + editor + '가 명부를 확인했다.'};
    recordRow(before, decision, 2);
    recordRow(after, decision, 3);
  })));
  assert.deepEqual(compare(...reviews).factMatches, [[2,3]]);
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
  assert.deepEqual(result.severity, {matrix:[[0,0,0],[0,2,0],[0,0,0]], oppositeSteps:1, withinBandOppositeSteps:1});
  assert.deepEqual(result.improved, ratio(0, 0));
});

test('두 편집자의 실제 단계가 반대로 움직였는지 중요도 경계를 넘긴 경우와 경계 안의 경우로 구별한다', () => {
  const dimensions = [
    [1,0,0,1], [2,3,3,2], [0,1,3,2],  // Opposite movements within each editor's original band.
    [0,2,2,0], [2,0,0,1],              // Both cross, or one crosses.
    [0,0,1,0], [3,null,2,0], [0,3,'na',0]
  ].map(([a,b,c,d]) => ({first:{before:a,after:b},second:{before:c,after:d}}));
  const result = summarizeScores(dimensions);
  assert.equal(result.paired, 6);
  assert.deepEqual(result.severity, {matrix:[[2,0,0],[1,2,0],[0,0,1]], oppositeSteps:5, withinBandOppositeSteps:3});
  assert.deepEqual(summarizeScores(dimensions.toReversed().map(d => ({first:d.second,second:d.first}))).severity, result.severity);
  assert.deepEqual(summarizeScores([]).severity, {matrix:[[0,0,0],[0,0,0],[0,0,0]], oppositeSteps:0, withinBandOppositeSteps:0});
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

test('공동 개선의 가능한 범위는 원본에서 중요했던 전체 항목과 수정본에 남은 실제 점수를 사용한다', () => {
  const item = (firstAfter, secondAfter) => ({
    first:{before:3, after:firstAfter}, second:{before:2, after:secondAfter}
  });
  const dimensions = [item(0,1), item(null,2), item(null,0), item(null,null)];
  const partial = summarizeScores(dimensions);
  assert.deepEqual(partial.improved, ratio(1,1));
  assert.deepEqual(partial.improvementRange, {baseline:4, confirmed:1, ruledOut:1, unresolved:2,
    notApplicable:0, lowerPct:25, upperPct:75});
  dimensions[1] = item(null,0);
  const open = summarizeScores(dimensions);
  assert.deepEqual(open.improved, partial.improved);
  assert.equal(open.missingScores, partial.missingScores);
  assert.deepEqual(open.improvementRange, {...partial.improvementRange, ruledOut:0, unresolved:3, upperPct:100});

  const fixed = summarizeScores([item(1,'na'), item('na',null), item(2,'na'), item('na','na'), item(1,0)]);
  assert.deepEqual(fixed.improvementRange, {baseline:5, confirmed:1, ruledOut:1, unresolved:0,
    notApplicable:3, lowerPct:20, upperPct:20});
  assert.deepEqual(summarizeScores([item('na','na')]).improvementRange,
    {baseline:1, confirmed:0, ruledOut:0, unresolved:0, notApplicable:1, lowerPct:0, upperPct:0});
  assert.deepEqual(summarizeScores([]).improvementRange,
    {baseline:0, confirmed:0, ruledOut:0, unresolved:0, notApplicable:0, lowerPct:null, upperPct:null});
});

test('순변화는 네 점수가 모두 있는 항목에서 새 중요 왜곡을 포함하며 원본 0의 상대율을 보류한다', () => {
  const item = (a,b,c,d) => ({first:{before:a, after:b}, second:{before:c, after:d}});
  const dimensions = [
    item(2,0,3,0), item(2,3,0,2), item(1,2,3,2), item(0,2,0,3), item(0,0,1,1),
    item(2,null,3,1), item(null,2,1,3)
  ];
  const stats = summarizeScores(dimensions);
  assert.deepEqual(stats.improved, ratio(1,1));
  assert.deepEqual(stats.netSeverityChange,
    {paired:5, beforeImportant:1, afterImportant:3, deltaPoints:40, relativeReductionPct:-200});
  const swapped = dimensions.toReversed().map(({first,second}) => ({first:second, second:first}));
  assert.deepEqual(summarizeScores(swapped), stats);
  const reverse = side => ({before:side.after, after:side.before});
  const reversed = dimensions.map(({first,second}) => ({first:reverse(first), second:reverse(second)}));
  assert.deepEqual(summarizeScores(reversed).netSeverityChange,
    {paired:5, beforeImportant:3, afterImportant:1, deltaPoints:-40, relativeReductionPct:100 * 2 / 3});
  assert.deepEqual(summarizeScores([item(0,3,1,2)]).netSeverityChange,
    {paired:1, beforeImportant:0, afterImportant:1, deltaPoints:100, relativeReductionPct:null});
  assert.deepEqual(summarizeScores([]).netSeverityChange,
    {paired:0, beforeImportant:0, afterImportant:0, deltaPoints:null, relativeReductionPct:null});
});

test('네 회수본에서 계산한 범위와 순변화는 익명 요약의 판정을 다시 집계해도 같다', async () => {
  const series = require('../docs/reader/revision-series.js');
  const levels = {wording:3, framing:2, omission:2, standards:3};
  const first = await assignment(0, [levels, {wording:0, framing:3, standards:'na'}]);
  const second = await assignment(1, [levels, {wording:1, standards:0}]);
  const joint = compare(first, second);
  const saved = series.makeRecord(joint, first.key);
  assert.equal(saved.version, 8);
  assert.ok(!Object.hasOwn(saved, 'improvementRange') && !Object.hasOwn(saved, 'netSeverityChange'));
  const result = series.summarize([JSON.parse(JSON.stringify(saved))]);
  assert.deepEqual(joint.improvementRange, {baseline:4, confirmed:1, ruledOut:1, unresolved:1,
    notApplicable:1, lowerPct:25, upperPct:50});
  assert.deepEqual(joint.netSeverityChange,
    {paired:1, beforeImportant:1, afterImportant:0, deltaPoints:-100, relativeReductionPct:100});
  assert.deepEqual(result.improvementRange, joint.improvementRange);
  assert.deepEqual(result.netSeverityChange, joint.netSeverityChange);
});
