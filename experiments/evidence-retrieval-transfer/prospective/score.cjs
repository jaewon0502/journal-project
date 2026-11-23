'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const read = name => path.resolve(__dirname, name);
const fixturePath = read('holdout.json');
const fixtureHash = sha(fixturePath);
assert.equal(fixtureHash, '09b371de9a1371825fcfb84213d93c7fc2a81afd8063680069eaf6859861f4a3');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const { sources, queries } = fixture;

if (process.argv.length !== 5) {
  console.error('Usage: node score.cjs candidate-file expected-candidate-sha256 expected-sibling-period-sha256');
  process.exit(2);
}
const candidateFile = path.resolve(process.argv[2]);
const baselineFile = read('../baseline-finder.cjs');
const periodFile = path.join(path.dirname(candidateFile), 'evidence-period.js');
const baselineHash = sha(baselineFile);
const candidateHash = sha(candidateFile);
const periodHash = sha(periodFile);
assert.equal(baselineHash, '90921959ada13a036f5ad1e1051f1bc25ed0f1b80a8aca4501f10090167af86e');
assert.equal(candidateHash, process.argv[3]);
assert.equal(periodHash, process.argv[4]);

assert.equal(Object.keys(sources).length, 2);
assert.equal(new Set(queries.map(row => row.id)).size, 8);
assert.equal(queries.length, 8);
for (const [source, { lines }] of Object.entries(sources)) {
  assert(lines.every(line => line.trim() && !/[\r\n]/u.test(line)));
  const group = queries.filter(q => q.source === source);
  assert.equal(group.length, 4);
  assert.equal(group.filter(q => q.gold.length).length, 3);
  for (const q of group) {
    assert(q.gold.every(n => Number.isInteger(n) && n >= 1 && n <= lines.length));
  }
}

function scoreEngine(file) {
  const { find } = require(file);
  return queries.map(({ id, source, gold, query }) => {
    const { lines } = sources[source];
    const hits = find(lines.join('\n'), query);
    assert(Array.isArray(hits) && hits.length <= 3);
    const candidates = hits.map(({ paragraph, text }) => {
      assert(Number.isInteger(paragraph) && paragraph >= 1 && paragraph <= lines.length);
      assert.equal(text, lines[paragraph - 1], 'Source excerpt or location changed');
      return paragraph;
    });
    assert.equal(new Set(candidates).size, candidates.length);
    const firstGoldRank = candidates.findIndex(n => gold.includes(n)) + 1 || null;
    return { id, source, gold, candidates, firstGoldRank };
  });
}

function metrics(rows) {
  const positives = rows.filter(row => row.gold.length);
  const controls = rows.filter(row => !row.gold.length);
  return {
    answerable: positives.length,
    hitAt1: positives.filter(row => row.firstGoldRank === 1).length,
    hitAt3: positives.filter(row => row.firstGoldRank !== null).length,
    controls: controls.length,
    controlsWithCandidates: controls.filter(row => row.candidates.length).length,
    controlsWithNoCandidates: controls.filter(row => !row.candidates.length).length
  };
}

function summarize(rows) {
  const perSource = Object.fromEntries(Object.keys(sources).map(source => [
    source, metrics(rows.filter(row => row.source === source))
  ]));
  return { overall: metrics(rows), perSource, rows };
}

const baseline = summarize(scoreEngine(baselineFile));
const candidate = summarize(scoreEngine(candidateFile));
console.log(JSON.stringify({ fixtureHash, baselineHash, candidateHash, periodHash, baseline, candidate }, null, 2));
