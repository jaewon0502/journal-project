const {test} = require('node:test');
const assert = require('node:assert/strict');
const {reviewId, summarize} = require('../docs/reader/revision-series.js');

function versions() {
  const v1 = {format:'journal-revision-series-record', version:1, demo:false,
    before:{articleSha256:'a'.repeat(64), sourcesSha256:'c'.repeat(64)},
    after:{articleSha256:'b'.repeat(64), sourcesSha256:'c'.repeat(64)},
    dimensions:['wording','framing','omission','standards'].map(id => ({id,
      first:{before:3, after:1}, second:{before:2, after:0}}))};
  const rows = ['pending','supported','supported'].map(outcome => ({outcome, flag:'none'}));
  const v2 = {...v1, version:2, facts:{before:rows, after:structuredClone(rows)}};
  const v3 = {...v2, version:3, factMatches:[[1,0],[2,null]]};
  const v4 = {...v3, version:4, factContext:{beforeCore:[0,1,2], afterCore:[2,0,1], matches:[[0,2],[1,0]]}};
  return [v1, v2, v3, v4];
}

test('v4는 핵심 표시와 모든 구절 대응을 식별하고 v2·v3 근거 링크를 재현한다', () => {
  const [,v2,v3,v4] = versions();
  // Fixed historical wire digests calculated independently with Python hashlib.
  assert.equal(reviewId(v2), 'ec6d43fa033d480cd29c4c05d4f60e536f0f8eee238e100336648312ac5b3f9e');
  assert.equal(reviewId(v3), '8a30ec4bbb5b59836b1430d7bed8c0ec88cf9815a812d88cde2335d657e5ab54');
  assert.equal(reviewId(v4, 2), reviewId(v2));
  assert.equal(reviewId(v4, 3), reviewId(v3));
  assert.notEqual(reviewId(v4), reviewId(v3));
  assert.throws(() => reviewId(v3, 4), /구절별/);
  const reordered = structuredClone(v4);
  const {beforeCore,afterCore,matches} = reordered.factContext;
  reordered.factContext = {matches,afterCore,beforeCore};
  for (const d of reordered.dimensions) [d.first,d.second] = [d.second,d.first];
  assert.equal(reviewId(reordered), reviewId(v4));
  const changes = [c => { c.beforeCore[0] = 1; }, c => { c.afterCore[1] = 2; }, c => { c.matches.shift(); }];
  for (const change of changes) {
    const changed = structuredClone(v4);
    change(changed.factContext);
    assert.notEqual(reviewId(changed), reviewId(v4));
    assert.equal(reviewId(changed, 3), reviewId(v3));
    assert.throws(() => summarize([v3, v4, changed]), e =>
      /핵심 주장 표시 또는 전체 구절 대응/.test(e.message) && e.recordIndexes.join() === '1,2');
  }
});

test('전체 구절 대응은 일부만 연결해도 되지만 번호·표시 수와 공동 지지 구절 대응을 엄격히 검증한다', () => {
  const [,,,v4] = versions();
  const invalid = [
    c => { c.notes = '자유 메모'; }, c => { delete c.beforeCore; }, c => { c.matches = {}; },
    c => { c.beforeCore.pop(); }, c => { c.afterCore.push(2); }, c => { c.afterCore[1] = -1; },
    c => { c.beforeCore[2] = 3; }, c => { c.beforeCore[1] = '1'; }, c => { delete c.afterCore[0]; },
    c => { c.matches = [[0,2,1]]; }, c => { c.matches[0][0] = -1; }, c => { c.matches.push([3,1]); },
    c => { c.matches[0][1] = null; }, c => { c.matches[0][1] = 3; }, c => { c.matches[0][1] = 0.5; },
    c => { c.matches.reverse(); }, c => { c.matches.push([1,1]); }, c => { c.matches[0][1] = 0; },
    c => { c.matches.pop(); }, c => { c.matches[1][1] = 1; }, c => { c.matches.push([2,1]); }
  ];
  for (const change of invalid) {
    const changed = structuredClone(v4);
    change(changed.factContext);
    assert.throws(() => reviewId(changed), /핵심 주장|구절 대응/);
    assert.throws(() => summarize([changed]), error => error.recordIndexes.join() === '0');
  }
  const unmatched = structuredClone(v4);
  unmatched.factMatches = [[1,null],[2,null]];
  unmatched.factContext.matches = [];
  assert.doesNotThrow(() => reviewId(unmatched));
});

test('여러 버전이 섞여도 가장 자세한 기록 한 건을 사용하고 공통으로 가진 판정과 대응은 대조한다', () => {
  const [v1,v2,v3,v4] = versions();
  const expected = {...summarize([v4]), duplicateCount:3};
  for (const records of [[v1,v2,v3,v4], [v4,v3,v2,v1], [v3,v1,v4,v2]]) {
    assert.deepEqual(summarize(records), expected);
  }
  const otherV3 = structuredClone(v3);
  otherV3.factMatches[0][1] = 2;
  const otherV2 = structuredClone(v2);
  otherV2.facts.after[1].outcome = 'pending';
  for (const older of [otherV2,otherV3]) {
    for (const records of [[older,v1,v4], [v4,v1,older]]) {
      assert.throws(() => summarize(records), e => e.recordIndexes.join() === '0,2');
    }
  }
});
