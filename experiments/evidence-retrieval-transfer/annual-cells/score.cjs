'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The evaluator supplies rows and expected coordinates without using the search tool.
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'holdout.json'), 'utf8'));
const reader = path.resolve(process.argv[2] || path.join(__dirname, '../../../docs/reader'));
const search = require(path.join(reader, 'evidence-search.js')).search;
const column = require(path.join(reader, 'evidence-columns.js')).annualMetricCell;
const source = fixture.lines.join('\n');
assert.ok(fixture.lines.length > 2 && fixture.lines.every(line => typeof line === 'string' && line.trim() && !/[\r\n]/u.test(line)));
assert.equal(new Set(fixture.cases.map(item => item.id)).size, fixture.cases.length);
const stats = {answerable:0, firstRow:0, topThreeRow:0, exactCell:0, incorrectCell:0, controls:0, controlsShowingCell:0};
const results = fixture.cases.map(({id, query, expected}) => {
  const {passages} = search(source, query);
  const lines = passages.map(passage => {
    assert.equal(passage.text, fixture.lines[passage.paragraph - 1]);
    return passage.paragraph;
  });
  const cells = passages.map(passage => column?.(source, query, passage)).filter(Boolean);
  if (!expected) {
    stats.controls++;
    if (cells.length) stats.controlsShowingCell++;
  } else {
    const {row, col, value} = expected;
    assert.equal(fixture.lines[row - 1].split('\t')[col - 1], value);
    stats.answerable++;
    if (lines[0] === row) stats.firstRow++;
    if (lines.includes(row)) stats.topThreeRow++;
    const match = cell => cell.rowParagraph === row && cell.column === col && cell.value === value &&
      cell.heading === fixture.lines[0].split('\t')[col - 1] && cell.headerParagraph === 1;
    if (cells.some(match)) stats.exactCell++;
    if (cells.some(cell => !match(cell))) stats.incorrectCell++;
  }
  return {id, candidateRows:lines, cells};
});
assert.equal(stats.answerable, 4);
assert.equal(stats.controls, 2);
console.log(JSON.stringify({stats, results}, null, 2));
