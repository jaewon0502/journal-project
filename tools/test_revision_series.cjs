const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const workspace = require('../docs/reader/workspace-snapshot.js');
const engine = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');
const blind = require('../docs/reader/blind-revision.js');
const agreement = require('../docs/reader/revision-agreement.js');
const {makeRecord, reviewId, summarize} = require('../docs/reader/revision-series.js');

const ratio = (numerator, denominator) => ({numerator, denominator, pct: denominator ? 100 * numerator / denominator : null});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function work(article) {
  return {format: workspace.schema, article, articleDraft: article, demo: true, receipts: [], rowDrafts: [],
    sources: [{id: 'budget', title: '비공개 자료', url: 'https://desk.invalid/budget', version: '초판', locator: '1쪽', excerpt: '10억 원'}],
    sourceDraft: {id: null, fields: Object.fromEntries(workspace.sourceFields.map(k => [k, '']))}};
}
async function assignment(before, after, levels, revisedStatus) {
  const {key, packets} = await blind.prepare(before, after);
  for (const [i, role] of ['before', 'after'].entries()) {
    const w = packets[key.mapping[role].slot];
    if (role === 'after' && revisedStatus) {
      const row = engine.report(w.article, w.sources).rows[0];
      w.receipts = [engine.decide(row, {status: revisedStatus, sourceIds: [w.sources[0].id], acknowledged: true,
        reason: '공개하지 않을 검토 메모'}, w.sources)];
    }
    const report = engine.report(w.article, w.sources, w.receipts);
    const row = report.rows[0];
    w.articleAssessment = rubric.save(report, w.sources, {coreRowIds: [], ratings: {wording: {
      level: levels[i], rowId: row.id, quote: row.text, sourceId: w.sources[0].id, sourceQuote: w.sources[0].excerpt,
      reason: '원표와 대조했다.', impact: '확정 예산이 다르게 보인다.'
    }}});
  }
  return {key, ...await blind.resolve(key, packets.B, packets.A)};
}

// Construct schema-valid score-only records to test import independently of the export implementation.
function record(name, values = [], sourceChanged = false) {
  const pair = (before = null, after = null) => ({before, after});
  return {format: 'journal-revision-series-record', version: 1, demo: true,
    before: {articleSha256: hash(name + '/before'), sourcesSha256: hash('sources')},
    after: {articleSha256: hash(name + '/after'), sourcesSha256: hash(sourceChanged ? 'revised sources' : 'sources')},
    dimensions: ['wording', 'framing', 'omission', 'standards'].map((id, i) => {
      const [a, b, c, d] = values[i] ?? [];
      return {id, first: pair(a, b), second: pair(c, d)};
    })};
}

const fact = (outcome, flag = 'none') => ({outcome, flag});
const withFacts = (legacy, before, after) => ({...legacy, version: 2, facts: {before, after}});
const withMatches = (previous, factMatches) => ({...previous, version: 3, factMatches});

test('요약 식별값은 JSON 순서와 두 편집자의 전체 자리 교환을 허용하고 원문·자료·판정 변경은 구별한다', () => {
  const sample = withFacts(record('revisit', [[3, 0, 2, 1], [null, 'na', 3, 2]], true),
    [fact('pending'), fact('supported')], [fact('disputed', 'quote'), fact('pending')]);
  const id = reviewId(sample);
  // Independently calculated with Python hashlib. Existing bookmarks rely on
  // the same v2 summary keeping its identifier across application upgrades.
  assert.equal(id, 'eee4e446977c73e967ac761809579f8bb7af24a317f33f0409ae6123e69346da');
  function reorderKeys(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(reorderKeys);
    return Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reorderKeys(v)]));
  }
  const reordered = reorderKeys(sample);
  reordered.dimensions.reverse();
  for (const axis of reordered.dimensions) [axis.first, axis.second] = [axis.second, axis.first];
  assert.equal(reviewId(reordered), id);
  for (const change of [
    r => { r.demo = false; }, r => { r.before.articleSha256 = hash('another original'); },
    r => { r.after.articleSha256 = hash('another revision'); }, r => { r.before.sourcesSha256 = hash('sources A'); },
    r => { r.after.sourcesSha256 = hash('sources B'); }, r => { [r.before, r.after] = [r.after, r.before]; },
    r => { r.dimensions[1].first.after = null; },
    r => { const a = r.dimensions[0]; [a.first, a.second] = [a.second, a.first]; },
    r => { r.facts.before.reverse(); }, r => { r.facts.after.reverse(); },
    r => { r.facts.after[0].flag = 'article'; }, r => { r.facts.after[0].outcome = 'pending'; }
  ]) {
    const changed = structuredClone(sample);
    change(changed);
    assert.notEqual(reviewId(changed), id);
  }
  assert.throws(() => reviewId(record('v1')), /구절별 검토 상태/);
  assert.throws(() => reviewId({...sample, fields: 'ignored data'}), /형식과 버전/);
});

