const test = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');
const {find} = require('../docs/reader/evidence-finder.js');
const frozen = require('../experiments/evidence-retrieval-transfer/grain-consumption/first-pass.freeze.json');

// Keep the official caption and header tiers, with the total and three rows
// from table 6. The production benchmark separately searches the entire PDF.
const headers = ['[표6] 업종별 쌀 소비량', '(  단위: 톤, %)', '2022   2023   2024',
  '업 종', '소비량 구성비 소비량 구성비 소비량 구성비 증감률'];
const total = '사업체부문 쌀 소비량(계)    691,422 100.0 817,122 100.0 873,363 100.0 6.9';
const food = '식료품 제조업(10)   515,894 74.6 558,064 68.3 584,612 66.9 4.8';
const beverage = '음료 제조업(11)   175,528 25.4 259,057 31.7 288,751 33.1 11.5';
const child = '떡류 제조업(10711)   185,079 26.8 214,041 26.2 199,766 22.9 -6.7';
const document = [...headers, total, food, child, '․', beverage].join('\n');
const query = frozen.cases.find(c => c.id === 'food-manufacturing').query;

function first(source, question) {
  return search(source, question).passages[0];
}

test('오보의 합계·올바른 값·생소한 값 모두 표의 동일 업종을 첫 근거로 찾는다', () => {
  for (const question of [query, query.replace('6.9%', '4.8%').replace('5만6242', '2만6548').replace('87만3363', '58만4612'),
    query.replace('6.9%', '21.0%').replace('87만3363', '80만1234')]) {
    const hit = first('제조업(식료품 및 음료)부문 쌀 소비량은 87만 3,363톤으로 전년대비 6.9% 증가\n' + document, question);
    assert.equal(hit.text, food);
    assert.ok(headers.every(text => hit.context.some(item => item.text === text)));
    assert.deepEqual(Object.keys(hit).sort(), ['context', 'matched', 'paragraph', 'text']);
  }
});

test('모업종·하위 업종·다른 업종·명시적인 합산 행을 서로 바꾸지 않는다', () => {
  const combined = total.replace('사업체부문 쌀 소비량(계)', '식료품 및 음료 제조업');
  const table = document.replace(total, combined);
  for (const [subject, expected] of [['식료품 제조업', food], ['떡류 제조업', child],
    ['음료제조업', beverage], ['식료품 및 음료 제조업', combined]]) {
    const question = '2024년 ' + subject + '의 쌀 소비량은 584612톤이었다.';
    assert.equal(first('다른 기사에는 2024년 쌀 소비량은 584612톤이었다.\n' + table, question).text, expected);
  }
});

test('다른 산업·품목·연도·단위·행 순서에서도 출처의 표기를 따른다', () => {
  const gas = '가스 공급업(352)   120 85 128 80 140 70 9.4';
  const electric = '전기 공급업(351)   20 15 32 20 60 30 87.5';
  const other = ['[표 31] 산업별 연료 사용량', '산 업    2028년 2029년 2030년', '(단위: 개, %)',
    '사용량 구성비 사용량 구성비 사용량 구성비 증감률', gas, electric].join('\n');
  const claim = '2030년 전기 공급업의 연료 사용량은 140개였다.';
  assert.equal(first('보도에서 2030년 연료 사용량은 140개였다.\n' + other + '\n' + document, claim).text, electric);
});

test('조건·단위·지표·연도가 맞지 않거나 행이 중복되면 표를 지정하지 않는다', () => {
  const plain = '식료품 제조업 쌀 소비량은 873363톤이었다.';
  const cases = [
    [document, '서울 ' + plain], [document, '2030년 ' + plain],
    [document, plain.replace('톤', 'kg')], [document, plain.replace('톤', '%')],
    [document, plain.replace('쌀', '밀')],
    [document, plain.replace('톤이었다', '톤/업체였다')], [document, plain.replace('식료품 제조업', '유기농 식료품 제조업')],
    [document, plain.replace('식료품 제조업', '식료품 및 음료 제조업')],
    [document, plain.replace('식료품 제조업', '음료 및 식료품 제조업')],
    [document, plain.replace('이었다', ' 중 서울에서 소비됐다')],
    [document, '2023년 ' + query], [document + '\n' + document, plain],
    [document.replace(headers[0], headers[0] + ' (서울)'), plain],
    [document.replace(headers[1], '\f' + headers[1]), plain],
    [document.replace(headers[4], '소비량 구성비'), plain],
  ];
  for (const [table, question] of cases) {
    const documentWithReference = '검토할 기사 문장 ' + question + '\n' + table;
    assert.match(first(documentWithReference, question).text, /^검토할 기사 문장/u, question);
  }
});

test('별도 기사 문맥이 조건을 추가하면 업종 행의 우선순위를 올리지 않는다', () => {
  const reference = '검토할 기사 문장 ' + query;
  const text = reference + '\n' + document;
  assert.equal(search(text, query, {articleContext:'서울 사업체만 포함'}).passages[0].text, reference);
  assert.equal(search(text, query, {articleContext:query}).passages[0].text, food);
});

test('범위를 지정하면 전체 원문 중 허용한 행을 먼저 거른 다음 세 후보를 고른다', () => {
  const text = ['쌀 소비량은 50톤이었다.', '쌀 소비량은 50톤이었다.', '쌀 소비량은 50톤이었다.',
    '부산 사업체의 쌀 소비량은 43톤이었다.', '부산 사업체의 쌀 소비량은 45톤이었다.'].join('\n');
  const question = '쌀 소비량은 50톤이었나?';
  assert.deepEqual(find(text, question).map(p => p.paragraph), [1, 2, 3]);
  assert.deepEqual(find(text, question, {passageFilter:line => line.includes('부산')}).map(p => p.paragraph), [4, 5]);
  assert.deepEqual(find(text, question, {passageFilter:() => false}), []);
});
