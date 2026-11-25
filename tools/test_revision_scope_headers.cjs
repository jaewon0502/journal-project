const {test} = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../docs/reader/factcheck-engine.js');
const {matchRevisionRows} = require('../docs/reader/article-compare-core.js');

const margin = '올해 수치를 집계했다.';
const rate = '고용률은 62.7%였다.';
const total = '항목별 합계는 120이다.';
const foot = '표 설명은 끝났다.';

function compareRows(before, after) {
  const left = engine.prepare(before.join('\n')), right = engine.prepare(after.join('\n'));
  const historical = [new Map(), new Map(), new Map()];
  const current = matchRevisionRows(left, right, ...historical);
  return (text, occurrence = 0) => {
    const original = left.rows.filter(row => row.text === text)[occurrence];
    const revised = right.rows.filter(row => row.text === text)[occurrence];
    assert.ok(original && revised, text);
    return [current, ...historical].map(map => {
      if (!map.has(original.id)) return false;
      assert.equal(map.get(original.id), revised.id, '올바른 수정 행을 가리켜야 한다.');
      return true;
    });
  };
}
const stillPaired = [true, false, false, false];
const withheldSinceV8 = [false, true, true, true];
const neverPaired = [false, false, false, false];

test('통계 표제의 대상·분모·단위·기간·출처 변경, 삽입, 삭제는 떨어진 같은 수치를 다시 대조한다', () => {
  const fixtures = [
    ['조사 대상: 15세 이상 전체', '조사 대상: 15~64세', rate],
    ['분모: 응답자 전체', '분모: 유효 응답자', '찬성 비율은 과반이었다.'],
    ['집계 단위: 만 원', '집계 단위: 억 원', total],
    ['기준 기간: 1분기', '기준 기간: 1~3분기', total],
    ['표본 규모: 100명', '표본 규모: 150명', '| 서울 | 30 |'],
    ['자료 출처: 가 기관의 확정표', '자료 출처: 나 기관의 잠정표', rate],
    ['다음 수치는 시범사업 참여자만을 대상으로 한다.', '다음 수치는 전체 주민을 대상으로 한다.', rate]
  ];
  for (const [from, to, fact] of fixtures) {
    const body = [margin, fact, foot];
    for (const [before, after] of [[[from, ...body], [to, ...body]], [[from, ...body], body], [body, [to, ...body]]]) {
      assert.deepEqual(compareRows(before, after)(fact), withheldSinceV8);
    }
  }
});

test('다른 표제가 추가돼도 기존 차이를 기억하고, 같은 항목을 다시 지정하면 그 지점부터 비교한다', () => {
  const body = ['집계 단위: 명', margin, rate, '첫 집계 설명이다.', '조사 대상: 전국 성인',
    '다음 조사를 집계했다.', rate, '두 번째 표본이다.'];
  const check = compareRows(['조사 대상: 서울 시민', ...body], ['조사 대상: 부산 시민', ...body]);
  assert.deepEqual(check(rate, 0), withheldSinceV8);
  assert.deepEqual(check(rate, 1), stillPaired);
});

test('같은 값의 간격·구분기호와 독립적인 표제 순서는 통계를 바꾸지 않는다', () => {
  const body = [margin, total, foot];
  const before = ['집계 단위: 만 원', '조사 대상: 전체  가구', ...body];
  const after = [' 조사대상 ： 전체 가구 ', '집계단위: 만원', ...body];
  assert.deepEqual(compareRows(before, after)(total), stillPaired);
});

test('표 안의 표제는 다음 표와 표 밖의 서술로 넘어가지 않고 표 밖의 공통 기준은 상속된다', () => {
  const body = ['표 1. 시범 사업', '분모: 실제 방문자', margin, rate, '첫 표의 주석.',
    '[표 2] 정규 사업', '정규 사업 현황이다.', total, '별도 지표다.', '[표 끝]',
    '종합 지표를 발표했다.', '응답률은 90%였다.', foot];
  const changed = body.map(line => line.replace('실제 방문자', '초청자 전체'));
  const local = compareRows(body, changed);
  assert.deepEqual(local(rate), withheldSinceV8);
  assert.deepEqual(local(total), stillPaired);
  assert.deepEqual(local('응답률은 90%였다.'), stillPaired);
  const shared = compareRows(['조사 대상: 청년', ...body], ['조사 대상: 전체', ...body]);
  assert.deepEqual(shared(rate), withheldSinceV8);
  assert.deepEqual(shared(total), withheldSinceV8);
  assert.deepEqual(shared('응답률은 90%였다.'), withheldSinceV8);
  const table = ['표 1. 지역별 인구', '집계 단위: 명', margin, '서울 250', foot];
  assert.deepEqual(compareRows(table, table.map(line => line.replace('단위: 명', '단위: 천 명')))('서울 250'), withheldSinceV8);
});

test('통계와 관계없는 문장, 날짜만 있는 사건과 본문 속 표제 모양 문구는 기존 자동 대응을 유지한다', () => {
  const date = '회의는 2026년 5월 2일에 열렸다.', event = '위원회가 회의록을 공개했다.';
  const body = [margin, date, event, foot, rate, '마지막 설명이다.'];
  const check = compareRows(['조사 대상: 청년', ...body], ['조사 대상: 전체', ...body]);
  assert.deepEqual(check(date), stillPaired);
  assert.deepEqual(check(event), stillPaired);
  assert.deepEqual(compareRows(['안내문에 “조사 대상: 청년”을 썼다.', ...body],
    ['안내문에 “조사 대상: 전체”를 썼다.', ...body])(rate), stillPaired);
});

test('대명사·인용 제한과 바로 옆 문맥에서 탈락한 링크는 그 링크를 허용했던 과거 버전에만 추가한다', () => {
  for (const [text, maps] of [
    ['그 수치는 30%였다.', neverPaired],
    ['“청년 고용률은 70%였다.”', [false, true, false, false]],
    ['“청년 고용률은 70%였다”라고 강조했다.', [false, true, true, false]]
  ]) {
    const body = [margin, text, foot];
    assert.deepEqual(compareRows(['조사 대상: 서울', ...body], ['조사 대상: 부산', ...body])(text), maps);
  }
  assert.deepEqual(compareRows(['조사 대상: 서울', rate, foot], ['조사 대상: 부산', rate, foot])(rate), neverPaired);
});
