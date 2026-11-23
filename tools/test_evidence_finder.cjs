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
