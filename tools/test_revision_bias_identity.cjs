const test = require('node:test');
const assert = require('node:assert/strict');
const {speakerCase} = require('./fixtures/revision-speaker-case.cjs');
const engine = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');
const blind = require('../docs/reader/blind-revision.js');
const agreement = require('../docs/reader/revision-agreement.js');
const series = require('../docs/reader/revision-series.js');
const retention = require('../docs/reader/retention-case.js');
const {audit} = require('../docs/reader/revision-bias-audit.js');

function edit(items, key, role, update) {
  const work = items.map(item => item.data).find(data => data.blindReview?.pairId === key.pairId &&
    data.blindReview.slot === key.mapping[role].slot);
  const report = engine.report(work.article, work.sources, work.receipts);
  update(work.articleAssessment.ratings.wording, report, work.sources);
  work.articleAssessment = rubric.save(report,work.sources,work.articleAssessment);
}
async function summary(items) {
  const reviews = await blind.resolveBundle(items);
  return series.makeRecord(agreement.compare(...reviews), reviews[0].key);
}

test('두 판본의 편향 점수가 같아도 다른 기사 위치·자료·발췌의 진행자 파일은 해당 요약의 인용 대조로 열리지 않는다', async () => {
  const {items,key,reviews,joint} = await speakerCase(), original = series.makeRecord(joint,key);
  const firstArchive = await retention.create(original,items,[]);
  assert.equal((await audit([original],[firstArchive])).aligned, 1);
  assert.equal(series.reviewId(series.makeRecord(agreement.compare(reviews[1],reviews[0]),key)), series.reviewId(original));
  const reasonsOnly = structuredClone(items);
  edit(reasonsOnly,key,'after', rating => { rating.reason = '이유를 더 자세히 적었다.'; });
  assert.equal(series.reviewId(await summary(reasonsOnly.reverse())), series.reviewId(original));
  const edits = [
    (rating,report) => { rating.rowId = report.rows[2].id; rating.quote = report.rows[2].text; },
    rating => { rating.quote = '박 기자'; },
    (rating,report,sources) => { rating.sourceId = sources[1].id; rating.sourceQuote = sources[1].excerpt; },
    rating => { rating.sourceQuote = '박 기자'; }
  ];
  const seen = new Set([original.biasEvidenceSha256]);
  for (const change of edits) {
    const otherFiles = structuredClone(items);
    edit(otherFiles,key,'after', change);
    const other = await summary(otherFiles);
    assert.deepEqual(other.dimensions,original.dimensions);
    assert.deepEqual(other.facts,original.facts);
    assert.equal(series.reviewId(other,8),series.reviewId(original,8));
    assert.match(other.biasEvidenceSha256,/^[0-9a-f]{64}$/u);
    assert.ok(!seen.has(other.biasEvidenceSha256));
    seen.add(other.biasEvidenceSha256);
    assert.notEqual(series.reviewId(other),series.reviewId(original));
    for (const records of [[other,original],[original,other]]) assert.throws(() => series.summarize(records),/인용 근거/);
    const archive = await retention.create(other,otherFiles,[]);
    await assert.rejects(audit([original],[archive]), /짝이 맞지/);
    await assert.rejects(audit([other],[firstArchive]), /짝이 맞지/);
  }
  const changed = structuredClone(items);
  edit(changed,key,'after',edits[0]);
  const different = await summary(changed);
  assert.equal((await audit([different],[await retention.create(different,changed,[])])).different, 1);
  for (const value of [null, 'a123', undefined]) {
    const invalid = {...original,biasEvidenceSha256:value};
    if (value === undefined) delete invalid.biasEvidenceSha256;
    assert.throws(() => series.reviewId(invalid),/식별값|형식/);
  }
});

test('판본별 인용을 같은 편집자에게 연결하고 자료의 임시 번호와 작업 파일 순서는 식별에 쓰지 않는다', async () => {
  const {items,reviews} = await speakerCase();
  const [first,second] = reviews.map(review => review.key);
  const citeSurvey = (rating,report,sources) => {
    rating.sourceId = sources[2].id;
    rating.sourceQuote = sources[2].excerpt;
  };
  const own = structuredClone(items), crossed = structuredClone(items);
  for (const bundle of [own,crossed]) edit(bundle,first,'before',citeSurvey);
  edit(own,first,'after',citeSurvey);
  edit(crossed,second,'after',citeSurvey);
  const a = await summary(own), b = await summary(crossed);
  assert.deepEqual(a.dimensions,b.dimensions);
  assert.equal(series.reviewId(a,8),series.reviewId(b,8));
  assert.notEqual(a.biasEvidenceSha256,b.biasEvidenceSha256);

  const renamed = structuredClone(own);
  for (const item of renamed) {
    item.name = '다시 저장한 ' + item.name;
    const work = item.data;
    if (!work.blindReview) continue;
    // Verify the citation commitment separately from claim receipts tied to local catalogue IDs.
    const {ratings,coreRowIds} = work.articleAssessment;
    const oldId = ratings.wording.sourceId;
    const selected = work.sources.find(s => s.id === oldId);
    selected.id = '편집기에서 바뀐 자료 번호';
    ratings.wording.sourceId = selected.id;
    work.receipts = [];
    work.articleAssessment = rubric.save(engine.report(work.article, work.sources), work.sources,{ratings,coreRowIds});
  }
  assert.equal((await summary(renamed.reverse())).biasEvidenceSha256, a.biasEvidenceSha256);
});