test('새로 배포한 네 파일과 일부만 회수한 결과는 열 수 있으나 화면 조작으로 기사 요약을 저장할 수 없다', async () => {
  const before = work('예산은 20억 원이다.'), after = work('예산은 10억 원이다.');
  async function fresh() {
    const {key, packets} = await blind.prepare(before, after);
    return {key, ...await blind.resolve(key, packets.A, packets.B)};
  }
  const first = await fresh(), second = await fresh();
  const scored = await assignment(before, after, [2,0]);
  for (const [one, missing] of [[first,4], [scored,2]]) {
    const joint = agreement.compare(one, second);
    assert.equal(joint.missingReturns.length, missing);
    assert.ok(joint.missingReturns.every(item => item.state === 'empty'));
    assert.deepEqual(agreement.comparedScores(joint, one.key)[0].first,
      {before:joint.dimensions[0].first.before, after:joint.dimensions[0].first.after});
    assert.deepEqual(agreement.comparedFacts(joint, second.key), joint.facts);
    joint.missingReturns.length = 0;
    for (const key of [one.key,second.key]) assert.throws(() => makeRecord(joint, key), /네 파일/);
  }
  const other = await assignment(before, after, [3,1]);
  const ready = agreement.compare(scored, other);
  ready.missingReturns.push({editor:0, role:'before', state:'empty'});
  assert.deepEqual(makeRecord(ready, scored.key).facts, {before:[fact('pending')], after:[fact('pending')]});
});

test('두 대응표에서 같은 점수와 익명 사실 판정을 내보내고 집계 수치·출처·검토 내용을 제외한다', async () => {
  const original = work('사업비 20억 원을 책정했다.'), revision = work('사업비 10억 원을 책정했다.');
  const [one, two] = await Promise.all([
    assignment(original, revision, [2, 1], 'fact'), assignment(original, revision, [3, 0], 'contradicted')
  ]);
  const joint = agreement.compare(one, two);
  const saved = makeRecord(joint, one.key);
  assert.deepEqual(saved, makeRecord(joint, two.key));
  const wire = JSON.stringify(saved);
  const expected = withMatches(withFacts(record('example', [[2, 1, 3, 0]]), [fact('pending')], [fact('disputed', 'article')]), []);
  for (const role of ['before', 'after']) {
    expected[role] = {articleSha256: one.key.mapping[role].articleSha256, sourcesSha256: one.key.mapping[role].sourcesSha256};
  }
  assert.deepEqual(saved, expected);
  for (const privateValue of [one.key.pairId, two.key.pairId, original.article, revision.article,
    ...Object.values(original.sources[0]), '공개하지 않을 검토 메모', '확정 예산이 다르게 보인다.', 'unit-0']) {
    assert.equal(wire.includes(privateValue), false, privateValue);
  }
  const report = summarize([JSON.parse(wire)]);
  for (const metric of ['paired', 'total', 'unpaired', 'disagreed', 'stableSeverityDifferences', 'improved', 'worsened']) {
    assert.deepEqual(report[metric], joint[metric]);
  }
  const reversed = makeRecord(agreement.compare(two, one), two.key);
  assert.deepEqual(saved.facts, reversed.facts);
  assert.equal(reviewId(saved), reviewId(reversed));
  assert.equal(summarize([saved, reversed]).duplicateCount, 1);

  assert.throws(() => makeRecord({...joint}, one.key), /대응표/);
  const otherKey = structuredClone(one.key);
  otherKey.mapping.after.articleSha256 = hash('different manuscript');
  assert.throws(() => makeRecord(joint, otherKey), /대응표/);
  joint.dimensions[0].first.before = 0;
  saved.dimensions[0].first.before = null;
  saved.facts.after[0].flag = 'none';
  assert.deepEqual(makeRecord(joint, one.key), expected);
});

