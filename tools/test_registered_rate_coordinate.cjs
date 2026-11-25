const {test} = require('node:test');
const assert = require('node:assert/strict');
const {prepare} = require('../docs/reader/factcheck-engine.js');
const {registeredRateCell, registeredRateQuestion} = require('../docs/reader/evidence-fiscal-table.js');

const claim = '2024년 별빛돌봄의 예산현액 대비 집행률은 90.0%였다.';
const headers = ['구분','2024년 본예산 대비 집행률(%)','2024년 예산현액 대비 집행률(%)','2023년 예산현액 대비 집행률(%)'];
const row = '별빛돌봄\t90.0\t75.0\t90.0';
const archive = [headers.join('\t'), '[…]', row].join('\n');
function source(id, excerpt, heading, column, year = '') {
  const prefix = year ? year + '년 · ' : '';
  return {id, title:'별빛돌봄 결산', url:'https://example.org/budget/' + id, version:'결산본', excerpt,
    locator:prefix + '‘별빛돌봄’ 행 · ‘' + heading + '’ 열 (왼쪽에서 ' + column + '번째 열) · 단위 %'};
}
const balance = source('balance', archive, headers[2], 3);
const original = source('original', archive, headers[1], 2);
const previous = source('previous', archive, headers[3], 4);

test('같은 발췌문도 실제로 저장한 집행률 좌표에 따라 연도와 분모를 구분한다', () => {
  const match = registeredRateQuestion(claim);
  assert.deepEqual(match(balance), {status:'compatible', value:'75.0', unit:'%', basis:'예산현액'});
  assert.deepEqual(match(original), {status:'incompatible'});
  assert.deepEqual(match(previous), {status:'incompatible'});
  assert.deepEqual(registeredRateCell(balance), {rowLabel:'별빛돌봄', heading:headers[2], column:3,
    year:'2024', value:'75.0', unit:'%', basis:'예산현액'});
  assert.equal(registeredRateQuestion('2024년 별빛돌봄의 집행액은 20억 원이다.'), null);
});

test('기사가 틀린 수치를 적어도 맞는 좌표의 원문을 우선하고 해당 자료가 없으면 검토를 요청한다', () => {
  const current = prepare(claim, [original,previous,balance]).rows[0];
  assert.deepEqual(current.sourceIds, ['balance']);
  assert.match(current.sourceMatches[0].reason, /75\.0/u);
  assert.equal(current.status, 'pending');
  const missing = prepare(claim, [previous,original]).rows[0];
  assert.deepEqual(missing.sourceIds, []);
  assert.match(missing.sourceCaution, /집행률.*분모/u);
  assert.equal(missing.status, 'pending');

  const revised = {...balance, id:'revised', excerpt:archive.replace('75.0','74.0')};
  const both = prepare(claim, [original, revised, balance]).rows[0];
  assert.deepEqual(both.sourceIds.slice().sort(), ['balance','revised']);
  assert.ok(both.sourceMatches.some(s => s.reason.includes('74.0')));
});

test('행에 회계연도가 있거나 윗줄이 연도 머리글인 집행률 좌표를 검증한다', () => {
  const leaf = '집행률(예산현액 기준)(%)';
  const vertical = ['회계연도\t사업명\t본예산 대비 집행률(%)\t' + leaf, '2024\t별빛돌봄\t90.0\t７５．００'].join('\n');
  const grouped = ['구분\t2023년\t\t2024년\t', '\t본예산 대비 집행률(%)\t' + leaf + '\t본예산 대비 집행률(%)\t' + leaf,
    '별빛돌봄\t87\t90.0\t90.0\t７５．００'].join('\n');
  for (const [table, column] of [[vertical,4],[grouped,5]]) {
    const saved = source('grouped', table, leaf, column, '2024');
    const result = {status:'compatible', value:'７５．００', unit:'%', basis:'예산현액'};
    assert.deepEqual(registeredRateQuestion(claim)(saved), result);
    assert.deepEqual(registeredRateQuestion(claim)({...saved, locator:'PDF 32쪽 · ' + saved.locator}), result);
    assert.equal(registeredRateCell({...saved, locator:saved.locator.replace('2024년 · ', '')}), null);
    assert.equal(registeredRateCell({...saved, locator:saved.locator.replace('2024년 · ', '2023년 · ')}), null);
  }
});

test('자유서식 위치·열 불일치·단위 미확인 자료와 조건이 모호한 질문은 수동 검토에 남긴다', () => {
  const match = registeredRateQuestion(claim);
  for (const edited of [
    {locator:'PDF 32쪽, 별빛돌봄의 예산현액 대비 집행률'},
    {locator:'예산 추정치 · ' + balance.locator}, {locator:'2023년 · ' + balance.locator}, {locator:balance.locator.replace('3번째','2번째')},
    {locator:balance.locator.replace('별빛돌봄','별빛교육')}, {locator:balance.locator.replace('단위 %','단위 확인 필요')},
    {excerpt:row}, {excerpt:archive.replace('75.0','—')}, {excerpt:archive.replace('75.0','75.0%p')},
    {excerpt:archive.replace(headers[2], '2024년 예산현액 대비 집행률(A/B)(%)')},
    {excerpt:archive + '\n주: 2024년 사업 중 일부만 포함'}
  ]) {
    const candidate = {...balance, ...edited};
    assert.equal(registeredRateCell(candidate), null);
    assert.deepEqual(match(candidate), {status:'unknown'});
    assert.deepEqual(prepare(claim, [candidate]).rows[0].sourceIds, []);
  }
  for (const query of ['2024년 별빛돌봄의 집행률은 90%였다.', '별빛돌봄의 집행률은 90%였다.',
    '2024년 별빛돌봄의 집행률은 10%p 상승했다.', '2024년 별빛돌봄 청소년 대상의 예산현액 대비 집행률은 90%였다.'])
    assert.deepEqual(registeredRateQuestion(query)(balance), {status:'unknown'}, query);
});
