const {test} = require('node:test');
const assert = require('node:assert/strict');
const {find} = require('../docs/reader/evidence-finder.js');

test('후보는 수치가 다른 반대 근거도 남기고, 붙여넣은 원문과 위치를 보존한다', () => {
  const passage = '  주거 예산은 27억 원이다.  ';
  const source = ['회의 개회.', '', passage, '시청 앞 도로 정비에 관한 의견.'].join('\r\n');
  const hits = find(source, '주거 예산이 45억 원으로 늘었다.');
  assert.deepEqual(hits[0], {paragraph: 2, text: passage, matched: ['주거', '예산']});
});

test('겹치는 표현이 없으면 후보를 만들지 않고, 동점인 다른 설명도 남긴다', () => {
  const source = '교육 예산은 증가했다.\n교육 예산은 감소했다.';
  assert.deepEqual(find(source, '상수도 설치'), []);
  assert.deepEqual(find(source, '교육 예산'), [
    {paragraph: 1, text: '교육 예산은 증가했다.', matched: ['교육', '예산']},
    {paragraph: 2, text: '교육 예산은 감소했다.', matched: ['교육', '예산']},
  ]);
  assert.deepEqual(find(source, ' '), []);
});

test('낮은 빈도의 일치어로 위치를 찾고 서로 다른 수치나 단위를 같은 값으로 바꾸지 않는다', () => {
  const text = '찬성률은 21%p 증가했다.\n찬성률은 21%였다.\n찬성률은 2.1%였다.';
  const [hit] = find(text, '찬성률은 2.1%라고 밝혔다.');
  assert.equal(hit.paragraph, 3);
  assert.ok(hit.matched.includes('2.1%'));
});

test('수치는 단위와 크기를 붙여 비교하고, 조사처럼 끝나는 명사도 그대로 찾는다', () => {
  const [money] = find('주거 예산은 27만 원이다.\n주거 예산은 27억 원이다.', '주거 예산 27억 원');
  assert.equal(money.paragraph, 2);
  assert.ok(money.matched.includes('27억'));
  const [points] = find('찬성률은 21%였다.\n찬성률은 21%p 올랐다.', '찬성률이 21%포인트 올랐다');
  assert.equal(points.paragraph, 2);
  assert.ok(find('사업비는 1,000억 원이다.', '1000억').length);
  assert.ok(find('회의 개회.\n전문가는 반대했다.', '전문가 반대')[0].matched.includes('전문가'));
  assert.ok(find('회의 개회.\n어린이 수당 확대.', '어린이가 받는 수당')[0].matched.includes('어린이'));
});

test('같은 낱말의 원형과 활용형을 한 번만 세어 관련 문단을 앞에 둔다', () => {
  const doc = ['시의회는 오전 10시 본회의를 열었다.', '시의회는 회의 시작 전 묵념을 했다.', '시의회는 다음 회기 일정을 공지했다.',
    '시의회가 돌봄 예산 3억 원 삭감안을 의결했다.', '교육 예산은 동결됐다.', '복지 예산은 늘었다.', '주거 예산은 줄었다.',
    '문화 예산은 그대로다.', '시장은 귀가했다.', '날씨가 맑았다.'].join('\n');
  assert.equal(find(doc, '시의회는 예산을 삭감했다')[0].paragraph, 4);
  const [hit] = find('이 발언은 사실이 아니라는 반론이 나왔다.\n시장의 예산 발언 기록이 공개됐다.', '시장의 발언은 사실이 아니다');
  assert.equal(hit.paragraph, 2);
});
