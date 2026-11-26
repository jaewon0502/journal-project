// Rebuild the two blind packets. The original six translated claims and their order are frozen.
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const previous = '../editor-holdout-20261126/';
const {load} = require(previous + 'pages.cjs');
const reference = require(previous + 'key.json');
const oldAnswers = require(previous + 'blind-answers.json');
const {cases} = reference;
const folder = process.argv[2];
if (!folder) throw Error('Usage: node score-dated.cjs <original-holdout-html-folder>');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serialize = data => JSON.stringify(data, null, 2);
const answersBytes = fs.readFileSync(path.join(__dirname,'dated-answers.json'));
assert.equal(sha(answersBytes),'aef60f6ad96476d8095ff83edb103d219122ddd8db5f0a9b923fbf55fd6d0485');
const answers = JSON.parse(answersBytes);
const ordered = ['en-command','ko-wish','ko-sales','en-recalibration','ko-award','en-resumed'].map(id=>cases.find(c=>c.id===id));
const {sources} = load(folder);
const packet = {claims:ordered.map((c,i)=>({id:'C'+(i+1),text:c.claim})),
  sources:Object.fromEntries(Object.entries(sources).map(([id,rows])=>[id,rows.map((text,i)=>({paragraph:i+1,text}))]))};
assert.equal(sha(serialize(packet)),'fcdf65c99252dd9e6257ec1d5a4199a28bee2575250670ad17c0c4dbf6a78861');
const dom = new JSDOM('',{runScripts:'outside-only'});
dom.window.eval(fs.readFileSync(path.join(__dirname,'../../docs/reader/web-document.js'),'utf8'));
const {web} = dom.window.JournalWebDocument.parse(fs.readFileSync(path.join(folder,'nasa.html'),'utf8'));
dom.window.close();
packet.pageMetadata = {nasa:{published:web.published,modified:web.modified}};
assert.equal(sha(serialize(packet)),'92592bc8240d6020613b33ca1c826f0cd52895e21f03cf1315f561138572d0cf');
function score(entries) {
  assert.deepEqual(entries.map(e=>e.id).sort(),packet.claims.map(c=>c.id));
  const rows = ordered.map((c,i)=>{
    const e = entries.find(item=>item.id===packet.claims[i].id);
    assert(['supported','contradicted','unresolved'].includes(e.verdict));
    for (const ref of e.citations) assert(sources[ref.source]?.[ref.paragraph-1]);
    for (const meta of e.metadata || []) assert(packet.pageMetadata[meta.source]?.[meta.field]);
    const agreed = e.verdict===c.referenceJudgment;
    const cited = Object.entries(c.requiredParagraphs).every(([source,positions])=>
      positions.every(paragraph=>e.citations.some(ref=>ref.source===source && ref.paragraph===paragraph)));
    return {agreed,cited,supported:c.referenceJudgment==='supported',core:c.core};
  });
  return {verdicts:rows.filter(r=>r.agreed).length,total:rows.length,core:rows.filter(r=>r.core&&r.agreed).length,
    supportedWithEvidence:rows.filter(r=>r.supported&&r.cited&&r.agreed).length};
}
assert(answers.find(a=>a.id==='C6').metadata.some(m=>m.source==='nasa'&&m.field==='published'));
const result={bodyOnly:score(oldAnswers),withPublisherDates:score(answers)};
assert.deepEqual(result,{bodyOnly:{verdicts:5,total:6,core:1,supportedWithEvidence:3},
  withPublisherDates:{verdicts:6,total:6,core:2,supportedWithEvidence:4}});
console.log(JSON.stringify(result));
