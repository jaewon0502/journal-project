'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const fixtureFile = path.join(__dirname, 'holdout.json');
const fixtureSha = sha(fixtureFile);
assert.equal(fixtureSha, '5b509ff0d910320f33806afca105bd2abf23ed84e33bef9c757f063173b7823c');
const {claims, bundles, slotIds, orders, prefixes} = JSON.parse(readFileSync(fixtureFile, 'utf8'));
assert.equal(claims.length, 8);
assert.equal(claims.filter(claim => claim.gold).length, 6);
if (process.argv.length !== 6) {
  console.error('Usage: node score.cjs baseline.js expected-sha256 candidate.js expected-sha256');
  process.exit(2);
}

function checkedEngine(file, expectedSha) {
  file = path.resolve(file);
  assert.equal(sha(file), expectedSha);
  return require(file);
}

function observe(engine, claim, order, prefix) {
  const docKeys = new Map();
  const sources = order.map((index, slot) => {
    const {key, ...document} = bundles[claim.bundle][index];
    const id = slotIds[slot];
    docKeys.set(id, key);
    return { ...document, id, url: 'https://source-order.invalid/' + id };
  });
  const result = engine.prepare(prefix + claim.text, sources);
  assert.equal(result.rows.length, 1, 'Expected a single claim row for ' + claim.id);
  const row = result.rows[0];
  const toKey = id => {
    assert(docKeys.has(id), 'Unrecognized source ID ' + id);
    return docKeys.get(id);
  };
  const recommended = row.sourceMatches.map(m => toKey(m.id));
  const opened = row.sourceIds.length ? toKey(row.sourceIds[0]) : null;
  assert.equal(new Set(recommended).size, recommended.length);
  return { recommended, opened };
}

function score(engine) {
  const rows = [];
  for (const claim of claims) {
    for (const [rotation, order] of orders.entries()) {
      for (const [label, prefix] of Object.entries(prefixes)) {
        const {recommended, opened} = observe(engine, claim, order, prefix);
        rows.push({id: claim.id, gold: claim.gold, rotation, label, recommended, opened});
      }
    }
  }
  const canonical = rows.filter(r => r.label === 'neutral' && !r.rotation);
  const answerable = rows.filter(r => r.gold);
  const canonicalAnswerable = canonical.filter(r => r.gold);
  const canonicalControls = canonical.filter(r => !r.gold);
  const positiveClaims = claims.filter(c => c.gold);
  const first = r => r.recommended[0] ?? null;
  const correct = r => first(r) === r.gold;
  const allCorrect = positiveClaims.filter(c => rows.filter(r => r.id === c.id).every(correct));
  let labelChanges = 0;
  for (const r of rows.filter(r => r.label === 'party-a')) {
    const other = rows.find(s => s.label === 'party-b' && s.id === r.id && s.rotation === r.rotation);
    if (first(r) !== first(other)) labelChanges++;
  }
  const controls = subset => ({
    controls: subset.length,
    noRecommendation: subset.filter(r => !r.recommended.length).length,
    soleRecommendation: subset.filter(r => r.recommended.length === 1).length,
    multipleRecommendations: subset.filter(r => r.recommended.length > 1).length,
    defaultOpened: subset.filter(r => r.opened).length
  });
  const metrics = {
    answerableClaims: positiveClaims.length, robustHitAt1: allCorrect.length,
    canonicalHitAt1: canonicalAnswerable.filter(correct).length,
    canonicalHitAnywhere: canonicalAnswerable.filter(r => r.recommended.includes(r.gold)).length,
    correctRepeatedPresentations: answerable.filter(correct).length,
    repeatedAnswerablePresentations: answerable.length,
    partyPairFirstRecommendationChanges: labelChanges,
    partyPairComparisons: claims.length * orders.length,
    firstRecommendationDiffersFromOpened: rows.filter(r => first(r) !== r.opened).length,
    allPresentations: rows.length,
    canonicalControls: controls(canonicalControls),
    repeatedControls: controls(rows.filter(r => !r.gold))
  };
  return { metrics, rows };
}

const [baselineFile, baselineSha, candidateFile, candidateSha] = process.argv.slice(2);
const baseline = checkedEngine(baselineFile, baselineSha);
const candidate = checkedEngine(candidateFile, candidateSha);
console.log(JSON.stringify({
  fixtureSha, baselineSha, candidateSha, baseline: score(baseline), candidate: score(candidate)
}, null, 2));
