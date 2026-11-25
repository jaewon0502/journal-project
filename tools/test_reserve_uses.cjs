const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {search} = require('../docs/reader/evidence-search.js');
const dir = path.join(__dirname, '../experiments/cross-party-review');
const table = fs.readFileSync(path.join(dir, 'reserve-uses-layout.txt'), 'utf8');
const article = require('../experiments/cross-party-review/blind-workspace.json').article.split('\n').at(-1);
const relief = '2019년 재해대책비에 예비비 6,692억 원을 썼다.';

test('기사에서 특정 용도로 쓴 금액을 물으면 용도별 표의 합계를 표시하고 실제 용도는 미확인으로 둔다', () => {
  const result = search(table, article), [hit] = result.passages;
  assert.deepEqual([hit.reserveUse.rowLabel, hit.reserveUse.matchedPurpose, hit.reserveUse.spent, hit.reserveUse.decided],
    ['합계', false, '26,901', '27,230']);
  assert.deepEqual(hit.reserveUse.exampleUses, [{label:'재해대책비',spent:'6,654'}, {label:'법적의무지출 미지급금 등',spent:'6,024'}]);
  assert.match(result.notice, /이름이 같은 행을 찾지 못/);
  const excerpt = [...hit.context, hit].sort((a,b) => a.paragraph - b.paragraph).map(row => row.text).join('\n');
  assert.equal(excerpt, table.slice(0, table.indexOf('자료:')).trimEnd());
  assert.ok(excerpt.includes('재해대책비') && excerpt.includes('영유아보육료지원'));
  assert.ok(!hit.fiscalCell);
});

test('원문에 명시된 용도는 질문에 적힌 금액과 관계없이 그 행에서 지출액과 지출결정액을 각각 읽는다', () => {
  for (const query of [relief, relief.replace('6,692','6,654')]) {
    const [hit] = search(table, query).passages;
    assert.deepEqual([hit.reserveUse.rowLabel, hit.reserveUse.matchedPurpose, hit.reserveUse.spent, hit.reserveUse.decided],
      ['재해대책비', true, '6,654','6,692']);
  }
  const child = search(table, '2019년 예비비 중 영유아보육료 지원에 712억 원을 지출했다.').passages[0].reserveUse;
  assert.equal(child.rowLabel, '영유아보육료지원');
  const reordered = table.replace('지출결정액       지출액','지출액       지출결정액');
  assert.equal(search(reordered,relief).passages[0].reserveUse.spent, '6,692');
});

test('쪽이 갈리거나 단위·열·합계·연도·인용 범위가 맞지 않으면 용도별 셀 표시를 보류한다', () => {
  const unavailable = [
    table.replace('지출결정액', '지출액'), table.replace('단위: 억원', '단위: %'),
    table.replace('    - 재해대책비','\f    - 재해대책비'), table.replace(' 6,654 ','   '),
    table.replace('  합 계  ', '  누계  '),table.replace(/자료:.*$/mu,'주: 일부 금액은 천원 단위'),
    table.replace('- 재해대책비', '- 재해대책비(제주)'), table.replace('영유아보육료지원','재해대책비'),
    table + '\n' + table, table.replace('2019회계연도 예비비 사용명세별','2020회계연도 예비비 사용명세별'),
  ];
  for (const altered of unavailable) assert.ok(!search(altered, relief).passages.some(hit => hit.reserveUse?.matchedPurpose));
  for (const q of [relief.replace('2019년', '2020년'), relief.replace('2019년', '2018~2019년'),
    relief.replace('재해대책비에','특별회계 재해대책비에'), relief.replace('썼다','지출하기로 결정했다')]) {
    assert.ok(!search(table, q).passages.some(hit => hit.reserveUse));
  }
  assert.ok(!search(table, relief, {articleContext:'이 중 특정 지역만 조사했다.'}).passages.some(hit => hit.reserveUse));
});


test('기사 안의 지출 사례만 대조하고 나머지 주장이나 금액이 섞이면 구절을 선택하게 한다', () => {
  const query = article + ' 사례를 들어 새로운 대응이 필요하다고 강조했다.';
  const located = search(table, query);
  assert.equal(located.passages[0].reserveUse.clause, article);
  assert.equal(located.passages[0].reserveUse.spent, '26,901');
  for (const rest of ['2020년에는 다른 용도에 4억원을 썼다고 강조했다.', '당시 지출이 없었다고 반박했다.', '감액은 잠정적이라는 답변을 내놓았다.']) {
    const choice = search(table, article + ' 전례를 들며 ' + rest);
    assert.equal(choice.reserveUseChoice, article);
    assert.deepEqual(choice.passages, []);
    assert.equal(search(table, choice.reserveUseChoice).passages[0].reserveUse.spent, '26,901');
  }
});