test('동일한 사실 판정과 편향 점수라도 구절 대응이 다른 새 요약은 구별하고 이전 링크는 보존한다', () => {
  const old = record('cases', [[3, 0, 2, 1]]);
  const rich = withFacts(old, [fact('supported'), fact('pending')], [fact('supported'), fact('supported')]);
  const original = withMatches(rich, [[0, 1]]);
  const replacement = withMatches(rich, [[0, null]]);
  assert.notEqual(reviewId(original), reviewId(replacement));
  assert.notEqual(reviewId(original), reviewId(rich));
  assert.equal(reviewId(original, 2), reviewId(rich));
  assert.equal(reviewId(replacement, 2), reviewId(rich));
  assert.throws(() => reviewId(rich, 3), /구절별/);
  const unsorted = structuredClone(original);
  unsorted.dimensions.reverse();
  for (const d of unsorted.dimensions) [d.first, d.second] = [d.second, d.first];
  assert.equal(reviewId(unsorted), reviewId(original));
  assert.deepEqual(summarize([original]).articles[0].factTrace, {total:1, retained:1, unmatched:0, changed:0});
  for (const incoming of [[rich, old, original], [original, old, rich], [old, original, rich]]) {
    const expected = summarize([original]);
    assert.deepEqual(summarize(incoming), {...expected, duplicateCount:2});
  }
  for (const incoming of [[old, original, rich, replacement], [rich, replacement, old, original]]) {
    assert.throws(() => summarize(incoming), error => {
      assert.deepEqual(error.recordIndexes, [1, 3]);
      return /구절 대응/.test(error.message);
    });
  }
});

test('두 편집자가 새 구절도 확인한 배포 파일을 회수해도 교체된 원본 구절의 지지는 이어지지 않는다', async () => {
  const rows = ['승인액은 10억 원이다.', '위원회는 수요일에 열렸다.', '결과는 금요일에 공개됐다.', '작년에는 11명이 참석했다.'];
  const before = work(rows.join('\n'));
  const after = work([...rows.slice(0, -1), '올해는 12명이 참석했다.'].join('\n'));
  for (const manuscript of [before, after]) manuscript.sources[0].excerpt = '승인액 10억 원. 참석자 수는 작년 11명, 올해 12명.';
  const reviews = await Promise.all([assignment(before, after, [2,0]), assignment(before, after, [3,1])]);
  for (const [editor, review] of reviews.entries()) {
    for (const role of ['before', 'after']) {
      const copy = review[role];
      const rows = engine.report(copy.article, copy.sources).rows;
      copy.receipts = [rows[0], rows.at(-1)].map(row => engine.decide(row, {status:'fact',
        sourceIds:[copy.sources[0].id], acknowledged:true, reason:'독립 검토 ' + editor}, copy.sources));
    }
  }
  const joint = agreement.compare(...reviews);
  const saved = makeRecord(joint, reviews[1].key);
  assert.deepEqual(saved.factMatches, [[0, 0], [3, null]]);
  assert.deepEqual(summarize([JSON.parse(JSON.stringify(saved))]).articles[0].factTrace,
    {total:2, retained:1, unmatched:1, changed:0});
  assert.deepEqual(makeRecord(agreement.compare(...[...reviews].reverse()), reviews[0].key).factMatches, saved.factMatches);
  joint.factMatches[1][1] = 3;
  saved.factMatches[0].length = 0;
  assert.deepEqual(makeRecord(joint, reviews[0].key).factMatches, [[0, 0], [3, null]]);
});

