const {test} = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');
const finder = require('../docs/reader/evidence-finder.js');
const study = require('../docs/reader/editor-study-cases.js');

test('원고의 수치가 다른 단계와 일치해도 네 단계 각각의 원문을 찾는다', () => {
  const prefix = '2025년 달빛돌봄 사업';
  const lines = [
    prefix + '을 위해 부처가 13억 원을 요구했다.',
    prefix + '의 정부 예산안은 12억 원이다.',
    prefix + '에 대해 국회가 11억 원을 최종 의결했다.',
    prefix + '의 실제 지출은 9억 원이었다.'
  ];
  for (const [question, index, stage] of [['요구액은 12억 원인가?',0,'request'],['정부안은 11억 원인가?',1,'proposal'],
    ['국회 확정 예산은 12억 원인가?',2,'approved'],['집행액은 11억 원인가?',3,'spent']]) {
    for (const order of [lines, [...lines].reverse()]) {
      const result = search(order.join('\n'), prefix + '의 ' + question);
      assert.equal(result.gap, null, question);
      assert.deepEqual(result.passages.map(p => p.text), [lines[index]]);
      assert.equal(result.passages[0].fiscalStage,stage);
      assert.equal(result.passages[0].paragraph, order.indexOf(lines[index]) + 1);
    }
  }
});

test('사업명과 연도가 맞는 문단이 3위 밖에 있어도 동명이 아닌 다른 사업의 금액을 제외한다', () => {
  const query = '2024년 청년 주거 지원 사업의 본예산은 130억 원이다.';
  const other = '2024년 노인 주거 지원 사업의 본예산은 130억 원이다.';
  const prior = '2023년 청년 주거 지원 사업의 본예산은 130억 원이다.';
  const unknown = '청년 주거 지원 사업의 국회 확정액은 130억 원이다.';
  const correct = '2024회계연도 청년 주거 지원 사업의 국회 확정액은 110억 원이다.';
  const lines = [other, prior, unknown, other, prior, correct];
  const result = search(lines.join('\n'),query);
  assert.equal(result.gap,null);
  assert.equal(result.passages[0].paragraph,6);
  assert.equal(result.passages[0].text,correct);
  assert.deepEqual(result.passages.filter(p=>p.fiscalStage).map(p=>p.text),[correct]);
  for (const document of [[other, prior, unknown], [other, prior], [other], [unknown]]) {
    const incomplete = search(document.join('\n'),query);
    assert.match(incomplete.gap,/확정 예산/);
    assert.ok(incomplete.passages.every(p=>!p.fiscalStage));
  }
  assert.match(search(other.replace('2024년 ',''),query.replace('2024년 ','')).gap,/확정 예산/);
});

test('회계연도와 의결일을 구분하고 양쪽 단계의 금액을 같은 문단에서 섞지 않는다', () => {
  const query = '2024년도 별빛 사업의 국회 확정 예산은 12억 원인가?';
  for (const suffix of ['정부안은 12억 원이고 국회 확정액은 11억 원이다.',
    '국회 확정액은 11억 원이며 정부안은 12억 원이다.',
    '국회 확정액은 11억 원, 근로자 수당은 12억 원이다.',
    '국회 확정액은 11억 원, 12억 원은 부결되었다.']) {
    const text = '2023년 12월 21일 의결한 2024년도 별빛 사업의 ' + suffix;
    const result = search(text,query);
    assert.equal(result.passages[0].text,text);
    assert.equal(result.gap,null,suffix);
    assert.ok(!result.passages[0].matched.includes('12억'),suffix);
  }
  const text = '2023년 12월 21일 국회에서 의결한 2024년도 확정 예산은 11억 원이다.';
  assert.match(search(text,'2023회계연도의 국회 확정 예산은 11억 원인가?').gap,/확정 예산/);
});

