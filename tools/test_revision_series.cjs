const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const workspace = require('../docs/reader/workspace-snapshot.js');
const engine = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');
const blind = require('../docs/reader/blind-revision.js');
const agreement = require('../docs/reader/revision-agreement.js');
const {makeRecord, summarize} = require('../docs/reader/revision-series.js');

const ratio = (numerator, denominator) => ({numerator, denominator, pct: denominator ? 100 * numerator / denominator : null});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function work(article) {
  return {format: workspace.schema, article, articleDraft: article, demo: true, receipts: [], rowDrafts: [],
    sources: [{id: 'budget', title: '비공개 자료', url: 'https://desk.invalid/budget', version: '초판', locator: '1쪽', excerpt: '10억 원'}],
    sourceDraft: {id: null, fields: Object.fromEntries(workspace.sourceFields.map(k => [k, '']))}};
}
async function assignment(before, after, levels) {
  const {key, packets} = await blind.prepare(before, after);
  for (const [i, role] of ['before', 'after'].entries()) {
    const w = packets[key.mapping[role].slot];
    const report = engine.report(w.article, w.sources, []);
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

test('두 대응표 중 어느 쪽으로도 검증한 점수만 내보내고 집계 수치·출처·식별 정보를 제외한다', async () => {
  const original = work('사업비 20억 원을 책정했다.'), revision = work('사업비 10억 원을 책정했다.');
  const [one, two] = await Promise.all([assignment(original, revision, [2, 1]), assignment(original, revision, [3, 0])]);
  const joint = agreement.compare(one, two);
  const saved = makeRecord(joint, one.key);
  assert.deepEqual(saved, makeRecord(joint, two.key));
  const wire = JSON.stringify(saved);
  const expected = record('example', [[2, 1, 3, 0]]);
  for (const role of ['before', 'after']) {
    expected[role] = {articleSha256: one.key.mapping[role].articleSha256, sourcesSha256: one.key.mapping[role].sourcesSha256};
  }
  assert.deepEqual(saved, expected);
  assert.equal(wire.includes(one.key.pairId), false);
  assert.equal(wire.includes(two.key.pairId), false);
  const report = summarize([JSON.parse(wire)]);
  for (const metric of ['paired', 'total', 'unpaired', 'disagreed', 'stableSeverityDifferences', 'improved', 'worsened']) {
    assert.deepEqual(report[metric], joint[metric]);
  }

  assert.throws(() => makeRecord({...joint}, one.key), /대응표/);
  const otherKey = structuredClone(one.key);
  otherKey.mapping.after.articleSha256 = hash('different manuscript');
  assert.throws(() => makeRecord(joint, otherKey), /대응표/);
  joint.dimensions[0].first.before = 0;
  saved.dimensions[0].first.before = null;
  assert.deepEqual(makeRecord(joint, one.key), expected);
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