test('원본의 모든 공동 전체 지지 구간만 순서대로 연결하고 수정본 구간 재사용과 잘못된 위치를 거부한다', () => {
  const reviewed = withFacts(record('ordered'), [fact('pending'), fact('supported'), fact('limited'), fact('supported')],
    [fact('supported'), fact('pending')]);
  for (const matches of [null, {}, [], [[1, 0]], [[1, 0], [1, null]], [[3, 1], [1, 0]], [[0, 1], [3, null]],
    [[1, null], [2, 0]], [[1, 0], [3, 0]], [[1, 0], [3, -1]], [[1, 0], [3, 2]], [[1, 0], [3, 0.5]],
    [[1, 0], [3, false]], [[1, 0], [3, '1']], [[1, 0], [3, {}]], [[1, 0], [3]], [[1, '원문', 0], [3, null]],
    [[1, 0], ['3', null]], Array(2), [[1, 0], [3, 1], [4, null]]]) {
    assert.throws(() => summarize([withMatches(reviewed, matches)]), /대응 기록/);
  }
  const changed = withMatches(reviewed, [[1, 1], [3, 0]]);
  assert.deepEqual(summarize([changed]).articles[0].factTrace, {total:2, retained:1, unmatched:0, changed:1});
  const unmatched = withMatches(reviewed, [[1, null], [3, null]]);
  assert.deepEqual(summarize([unmatched]).articles[0].factTrace, {total:2, retained:0, unmatched:2, changed:0});
});

test('편향이 개선된 기사에서 원본 사실의 대응, 수정 후 판정 변화, 구형 기록과 분모 감소를 기사별로 센다', () => {
  const improved = [[2, 0, 3, 0], [2, 1, 2, 0]];
  const replaced = withMatches(withFacts(record('replaced', improved),
    [fact('supported'), fact('supported'), fact('supported')], [fact('limited'), fact('supported'), fact('supported')]),
    [[0, 2], [1, null], [2, 0]]);
  const earlier = withFacts(record('legacy', improved), [fact('supported'), fact('pending')], [fact('supported')]);
  const newer = withMatches(withFacts(record('empty original', improved), [fact('pending')], [fact('supported')]), []);
  const stableBias = withMatches(withFacts(record('stable', [[2, 2, 2, 2]]),
    [fact('supported'), fact('supported')], [fact('excluded'), fact('pending')]), [[0, null], [1, 1]]);
  const s = summarize([replaced, earlier, newer, stableBias, record('score only', improved)]);
  assert.deepEqual(s.articles.map(a => a.factTrace), [
    {total:3, retained:1, unmatched:1, changed:1}, null, {total:0, retained:0, unmatched:0, changed:0},
    {total:2, retained:0, unmatched:1, changed:1}, null
  ]);
  assert.deepEqual([s.facts.improvedArticles, s.facts.improvedWithUnconfirmedRetention,
    s.facts.improvedWithoutTrace, s.facts.improvedWithFewerFactRows], [4, 1, 2, 1]);
  assert.equal(summarize([replaced]).facts.improvedWithFewerFactRows, 0);
  assert.deepEqual(summarize([replaced]).improved, ratio(2, 2));
  const opinionOnly = withFacts(record('opinion', improved), [fact('supported'), fact('pending')], [fact('supported'), fact('excluded')]);
  assert.equal(summarize([opinionOnly]).facts.improvedWithFewerFactRows, 1);
});

