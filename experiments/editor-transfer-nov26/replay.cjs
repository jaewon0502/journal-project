// Compare direct passage coordinates in the actual production search functions.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [folder, baselineReader, sample, mode, readerDirectory, expectedFile = 'result.json'] = process.argv.slice(2);
const samples = {
  initial: {directory:__dirname, hash:'b9deddec0d3cbc601b633fe027ee16db12f4a2d1386627f42069cfa3e22b8dd6'},
  prose: {directory:path.join(__dirname, 'prose'), hash:'6d1273356081e5d5467591a972a1559279ecf85fee18ae1ec011183eb83fda32'},
  diplomacy: {directory:path.join(__dirname,'diplomacy'), hash:'cc4b0321aa108da15fc6b19bc6c04d31c5884476fa3fb9ee6b47ffcda5224260'}
};
if (!folder || !baselineReader || !Object.hasOwn(samples, sample) || !['baseline', 'compare', 'check'].includes(mode) ||
    !['result.json', 'result-retest.json'].includes(expectedFile))
  throw Error('Usage: node replay.cjs <private-html-folder> <baseline-docs/reader> initial|prose|diplomacy baseline|compare|check [candidate-docs/reader] [result.json|result-retest.json]');
const dataset = samples[sample].directory;
const bytes = filename => fs.readFileSync(path.join(dataset, filename));
const {editions, sha} = require(path.join(dataset, 'editions.cjs'));
const queries = JSON.parse(bytes('queries.json')), reference = JSON.parse(bytes('reference.json'));
assert.equal(sha(bytes('queries.json')), reference.querySha256);
assert.equal(sha(bytes('editions.cjs')), reference.extractorSha256);
const referenceHash = sha(bytes('reference.json'));
assert.equal(referenceHash, samples[sample].hash);
const currentReader = fs.realpathSync(readerDirectory || path.resolve(__dirname, '../../docs/reader'));
const snapshot = fs.realpathSync(baselineReader);
assert.notEqual(snapshot, currentReader, 'Extract the immutable baseline to a separate directory');
const pages = editions(folder);
for (const [id, paragraphs] of Object.entries(pages)) {
  assert.equal(paragraphs.length, reference.editions[id].paragraphs, 'Paragraph count changed: ' + id);
  assert.equal(sha(paragraphs.join('\n')), reference.editions[id].sha256, 'Edition changed: ' + id);
}
function prepareRows(directory) {
  const {prepare} = require(path.join(directory, 'factcheck-engine.js'));
  return Object.fromEntries(Object.keys(queries.articles).map(id => [id, prepare(pages[id].join('\n'), []).rows]));
}
const rows = prepareRows(snapshot);
const currentRows = mode === 'baseline' ? null : prepareRows(currentReader);
const baseline = require(path.join(snapshot, 'evidence-search.js')).search;
const current = mode === 'baseline' ? null : require(path.join(currentReader, 'evidence-search.js')).search;
const finder = mode === 'baseline' ? null : require(path.join(currentReader, 'evidence-finder.js'));
function selected(query, rowSet) {
  const paragraph = reference.cases[query.id].articleParagraph - 1;
  const body = pages[query.article];
  const offset = body[paragraph].indexOf(query.anchor);
  assert(offset >= 0 && offset === body[paragraph].lastIndexOf(query.anchor));
  const start = body.slice(0, paragraph).reduce((sum, line) => sum + line.length + 1, 0) + offset;
  const end = start + query.anchor.length;
  const matches = rowSet[query.article].filter(row => row.positions.some(span => span.start <= start && span.end >= end));
  assert.equal(matches.length, 1, 'Article row changed: ' + query.id);
  return matches[0];
}
const firstThree = result => result.passages.slice(0, 3).map(p => p.paragraph);
function moduleDigest(directory) {
  const files = Object.keys(require.cache).filter(filename => filename.startsWith(directory + path.sep))
    .map(filename => path.relative(directory, filename)).sort();
  assert(files.includes('factcheck-engine.js') && files.includes('evidence-search.js'), 'Loaded module provenance missing');
  const names = files.map(name => [name, sha(fs.readFileSync(path.join(directory, name)))]);
  return {files:files.length, sha256:sha(JSON.stringify(names))};
}
const cases = queries.cases.map(query => {
  const row = selected(query, rows);
  assert.equal(row.status, 'pending');
  const source = reference.cases[query.id].source || reference.sources[query.article];
  const text = pages[source].join('\n');
  const outcome = {id:query.id, row:rows[query.article].indexOf(row) + 1, originalQuerySha256:sha(row.text),
    original:firstThree(baseline(text, row.text)), manual:firstThree(baseline(text, query.phrase))};
  if (current) {
    outcome.append = firstThree(baseline(text, row.text + ' ' + query.phrase));
    const next = selected(query, currentRows);
    assert.equal(next.text, row.text);
    assert.equal(next.status, 'pending');
    const original = current(text, row.text);
    outcome.currentOriginal = firstThree(original);
    outcome.assisted = firstThree(finder.withSourcePhrase(text, row.text, query.phrase, original));
  }
  return outcome;
});
function tally(method) {
  const counts = {supported:{n:0,top1:0,top3:0}, partialOrScope:{n:0,top1:0,top3:0},
    unresolved:{n:0,anyCandidate:0}};
  for (const row of cases) {
    const {verdict, required} = reference.cases[row.id];
    const hits = row[method];
    if (verdict === 'unresolved') {
      counts.unresolved.n++;
      if (hits.length) counts.unresolved.anyCandidate++;
    } else {
      if (verdict === 'contradicted' && !counts.contradicted) counts.contradicted = {n:0,top1:0,top3:0};
      const group = verdict === 'contradicted' ? counts.contradicted
        : verdict === 'supported' ? counts.supported : counts.partialOrScope;
      group.n++;
      for (const k of [1,3]) if (required.every(p => hits.slice(0,k).includes(p))) group['top'+k]++;
    }
  }
  return counts;
}
const base = {referenceHash, baselineModules:moduleDigest(snapshot), methods:{original:tally('original'), manual:tally('manual')},
  cases: cases.map(({id, row, originalQuerySha256, original, manual}) => ({id, row, originalQuerySha256, original, manual}))};
if (mode === 'baseline') {
  console.log(JSON.stringify(base, null, 2));
} else {
  assert.deepEqual(base, JSON.parse(bytes('baseline.json')), 'Baseline changed');
  const result = {referenceHash, baselineResultSha256:sha(bytes('baseline.json')), currentModules:moduleDigest(currentReader),
    methods:{manualAppend:tally('append'), currentOriginal:tally('currentOriginal'), assisted:tally('assisted')},
    cases:cases.map(({id, append, currentOriginal, assisted}) => ({id, append, currentOriginal, assisted}))};
  if (mode === 'check') {
    assert.deepEqual(result, JSON.parse(bytes(expectedFile)), 'Updated search no longer matches these observations');
    console.log('Frozen editions and all baseline/assisted outcomes verified.');
  } else console.log(JSON.stringify(result, null, 2));
}
