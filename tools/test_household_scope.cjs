const test = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');

const national = '2024년 전체 가구의 1인당 연간 쌀 소비량은 55.8kg이었다.';
const claim = '2024년 서울 1인 가구의 1인당 연간 쌀 소비량은 55.8kg이었다.';
const direct = '2024년 서울특별시 1인 가구의 1인당 연간 쌀 소비량은 49.2kg이었다.';

test('전체 가구 평균과 가구원 수·지역이 다른 수치를 같은 집단의 수치로 찾지 않는다', () => {
  for (const line of [national, direct.replace('서울특별시','부산광역시'),
    direct.replace('1인 가구','11인 가구'), direct.replace('1인 가구','1인 이상 가구'),
    direct.replace('2024','2023'), direct.replace('쌀 소비량','월간 소득'),
    '서울 1인 가구 통계는 미집계. ' + national,
    '2024년 서울 1인 가구의 쌀 소비량은 제공되지 않았으나 전체 가구 평균은 55.8kg이었다.',
    '2024년 서울 1인 가구의 쌀 소비량을 조사했다, 전국 평균은 55.8kg이었다.',
    '서울 1인 가구는 제외하고 조사한 2024년 쌀 소비량은 55.8kg이었다.']) {
    const result = search(line,claim);
    assert.match(result.gap,/서울 1인 가구.*확인하지 못했/,line);
    assert.equal(result.passages.some(p => p.matrixCell || p.datedCell),false);
  }
});

test('상위 후보 밖에서 다른 수치로 발표된 같은 지역·가구 규모의 원문도 찾는다', () => {
  const lines = [national,national,national,national,direct];
  const hit = search(lines.join('\n'),claim);
  assert.equal(hit.gap,undefined);
  assert.deepEqual(hit.passages.map(p => p.paragraph),[5]);
  assert.match(hit.notice,/기간·단위/);
  assert.equal(search(national,national).householdScope,undefined);
});

test('별도 기사 문맥의 지역과 기간을 적용하고, 범위가 다른 후보는 직접 열어볼 수 있다', () => {
  const query = '1인당 연간 쌀 소비량은 55.8kg이었다.';
  assert.equal(search(direct,query,{articleContext:'2024년 서울 1인 가구'}).passages[0].text,direct);
  const gap = search(national,query,{articleContext:'2024년 서울 1인 가구'});
  assert.equal(gap.usedArticleContext,true);
  assert.ok(gap.gap && gap.passages.length);
  assert.ok(search(direct,claim,{articleContext:'부산 2인 가구'}).gap);
});

test('수도 밖의 시도 이름과 인원 구간을 일반화하고 인원이 다른 행을 제외한다', () => {
  const query = '충북 2~3인 가구의 월 지출은 얼마인가?';
  const source = '충청북도 2인~3인 세대의 월 지출은 80만원이다.';
  assert.equal(search(source,query).gap,undefined);
  assert.ok(search(source.replace('2인~3인', '3인'),query).gap);
  assert.ok(search('부산광역시 해운대구 2인 가구의 월 지출은 8만원이다.', '강남구 2인 가구 월 지출은 얼마인가?').gap);
});
