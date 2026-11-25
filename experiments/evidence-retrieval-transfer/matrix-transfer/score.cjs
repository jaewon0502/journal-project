'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Run the same extraction and coordinate checks against any archived reader.
const reader = path.resolve(process.argv[2]);
const input = JSON.parse(fs.readFileSync(path.join(__dirname, 'holdout.json'), 'utf8'));
const {search} = require(path.join(reader, 'evidence-search.js'));
const columns = require(path.join(reader, 'evidence-columns.js'));
const documentText = input.lines.join('\n');
const headers = input.lines[0].split('\t');
assert.ok(headers[0].trim() && headers.length > 2);
assert.ok(input.lines.every(line => !/[\r\n\f]/u.test(line) && line.split('\t').length === headers.length));
assert.equal(input.cases.length, 6);
assert.equal(new Set(input.cases.map(item => item.id)).size, 6);
assert.equal(input.cases.filter(item => item.expected).length, 4);

function displayedCells(passage, query) {
  const cues = [];
  const raw = input.lines[passage.paragraph - 1].split('\t');
  const add = (kind, cell, rowLabel, heading, physicalColumn) => cues.push({
    kind, row:cell.rowParagraph, header:cell.headerParagraph, col:physicalColumn,
    rowLabel, heading, value:cell.value
  });
  if (passage.matrixCell) {
    const c = passage.matrixCell;
    add('matrix', c, c.rowLabel, c.heading, c.column);
  }
  const annual = columns.inspectAnnualRow(documentText, query, passage)?.metric;
  if (annual) add('annual', annual, raw[0], annual.heading, annual.column);
  const byYear = columns.forRow(documentText, query, passage);
  if (byYear) {
    // This fixture has exactly one stub followed by year columns.
    for (const c of byYear.cells) {
      const physicalColumn = c.column + 1;
      add('year', {...byYear, value:c.value}, raw[0], headers[physicalColumn - 1], physicalColumn);
    }
  }
  return cues;
}

const stats = {answerable:0, firstRow:0, topThreeRow:0, exactCell:0, incorrectCell:0,
  controls:0, controlsShowingCell:0};
const results = input.cases.map(({id, query, expected}) => {
  const {passages} = search(documentText, query);
  const top = passages.slice(0, 3);
  for (const p of passages) assert.equal(p.text, input.lines[p.paragraph - 1]);
  const rows = top.map(p => p.paragraph);
  const cues = passages.flatMap(p => displayedCells(p, query));
  if (expected) {
    stats.answerable++;
    const {row, col, value} = expected;
    assert.ok(row > 1 && col > 1);
    const data = input.lines[row - 1].split('\t');
    assert.equal(data[col - 1], value);
    const exact = c => c.header === 1 && c.row === row && c.col === col && c.heading === headers[col - 1] &&
      c.rowLabel === data[0] && c.value === value;
    if (rows[0] === row) stats.firstRow++;
    if (rows.includes(row)) stats.topThreeRow++;
    if (cues.some(exact)) stats.exactCell++;
    if (cues.some(c => !exact(c))) stats.incorrectCell++;
  } else {
    stats.controls++;
    if (cues.length) stats.controlsShowingCell++;
  }
  return {id, candidateRows:rows, cues};
});
console.log(JSON.stringify({stats, results}, null, 2));
