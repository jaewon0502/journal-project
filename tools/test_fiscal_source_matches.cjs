const {test} = require('node:test');
const assert = require('node:assert/strict');
const {prepare, decide} = require('../docs/reader/factcheck-engine.js');
const housing = require('../docs/reader/editor-study-cases.js');
const fiscal = require('../docs/reader/evidence-fiscal.js');

const record = (id, title, locator, excerpt) => ({id, title, locator, excerpt, version:'공개본',
  url:'https://study.invalid/fiscal/' + id});
const records = [
  record('ministry', '돌봄 사업 요구서', '부처 요구액', '돌봄 사업의 부처 요구액은 130억 원이다.'),
  record('cabinet', '국회 제출 예산안', '정부안', '돌봄 사업의 정부 제출 예산안은 120억 원이다.'),
  record('adopted', '의결 예산서', '확정액', '돌봄 사업의 확정 예산은 110억 원이다.'),
  record('accounts', '세출 결산서', '집행액', '돌봄 사업의 실제 집행액은 90억 원이다.')
];
const row = (q, sources) => prepare(q, sources).rows[0];
const permutations = values => values.length < 2 ? [values] :
  values.flatMap((value, i) => permutations(values.filter((_, j) => j !== i)).map(rest => [value, ...rest]));

test('부처 요구·정부 제출·의결·집행 중 다른 단계와 같은 금액을 적어도 기사에서 물은 단계가 먼저다', () => {
  for (const [label, id] of [['부처 요구액','ministry'], ['정부안','cabinet'], ['본예산','adopted'], ['집행액','accounts']]) {
    for (const amount of [90, 110, 120, 130]) {
      const q = `돌봄 사업의 ${label}은 ${amount}억 원이다.`;
      for (const order of permutations(records)) {
        const r = row(q, order);
        assert.equal(r.sourceIds[0], id, q);
        assert.match(r.sourceMatches[0].reason, /예산 단계 · /u, q);
        assert.equal(r.sourceCaution, null, q);
        assert.equal(r.status, 'pending');
      }
    }
  }
});

test('의결 자료를 찾지 못하면 관련 후보를 남기고, 실제 반증을 고른 편집자의 판단을 보존한다', () => {
  for (const variant of ['A','B']) {
    const {article, sources, expectedSourceIds} = housing.get('repair', variant);
    const r = row(article, sources);
    assert.equal(r.sourceIds[0], expectedSourceIds[0]);
    assert.equal(r.sourceCaution, null);
    const receipt = decide(r, {status:'contradicted', acknowledged:true, sourceIds:expectedSourceIds,
      reason:'같은 범위의 의결액은 지난해 10억 원, 올해 11억 원으로 10% 증가했다.'}, sources);
    assert.equal(prepare(article, sources, [receipt]).rows[0].status, 'contradicted');
    const incomplete = row(article, sources.filter(s => !expectedSourceIds.includes(s.id)));
    assert.ok(incomplete.sourceIds.includes('doc-1'));
    assert.equal(incomplete.sourceCaution, fiscal.gap('approved'));
    assert.equal(incomplete.status, 'pending');
  }
});

test('자료 제목이 정부안이어도 해당 구간에 든 집행액은 정부 제출액의 빈자리를 메우지 않는다', () => {
  const heading = record('audit', '돌봄 사업 정부안 분석', '표 7 집행실적', '돌봄 사업의 실제 지출액은 120억 원이다.');
  const q = '돌봄 사업의 정부안은 120억 원이다.';
  assert.equal(row(q, [heading, records[0]]).sourceCaution, fiscal.gap('proposal'));
  assert.equal(row(q, [heading, records[1]]).sourceIds[0], 'cabinet');
});

test('집행 자료의 위치 표시는 금액만 적힌 행에는 적용해도 지출 예정이나 미공개 설명에는 적용하지 않는다', () => {
  const q = '돌봄 사업의 실제 집행액은 120억 원이다.';
  const inAccounts = excerpt => record('accounts', '세출 결산서', '집행액', excerpt);
  assert.equal(row(q, [inAccounts('돌봄 사업 110억 원.')]).sourceCaution, null);
  assert.equal(row(q, [{...inAccounts('돌봄 사업 110'), locator:'집행액 (단위: 억 원)'}]).sourceCaution, null);
  for (const excerpt of ['돌봄 사업의 실제 지출액은 아직 공개되지 않았다.',
    '돌봄 사업에 120억 원을 집행할 예정이다.', '돌봄 사업의 실제 지출액은 별도 부록에 기재했다.']) {
    assert.equal(row(q, [inAccounts(excerpt)]).sourceCaution, fiscal.gap('spent'));
  }
});

