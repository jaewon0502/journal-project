const {test} = require('node:test');
const assert = require('node:assert/strict');
const {request, stages} = require('../docs/reader/evidence-fiscal.js');

test('budget stages follow the financial event in a claim', () => {
  for (const [stage, term] of [
    ['request','시의 보건소 예산 요구액은 2억 원이다.'],
    ['proposal','2024년도 예산안의 총지출은 얼마인가?'],
    ['approved','교육비 예산안이 의회 본회의를 통과했다.'],
    ['approved','시의회가 확정한 교육비 예산은 얼마인가?'],
    ['spent','총지출 결산액은 10조 원이었다.'],
    ['spent','학교 시설비로 실제 집행한 금액은 10억 원이었다.'],
    [null,'예산안 표결에서 찬성한 의원은 몇 명인가?'],
    [null,'정부안에 시설 관리 조항이 추가됐다.'],
    [null,'사업비가 12억 원 늘었다.'],
    [null,'법원이 확정한 손해배상금은 10억 원이다.'],
    [null,'국회가 예산안 표결을 연기했다.'],
    [null,'예산안에 대한 야당 수정안은 3억 원을 줄인다.'],
    [null,'예산 집행계획은 12억 원이다.'],
    [null,'12억 원을 집행할 예정이다.'],
    [null,'사업비 12억 원은 아직 확정되지 않았다.'],
    [null,'2024년 청년 주거 지원 사업의 본예산은 130억 원으로 최종 확정되지 않았다.'],
    [null,'교육비 예산의 집행액은 2억 원으로 잡았지만 집행되지 않았다.'],
    [null,'국회가 예산안을 의결할 예정이다.'],
    [null,'시의회는 예산안을 부결했다.'],
    [null,'국무회의에서 확정한 새 예산 규모는 얼마인가?'],
    [null,'2024년 예산안 표결 날짜는 언제인가?']
  ]) assert.equal(request(term), stage, term);
});

test('mixed financial stages remain available for manual comparison', () => {
  const text = '시설비 정부안은 5억 원이었지만 국회가 확정한 금액은 4억 원이었다.';
  assert.deepEqual([...stages(text)].sort(), ['approved', 'proposal']);
  assert.equal(request(text), null);
  assert.deepEqual([...stages('정부안 12억 원은 국회 의결 전이다.')], ['proposal']);
});
