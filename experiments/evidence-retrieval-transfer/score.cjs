'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const fixtures = {
  '': ['holdout.json', 'dd857b5953ad13d8203bc1b3eb414a7a64688e724c16c1f7dd740e29ea26b09e'],
  '--second': ['second/holdout.json', '26eb0623ebfd042a24fbf3bde19e88a81f578118d8222abcc33f22e1829f381c'],
  '--third': ['third/holdout.json', '602e38135903a93a899a445f2e054e2830b3b805326922bd8d4885bb13a67928']
};
const option = process.argv[3] || '';
if (!Object.hasOwn(fixtures, option) || process.argv.length !== (option ? 4 : 3)) {
  console.error('Usage: node score.cjs path/to/evidence-finder.js [--second|--third]');
  process.exit(2);
}
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const [fixtureName, expectedHash] = fixtures[option];
const file = path.join(__dirname, fixtureName);
const fixtureHash = sha(file);
assert.equal(fixtureHash, expectedHash);
const { sources, queries } = require(file);
assert.equal(new Set(queries.map(q => q.id)).size, queries.length);
const modulePath = path.resolve(process.argv[2]);
const engine = require(modulePath);
const rows = queries.map(({ id, source, query, gold }) => {
  const lines = sources[source].lines;
  assert(lines.every(line => line.trim() && !/[\r\n]/u.test(line)));
  assert(gold.every(n => Number.isInteger(n) && n > 0 && n <= lines.length));
  const hits = engine.find(lines.join('\n'), query);
  assert(Array.isArray(hits) && hits.length <= 3);
  const candidates = hits.map(({ paragraph, text }) => {
    assert(Number.isInteger(paragraph) && paragraph >= 1 && paragraph <= lines.length);
    assert.equal(text, lines[paragraph - 1], 'Candidate excerpt does not match its source row');
    return paragraph;
  });
  assert.equal(new Set(candidates).size, candidates.length);
  const rank = candidates.findIndex(n => gold.includes(n)) + 1;
  return { id, source, gold, candidates, firstGoldRank: rank || null };
});
const positive = rows.filter(row => row.gold.length);
const controls = rows.filter(row => !row.gold.length);
const metrics = {
  answerable: positive.length,
  hitAt1: positive.filter(row => row.firstGoldRank === 1).length,
  hitAt3: positive.filter(row => row.firstGoldRank !== null).length,
  controls: controls.length,
  controlsWithCandidates: controls.filter(row => row.candidates.length).length,
  controlsWithNoCandidates: controls.filter(row => !row.candidates.length).length
};
console.log(JSON.stringify({ fixtureHash, finderHash: sha(modulePath), metrics, rows }, null, 2));
