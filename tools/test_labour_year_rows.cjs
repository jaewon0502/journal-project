const {test} = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');

// Public December and annual 2024 employment release, PDF p.42 (printed 37).
// Retain the nested header, annual field order, quarterly distractor and definition.
const header = ['1. 전체 경제활동인구 총괄','(단위: 천명)',
  '15세 이상 인구                           경제활동 고용률', '1)', '실업률2)',
  '경 제 활 동 인 구          비 경 제 참 가 율', '취업자     실업자 활동인구         (%)   (%)               (%)'];
const earlier = '  2023       45,407 29,203  28,416    787   16,204   64.3 62.6            2.7';
const current = '  2024       45,570 29,399  28,576    823   16,172   64.5 62.7            2.8';
const quarter = '2024.1/4     45,523   29,020    28,060     960    16,503   63.7   61.6    3.3   (2.8)';
const month = '2023.    1   45,352   28,387    27,363   1,024    16,965   62.6   60.3    3.6   (2.9)';
const footnote = '주: 1) 취업자/15세이상인구×100';
const lines = [...header,earlier,current,quarter,month,footnote,'2) 실업자/경제활동인구×100'];
const question = '2024년 연간 15세 이상 고용률은 2023년보다 얼마나 올랐나?';
const doc = lines.join('\r\n');

test('연간 행 두 개와 분모 각주를 원문 그대로 묶고 분기·월 행을 발췌에서 제외한다', () => {
  for (const q of [question,question.replace('얼마나','몇 퍼센트포인트'),question.replace('연간','한 해 동안')]) {
    const {passages,gap,notice} = search(doc,q);
    assert.equal(gap,null);
    assert.equal(passages.length,1);
    const [hit] = passages;
    assert.deepEqual(hit.labourYearRows,{previous:2023,current:2024,measure:'고용률'});
    assert.equal(hit.text,current);
    assert.deepEqual(hit.context.map(row=>row.text),[...header,earlier,footnote]);
    assert.deepEqual(hit.context.map(row=>row.paragraph),[1,2,3,4,5,6,7,8,12]);
    assert.match(notice,/차이\(%p\).*상대 변화율\(%\)/u);
  }
});

test('두 연도·연간 기간·대상·같은 쪽 표의 구조와 분모를 확인하지 못하면 보류한다', () => {
  const abstains = (text,q=question,extra) => {
    const {passages,gap} = search(text,q,extra);
    assert.deepEqual(passages,[],q); assert.ok(gap,q);
  };
  for (const q of [question.replace('연간','12월'),question.replace('연간','3분기'),
    question.replace('15세 이상','15~64세'),question.replace('15세 이상','여성 15세 이상'),
    question.replace('얼마나','전월보다 얼마나'),question.replace('2023년','2020년')]) abstains(doc,q);
  abstains(doc,question,{articleContext:'서울의 남성으로 범위를 좁혔다.'});
  for (const bad of [doc.replace(footnote,''),doc.replace(footnote,'\f'+footnote),
    doc.replace(footnote,footnote.replace('15세이상인구','경제활동인구')),
    doc.replace(earlier,''),doc.replace(current,quarter),doc.replace(current,current+'\n'+current),
    doc.replace(earlier,earlier.replace('   64.3','')).replace(current,current.replace('   64.5','')),
    doc.replace(header[2],'여성 '+header[2]),doc+'\n'+doc]) abstains(bad);
});
