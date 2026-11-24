const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {summarize} = require('../docs/reader/revision-series.js');

const hash = value => createHash('sha256').update(value).digest('hex');
const fact = (outcome, flag = 'none') => ({outcome, flag});
const noFlags = {total: 0, previouslyFlagged: 0, previouslySupported: 0, previouslyUnflagged: 0, unmatched: 0, core: 0};

function record(name, {improved = true, sourceChanged = false} = {}) {
  return {format: 'journal-revision-series-record', version: 4, demo: true,
    before: {articleSha256: hash(name + ' before'), sourcesSha256: hash('source')},
    after: {articleSha256: hash(name + ' after'), sourcesSha256: hash(sourceChanged ? 'updated' : 'source')},
    dimensions: ['wording', 'framing', 'omission', 'standards'].map((id, i) => {
      const pair = i === 0 ? {before: 2, after: improved ? 0 : 2} : {before: null, after: null};
      return {id, first: {...pair}, second: {...pair}};
    }),
    facts: {before: [fact('supported'), fact('supported')], after: [fact('supported'), fact('pending')]},
    factMatches: [[0, 0], [1, null]],
    factContext: {beforeCore: [2, 0], afterCore: [0, 0], matches: [[0, 0]]}};
}

function asLegacy(input, version) {
  const result = {...input, version};
  delete result.factContext;
  if (version < 3) delete result.factMatches;
  if (version < 2) delete result.facts;
  return result;
}

test('종전 집계가 같은 두 집단에서 편향 개선 기사에 실제로 남은 핵심 사실을 구별한다', () => {
  const reports = [];
  for (const keepCoreInImproved of [true, false]) {
    const improved = record('improved'), stable = record('stable', {improved: false});
    improved.factContext.beforeCore = keepCoreInImproved ? [2, 0] : [0, 2];
    stable.factContext.beforeCore = keepCoreInImproved ? [0, 2] : [2, 0];
    reports.push(summarize([improved, stable]));
  }
  const [first, second] = reports;
  for (const report of reports) {
    assert.deepEqual(report.facts.audit.flags, noFlags);
    assert.equal(report.facts.audit.improvedArticles, 1);
    assert.equal(report.facts.audit.missingImprovedArticles, 0);
    assert.deepEqual(report.articles.map(a => a.factTrace), Array(2).fill({total: 2, retained: 1, unmatched: 1, changed: 0}));
    assert.equal(report.articles.reduce((sum, a) => sum + a.factAudit.core.retained, 0), 1);
  }
  const {audit: a, ...oldFirst} = first.facts, {audit: b, ...oldSecond} = second.facts;
  assert.deepEqual(oldFirst, oldSecond);
  assert.deepEqual(first.improved, second.improved);
  assert.deepEqual(a.core, {total: 1, retained: 1, changed: 0, unmatched: 0});
  assert.deepEqual(b.core, {total: 1, retained: 0, changed: 0, unmatched: 1});
});

test('같은 기사 복사본과 구버전은 한 번만 세고 구버전만 있는 개선 기사는 자료 누락으로 센다', () => {
  const improved = record('revised sources', {sourceChanged: true});
  improved.facts.after[0] = fact('pending', 'quote');
  improved.factContext.afterCore = [2, 1];
  const legacy = [1, 2, 3].map(version => asLegacy(record('legacy ' + version), version));
  const stable = record('stable', {improved: false});
  stable.facts.after[1] = fact('quotedConflict', 'quote');
  for (const duplicates of [[asLegacy(improved, 3), improved], [improved, asLegacy(improved, 3)]]) {
    const report = summarize([...duplicates, ...legacy, stable, structuredClone(improved)]);
    assert.equal(report.duplicateCount, 2);
    assert.equal(report.articleCount, 5);
    assert.equal(report.changedSources, 1);
    assert.equal(report.articles[0].sourceChanged, true);
    assert.deepEqual(report.facts.audit, {improvedArticles: 1, missingImprovedArticles: 3,
      core: {total: 1, retained: 0, changed: 1, unmatched: 0},
      flags: {...noFlags, total: 1, previouslySupported: 1, core: 1}});
    assert.equal(report.articles[4].factAudit.flags.unmatched, 1);
    for (const article of report.articles.slice(1, 4)) assert.equal(article.factAudit, null);
    assert.equal(report.articles[3].factTrace.retained, 1);
    assert.equal(report.facts.improvedWithoutTrace, 2);
  }
});

test('핵심을 한 명만 지정했거나 원본 공동 지지가 제한적이면 분모는 0이다', () => {
  const sample = record('no established core');
  sample.factContext.beforeCore = [1, 2];
  sample.facts.before[1] = fact('limited');
  sample.factMatches.pop();
  const {facts, articles} = summarize([sample]);
  const empty = {total: 0, retained: 0, changed: 0, unmatched: 0};
  assert.deepEqual(articles[0].factAudit.core, empty);
  assert.deepEqual(facts.audit, {improvedArticles: 1, missingImprovedArticles: 0, core: empty, flags: noFlags});
  assert.deepEqual(summarize([]).facts.audit, {improvedArticles: 0, missingImprovedArticles: 0, core: empty, flags: noFlags});
});

test('개선 기사마다 분모가 달라도 기사 평균 대신 해당 구절을 모두 합친다', () => {
  const first = record('two original core rows');
  first.factContext.beforeCore = [2, 2];
  first.facts.after[1] = fact('quotedConflict', 'quote');
  const second = record('one original core row');
  second.facts.after[0] = fact('contradicted', 'article');
  second.factContext.afterCore[0] = 2;
  assert.deepEqual(summarize([first, second]).facts.audit, {improvedArticles: 2, missingImprovedArticles: 0,
    core: {total: 3, retained: 1, changed: 1, unmatched: 1},
    flags: {...noFlags, total: 2, previouslySupported: 1, unmatched: 1, core: 1}});
});

test('핵심 구절의 자동 대응을 완전 지지, 제한된 지지, 의견, 충돌과 구분하고 한 사람만 핵심으로 삼으면 제외한다', () => {
  const s = record('different core outcomes'), stable = record('stable other article', {improved:false});
  s.facts = {before:[fact('limited'), fact('excluded'), fact('pending'), fact('contradicted','article'), fact('quotedConflict','quote'), fact('supported')],
    after:[fact('excluded'),fact('pending')]};
  s.factMatches = [[5,null]];
  s.factContext = {beforeCore:[2,2,1,2,2,2], afterCore:[0,0], matches:[[1,0],[3,1]]};
  stable.facts.before[0] = fact('disputed');
  stable.factMatches = [[1,null]];
  stable.factContext.matches = [];
  const result = summarize([s, stable, structuredClone(s)]);
  assert.deepEqual(result.articles[0].coreContextReview, {total:4, unmatched:[0,4]});
  assert.deepEqual(result.articles[1].coreContextReview, {total:1, unmatched:[0]});
  assert.deepEqual(result.facts.coreContext,{total:4,unmatched:2});
  assert.deepEqual(result.articles[0].factAudit.core,{total:1,retained:0,changed:0,unmatched:1});
});
