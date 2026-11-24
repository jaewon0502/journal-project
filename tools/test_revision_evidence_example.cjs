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
  assert.deepEqual(series.makeRecord(joint, first.key), JSON.parse(JSON.stringify(library.record)));
  assert.deepEqual(series.makeRecord(joint, second.key), series.makeRecord(joint, first.key));

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
