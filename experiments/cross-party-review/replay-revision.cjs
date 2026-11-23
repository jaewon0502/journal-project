'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {read} = require('../../docs/reader/workspace-snapshot.js');
const {compare} = require('../../docs/reader/article-compare-core.js');
const {sourceTarget} = require('../../docs/reader/factcheck-engine.js');

function load(version) {
  const file = path.join(__dirname, 'reconstructed-' + version + '.json');
  return read(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const before = load('before');
const after = load('after');
const pair = compare(before, after, 'revision');
assert.equal(pair.sourceChanged, false);
assert.equal(pair.bias.paired, 0);

for (const snapshot of [before, after]) {
  assert.equal(snapshot.demo, true);
  assert.match(snapshot.article, /^\[AI가 재구성한 검토 문장\]/u);
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.assessment.accuracy.total, 6);
  assert.equal(snapshot.assessment.bias.assessed, 0);
  assert.ok(snapshot.rows.every(row => row.receipt && !row.draftPending));
  assert.equal(snapshot.rows[4].receipt.status, 'held');
  assert.equal(snapshot.assessment.accuracy.coveragePct, 100 * 5 / 6);
  const pdfs = snapshot.sources.filter(source => source.pdfPage);
  assert.deepEqual(pdfs.map(source => sourceTarget(source).page), ['34', '37', '53', '54']);
}

const changed = before.rows.flatMap((row, i) => row.text === after.rows[i].text ? [] : [i]);
assert.deepEqual(changed, [3, 5]);
for (const i of changed) {
  assert.equal(before.rows[i].receipt.status, 'contradicted');
  assert.equal(before.rows[i].receipt.correction, after.rows[i].text);
  assert.equal(after.rows[i].receipt.status, 'fact');
}

function counts(snapshot) {
  const a = snapshot.assessment.accuracy;
  return [a.supported, a.contradicted, a.unresolved, a.accuracyPct];
}
assert.deepEqual(counts(before), [3, 2, 1, 60]);
assert.deepEqual(counts(after), [5, 0, 1, 100]);

for (const [name, snapshot] of [['수정 전', before], ['수정 후', after]]) {
  const a = snapshot.assessment.accuracy;
  console.log(name, '지지 ' + a.supported + ', 충돌 ' + a.contradicted + ', 미결 ' + a.unresolved,
    '· 판정한 명제 중 지지 ' + a.supported + '/' + a.adjudicated + ' (' + a.accuracyPct + '%)',
    '· 판정 완료 ' + a.adjudicated + '/' + a.total + ' (' + a.coveragePct.toFixed(1) + '%)');
}
