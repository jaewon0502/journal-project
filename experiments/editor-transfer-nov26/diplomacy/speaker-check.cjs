// Retrospective check on the long, already-scored MBC quotation, without changing its query.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {editions,sha} = require('./editions.cjs');
const [folder, baselineDir, revisedDir, speakerFile, check] = process.argv.slice(2);
if (!folder || !baselineDir || !revisedDir || !speakerFile || ![undefined,'--check'].includes(check)) {
  throw Error('Usage: node speaker-check.cjs <private-raw> <base-reader> <revised-reader> <speaker-module-js> [--check]');
}
const id = 'palestinian-quote';
const reference = require('./reference.json');
const question = require('./queries.json').cases.find(row => row.id === id);
const expected = require('./result-retest.json').cases.find(row => row.id === id);
const oldCase = require('./baseline.json').cases.find(row => row.id === id);
const data = editions(folder);
const source = data.un24.join('\n');
assert.equal(sha(source),reference.editions.un24.sha256);
const row = require(path.resolve(baselineDir,'factcheck-engine.js')).prepare(data.mbc.join('\n'),[]).rows[oldCase.row-1];
assert.equal(sha(row.text),oldCase.originalQuerySha256);
const search = require(path.resolve(revisedDir,'evidence-search.js')).search;
const original = search(source,row.text);
const result = require(path.resolve(revisedDir,'evidence-finder.js')).withSourcePhrase(source,row.text,question.phrase,original);
const passages = result.passages.slice(0,3);
assert.deepEqual(passages.map(p=>p.paragraph),expected.assisted);
const file = path.resolve(speakerFile);
const previews = require(file).englishSpeakerContexts(source,passages);
const [header, speech] = reference.cases[id].required;
const within = (p, value) => p.context.some(r => r.paragraph === value);
const record = {
  id, speakerFileSha256:sha(fs.readFileSync(file)), required:{header,speech}, evidenceBlocksApart:speech-header,
  querySubmissions:1, direct:passages.map(p=>p.paragraph), baselineSpeechDirect:passages.some(p=>p.paragraph===speech),
  baselineHeaderDirect:passages.some(p=>p.paragraph===header),
  baselineHeaderInAnyCandidateContext:passages.some(p=>within(p,header)),
  eligibleForOptionalPreview:result.state==='ordinary' && !result.gap && !result.transcript,
  surfacedPreviews:[...previews.values()].map(p=>({header:p.startParagraph,paragraph:p.paragraph,label:p.label})),
  speakerAndSpeechPreview:!!previews.get(speech) && previews.get(speech).startParagraph===header,
  optionalPreviewsAvailableToOpen:previews.size
};
if (check) {
  const {speakerFileSha256:originalHash,...first} = require('./speaker-result.json');
  const {speakerFileSha256:testedHash,...rerun} = record;
  assert.deepEqual(rerun,first);
  console.log('Political speech attribution verified against speaker module ' + testedHash +
    (testedHash === originalHash ? ' (same edition).' : ' (different edition; matching outcomes).'));
}
else console.log(JSON.stringify(record,null,2));
