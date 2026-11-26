'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {load, sha} = require('./pages.cjs');
const {prepare} = require('../../docs/reader/factcheck-engine.js');
const {search} = require('../../docs/reader/evidence-search.js');

const dir = __dirname;
const [folder, command] = process.argv.slice(2);
if (!folder || ![undefined, '--check'].includes(command))
  throw Error('Usage: node replay.cjs <private-html-folder> [--check]');
const keyFile = fs.readFileSync(path.join(dir, 'key.json'));
const keyHash = sha(keyFile);
assert.equal(keyHash, 'd6f28e1b5896376b81d6743b11fbe2d08589aa8b472f216b35c6332c8bac0567', 'Frozen key changed');
const key = JSON.parse(keyFile);
assert.equal(sha(fs.readFileSync(path.join(dir, 'pages.cjs'))), key.extractorSha256, 'Extraction rules changed');
const {articles, sources} = load(folder);
for (const [id, rows] of Object.entries({...articles, ...sources}))
  assert.equal(sha(rows.join('\n')), key.sha256[id], 'Edition changed: ' + id);

const runs = {};
for (const [id, paragraphs] of Object.entries(articles)) {
  const article = paragraphs.join('\n');
  const prepared = prepare(article, []);
  const document = key.documents[id].flatMap(source => sources[source]).join('\n');
  const sourceCoordinates = key.documents[id].flatMap(source => sources[source].map((_, i) => source + '/' + (i + 1)));
  runs[id] = {paragraphs, rows:prepared.rows, document, sourceCoordinates};
}

const cases = key.cases.map(target => {
  const {paragraphs, rows, document, sourceCoordinates} = runs[target.article];
  const index = target.articleParagraph - 1;
  const preceding = paragraphs.slice(0, index).reduce((length, p) => length + p.length + 1, 0);
  const offset = paragraphs[index].indexOf(target.anchor);
  const start = preceding + offset, end = start + target.anchor.length;
  const candidates = rows.filter(row => row.positions.some(p => p.start <= start && p.end >= end));
  const unique = offset >= 0 && offset === paragraphs[index].lastIndexOf(target.anchor) && candidates.length === 1;
  const row = unique ? candidates[0] : null;
  const direct = row ? search(document, row.text, {articleContext:row.text}).passages : [];
  const firstThree = direct.slice(0, 3).map(hit => sourceCoordinates[hit.paragraph - 1]);
  assert(firstThree.every(Boolean), 'Search coordinate not found in frozen edition');
  if (row) {
    // The normal UI also permits leaving the optional context blank.
    const defaults = search(document, row.text).passages.slice(0, 3).map(hit => sourceCoordinates[hit.paragraph - 1]);
    assert.deepEqual(defaults, firstThree, 'Default UI and frozen query contexts disagree');
  }
  const reference = Object.entries(target.requiredParagraphs).flatMap(([source, indexes]) => indexes.map(i => source + '/' + i));
  const fullHit = k => reference.length ? reference.every(p => firstThree.slice(0, k).includes(p)) : null;
  return {id:target.id, article:target.article, core:target.core, referenceJudgment:target.referenceJudgment,
    readerRow:row ? rows.indexOf(row) + 1 : null, querySha256:row ? sha(row.text) : null,
    rowStatus:row?.status ?? null, firstThree, required:reference, hitAt1:fullHit(1), hitAt3:fullHit(3)};
});

const supported = cases.filter(c => c.referenceJudgment === 'supported');
const unresolved = cases.filter(c => c.referenceJudgment === 'unresolved');
const result = {
  keySha256:keyHash,
  articleRows:Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, v.rows.length])),
  totals:{
    selected:cases.length, located:cases.filter(c => c.readerRow !== null).length,
    referenceSupported:supported.length, referenceUnresolved:unresolved.length,
    coreSupported:supported.filter(c => c.core).length,
    fullHitAt1:supported.filter(c => c.hitAt1).length, fullHitAt3:supported.filter(c => c.hitAt3).length,
    coreFullHitAt3:supported.filter(c => c.core && c.hitAt3).length,
    unresolvedWithAnyCandidate:unresolved.filter(c => c.firstThree.length).length
  },
  cases
};
if (command === '--check') {
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'result.json')));
  assert.deepEqual(result, saved, 'Reader outputs differ from the recorded run');
  console.log('Frozen editions and all six recorded outcomes verified.');
} else {
  console.log(JSON.stringify(result, null, 2));
}