test('기사별 1/1과 0/3은 1/4이고 원자료가 같은 기사에는 별도 분모를 적용한다', () => {
  const a = record('a', [[2, 0, 3, 1], [0, 2, 1, 3]]);
  const b = record('b', [[2, 2, 3, 3], [2, 3, 3, 2], [3, 3, 2, 2]], true);
  const c = record('c');
  const s = summarize([a, b, c]);
  assert.deepEqual(s.improved, ratio(1, 4));
  assert.deepEqual(s.worsened, ratio(1, 1));
  assert.deepEqual(s.unchangedEvidenceImprovement, ratio(1, 1));
  assert.deepEqual([s.articleCount, s.eligibleArticles, s.improvementEligibleArticles, s.worseningEligibleArticles], [3, 2, 2, 1]);
  assert.deepEqual([s.total, s.paired, s.unpaired, s.missingScores, s.naScores], [12, 5, 7, 28, 0]);
  assert.deepEqual([s.changedSources, s.unchangedSources], [1, 2]);
  assert.deepEqual(s.articles.map(a => [a.sourceChanged, a.improved]), [[false, ratio(1, 1)], [true, ratio(0, 3)], [false, ratio(0, 0)]]);
  assert.deepEqual(s.dimensions.map(d => d.improved), [ratio(1, 2), ratio(0, 1), ratio(0, 1), ratio(0, 0)]);
  assert.deepEqual(summarize([b]).unchangedEvidenceImprovement, ratio(0, 0));
});

test('미평가·해당 없음과 수정 후 판단이 빠진 공동 중요 항목을 따로 세고 유지 심각도 차이를 방향 불일치와 구별한다', () => {
  const r = record('mixed', [[2, 2, 0, 1], [2, 'na', 3, null], [3, 0, 2, 2], ['na', 1, 3, null]]);
  const s = summarize([r]);
  assert.deepEqual([s.total, s.paired, s.unpaired, s.disagreed, s.stableSeverityDifferences], [4, 2, 2, 1, 1]);
  assert.deepEqual([s.missingScores, s.naScores, s.pendingImportant], [2, 2, 1]);
  assert.deepEqual(s.improved, ratio(0, 1));
  assert.deepEqual(s.worsened, ratio(0, 0));
  assert.equal(s.dimensions.find(d => d.id === 'framing').pendingImportant, 1);
});

test('모든 기준에서 편집자 순서를 함께 바꾸거나 기준을 재정렬한 중복 파일은 한 번만 센다', () => {
  const r = record('same', [[2, 0, 3, 1], [1, 2, 0, 3]]);
  const swap = structuredClone(r);
  for (const d of swap.dimensions) [d.first, d.second] = [d.second, d.first];
  swap.dimensions.reverse();
  const s = summarize([r, swap, r]);
  assert.deepEqual([s.articleCount, s.duplicateCount, s.total, s.paired], [1, 2, 4, 2]);
  assert.deepEqual(s.improved, ratio(1, 1));
  assert.deepEqual(s.worsened, ratio(1, 1));
  const crosswise = structuredClone(r);
  const firstAxis = crosswise.dimensions[0];
  [firstAxis.first, firstAxis.second] = [firstAxis.second, firstAxis.first];
  assert.throws(() => summarize([r, crosswise]), /하나만/);
});

test('이전 기록과 새 기록의 입력 순서에 관계없이 같은 기사 한 건의 사실 검토 자료를 보존한다', () => {
  const old = record('same', [[3, 0, 2, 1]]);
  const rich = withFacts(structuredClone(old), [fact('limited')], [fact('quotedConflict', 'quote')]);
  for (const d of rich.dimensions) [d.first, d.second] = [d.second, d.first];
  const solo = summarize([rich]);
  for (const records of [[old, old, rich], [rich, old, old], [old, rich, old]]) {
    assert.deepEqual(summarize(records), {...solo, duplicateCount: 2});
  }
  assert.deepEqual([solo.facts.articleCount, solo.facts.missingArticles, solo.facts.improvedWithRevisedFlags], [1, 0, 1]);
  assert.equal(solo.articles[0].facts.after.quotedConflict, 1);
});

