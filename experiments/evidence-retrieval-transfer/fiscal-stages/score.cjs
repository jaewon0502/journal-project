// Run against a fixed git archive or the current reader. Only source text and query
// reach the reader; the answer key is used afterwards to score the returned rows.
const assert = require('node:assert/strict');
const path = require('node:path');
const fixture = require('./fixture.json');
const reader = path.resolve(process.argv[2] || path.join(__dirname, '../../../docs/reader'));
const {search} = require(path.join(reader, 'evidence-search.js'));
const totals = {stage:0, first:0, top3:0, gap:0, warned:0, warnedEmpty:0, ordinary:0, ordinaryFirst:0};

for (const item of fixture.cases) {
  const {lines} = fixture.documents[item.document];
  const {passages, gap} = search(lines.join('\n'), item.query);
  for (const {text, paragraph} of passages) assert.equal(text, lines[paragraph - 1], item.id);
  const order = passages.map(p => p.paragraph);
  totals[item.kind]++;
  if (item.kind === 'stage') {
    totals.first += Number(!gap && order[0] === item.expectedParagraph);
    totals.top3 += Number(order.slice(0, 3).includes(item.expectedParagraph));
  } else if (item.kind === 'gap') {
    totals.warned += Number(Boolean(gap));
    totals.warnedEmpty += Number(Boolean(gap) && !order.length);
  } else {
    totals.ordinaryFirst += Number(!gap && order[0] === item.expectedParagraph);
  }
  console.log(item.id, JSON.stringify({order, gap}));
}
console.log(JSON.stringify(totals));
