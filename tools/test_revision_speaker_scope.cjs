const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const blind = require('../docs/reader/blind-revision.js');
const comparison = require('../docs/reader/article-compare-core.js');
const agreement = require('../docs/reader/revision-agreement.js');
const series = require('../docs/reader/revision-series.js');
const retention = require('../docs/reader/retention-case.js');

const {speakerCase, quote} = require('./fixtures/revision-speaker-case.cjs');

function paired(utterance, scope = '김 의원의 서면 답변') {
  const article = ['표지 초안',scope,'질문 순서대로 답했다.',utterance,'답변 끝.'].join('\n');
  const before = engine.prepare(article), after = engine.prepare(article.replace('김 의원','박 기자'));
  const row = before.rows.find(row => row.text === utterance);
  assert.ok(row);
  return comparison.matchRevisionRows(before, after).has(row.id);
}
test('발언 주체가 밖에 남은 직접·간접 인용과 문장 자체가 화자를 밝힌 구절을 구분한다', () => {
  for (const text of [quote, '이어 “사업비는 10억 원이다”라고 재차 강조했다.',
    '사업비는 10억 원이라고 말했다.', '이번 예산안은 무책임하다고 주장했다.',
    '김 의원이 반대했다고 주장했다.']) assert.equal(paired(text), false, text);
  for (const text of ['김하늘 의원은 “사업비는 10억 원이다”라고 거듭 강조했다.',
    '“사업비는 10억 원이다”라고 김하늘 의원이 거듭 강조했다.',
    '김하늘 의원은 사업비가 10억 원이라고 말했다.', '사업비가 10억 원이라고 박 기자가 전했다.',
    '위원회가 예산표를 공개했다.']) assert.equal(paired(text), true, text);
  const before = '표지 초안\n발언자 실명: 김하늘 의원\n' + quote + '\n답변 끝.';
  const view = engine.prepare(before), row = view.rows[2];
  assert.equal(comparison.matchRevisionRows(view, engine.prepare(before.replace('초안','정정'))).has(row.id), true);
  assert.equal(comparison.matchRevisionRows(view, view).has(row.id), true);
});

test('정정 초안에서 화자가 바뀌면 편향은 개선될 수 있어도 핵심 발언은 유지로 집계하지 않는다', async () => {
  const {items, reviews, joint, key} = await speakerCase();
  const one = comparison.compare(workspace.read(reviews[0].before),workspace.read(reviews[0].after),'revision');
  assert.deepEqual(one.untracedCore.map(r => r.text), [quote]);
  assert.deepEqual(joint.missingReturns, []);
  const current = series.makeRecord(joint,key);
  assert.deepEqual(current.factMatches, [[2,null],[6,null]]);
  const {facts, improved} = series.summarize([current]);
  assert.deepEqual(improved, {numerator:1,denominator:1,pct:100});
  assert.deepEqual(facts.audit.core,{total:1,retained:0,changed:0,unmatched:1});
  const older = [5,6,7,8].map(v => series.makeLegacyMatchRecord(joint,key,v));
  const v8 = older[3];
  // Replayed independently using the released v8 writer at d323edf.
  assert.equal(series.reviewId(v8), 'bb83d37d93c545df0a0211f68712957f2826a0d0ffef51043d78ffaf8a7353ad');
  assert.deepEqual(v8.factMatches, [[2,2],[6,null]]);
  assert.deepEqual(v8.priorReviewIds, older.slice(0,3).map(r => [r.version,series.reviewId(r)]));
  assert.deepEqual(current.priorReviewIds.at(-1), [8,series.reviewId(v8)]);
  for (const group of [[...older,current],[current,...older.reverse()]]) {
    const combined = series.summarize(group);
    assert.equal(combined.duplicateCount,4);
    assert.deepEqual(combined.facts.audit.core,facts.audit.core);
  }
  const priorArchive = await retention.create(current,items,[]);
  priorArchive.reviewId = series.reviewId(v8);
  priorArchive.checksum = engine.digestValue([priorArchive.format,6,priorArchive.reviewId,priorArchive.evidenceDigest,[],[]]);
  assert.throws(() => retention.verifyAll(priorArchive,current), err => err.code === 'legacy-review-changed');
  assert.deepEqual(retention.verifyLegacyMatchNotes(priorArchive,v8), []);
  assert.throws(() => retention.verifyLegacyMatchNotes(priorArchive,{...v8,priorReviewIds:current.priorReviewIds}), /이전 요약/);
});

test('도서관과 핵심 반대 발언 연습 자료는 배포된 v8 판정과 저장 식별값을 복원한다', async () => {
  const library = require('../docs/reader/revision-evidence-example.js');
  const archived = require('../experiments/core-quote-revision/coordinator-case.json');
  for (const [items, expected] of [
    [await library.files(), '61662600baa7a2901a7cc465dff2767f069bf5bb29c6f180f1d6fa872c206fe7'],
    [retention.read(archived).items, 'c863e9b00d5152e228c086371d15012afc3f7d129f51a8c5751aa71b175a69ce']
  ]) {
    const reviews = await blind.resolveBundle(items);
    const joint = agreement.compare(...reviews), key = reviews[0].key;
    const historical = series.makeLegacyMatchRecord(joint,key,8), current = series.makeRecord(joint,key);
    assert.equal(series.reviewId(historical), expected);
    assert.equal(series.reviewId(current,8), expected);
    assert.equal(series.summarize([historical,current]).duplicateCount, 1);
  }
});