test('다른 사업이나 다른 연도에만 요청한 단계가 나오면 비교에 맞는 원문을 더 요청한다', () => {
  const q = '2024년 돌봄 사업의 본예산은 130억 원이다.';
  const request = record('care', '돌봄 사업 요구서', '요구액', '2024년 돌봄 사업의 부처 요구액은 130억 원이다.');
  const mixed = record('history', '돌봄 사업 연혁', '연도별 사업비',
    '2023년 확정 예산은 130억 원, 2024년 부처 요구액은 140억 원이다.');
  const other = record('road', '도로 사업 결산', '재원', '2024년 도로 사업의 확정 예산은 130억 원이다.');
  const crossed = record('crossed', '연도별 재정 기록', '의결 내역',
    '2023년 돌봄 사업의 확정 예산은 90억 원이다. 2024년 도로 사업의 확정 예산은 130억 원이다.');
  const correct = record('decision', '의회 의결 자료', '소관 사업별 확정액', '2024년 돌봄 사업의 확정 예산은 110억 원이다.');
  assert.equal(row(q, [request, mixed, other, crossed]).sourceCaution, fiscal.gap('approved'));
  assert.equal(row(q, [request, mixed, other, crossed, correct]).sourceIds[0], 'decision');
  assert.equal(row(q, [request, mixed, other, crossed, correct]).sourceCaution, null);
  assert.equal(row('2024년 하천정비 사업의 본예산은 130억 원이다.', [other]).sourceCaution, fiscal.gap('approved'));
});

test('단계를 지정하지 않은 예산·비금융 기사와 발언 원문에는 재정 단계 보완 경고를 붙이지 않는다', () => {
  for (const q of ['돌봄 사업 예산은 110억 원이다.', '돌봄 사업의 작년 참여 인원은 110명이다.',
    '위원장은 “돌봄 사업의 본예산은 110억 원이다”라고 말했다.']) {
    assert.equal(row(q, [records[0]]).sourceCaution, null, q);
  }
});

test('금액이 같아도 다른 연령대의 사업이나 연도가 빠진 자료가 같은 사업의 해당 연도 의결액을 앞서지 않는다', () => {
  const q = '2024년 청년 주거 지원 사업의 본예산은 130억 원이다.';
  const sameYearDifferentProgram = record('older', '주거 지원 사업 예산', '본예산',
    '2024년 노인 주거 지원 사업의 확정 예산은 130억 원이다.');
  const sameProgramNoYear = record('undated', '주거 지원 사업 예산', '본예산',
    '청년 주거 지원 사업의 확정 예산은 130억 원이다.');
  const correct = record('vote', '시의회 공고', '표 7', '2024년 청년 주거 지원 사업의 확정 예산은 110억 원이다.');
  const yearInHeading = {...correct, title:'2024년 시의회 의결 예산', excerpt:'청년 주거 지원 사업의 확정 예산은 110억 원이다.'};
  for (const wrong of [sameYearDifferentProgram, sameProgramNoYear]) {
    assert.equal(row(q, [wrong]).sourceCaution, fiscal.gap('approved'));
    for (const right of [correct, yearInHeading]) {
      for (const refs of [[right, wrong], [wrong, right]]) {
        assert.equal(row(q, refs).sourceIds[0], right.id);
        assert.equal(row(q, refs).sourceCaution, null);
      }
    }
  }
});

test('확정 예산서라는 제목은 의결을 명시적으로 부정한 발췌문을 덮어쓰지 않는다', () => {
  const query = '2024년 청년 주거 지원 사업의 본예산은 130억 원이다.';
  const denied = record('denied', '2024년 청년 주거 지원 사업 확정 예산서', '확정액',
    '2024년 청년 주거 지원 사업의 본예산은 130억 원으로 최종 확정되지 않았다.');
  const adopted = record('approved', '시의회 공고', '의결 내역', '2024년 청년 주거 지원 사업의 확정액은 110억 원이다.');
  assert.equal(row(query, [denied]).sourceCaution, fiscal.gap('approved'));
  for (const order of [[denied, adopted], [adopted, denied]]) {
    assert.equal(row(query, order).sourceIds[0], 'approved');
    assert.equal(row(query, order).sourceCaution, null);
  }
});

test('한 문장에 전년도 의결액과 올해 요구액이 함께 나올 때 올해 의결액을 확인한 것으로 표시하지 않는다', () => {
  const query = '2024년 청년 주거 지원 사업의 본예산은 130억 원이다.';
  const mixed = record('mixed', '시의회 공고', '사업비 증감',
    '2023년 청년 주거 지원 사업의 확정 예산은 90억 원이었고 2024년 청년 주거 지원 사업의 요구액은 130억 원이었다.');
  assert.equal(row(query, [mixed]).sourceCaution, fiscal.gap('approved'));
  const current = {...mixed, excerpt:'2024년 청년 주거 지원 사업의 정부안은 130억 원이었으며 국회 확정액은 110억 원이었다.'};
  assert.equal(row(query, [current]).sourceCaution, null);
});

