'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');

// Synthetic values intentionally repeat across periods, metrics and cohorts.
const lines = [
  '  2021년 9월 고용동향(요약)',
  ' □ 실업률은 3.1%로 전년동월대비 0.2%p 상승',
  ' ○ 청년층(15~29세) 실업률은 7.1%로 전년동월대비 0.3%p 상승',
  '\f 2021년 연간 고용동향(요약)',
  ' □ 15~64세 고용률은 61.2%로 전년대비 0.3%p 상승',
  ' ○ 청년층(15~29세) 고용률은 44.3%로 전년대비 0.3%p 하락',
  ' □ 실업률은 3.1%로 전년대비 0.2%p 하락',
  ' ○ 청년층(15~29세) 실업률은 7.1%로 전년과 동일',
  ' □ 15세 이상 경제활동참가율은 63.2%로 전년대비 0.3%p 상승',
];
const doc = lines.join('\r\n');
const annual = '2021년 연간 청년층(15~29세) 실업률이 0.3%p 올랐다는 주장은 맞나?';
const monthly = '2021년 09월 15∼29세 청년 실업률은 전년동월보다 몇 퍼센트포인트 올랐나?';
function expectGap(text, query, options) {
  const result = search(text, query, options);
  assert.deepEqual(result.passages, [], query);
  assert.ok(result.gap, query);
}

test('잘못 주장한 변동폭보다 기간·대상·지표를 우선하고 원문 머리글을 보존한다', () => {
  for (const [query, head, para] of [
    [annual,4,8], [monthly,1,3], ['2021년 연간 청년 실업률은 몇 퍼센트인가?',4,8],
    ['2021년 연간 실업률은?',4,7], ['2021년 연간 15~29세 고용률은?',4,6],
    ['2021년 연간 15~64세 고용률은?',4,5], ['2021년 연간 15세 이상 경제활동참가율은?',4,9],
  ]) {
    const {passages, gap} = search(doc,query);
    assert.equal(gap,null,query);
    assert.deepEqual(passages.map(hit => hit.paragraph),[para],query);
    assert.equal(passages[0].labourScope,true);
    assert.equal(passages[0].text,lines[para-1]);
    assert.deepEqual(passages[0].context,[{paragraph:head,text:lines[head-1]}]);
  }
});

test('모르는 연도·분기·비교 기준·추가 조건과 누락된 대상에는 다른 행을 제시하지 않는다', () => {
  for (const query of ['2022년 연간 청년 실업률은?', '2021년 10월 청년 실업률은?',
    '2021년 3분기 청년층 실업률은?', '2021년 연간 20~34세 청년 실업률은?',
    '2021년 연간 서울 청년 실업률은?', '2021년 연간 청년 실업률은 남성에서 얼마인가?',
    '2021년 연간 청년층 경제활동참가율은?', '2021년 연간 청년 실업률은 전년동월보다 얼마나 올랐나?',
    '2021년 9월 청년 실업률은 전월보다 얼마나 올랐나?']) expectGap(doc,query);
  expectGap(lines.slice(0,3).join('\n'),annual);
  expectGap(doc,annual,{articleContext:'서울에 거주하는 여성 청년만 대상으로 했다.'});
  expectGap(lines[3]+'\n'+lines[2],annual);
});

test('충돌하는 보고서와 다른 장·쪽·지역의 수치가 같은 범위로 병합되지 않는다', () => {
  expectGap(doc+'\n'+lines[3]+'\n'+lines[7].replace('7.1','5.4'),annual);
  for (const boundary of ['\f', '서울 지역 수치', '□ 서울 지역 고용동향', '2021년 3분기 고용동향']) {
    expectGap([lines[3],boundary,lines[7]].join('\n'),annual);
  }
  const count = ' ○ 청년층(15~29세) 실업자는 7만 1천 명으로 전년과 동일';
  expectGap(lines[3]+'\n'+count,annual);
  const other = search('2021년 연간 조사 결과\n'+lines[7],annual);
  assert.equal(other.labourScope,undefined);
});
