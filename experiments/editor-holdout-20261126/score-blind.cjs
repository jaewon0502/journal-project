'use strict';
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const questionOrder = ['en-command', 'ko-wish', 'ko-sales', 'en-recalibration', 'ko-award', 'en-resumed'];
const sourceLengths = {nobel:6, interview:40, nasa:6};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function checkedJSON(file, digest) {
  const bytes = fs.readFileSync(path.join(__dirname, file));
  assert.equal(sha(bytes), digest, file + ' hash mismatch');
  return JSON.parse(bytes);
}
const reference = checkedJSON('key.json', 'd6f28e1b5896376b81d6743b11fbe2d08589aa8b472f216b35c6332c8bac0567');
const answers = checkedJSON('blind-answers.json', 'efa6736c2428b0fa024ddc5425ae2044b1cde317898ca720cb6a15e88d9f216c');
const expectedIds = questionOrder.map((_, i) => 'C' + (i + 1));
assert.deepEqual(answers.map(a => a.id).sort(), expectedIds);
assert.deepEqual(reference.cases.map(c => c.id).sort(), [...questionOrder].sort());

const claims = questionOrder.map(id => reference.cases.find(c => c.id === id));
if (process.argv.length > 3) throw Error('Usage: node score-blind.cjs [private-html-folder]');
if (process.argv[2]) {
  const {load} = require('./pages.cjs');
  const {sources} = load(process.argv[2]);
  const numbered = {};
  for (const [name, rows] of Object.entries(sources)) {
    assert.equal(rows.length, sourceLengths[name]);
    assert.equal(sha(rows.join('\n')), reference.sha256[name]);
    numbered[name] = rows.map((text, i) => ({paragraph:i + 1, text}));
  }
  const input = {claims:claims.map((c, i) => ({id:expectedIds[i], text:c.claim})), sources:numbered};
  assert.equal(sha(JSON.stringify(input, null, 2)), 'fcdf65c99252dd9e6257ec1d5a4199a28bee2575250670ad17c0c4dbf6a78861',
    'Reconstructed input differs from the packet the blind reader saw');
}

const scores = claims.map((claim, i) => {
  const a = answers.find(item => item.id === expectedIds[i]);
  assert(['supported', 'unresolved', 'contradicted'].includes(a.verdict));
  for (const {source, paragraph} of a.citations) {
    assert(Object.hasOwn(sourceLengths, source) && Number.isInteger(paragraph) && paragraph >= 1 && paragraph <= sourceLengths[source]);
  }
  const required = Object.entries(claim.requiredParagraphs).flatMap(([source, rows]) =>
    rows.map(paragraph => ({source, paragraph})));
  const citesAll = required.length > 0 && required.every(r => a.citations.some(c =>
    c.source === r.source && c.paragraph === r.paragraph));
  return {id:a.id, key:claim.id, core:claim.core, expected:claim.referenceJudgment, verdict:a.verdict,
    verdictAgreement:claim.referenceJudgment === a.verdict, citesAll};
});
const supported = scores.filter(c => c.expected === 'supported');
const unresolved = scores.filter(c => c.expected === 'unresolved');
const core = scores.filter(c => c.core);
function tally(items, predicate) {
  return {count:items.filter(predicate).length, total:items.length};
}
console.log(JSON.stringify({
  verdictAgreement:tally(scores, c => c.verdictAgreement),
  verdictAndRequiredCitationsAmongSupported:tally(supported, c => c.verdictAgreement && c.citesAll),
  allRequiredCitationsAmongSupported:tally(supported, c => c.citesAll),
  coreVerdictAgreement:tally(core, c => c.verdictAgreement),
  unresolvedAgreement:tally(unresolved, c => c.verdictAgreement),
  disagreements:scores.filter(c => !c.verdictAgreement).map(({id, key, expected, verdict}) => ({id, key, expected, verdict}))
}, null, 2));
