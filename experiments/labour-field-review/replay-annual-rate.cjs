'use strict';
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const {search} = require('../../docs/reader/evidence-search.js');
const {textSha256} = require('./transfer-gold.json');

if (!process.argv[2]) throw Error('고용동향 PDF에서 추출한 전체 layout.txt 경로를 지정하세요.');
const text = readFileSync(process.argv[2],'utf8');
assert.equal(createHash('sha256').update(text).digest('hex'),textSha256);
const cases = [
  ['2024년 연간 청년층(15~29세) 실업률이 0.4%p 올랐다는 주장은 맞나?',809,813],
  ['2024년 연간 청년층(15~29세) 실업률은 몇 퍼센트인가?',809,813],
  ['2024년 12월 청년층(15~29세) 실업률은 전년동월보다 몇 퍼센트포인트 올랐나?',104,108],
  ['2024년 연간 청년층 고용률은?',809,811],
  ['2024년 연간 15~64세 고용률은?',809,810],
  ['2024년 연간 실업률은?',809,812],
  ['2024년 연간 청년층 경제활동참가율은?'],
  ['2024년 3분기 청년층 실업률은?'],
  ['2024년 한 해 청년층(15~29세) 실업률이 0.4%p 올랐다는 주장은 맞나?',809,813],
  ['청년층(15~29세) 실업률은 2024년 한 해 동안 전년보다 오르지 않았나?',809,813],
  ['2024년 한 해 청년층(15~29세) 여성의 실업률은 0.4%p 올랐나?'],
  ['2024년 연평균 청년층(15~29세) 실업률이 0.4%p 올랐다는 주장은 맞나?'],
  ['2024년에는 청년 실업률이 0.4%p 올랐나?']
];
for (const [query,heading,paragraph] of cases) {
  const {passages,gap} = search(text,query);
  if (paragraph) {
    assert.equal(gap,null,query);
    assert.deepEqual(passages.map(row => [row.context[0].paragraph,row.paragraph]),[[heading,paragraph]],query);
    console.log(query, '→', heading, '/', paragraph, passages[0].text.trim());
  } else {
    assert.deepEqual(passages,[],query);
    assert.ok(gap,query);
    console.log(query, '→', gap);
  }
}
