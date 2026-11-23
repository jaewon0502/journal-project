'use strict';

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const modulePath = process.argv[2];
if (!modulePath || process.argv.length > 3) {
  console.error('Usage: node score.cjs path/to/evidence-finder.js');
  process.exit(2);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const fixtureBytes = readFileSync(path.join(__dirname, 'holdout.json'));
const fixtureHash = sha256(fixtureBytes);
assert.equal(fixtureHash, '14be8517e99104ff7a4d3b7ec4b1344ed3ddfeaa75961c92015898f97f27723a', 'Preregistered fixture changed');
const fixture = JSON.parse(fixtureBytes);
const filename = path.resolve(modulePath);
const finder = require(filename);
const ids = new Set();

const results = fixture.queries.map(({ id, source, query, gold }) => {
  assert(!ids.has(id), 'Duplicate query ID');
  ids.add(id);
  const { lines } = fixture.sources[source];
  assert(lines.every(line => line.trim() && !/[\r\n]/u.test(line)));
  const isParagraph = n => Number.isInteger(n) && n >= 1 && n <= lines.length;
  assert(gold.every(isParagraph), 'Invalid gold paragraph');
  const ranked = finder.find(lines.join('\n'), query);
  assert(Array.isArray(ranked) && ranked.length <= 3, 'Expected at most three candidates');
  const candidates = ranked.map(({ paragraph, text }) => {
    assert(isParagraph(paragraph), 'Out-of-range candidate');
    assert.equal(text, lines[paragraph - 1], 'Candidate text differs from source');
    return paragraph;
  });
  assert.equal(candidates.length, new Set(candidates).size, 'Repeated candidate');
  const index = candidates.findIndex(n => gold.includes(n));
  return { id, gold, candidates, firstGoldRank: index < 0 ? null : index + 1 };
});

const scored = results.filter(row => row.gold.length);
const controls = results.filter(row => !row.gold.length);
const metrics = {
  answerable: scored.length,
  hitAt1: scored.filter(row => row.firstGoldRank === 1).length,
  hitAt3: scored.filter(row => row.firstGoldRank !== null).length,
  controls: controls.length,
  controlsReturningCandidates: controls.filter(row => row.candidates.length).length
};
console.log(JSON.stringify({ fixtureHash, finderHash: sha256(readFileSync(filename)), metrics, results }, null, 2));