test('사실 판정이 다른 두 새 파일을 찾아내고 먼저 가져온 이전 파일과 혼동하지 않는다', () => {
  const old = record('same');
  const rich = withFacts(old, [fact('supported')], [fact('pending'), fact('disputed', 'both')]);
  const changed = structuredClone(rich);
  changed.facts.after.reverse();
  for (const [records, indexes] of [
    [[old, rich, changed], [1, 2]], [[changed, old, rich], [0, 2]], [[rich, changed, old], [0, 1]]
  ]) {
    assert.throws(() => summarize(records), error => {
      assert.deepEqual(error.recordIndexes, indexes);
      return /사실 검토/.test(error.message);
    });
  }
  const differentFlag = structuredClone(rich);
  differentFlag.facts.after[1].flag = 'article';
  assert.throws(() => summarize([old, rich, differentFlag]), /2번째와 3번째/);
});

test('사실 검토의 분자·분모는 판본별 구간에서 합산하고 편향 개선과 충돌의 동시 발생은 기사별로 센다', () => {
  const improved = [[3, 1, 2, 0], [2, 1, 3, 1]];
  const a = withFacts(record('a', improved), [fact('supported')], [
    fact('supported'), fact('pending', 'quote'), fact('disputed', 'both')]);
  const b = withFacts(record('b', [[2, 2, 3, 2]], true), [fact('contradicted', 'article'), fact('limited')],
    [fact('contradicted', 'article'), fact('contradicted', 'article'), fact('contradicted', 'article'), fact('excluded')]);
  const c = withFacts(record('c', improved), [fact('shared')], [fact('pending')]);
  const old = record('d', improved, true);
  const s = summarize([a, b, c, old]);
  assert.deepEqual(s.facts.before.support, ratio(1, 2));
  assert.deepEqual(s.facts.before.coverage, ratio(3, 4));
  assert.deepEqual(s.facts.after.support, ratio(1, 4));
  assert.deepEqual(s.facts.after.coverage, ratio(4, 7));
  assert.deepEqual([s.facts.after.articleFlagged, s.facts.after.quoteFlagged, s.facts.after.flagged], [4, 2, 5]);
  assert.deepEqual([s.facts.articleCount, s.facts.missingArticles, s.facts.improvedArticles,
    s.facts.improvedWithRevisedFlags, s.facts.improvedWithOpenFacts, s.facts.improvedMissingFacts], [3, 1, 3, 1, 2, 1]);
  assert.deepEqual(s.articles.map(a => a.facts?.after.support ?? null), [ratio(1, 1), ratio(0, 3), ratio(0, 0), null]);
  assert.deepEqual(s.improved, ratio(6, 7));
  assert.deepEqual([s.changedSources, s.unchangedSources, s.unchangedEvidenceImprovement], [2, 2, ratio(4, 4)]);
  const v1 = summarize([old]);
  assert.deepEqual([v1.facts.articleCount, v1.facts.missingArticles, v1.facts.after.total, v1.articles[0].facts], [0, 1, 0, null]);
  const pending = summarize([c]);
  assert.deepEqual([pending.facts.articleCount, pending.facts.missingArticles, pending.facts.after.pending,
    pending.facts.improvedWithOpenFacts, pending.facts.improvedWithRevisedFlags], [1, 0, 1, 1, 0]);
  assert.deepEqual(pending.facts.after.coverage, ratio(0, 1));
});

test('버전별 사실 검토 형식·필수 구간·판정 및 충돌 조합·개인 자료 필드를 엄격히 검증한다', () => {
  const old = record('old');
  const valid = withFacts(old, [fact('supported')], [fact('pending')]);
  const changes = [
    r => { r.version = 1; }, r => { r.version = 3; }, r => { delete r.facts; }, r => { r.facts = null; },
    r => { delete r.facts.after; }, r => { r.facts.before = []; }, r => { r.facts.after = {}; },
    r => { r.facts.after = Array(2); }, r => { r.facts.after.push(null); }, r => { r.facts.reviewer = 'private'; },
    r => { r.facts.before[0].flag = 'quote'; }, r => { r.facts.after[0].outcome = 'toString'; },
    r => { delete r.facts.after[0].flag; }, r => { r.facts.after[0].rowId = 'unit-private'; }
  ];
  for (const change of changes) {
    const invalid = structuredClone(valid);
    change(invalid);
    assert.throws(() => summarize([old, invalid]), error => {
      assert.deepEqual(error.recordIndexes, [1]);
      return /2번째/.test(error.message);
    });
  }
});