test('결산서 제목과 위치가 다른 금액에 집행액이라는 근거를 붙이지 않는다', () => {
  const q = '2024년 달빛돌봄 사업의 실제 집행액은 120억 원인가?';
  const prefix = '2024년 달빛돌봄 사업의 ';
  const correct = record('spent', '세출 결산서', '지출액 행', prefix + '집행액은 90억 원이었다.');
  for (const [title, locator, excerpt] of [
    ['세출 결산서', '집행액 행', prefix + '예산현액은 120억 원이다.'],
    ['세출 결산서', '지출액 행', prefix + '결산서에는 이월액 120억 원이 기재됐다.'],
    ['집행액 분석', '결산서의 불용액', prefix + '120억 원.'],
    ['세입 결산서', '세입 결산액', prefix + '120억 원.'],
    ['세출 결산서', '붙임 표 3', prefix + '120억 원.']
  ]) {
    const wrong = record('other', title, locator, excerpt);
    assert.equal(row(q, [wrong]).sourceCaution, fiscal.gap('spent'));
    const ranked = row(q, [wrong, correct]);
    assert.equal(ranked.sourceIds[0], 'spent');
    assert.equal(ranked.status, 'pending');
  }
});

test('결산서의 집행액 추천 이유에는 같은 집행 구절의 금액만 표시한다', () => {
  const report = record('report', '세출 결산서', '별빛돌봄 집행 내역',
    '2024년 별빛돌봄 사업 결산서 예산현액 120억 원 중 90억 원을 집행했다.');
  for (const amount of [90, 120]) {
    const result = row('별빛돌봄 사업의 실제 집행액은 ' + amount + '억 원이다.', [report]);
    assert.deepEqual(result.sourceIds, ['report']);
    assert.equal(result.sourceCaution, null);
    assert.equal(result.status, 'pending');
    const reason = result.sourceMatches[0].reason;
    assert.match(reason, /예산 단계 · 결산·실제 집행액/u);
    assert.doesNotMatch(reason, /120억/u);
    if (amount === 90) assert.match(reason, /90억/u);
  }
});

test('동일 사업·단계에서도 다른 연도의 수치는 추천 이유로 쓰지 않는다', () => {
  const report = record('report', '별빛돌봄 사업 결산서', '연도별 집행 내역',
    '2023년 실제 집행액은 120억 원이었다. 2024년 실제 집행액은 90억 원이었다.');
  for (const [year, amount, matches] of [[2023,120,true], [2024,120,false], [2024,90,true]]) {
    const result = row(amount + '억 원이 ' + year + '년 별빛돌봄 사업의 실제 집행액이었다.', [report]);
    assert.deepEqual(result.sourceIds, ['report']);
    assert.equal(result.sourceCaution, null);
    assert.equal(result.sourceMatches[0].reason.includes(amount + '억'), matches);
  }
});

test('서로 다른 표의 집행률도 분모를 구분하고 같은 분모에 실린 상반된 수치는 모두 대조한다', () => {
  function archived(id, basis, value) {
    const heading = '2024년 ' + (basis ? basis + ' 대비 ' : '') + '집행률(%)';
    const locator = '‘별빛돌봄’ 행 · ‘' + heading + '’ 열 (왼쪽에서 2번째 열) · 단위 %';
    return record(id, '결산 공시', locator, '구분\t' + heading + '\n별빛돌봄\t' + value);
  }
  const original = archived('original', '본예산', '90.0');
  const current = archived('current', '예산현액', '75.0');
  const other = archived('other', '예산현액', '73.2');
  const missing = archived('unknown', '', '75.0');
  const unspecified = '2024년 별빛돌봄 집행률은 90.0%였다.';
  for (const refs of [[original, current], [current, original], [current, missing]]) {
    const r = row(unspecified, refs);
    assert.deepEqual(r.sourceMatches, []);
    assert.match(r.sourceCaution, /분모/);
  }
  const alone = row(unspecified, [missing]);
  assert.deepEqual(alone.sourceIds, ['unknown']);
  assert.match(alone.sourceCaution, /분모.*주석/);
  const named = row('2024년 별빛돌봄 예산현액 대비 집행률은 90.0%였다.', [original, current, other, missing]);
  assert.deepEqual(new Set(named.sourceIds), new Set(['current', 'other']));
  assert.match(named.sourceMatches.find(m => m.id === 'current').reason, /75\.0/);
  assert.match(named.sourceMatches.find(m => m.id === 'other').reason, /73\.2/);
  assert.equal(named.sourceCaution, null);
  assert.equal(named.status, 'pending');
});
