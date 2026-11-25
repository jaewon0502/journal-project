const test = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');

// MOEL's 2025-02-27 briefing. The period label transcribes the source table.
const heading = '2024년 연간 임금';
const original = '연간 월평균 명목임금은 407만 9,000원으로 2.9% 증가하였고, 실질임금은 357만 3,000원으로 0.5% 증가하였습니다.';
const document = heading + '\n' + original;
const claim = (basis, rate, direction = '증가') => '2024년 월평균 ' + basis + '임금은 전년보다 ' + rate + '% ' + direction + '했다.';

test('명목·실질임금 각각의 올바른 수치와 서로 바꿔 쓴 수치를 한 문단에서 구분한다', () => {
  for (const [basis, rate, otherOnly] of [
    ['실질', '2.9', true], ['명목', '0.5', true], ['실질', '0.50', false], ['명목', '2.9', false]
  ]) {
    const {passages} = search(document, claim(basis, rate));
    assert.equal(passages.length, 1);
    assert.equal(passages[0].text, original);
    assert.equal(passages[0].paragraph, 2);
    const {note, periodHeading} = passages[0].wageBasis;
    for (const entry of ['실질임금 0.5% 증가', '명목임금 2.9% 증가']) assert.ok(note.includes(entry));
    assert.equal(note.includes('붙은 수치'), otherOnly);
    if (otherOnly) assert.ok(note.includes((basis === '실질' ? '명목' : '실질') + '임금에 붙은 수치'));
    assert.deepEqual(periodHeading, {paragraph:1, text:heading});
  }
});

test('어순·금액·같은 비율·증감 방향을 바꿔도 다른 가격 기준에만 일치할 때만 알린다', () => {
  const reversed = '2024년 연간 월평균 실질 임금은 1.2% 감소하였고, 명목 임금은 1.2% 증가했다.';
  assert.match(search(reversed, claim('명목','1.2','감소')).passages[0].wageBasis.note, /실질임금에 붙은 수치/);
  assert.doesNotMatch(search(reversed, claim('실질','1.2','감소')).passages[0].wageBasis.note, /붙은 수치/);
  for (const source of [original.replace('0.5%', '2.9%'), original.replace('2.9%', '2.8%')]) {
    assert.doesNotMatch(search(heading + '\n' + source, claim('실질', '2.9')).passages[0].wageBasis.note, /붙은 수치/);
  }
});

test('발표 연도·달·다른 해·다른 쪽·모호한 표제를 연간 관측기간에 대입하지 않는다', () => {
  for (const prefix of ['2025년 2월 발표', '2024년 2월 발표', '2023년 연간 임금', '2024년 12월', '2024년 연간\n\f', '2024년 연간\n\n', '20페이지, 연간입니다.', '2024년 연간 서울 제조업 임금']) {
    const result = search(prefix + '\n' + original, claim('실질', '2.9'));
    assert.match(result.gap, /조사 기간/, prefix);
    assert.ok(result.passages.every(p => !p.wageBasis), prefix);
  }
});

test('같은 숫자만 있는 표, 다른 지표·집단, 인용, 비교, 추가 기사 문맥에는 임금 기준값을 붙이지 않는다', () => {
  const q = claim('실질', '2.9');
  for (const source of ['연도 | 명목임금 | 실질임금\n2024 | 2.9 | 0.5',
    original.replace('실질임금은', '실질 GDP는'), original.replace('실질임금은', '서울 실질임금은'),
    original.replace('0.5%', '0.5%p'), original.replace('실질임금은', '명목임금은'), '“' + original + '”']) {
    assert.equal(search(heading + '\n' + source, q).wageBasis, undefined, source);
  }
  for (const query of [q.replace('월평균', '서울 월평균'), q.replace('전년보다', '다른 지역보다'),
    q.replace('실질임금', '실질 GDP'), '“' + q + '”라고 주장했다.']) {
    assert.equal(search(document, query).wageBasis, undefined, query);
  }
  assert.equal(search(document, q, {articleContext:'대기업 근로자만 집계했다.'}).wageBasis, undefined);
});
