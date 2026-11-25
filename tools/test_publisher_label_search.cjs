const {test} = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');
const {prepare} = require('../docs/reader/factcheck-engine.js');

const costs = [
  '2024년 도서관 결산 자료',
  '도서관의 운영 경비는 12억 원이다.',
  '보수 성향 모임은 도서관의 운영 경비가 11억 원이라고 주장했다.',
  '진보 성향 모임은 도서관의 운영 경비가 13억 원이라고 주장했다.'
].join('\n');
const question = '도서관 운영 경비는 얼마인가?';

function hits(document, query) {
  return search(document, query).passages.map(({paragraph, text, matched}) => ({paragraph, text, matched}));
}

test('분리된 발행처와 독자용 표기를 교환해도 원문 후보의 순서와 검색어가 같다', () => {
  const expected = hits(costs, question);
  assert.deepEqual(expected.map(p => p.paragraph), [2, 3, 4]);
  for (const side of ['보수', '진보', '중도']) {
    for (const tag of [side + ' 성향 신문', '발행처: ' + side + ' 성향 주간지', side + ' 성향 독자용']) {
      const original = '[' + tag + '] ' + question;
      assert.equal(prepare(original).rows[0].text, original);
      assert.deepEqual(hits(costs, original), expected, original);
    }
  }
});

test('실제 발언자, 인용, 검색 대상 매체·자료 이름, 독자 집단은 원문 검색에 남는다', () => {
  const record = [
    '지역 모임이 도서관 소식을 전했다.',
    '보수 성향 신문은 도서관의 운영 경비가 11억 원이라고 보도했다.',
    '진보 성향 신문은 도서관의 운영 경비가 13억 원이라고 보도했다.'
  ].join('\n');
  for (const [side, which] of [['보수', 2], ['진보', 3]]) {
    for (const query of [
      side + ' 성향 신문이 밝힌 도서관 운영 경비는 얼마인가?',
      '[' + side + ' 성향 신문]이 밝힌 도서관 운영 경비는 얼마인가?',
      '[' + side + ' 성향 신문] 도서관의 운영 경비를 얼마라고 보도했나?',
      '[' + side + ' 성향 신문] 도서관 운영 경비는 얼마라고 썼나?',
      '[' + side + ' 성향 신문] “도서관의 운영 경비는 얼마인가?”',
      '“[' + side + ' 성향 신문] 도서관 운영 경비”라는 표제를 사용했나?',
      '[' + side + ' 성향 신문] 기사 제목은 무엇인가?',
      '[' + side + ' 성향 독자] 도서관 운영 경비의 얼마를 지지하나?'
    ]) {
      const [first] = hits(record, query);
      assert.equal(first.paragraph, which, query);
      assert.ok(first.matched.includes(side), query);
    }
    const [actor] = hits(costs, side + ' 성향 모임은 도서관 운영 경비를 얼마라고 주장했나?');
    assert.equal(actor.paragraph, which + 1);
    assert.ok(actor.matched.includes(side));
  }
});

test('질문 대상이 바뀌면 분리된 성향 표기와 관계없이 해당 원문을 먼저 표시한다', () => {
  const record = costs + '\n진보 성향 모임은 온라인 강좌 등록 수수료를 3천 원으로 공지했다.';
  const query = '온라인 강좌의 등록 수수료는 얼마인가?';
  const expected = hits(record, query);
  assert.equal(expected[0].paragraph, 5);
  assert.deepEqual(hits(record, '[보수 성향 신문] ' + query), expected);
  assert.deepEqual(hits(record, '[진보 성향 신문] ' + query), expected);
});

test('표지 뒤에 명시된 정당과 주택 보수 같은 동음이의어는 계속 검색한다', () => {
  const polls = '보수당의 정당 지지율은 45%로 집계됐다.\n진보당의 정당 지지율은 38%로 집계됐다.';
  const repairs = '청사 기계 구입 예산은 8억 원이다.\n주택 보수 예산은 12억 원이다.';
  for (const cue of ['보수', '진보']) {
    for (const [party, row] of [['보수당', 1], ['진보당', 2]]) {
      const claim = party + '의 정당 지지율은 얼마인가?';
      const candidates = hits(polls, '[' + cue + ' 성향 신문] ' + claim);
      assert.deepEqual(candidates, hits(polls, claim));
      assert.equal(candidates[0].paragraph, row);
      assert.ok(candidates[0].matched.includes(party));
    }
    const claim = '주택 보수 예산은 얼마인가?';
    const candidates = hits(repairs, '[' + cue + ' 성향 신문] ' + claim);
    assert.deepEqual(candidates, hits(repairs, claim));
    assert.ok(candidates[0].matched.includes('보수'));
  }
});

test('보도 표지만 다를 때 구조화된 연도별 증감 행과 재정 원표 행도 그대로 찾는다', () => {
  const counts = ['2023년 연간 통계', '구분 2021년 2022년 2023년',
    '도서관 이용자(만명, 전년대비증감)   5   4   2'].join('\n');
  const finance = ['[최근 2년간 일반회계 예비비 집행 실적]', '(단위: 억원)', '구분  일반회계 예비비',
    '예산     80', '2023   지출결정액     70', '지출액    60'].join('\n');
  const questions = [
    [counts, '2023년 도서관 이용자 증가 폭이 절반 수준으로 줄었습니다.', 'candidates'],
    [finance, '2023년 일반회계 예비비 지출액은 70억 원이었다.', 'ordinary']
  ];
  for (const [source, claim, state] of questions) {
    const expected = search(source, claim);
    assert.equal(expected.state, state);
    assert.equal(expected.passages.length, 1);
    for (const tag of ['보수', '진보']) {
      const text = '[' + tag + ' 성향 신문] ' + claim;
      assert.deepEqual(search(source, text), expected);
      assert.deepEqual(search(source, text, {articleContext:text}),
        search(source, claim, {articleContext:claim}));
    }
  }
});
