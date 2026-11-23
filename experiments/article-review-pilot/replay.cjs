'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const workspace = require('../../docs/reader/workspace-snapshot.js');
const {compare} = require('../../docs/reader/article-compare-core.js');

const names = ['a-original', 'b-revised', 'c-challenge', 'd-locators', 'e-recheck'];
const snapshots = names.map(name => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, name + '.json'), 'utf8'));
  const snap = workspace.read(data);
  const {accuracy, bias} = snap.assessment;
  assert.equal(snap.demo, true);
  assert.equal(snap.stale, false);
  assert.equal(snap.sourceDraftPending, false);
  assert.equal(accuracy.total, 6);
  assert.equal(accuracy.excluded, 0);
  assert.deepEqual(accuracy.coreRowIds, [snap.rows[0].id]);
  assert.equal(snap.rows[4].receipt.status, 'attribution');
  assert.equal(snap.rows[4].receipt.contentStatus, 'unverified');
  assert.deepEqual(snap.rows[4].receipt.sourceIds, ['debate']);
  assert.equal(bias.assessed, 3);
  assert.equal(bias.items.find(item => item.id === 'standards').rating.level, 'na');

  console.log(name, {supported: accuracy.supported, contradicted: accuracy.contradicted,
    unresolved: accuracy.unresolved, supportPct: accuracy.accuracyPct,
    coveragePct: Number(accuracy.coveragePct.toFixed(1)), coreConflicts: accuracy.coreContradicted.length,
    bias: bias.items.map(item => item.rating.level)});
  return snap;
});

const pairs = snapshots.slice(1).map((right, index) => {
  const left = snapshots[index];
  assert.equal(left.rows[4].text, right.rows[4].text);
  assert.notEqual(left.article, right.article);
  const pair = compare(left, right, 'revision');
  assert.equal(pair.sourceChanged, false);
  assert.equal(pair.bias.paired, 3);
  console.log(names[index] + ' -> ' + names[index + 1], {improved: pair.bias.improved, worsened: pair.bias.worsened});
  return pair;
});
assert.deepEqual(pairs[0].bias.improved, {numerator: 2, denominator: 2, pct: 100});
for (const pair of pairs.slice(1)) {
  assert.deepEqual(pair.bias.improved, {numerator: 0, denominator: 0, pct: null});
  assert.ok(pair.dimensions.every(d => d.left === d.right));
  assert.equal(pair.accuracy.left.accuracyPct, pair.accuracy.right.accuracyPct);
  assert.equal(pair.accuracy.left.coveragePct, pair.accuracy.right.coveragePct);
}
assert.equal(Math.round((249186 - 230028) / 249186 * 1000) / 10, 7.7);

// These are the two specific locations checked in the original PDF for this case.
const exactLocations = snapshots.map(s => [
  s.rows[1].text.includes('‘통계표’ 1번(인쇄 30쪽)'),
  s.rows[2].text.includes('‘통계표’의 12번(인쇄 41쪽)')
].filter(Boolean).length);
assert.deepEqual(exactLocations, [0, 0, 0, 2, 2]);
console.log('본문에 통계표 편과 인쇄 쪽을 명시한 인용', exactLocations);

if (process.argv[2]) {
  const pdf = path.resolve(process.argv[2]);
  const {createHash} = require('node:crypto');
  const {execFileSync} = require('node:child_process');
  const expectedSHA = '4af225ac4646818f2bd10f4346c35a139081696db6bc3df9bc2fe003c8a018a2';
  assert.equal(createHash('sha256').update(fs.readFileSync(pdf)).digest('hex'), expectedSHA);
  function page(n) {
    return execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '-layout', pdf, '-'], {encoding: 'utf8'});
  }
  const contents = page(3);
  assert.match(contents, /□ 통계표 .*28/);
  assert.match(contents, /◇ 부\s*록/);
  assert.match(contents, /출생 통계 작성 개요 .*43/);
  assert.match(page(7), /\[표 1\] 출생아 수/);
  assert.match(page(15), /\[표 12\] 다태아 출생/);
  const national = page(33), local = page(44);
  assert.match(national, /2022\s+249,186\s+4\.9\s+0\.78/);
  assert.match(national, /2023\s+230,028\s+4\.5\s+0\.72/);
  assert.match(national, /- 30 -/);
  assert.match(local, /12\. 시군구별 출생아 수 및 합계출산율/);
  assert.match(local, /전국\s+230,028\s+0\.72/);
  assert.match(local, /서울특별시\s+39,456\s+0\.55/);
  assert.match(local, /- 41 -/);
  console.log('원본 PDF 대조 완료 · 목차의 통계표·부록 구분, 중복 표제와 인쇄 30·41쪽 원자료 행');
}