test('재채점·자료 변경·역순·같은 원본/수정본·연속 개정이 겹치면 잘못 집계할 파일 위치를 알려 준다', () => {
  const a = record('a', [[3, 0, 2, 1]]);
  const mutations = [
    r => { r.dimensions[0].first.after = 2; },
    r => { r.before.sourcesSha256 = hash('other source set'); },
    r => { r.after.sourcesSha256 = hash('other source set'); },
    r => { [r.before, r.after] = [r.after, r.before]; },
    r => { r.after.articleSha256 = hash('different revision'); },
    r => { r.before.articleSha256 = hash('different baseline'); },
    r => { r.before = a.after; r.after = record('b').after; },
    r => { r.after = a.before; r.before = record('b').before; }
  ];
  for (const mutate of mutations) {
    const r = structuredClone(a);
    mutate(r);
    assert.throws(() => summarize([record('unrelated'), a, r]), err => {
      assert.deepEqual(err.recordIndexes, [1, 2]);
      return /겹치/.test(err.message);
    });
  }
  const actual = {...record('other'), demo: false};
  assert.throws(() => summarize([a, a, actual]), err => {
    assert.deepEqual(err.recordIndexes, [0, 2]);
    return /연습 기록과 실제 기사/.test(err.message);
  });
  assert.equal(summarize([actual]).demo, false);
});

test('버전·구조·다이제스트·기준·평점 및 금지된 필드 위조를 거부한다', () => {
  const changes = [
    r => { r.format = 'journal-local-factcheck-v1'; }, r => { r.version = '1'; }, r => { r.demo = 1; },
    r => { delete r.after; }, r => { r.before = null; }, r => { r.before.articleSha256 = 'Z'.repeat(64); },
    r => { r.after.sourcesSha256 = 'a'.repeat(63); }, r => { r.after.articleSha256 = r.before.articleSha256; },
    r => { r.total = 4; }, r => { r.before.pairId = 'private'; }, r => { r.after.url = 'https://private.invalid'; },
    r => { r.dimensions.pop(); }, r => { r.dimensions = {}; }, r => { r.dimensions[0] = null; },
    r => { r.dimensions[0].id = 'standards'; }, r => { r.dimensions[0].id = 'wrong'; },
    r => { r.dimensions[1].pct = 100; }, r => { r.dimensions[2].first.reason = 'private'; },
    r => { r.dimensions[3].first = null; }, r => { delete r.dimensions[0].second.after; },
    r => { r.dimensions[0].first.before = 'na'; }, r => { r.dimensions[2].second.after = 'na'; }
  ];
  for (const value of [true, false, '2', -1, 4, 2.5, {}, []]) changes.push(r => { r.dimensions[1].first.before = value; });
  for (const change of changes) {
    const r = record('invalid');
    change(r);
    assert.throws(() => summarize([record('ok'), r]), err => {
      assert.deepEqual(err.recordIndexes, [1]);
      return /2번째/.test(err.message);
    });
  }
  for (const invalid of [null, undefined, false, '', {}, []]) assert.throws(() => summarize([invalid]), /1번째/);
  assert.throws(() => summarize(null), /목록/);
});

test('빈 선택과 모든 점수가 빠진 기사를 구별하고 분모가 없으면 백분율을 만들지 않는다', () => {
  const empty = summarize([]);
  assert.deepEqual([empty.demo, empty.articleCount, empty.total, empty.eligibleArticles], [null, 0, 0, 0]);
  const unknown = summarize([record('unrated')]);
  assert.deepEqual([unknown.demo, unknown.articleCount, unknown.total, unknown.eligibleArticles, unknown.missingScores], [true, 1, 4, 0, 16]);
  for (const s of [empty, unknown]) {
    for (const k of ['improved', 'worsened', 'unchangedEvidenceImprovement']) assert.deepEqual(s[k], ratio(0, 0));
    assert.deepEqual(s.dimensions.map(d => d.improved.pct), [null, null, null, null]);
  }
});
