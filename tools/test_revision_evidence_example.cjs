const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const blind = require('../docs/reader/blind-revision.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const agreement = require('../docs/reader/revision-agreement.js');
const series = require('../docs/reader/revision-series.js');
const example = require('../docs/reader/revision-evidence-example.js');

test('도서관 연습 파일 여섯 개는 다시 열어도 같은 기록과 두 편집자의 기존 요약을 복원한다', async () => {
  const files = await example.files();
  assert.deepEqual(files, await example.files());
  assert.equal(new Set(files.map(file => file.name)).size, 6);
  for (const file of files) {
    assert.match(file.name, /^도서관-연습-편집자[12]-.+\.json$/);
    assert.deepEqual(JSON.parse(file.raw), file.data);
    assert.equal(file.data.demo, true);
  }
  const [first, second] = await blind.resolveBundle(files.reverse());
  assert.notEqual(first.key.pairId, second.key.pairId);
  const joint = agreement.compare(first, second);
  assert.deepEqual(joint.missingReturns, []);
  const filename = path.join(__dirname, '../docs/reader/revision-series-example.js');
  const fixtures = vm.runInNewContext(readFileSync(filename, 'utf8'));
  const library = fixtures.find(item => item.name === '도서관 운영 연습 기사');
  assert.deepEqual(series.makeLegacyMatchRecord(joint, first.key), JSON.parse(JSON.stringify(library.record)));
  assert.equal(series.reviewId(series.makeRecord(joint, first.key), 5), series.reviewId(library.record));
  assert.deepEqual(series.makeRecord(joint, second.key), series.makeRecord(joint, first.key));
  assert.deepEqual(Array.from(fixtures, item => item.record.version), [3, 5]);
  const results = series.summarize(Array.from(fixtures, item => item.record));
  assert.deepEqual(results.facts.audit, {improvedArticles: 1, missingImprovedArticles: 0,
    core: {total: 0, retained: 0, changed: 0, unmatched: 0},
    flags: {total: 1, previouslyFlagged: 1, previouslySupported: 0, previouslyUnflagged: 0, unmatched: 0, core: 0}});

  for (const role of ['before', 'after']) {
    const [one, two] = [first, second].map(review => workspace.read(review[role]));
    assert.ok([one, two].every(view => view.demo && !view.stale));
    assert.equal(one.rows[2].text, two.rows[2].text);
    assert.match(one.rows[2].text, /80곳/);
    const checked = one.rows[2].receipt, speechOnly = two.rows[2].receipt;
    assert.equal(checked.contentStatus, 'contradicted');
    assert.equal(speechOnly.contentStatus, 'unverified');
    assert.match(checked.contentReason, /80곳.*20곳/);
    assert.notEqual(checked.reason, speechOnly.reason);
    assert.equal(speechOnly.contentSourceIds, undefined);
    const table = one.sources.find(source => source.id === checked.contentSourceIds[0]);
    const transcript = one.sources.find(source => source.id === checked.sourceIds[0]);
    assert.equal(speechOnly.sourceIds[0], transcript.id);
    assert.match(transcript.excerpt, /80곳/);
    assert.match(table.excerpt, /100개.*20개/);
    assert.notEqual(table.url, transcript.url);
    assert.ok(one.sources.every(source => new URL(source.url).hostname.endsWith('.example.invalid')));
  }
});

test('편향 표현을 고쳤어도 원래 핵심 반대 발언이 이어지지 않은 가상 기사를 진행자 파일에서 다시 찾는다', async () => {
  const file = name => JSON.parse(readFileSync(path.join(__dirname, '../experiments/core-quote-revision', name), 'utf8'));
  const archive = file('coordinator-case.json'), record = file('series-summary.json');
  const retention = require('../docs/reader/retention-case.js');
  const reviews = await blind.resolveBundle(retention.read(archive).items);
  const joint = agreement.compare(...reviews);
  const rebuilt = series.makeRecord(joint, reviews[0].key);
  assert.equal(series.reviewId(rebuilt, 5), series.reviewId(record));
  assert.deepEqual(retention.verify(archive, rebuilt), []);
  assert.deepEqual(joint.missingReturns, []);
  const [article] = series.summarize([record]).articles;
  assert.deepEqual(article.coreContextReview, {total:1, unmatched:[3]});
  assert.deepEqual(article.improved, {numerator:1, denominator:1, pct:100});
  assert.deepEqual(article.factAudit.core, {total:1, retained:1, changed:0, unmatched:0});
  const sourceTitles = new Set();
  for (const review of reviews) {
    const old = workspace.read(review.before);
    const revised = workspace.read(review.after);
    assert.ok(old.demo && revised.demo);
    assert.match(old.rows[3].text, /야당 의원.*무책임하다/);
    assert.match(revised.rows[3].text, /여당 의원.*바람직하다/);
    const receipt = old.rows[3].receipt;
    assert.equal(receipt.contentStatus, 'opinion');
    sourceTitles.add(old.sources.find(s => s.id === receipt.sourceIds[0]).title);
  }
  assert.deepEqual([...sourceTitles].sort(), ['가상 공청회 속기록','가상 공청회 회의록']);
  assert.doesNotMatch(JSON.stringify(record), /무책임|야당 의원|속기록/);
});
