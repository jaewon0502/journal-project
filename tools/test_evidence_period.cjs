const {test} = require('node:test');
const assert = require('node:assert/strict');
const {different, requestedPeriod} = require('../docs/reader/evidence-period.js');

const row = date => ({text: date + '   45.2    197', paragraph: 1, context: []});

test('날짜와 시각이 함께 적힌 첫 셀은 표에 인쇄된 연도와 월로 읽는다', () => {
  const previous = {requested: '2024년 2월', source: '2024년 1월'};
  for (const stamp of ['2024-01-31 00:00:00', '2024-01-31T23:59:59.999999-09:00',
    '2024-01-31T23:59Z', '2024-01-31T12:15:30+0900', '2024/1/31 9:05',
    '2024. 1. 31.', '2024년 1월 31일']) {
    assert.deepEqual(different('2024년 2월 지수 45.2', row(stamp)), previous, stamp);
  }
  assert.deepEqual(different('2024년 2월 지수 45.2', {text:'| 2023-12-31T23:59:59Z | 45.2 |', context:[]}),
    {requested:'2024년 2월', source:'2023년 12월'});
  assert.deepEqual(different('2024-03-01T00:00:00Z 지수 45.2', {text:'2024-02-29 23:59:59,45.2,197',context:[]}),
    {requested:'2024년 3월', source:'2024년 2월'});
  assert.equal(different('2024년 2월 지수 45.2', row('2024-02-29 23:59:59-14:00')),null);
});

test('잘못된 일시와 기간·식별번호·발표문은 연월 불일치를 표시하지 않는다', () => {
  for (const bad of ['2023-02-29', '2024-04-31', '2024-13-01', '2024-02-00',
    '2024-01/12', '2024-01-123', '2023년 2월 29일', '2024년 13월', '2024-02-01 25:00:00',
    '2024-02-01T14:60:00', '2024-02-01T15:15:60Z', '2024-02-01 14:15:3',
    '2024-02-01T12:15:30+14:10', '2024-02-01T12:15:30+09:99',
    '2024-02-01T12:15:30.1234567891', '2024-02-01T월말', '2024-02-01.123', '시리얼 2024-02-01T12:15:30']) {
    assert.equal(different('2022년 1월 지수 45.2', row(bad)),null,bad+' 후보');
  }
  for (const q of ['2023-02-29 지수', '2024-02-01 24:55 지수', '2024-02-01XYZ 수치', '2024년 13월 지수', '2024-03-01 전월 대비 지수',
    '2024-03-01~2024-03-15 지수']) assert.equal(different(q,row('2024-01-01')),null,q);
  const q='2024년 2월 지수 45.2';
  assert.equal(different(q,row('2024-01-01 ~ 01-15')),null);
  assert.equal(different(q,{text:'2023,500   312',paragraph:2,context:[{text:'2022,500   143',paragraph:1}]}),null);
  assert.equal(different(q,{text:'2024-01-01T00:00:00 당시 수치는 45.2였다.'}),null);
});

test('첫 칸의 적용기간과 요청한 연·월·일이 완전히 어긋날 때 두 끝점을 그대로 보여 준다', () => {
  const interval = row("’23.10.01 ~'24.01.31");
  for (const [query, label] of [['2025년 요금', '2025년'], ['2024년 2월 요금', '2024년 2월'],
    ['2023년 9월 30일 요금', '2023년 9월 30일']]) {
    assert.deepEqual(different(query, interval),{requested:label,source:"’23.10.01 ~ '24.01.31"});
  }
  for (const q of ['2023년 요금','2024년 요금','2023년 10월 요금','2024년 1월 요금',
    '2023년 10월 1일 요금','2024년 1월 31일 요금', '1923년 12월 요금','2123년 12월 요금',
    '2024년 전년 대비 요금', '2023년과 2024년 요금']) assert.equal(different(q,interval),null,q);
  const midMonth = {text:'| 2024-01-10 – 2024-01-20 | 8,235원 |'};
  assert.equal(different('2024년 1월 이용료',midMonth),null);
  assert.equal(different('2024년 1월 20일 이용료',midMonth),null);
  assert.deepEqual(different('2024년 1월 21일 이용료',midMonth),
    {requested:'2024년 1월 21일',source:'2024-01-10 ~ 2024-01-20'});
  assert.ok(different('2022년 요금',row("2023년 1월 1일 - 2024년 12월 31일")));
  assert.ok(different('2024년 2월 요금',{text:'2024-01-15   72   -   3'}));
  assert.equal(different('2024년 요금',{text:"'23.01.01 ~'23.12.31 동안 접수된 민원 2 건을 기록했다."}),null);
});

test('축약된 세기와 중첩·역전·불완전한 기간은 안전하게 처리한다', () => {
  assert.equal(different('2000년 1월 요금',row("'99.12.15 ~ '00.01.15")),null);
  assert.equal(different('1900년 1월 요금',row("'99.12.15 ~ '00.01.15")),null);
  assert.ok(different('2001년 2월 요금',row("'99.12.15 ~ '00.01.15")));
  assert.ok(different('2024년 1월 요금',row("1999.12.15 ~ '00.01.15")));
  for (const r of ["'00.02.29~'00.04.30", "'23.01.32 ~ '23.12.31", "'23.06.01 ~ '23.05.31",
    "'21.12.31 ~ '24.01.01", "'23.01.01 ~ 12.31", "23.01.01 ~ 23.12.31", "'23.01.01 ~ '23.12.31 ~ '24.03.31",
    "기간 항목: '23.01.01 ~ '23.12.31"]) assert.equal(different('2026년 10월 요금',row(r)),null,r);
});

test('같은 달의 다른 관측일을 구분하고 날짜가 여러 개인 질문에는 단일 날짜를 배정하지 않는다', () => {
  const q = '2025년 8월 6일 저수율은 78.5%였나?';
  for (const stamp of ['2025년 8월 9일', '2025-08-09T00:05:00+09:00', '2025\t8월 9일']) {
    assert.deepEqual(different(q, row(stamp)), {requested:'2025년 8월 6일',source:'2025년 8월 9일'});
  }
  assert.equal(different(q, row('2025년 8월')), null);
  assert.equal(different(q, row('2025년 8월 6일')), null);
  assert.equal(different('2025년 8월 저수율', row('2025년 8월 9일')), null);
  for (const query of ['2025년 8월 6일과 9일의 저수율', '2025년 8월 6·9일 저수율',
    '2025-08-06 및 9일의 저수율']) {
    assert.equal(requestedPeriod(query), null, query);
    assert.equal(different(query, row('2025년 8월 7일')), null, query);
  }
});
