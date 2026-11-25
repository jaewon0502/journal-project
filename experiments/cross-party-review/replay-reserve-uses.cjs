// Recheck the selected newspaper passage and two fixed control queries on the complete report.
const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const path = require('node:path');
const {search} = require(process.argv[3] ? path.resolve(process.argv[3]) : '../../docs/reader/evidence-search.js');
const layout = readFileSync(process.argv[2], 'utf8');
const expectedLayout = 'ef15991254435a89993415a2670371c6a9c759f8e71b77e268ace43bb334218b';
if (createHash('sha256').update(layout).digest('hex') !== expectedLayout) throw new Error('결산 원문 판본과 추출 방식을 확인하세요.');
const paper = require('./blind-workspace.json').article.split('\n').at(-1);
const cases = [
  {query:paper, expected:1483},
  {query:'2019년 재해대책비에 예비비 6,692억 원을 썼다.', expected:1473},
  {query:'2019년 예비비 중 영유아보육료 지원에 712억 원을 지출했다.', expected:1478}
];
const rows = cases.map(c => {
  const {passages} = search(layout, c.query), item = passages[0]?.reserveUse;
  return {query:c.query, expected:c.expected, candidates:passages.slice(0,3).map(p => p.paragraph),
    expectedRowFirst:passages[0]?.paragraph === c.expected, decisionAmount:item?.decided ?? null,
    spentAmount:item?.spent ?? null, purposeRowSelected:item?.matchedPurpose ?? null};
});
console.log(JSON.stringify(rows,null,2));
