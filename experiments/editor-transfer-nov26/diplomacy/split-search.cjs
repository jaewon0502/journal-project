// Retrospective replay of ordinary search and context previews at equal reading caps.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {editions, sha} = require('./editions.cjs');
const {cases:queries} = require('./queries.json'), ref = require('./reference.json');
const previously = require('./baseline.json').cases;
const [folder, oldDir, revisedDir, check] = process.argv.slice(2);
if (!folder || !oldDir || !revisedDir || ![undefined,'--check'].includes(check)) {
  throw Error('Usage: node split-search.cjs <private-files> <baseline-reader> <revised-reader> [--check]');
}
const data = editions(folder);
for (const [id, rows] of Object.entries(data)) assert.equal(sha(rows.join('\n')), ref.editions[id].sha256);
const fragmentBytes = fs.readFileSync(path.join(__dirname,'fragments.json'));
assert.equal(sha(fragmentBytes),'f7b2171d9ab3d13e2612cb050ad7b22f1c05f6c807b5a65314ee9530cf5b48a9');
const {parts} = JSON.parse(fragmentBytes);
const from = (dir, name) => require(path.join(path.resolve(dir),name));
const old = from(oldDir,'evidence-search.js').search, next = from(revisedDir,'evidence-search.js').search;
const withPhrase = from(revisedDir,'evidence-finder.js').withSourcePhrase;
const rows = from(oldDir,'factcheck-engine.js').prepare(data.mbc.join('\n'),[]).rows;
const methods = ['original','english','appended','assisted','splitEnglish','splitAssisted'];
function roundRobin(groups) {
  const result = [];
  for (let rank = 0; groups.some(group => group.length > rank); rank++) {
    for (const group of groups) if (rank < group.length) result.push(group[rank]);
  }
  return result;
}
function readingList(searches) {
  const sequence = roundRobin(searches.map(result => result.passages.slice(0,3)));
  const distinct = new Map();
  for (const passage of sequence) if (!distinct.has(passage.paragraph)) distinct.set(passage.paragraph,passage);
  const neighbours = [...distinct.values()].map(passage => [...(passage.context || [])].sort((a,b)=>
    Math.abs(a.paragraph-passage.paragraph) - Math.abs(b.paragraph-passage.paragraph) || a.paragraph-b.paragraph));
  for (const neighbor of roundRobin(neighbours)) if (!distinct.has(neighbor.paragraph)) distinct.set(neighbor.paragraph,neighbor);
  return [...distinct.keys()].slice(0,6);
}
const caseResults = queries.map((q,index) => {
  const frozen = previously[index];
  assert.equal(frozen.id,q.id);
  const row = rows[frozen.row-1], key = ref.cases[q.id];
  assert.equal(sha(row.text),frozen.originalQuerySha256);
  const body = data[key.source || ref.sources.mbc].join('\n');
  const allowed = new Set(q.phrase.toLowerCase().split(/\s+/u));
  for (const part of parts[q.id]) for (const word of part.toLowerCase().split(/\s+/u)) {
    assert(allowed.has(word), 'New wording leaked into fragment: ' + word);
  }
  const original = next(body,row.text);
  const merge = phrase => withPhrase(body,row.text,phrase,original);
  const searches = {original:[old(body,row.text)], english:[old(body,q.phrase)], appended:[old(body,row.text + ' ' + q.phrase)],
    assisted:[merge(q.phrase)], splitEnglish:parts[q.id].map(part=>old(body,part)), splitAssisted:parts[q.id].map(merge)};
  return {id:q.id, runs:Object.fromEntries(methods.map(name=>[name,
    {submissions:searches[name].length, selected:readingList(searches[name])}]))};
});
function total(method, cap) {
  const summary = {queries:0,distinctBlocksReviewed:0,supportedComplete:0,supportedBlocks:0,
    contradictedComplete:0,contradictedBlocks:0,unresolvedWithCandidates:0};
  for (const item of caseResults) {
    const {submissions,selected} = item.runs[method], key = ref.cases[item.id], visible = selected.slice(0,cap);
    summary.queries += submissions;
    summary.distinctBlocksReviewed += visible.length;
    if (!key.required.length) {summary.unresolvedWithCandidates += Number(visible.length > 0); continue;}
    const found = key.required.filter(paragraph=>visible.includes(paragraph)).length;
    summary[key.verdict+'Blocks'] += found;
    summary[key.verdict+'Complete'] += Number(found === key.required.length);
  }
  return summary;
}
const result = {fragmentsSha256:sha(fragmentBytes), sample:{claims:6,supported:4,supportedBlocks:9,
  contradicted:1,contradictedBlocks:3,unresolved:1}, caps:Object.fromEntries([3,6].map(cap=>[cap,
    Object.fromEntries(methods.map(method=>[method,total(method,cap)]))])), cases:caseResults};
if (check) {
  assert.deepEqual(result,require('./split-result.json'));
  console.log('Fixed phrase fragments, both reading budgets and all six questions verified.');
} else console.log(JSON.stringify(result,null,2));
