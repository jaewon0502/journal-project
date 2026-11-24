// Reuse exactly the same article questions for every reader and unit condition.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const data = require('./fixture.json');
const variants = require('./variants.json');
const reader = path.resolve(process.argv[2] || path.join(__dirname, '../../../docs/reader'));
const {search} = require(path.join(reader, 'evidence-search.js'));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'fixture.json'))).digest('hex'),
  variants.fixtureSha256);

function lookup(lines, query) {
  const result = search(lines.join('\n'), query);
  const originals = lines.filter(line => line.trim());
  for (const hit of result.passages) {
    assert.equal(hit.text, originals[hit.paragraph - 1]);
    for (const near of hit.context || []) assert.equal(near.text, originals[near.paragraph - 1]);
  }
  return result;
}
for (const variant of variants.variants) {
  const original = data.documents[variant.document].lines;
  const lines = [...variant.prefixLines, ...original];
  const totals = {questions:0, first:0, top3:0, exactAmount:0, coordinateWithUnitWarning:0, unexpectedHint:0};
  for (const c of data.cases.filter(c => c.kind === 'cell' && c.document === variant.document)) {
    totals.questions++;
    const r = lookup(lines, c.query);
    const expectedRow = c.expected.row + variant.prefixLines.length;
    const index = r.passages.findIndex(p => p.paragraph === expectedRow);
    if (index === 0) totals.first++;
    if (index >= 0 && index < 3) totals.top3++;
    for (const p of r.passages) {
      const cue = p.fiscalCell || p.fiscalNavigation || p.matrixCell || p.datedCell;
      if (!cue || !cue.column) continue;
      const correct = p.paragraph === expectedRow && cue.column === c.expected.col && cue.value === c.expected.value &&
        cue.heading === original[0].split('\t')[c.expected.col - 1];
      if (correct && p.fiscalCell && variant.expectedAction === 'exact-cell' &&
          cue.unit === variant.expectedUnit && !r.gap) totals.exactAmount++;
      else if (correct && p.fiscalNavigation && variant.expectedAction === 'row-and-unit-warning' &&
          !cue.unit && /단위/u.test(r.gap || '')) totals.coordinateWithUnitWarning++;
      else totals.unexpectedHint++;
    }
  }
  console.log(variant.id, JSON.stringify(totals));
}

for (const c of data.cases.filter(c => c.kind !== 'cell')) {
  const r = lookup(data.documents[c.document].lines, c.query);
  console.log(c.id, JSON.stringify({first:r.passages[0]?.paragraph ?? null, warned:Boolean(r.gap),
    cellHints:r.passages.filter(p => p.fiscalCell || p.fiscalNavigation?.column || p.matrixCell || p.datedCell).length}));
}
for (const name of ['settlement','adoption']) {
  const lines = fs.readFileSync(path.join(__dirname, name + '-layout.txt'), 'utf8').split('\n');
  const totals = {questions:0, first:0, namedRowWithWarning:0, cellHints:0};
  for (const c of data.cases.filter(c => c.kind === 'cell' && c.document === name)) {
    const r = lookup(lines,c.query);
    const label = data.documents[name].lines[c.expected.row - 1].split('\t')[0];
    const hit = r.passages[0];
    totals.questions++;
    if (hit?.text.trim().split(/\s{2,}/u)[0] === label) totals.first++;
    if (hit?.fiscalNavigation?.rowLabel === label && /원표/u.test(r.gap || r.notice || '')) totals.namedRowWithWarning++;
    totals.cellHints += r.passages.filter(p => p.fiscalCell || p.fiscalNavigation?.column || p.matrixCell || p.datedCell).length;
  }
  console.log(name + '-layout',JSON.stringify(totals));
}
