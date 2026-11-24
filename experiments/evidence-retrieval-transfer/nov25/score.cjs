const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixturePath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, 'holdout.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const reader = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../../../docs/reader');
const {search} = require(path.join(reader, 'evidence-search.js'));
const sourceLines = process.argv[4] ? fs.readFileSync(process.argv[4], 'utf8').replace(/\r?\n$/u, '').split(/\r?\n/u) : fixture.lines;
assert.equal(sourceLines.length, fixture.lines.length);
assert.ok(sourceLines.every(line => typeof line === 'string' && line.trim() && !/[\r\n]/u.test(line)));
assert.equal(new Set(fixture.cases.map(item => item.id)).size, fixture.cases.length);
const document = sourceLines.join('\n');
let positive = 0, first = 0, topThree = 0;
const results = fixture.cases.map(({id, query, expectedLine}) => {
  const {passages, gap, state, notice} = search(document, query);
  assert.ok(passages.length <= 3);
  const lines = passages.map(hit => {
    assert.equal(hit.text, sourceLines[hit.paragraph - 1], '추천한 문단과 원문이 일치해야 합니다.');
    return hit.paragraph;
  });
  if (expectedLine === null) return {id, expectedLine, candidates: lines, coverageNotice: gap, state};
  assert.ok(Number.isInteger(expectedLine) && expectedLine >= 1 && expectedLine <= fixture.lines.length);
  positive++;
  if (lines[0] === expectedLine) first++;
  if (lines.includes(expectedLine)) topThree++;
  return {id, expectedLine, candidates: lines, rank: lines.includes(expectedLine) ? lines.indexOf(expectedLine) + 1 : null,
    ...(notice && {notice})};
});
assert.equal(positive, 4);
assert.equal(results.length - positive, 1);
console.log(JSON.stringify({positive, first, topThree, results}, null, 2));
