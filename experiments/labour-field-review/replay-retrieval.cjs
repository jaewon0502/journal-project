'use strict';

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const gold = require('./transfer-gold.json');
const retry = require('./transfer-retry.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [textPath, candidatePath] = process.argv.slice(2);
if (!textPath) {
  console.error('사용법: node replay-retrieval.cjs 고용동향-layout.txt [비교할-검색기.cjs]');
  process.exit(1);
}
const text = readFileSync(textPath, 'utf8');
assert.equal(hash(text), gold.textSha256, '사전에 고정한 PDF의 -layout 추출문을 사용하세요.');
assert.equal(hash(readFileSync(path.join(__dirname, 'transfer-gold.json'))), retry.originalGoldSha256);
const pages = [null];
let page = 1;
for (const line of text.split(/\r\n|[\n\r\u2028\u2029]/u)) {
  page += line.split('\f').length - 1;
  if (line.trim()) pages.push(page);
}

function ranks(find, tasks) {
  let direct = 0;
  for (const {id, query} of tasks) {
    const {targets} = gold.tasks.find(task => task.id === id);
    const matches = paragraph => targets[pages[paragraph]]?.includes(paragraph);
    const results = find(text, query, {includeContext: true});
    const centre = results.findIndex(hit => matches(hit.paragraph)) + 1;
    const context = results.findIndex(hit => hit.context?.some(other => matches(other.paragraph))) + 1;
    if (centre) direct++;
    const locations = results.map(hit => pages[hit.paragraph] + '쪽/' + hit.paragraph + '행');
    console.log(id, locations.join(', '), '중심 행 순위', centre || '없음', '주변 행 순위', context || '없음');
  }
  console.log('중심 행 적중 ' + direct + '/' + tasks.length);
}

const baseline = require.resolve('../evidence-retrieval-pilot/baseline-finder.cjs');
assert.equal(hash(readFileSync(baseline)), 'f5bf97dfc93c866bdc6a0660923d9dc99055575b475aa785f4c3677ffb7bdf91');
const candidate = candidatePath ? path.resolve(candidatePath) : require.resolve('../../docs/reader/evidence-finder.js');
for (const [name, file] of [['개선 전', baseline], ['비교 검색기', candidate]]) {
  console.log(name, hash(readFileSync(file)));
  console.log('첫 검색');
  ranks(require(file).find, gold.tasks);
  console.log('실패 두 문항의 1회 재검색');
  ranks(require(file).find, retry.tasks);
}