test('요구안과 결산만 있거나 대상 사업·연도가 다른 문장에 흩어졌으면 확인을 요청한다', () => {
  const query = '2025년도 달빛돌봄 사업의 국회 확정 예산은 12억 원인가?';
  const source = '2025년도 달빛돌봄 사업의 정부안은 12억 원이다.\n2025년도 달빛돌봄 사업의 실제 지출은 9억 원이다.';
  assert.match(search(source,query).gap,/확정 예산/);
  const loose = '달빛돌봄 사업의 확정액은 11억 원이다. 2025년도 확정 예산은 12억 원이다.';
  assert.match(search(loose,query).gap,/확정 예산/);
});

test('들여쓴 문장에서도 같은 기관이나 같은 세목의 금액만 우선한다', () => {
  for (const [subject, decoy] of [['중앙정부 총지출','시도교육청 총지출'],['의료비','교육비']]) {
    const query = '2024년 ' + subject + '의 확정 예산은 130억 원인가?';
    const wrong = '  2024년 ' + decoy + '의 확정 예산은 130억 원이다.';
    const correct = '  2024년 ' + subject + '의 국회 의결 예산은 110억 원이다.';
    const result = search([wrong,correct].join('\n'),query);
    assert.equal(result.gap,null,subject);
    assert.equal(result.passages[0].text,correct);
    assert.match(search(wrong,query).gap,/확정 예산/);
  }
});

test('연구 사례에서 발의자에 붙은 정치 표기와 무관하게 실제 의결 근거가 첫 결과다', () => {
  for (const variant of ['A','B']) {
    const trial = study.get('repair',variant);
    const source = trial.sources.map(s => s.excerpt).join('\n');
    for (const query of [trial.article,trial.question,'올해 주택 보수 사업의 확정 예산은 12억 원인가?']) {
      assert.equal(search(source,query).passages[0].text,trial.sources[2].excerpt);
    }
    assert.ok(search(source,trial.article).gap);
  }
});

test('단계가 모호한 예산, 일반 절차 질문, 추가 문맥과 표는 기존 검색을 유지한다', () => {
  const prose = '2024년 달빛돌봄 사업의 정부안은 12억 원이다.\n국회 의결 예산은 11억 원이다.';
  const table = '사업\t2024년도 본예산\t2024년도 결산\n달빛돌봄\t110\t90\n별빛돌봄\t120\t100';
  for (const [text,query,articleContext] of [[prose,'달빛돌봄 사업의 예산은 얼마인가?'],
    [prose,'예산안을 의결한 의원은 몇 명인가?'], [prose,'달빛돌봄 사업의 국회 확정 예산은 얼마인가?','추경까지 포함한 총액'],
    [table,'2024년도 본예산은 얼마인가?']]) {
    const result = search(text,query,{articleContext});
    assert.equal(result.gap,null);
    assert.deepEqual(result.passages,finder.find(text,query,{includeContext:true}));
  }
});

test('결산서의 예산현액·이월액·불용액과 실제로 지출한 금액을 구별한다', () => {
  const leading = '2024년 달빛돌봄 사업의 ';
  const query = leading + '실제 집행액은 120억 원인가?';
  for (const label of ['예산현액', '다음 해 이월액', '불용액', '미집행액', '집행잔액', '세입 결산액']) {
    const result = search(leading + '결산서에서 ' + label + '은 120억 원이었다.', query);
    assert.match(result.gap, /실제 집행액/);
    assert.ok(result.passages.every(p => !p.fiscalStage), label);
  }
  for (const data of ['결산자료에서 예산현액은 120억 원이며 지출액은 90억 원이었다.',
    '예산현액 120억 원 중 90억 원을 집행했다.']) {
    const result = search(leading + data, query);
    assert.equal(result.gap, null, data);
    assert.equal(result.passages[0].fiscalStage, 'spent');
    assert.ok(!result.passages[0].matched.includes('120억'), data);
    assert.ok(result.passages[0].text.includes('90억 원'), data);
  }
});
