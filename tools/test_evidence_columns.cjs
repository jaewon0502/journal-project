const {test} = require('node:test');
const assert = require('node:assert/strict');
const {forRow} = require('../docs/reader/evidence-columns.js');

function at(lines, n, query) {
  const text = lines.join('\n');
  const passage = {paragraph: n, text: lines.filter(line => line.trim())[n - 1]};
  return forRow(text, query, passage);
}

test('같은 연도를 쓰는 두 열의 값을 모두 남겨 상위 지표를 임의로 붙이지 않는다', () => {
  const t = ['주간 점검', '일반 점검\t정밀 점검', '2019\t2022\t2024\t2022',
    '시설\t중형\t63.2\t61.0\t66.4\t51.5', '대형\t60.3\t55.2\t68.2\t53.1'];
  assert.deepEqual(at(t, 5, '2022년 대형 점검률은?'), {headerParagraph:3,rowParagraph:5,
    cells:[{year:'2022',column:2,value:'55.2'},{year:'2022',column:4,value:'53.1'}],ambiguousYears:['2022']});
  assert.deepEqual(at(t, 4, '2024년과 2019년 비교').cells,
    [{year:'2019',column:1,value:'63.2'},{year:'2024',column:3,value:'66.4'}]);
  for (const q of ['2020~2022년 현황','2019년부터 2024년까지의 현황','올해 점검률','2022년 8월 점검률','2022년과 2021년 점검률']) {
    assert.equal(at(t, 5, q),null,q);
  }
});

test('공백 정렬 표의 음수·증감률·결측 부호는 표기 그대로이며 앞의 값에서 보간하지 않는다', () => {
  const lines = ['  2021년    2022년    2023년', '연간 증감률    +2.3%p    −1.50%p    -',
    '전 분기    3.5%    1.0%    2.2%'];
  assert.deepEqual(at(lines, 2, '2022년과 2023년 연간 증감률').cells.map(c => c.value),['−1.50%p','-']);
  assert.equal(at(['2022\t2023\t증감', '부산\t56.2\t57.3\t1.1'],2,'2023년'),null);
  assert.equal(at(['2022\t2023\t2024', '부산\t56.2\t\t57.3'],2,'2023년'),null);
  assert.equal(at(['2022\t2023', '부산\t56.2\t57.3\t-1.1'],2,'2023년'),null);
});

test('같은 쪽의 다음 표, 다른 쪽, 빈 줄, 다단 머리글을 거슬러 올라가지 않는다', () => {
  const header='2021\t2022', valid='서울\t20\t30', target='대전\t60\t50';
  for (const cut of ['', '주: 비교 연도 변경', '[표 2] 다른 지표', '지역\t2021\t2022', '성\t한빛\t2\t3\t4', '\f']) {
    const lines=[header,valid,cut,target];
    assert.equal(at(lines,lines.filter(s=>s.trim()).length,'2022년 대전'),null, cut);
  }
  assert.equal(at([header,valid,'\f'+target],3,'2022년 대전'),null);
  assert.equal(at([header,'2023\t2024',target],3,'2023년 대전'),null);
  assert.deepEqual(at([header,valid,'다른 표','2022\t2023',target],5,'2022년 대전').cells,
    [{year:'2022',column:1,value:'60'}]);
  assert.equal(forRow([header,target].join('\n'),'2022년',{paragraph:2,text:'다른 문단'}),null);
  assert.equal(forRow(header,'2022년',{paragraph:99}),null);
  assert.equal(at(['| 2021 | 2022 |','| 서울 | 20 | 30 |','| 표 2. 다른 기준 | 1 | 2 |','| 대전 | 60 | 50 |'],4,'2022년'),null);
});

const {changeNote} = require('../docs/reader/evidence-columns.js');

function notice(lines, query = '2024년 정밀 점검률') {
  const text = lines.join('\n');
  return changeNote(text, query, {paragraph:lines.filter(line => line.trim()).length, text:lines.at(-1)});
}

test('반복 연도의 같은 묶음에서 같은 비율과 큰 괄호 증감이 병기되면 원래 두 셀을 반환한다', () => {
  const grid = ['단위: % / () 증감', '일반\t\t정밀\t', '구 분', '2022\t2024\t2022\t2024',
    '전체\t30.0\t35.0(+5.0)\t62.1\t62.1(−4.5)'];
  assert.deepEqual(notice(grid),{rowParagraph:5,headerParagraph:4,legendParagraph:1,comparisons:[{
    prior:{year:'2022',column:3,value:'62.1'},current:{year:'2024',column:4,value:'62.1(−4.5)'},printedChange:'−4.5'}]});
  for (const query of ['2022년 정밀 점검률','2024년 일반 점검률','정밀 점검률','2024년 요금']) {
    assert.equal(notice(grid,query), null,query);
  }
});

test('2023년 국민 독서실태 보도자료 5쪽의 인쇄된 증감 충돌을 찾고 다른 매체에 옮기지 않는다', () => {
  const grid = [
    '                           (단위: %/ (）증감)', '',
    '             종이책                   전자책                   종합',
    '구    분',
    '      2019   2021   2023      2019   2021   2023      2019   2021   2023',
    '전체   52.1   40.7   32.3(-8.4)   16.5   19.0   19.4(0.4)   55.7   47.5   47.5(-4.5)'
  ];
  const checked = notice(grid, '2023년 성인 종합독서율은 얼마인가?');
  assert.equal(checked.legendParagraph,1);
  assert.deepEqual(checked.comparisons,[{prior:{year:'2021',column:8,value:'47.5'},
    current:{year:'2023',column:9,value:'47.5(-4.5)'},printedChange:'-4.5'}]);
  assert.equal(notice(grid,'2023년 성인 종이책 독서율은?'),null);
});

test('반올림과 상대 증감 해석, 일반 괄호, 맞지 않는 수준값·부호·기준에는 유보한다', () => {
  const head=['(단위: % / () 증감)','일반\t\t정밀\t','2023\t2024\t2023\t2024'];
  for (const [prior,later] of [['45.2','45.2(0.0)'],['45.2','45.2(+0.1)'],['0.1','0.1(4.0)'],
    ['45.2','43.2(+2.0)'],['45.2','45.2(△2.3)'],['-','45.2(-2.3)']]) {
    assert.equal(notice([...head,['계','60.0','59.0(-1.0)',prior,later].join('\t')]),null,later);
  }
  const data='전체\t7.0\t8.0(+1.0)\t61.0\t61.0(-4.0)';
  for(const legend of ['(단위: % / () 표본 수)','단위: % / () 증감률','단위: %','단위: % / () 2015년 대비 증감']){
    assert.equal(notice([legend,...head.slice(1),data]),null,legend);
  }
  for (const h of ['일반\t정밀', '일반\t\t일반\t','합계']) assert.equal(notice([head[0],h,head[2],data]),null,h);
  assert.equal(notice([head[0],head[1],'2023\t2024\t2024\t2023',data]),null);
  assert.equal(notice([head[0],head[1],'2023\t2024\t2025\t2026',data]),null);
  assert.equal(notice([head[0],'\f',head[1],head[2],data]),null);
  assert.equal(notice([...head,'[표 2] 다른 표',data]),null);
  assert.equal(notice([...head,'합계\t60.0\t60.0(0.0)\t61.0\t61.0(-4.0)']),null);
});

test('비수도권이나 비정규직 질문에 수도권·정규직 열의 증감 오류를 옮기지 않는다', () => {
  function grid(headings) {
    return ['단위: % / () 증감', headings.join('\t\t') + '\t', '2023\t2024\t2023\t2024',
      '전체\t62.1\t62.1(-4.5)\t30.0\t35.0(+5.0)'];
  }
  for (const name of ['수도권', '정규직']) {
    const rows = grid([name, '비' + name]);
    assert.equal(notice(rows, '2024년 비' + name + ' 고용률'), null);
    assert.equal(notice(grid([name, '전국']), '2024년 비' + name + ' 고용률'), null);
    assert.equal(notice(rows, '2024년 ' + name + '을 제외한 고용률'), null);
    assert.equal(notice(rows, '2024년 비' + name + '과 ' + name + ' 고용률').comparisons[0].current.column, 2);
  }
  // The label in the table contains literal punctuation, a space, and a shared prefix.
  const grouped = grid(['특별(가)', '특별(가) 지역']);
  assert.equal(notice(grouped, '2024년 특별(가)지역 점검률'), null);
  assert.equal(notice(grouped, '2024년 특별(가) 점검률').comparisons[0].current.column, 2);
});

const columns = require('../docs/reader/evidence-columns.js');
const {search} = require('../docs/reader/evidence-search.js');

test('질문의 숫자가 다른 연도에 있어도 실제 검색 후보에는 지정한 연도와 지표의 원문 값을 표시한다', () => {
  const lines = ['발생년\t신고건수\t사망자수', '2022\t84\t1,261', '2023\t90\t1,402', '2024\t91\t1,263'];
  const query = '2024년 사망자는 1,402명이었다는 주장이 통계와 일치하나?';
  for (const format of [cells => cells.join('\t'), cells => '| ' + cells.join(' | ') + ' |', cells => cells.join('   ')]) {
    const text = lines.map(line => format(line.split('\t'))).join('\n');
    const {passages} = search(text, query);
    assert.equal(passages[0].paragraph, 4);
    assert.deepEqual(columns.annualMetricCell(text, query, passages[0]), {
      headerParagraph:1, rowParagraph:4, year:'2024', heading:'사망자수', column:3, value:'1,263'
    });
    assert.ok(passages.slice(1).every(p => columns.annualMetricCell(text, query, p) === null));
  }
});

test('연도별 교통사고 원표에서 휴일·계절에 해당하는 값은 같은 숫자의 연간 합계로 대신하지 않는다', () => {
  const table = require('../experiments/evidence-retrieval-transfer/nov25/holdout.json').lines.join('\n');
  function read(source, query) {
    const passage = search(source, query).passages[0];
    return columns.inspectAnnualRow(source, query, passage);
  }
  for (const phrase of ['설 연휴', '추석에는', '공휴일에', '여름', '겨울철', '연말', '주말']) {
    const answer = read(table, '2024년 ' + phrase + ' 교통사고 사망자는 2,521명이었나?');
    assert.equal(answer.rowParagraph, 5);
    assert.equal(answer.metric, null, phrase);
    assert.equal(answer.scopeIssue, 'period', phrase);
    assert.equal(answer.cells.find(cell => cell.heading === '사망자수').value, '2521');
  }
  assert.equal(read(table, '2024년 말 교통사고 사망자는 2,521명이었나?').scopeIssue, 'period');
  assert.equal(read(table, '2024년 교통사고 사망자는 2,521명이었나?').metric.value, '2521');
  const qualified = '연도\t사망자수\t설 연휴 사망자수\n2023\t65\t2\n2024\t72\t3';
  const match = read(qualified, '2024년 설 연휴 사망자는 몇 명이었나?');
  assert.equal(match.metric.value, '3');
  assert.equal(match.scopeIssue, undefined);
  for (const topic of ['돌봄', '설비', '연말정산']) {
    const withTopic = read('연도\t사고건수\n2023\t4\n2024\t8', '2024년 ' + topic + ' 사고건수는 8건인가?');
    assert.equal(withTopic.scopeIssue, 'population', topic);
    assert.equal(withTopic.metric, null, topic);
  }
});

test('비율·인구당 지표와 절대 건수, 복수 연도·항목, 중복 키·빈 칸·불연속 구간을 분리한다', () => {
  const lines = ['연도\t사망자수\t부상자수', '2023\t63\t90', '2024\t68\t95'];
  const cell = (source, question, paragraph=3) => columns.annualMetricCell(source.join('\n'), question,
    {paragraph, text:source.filter(s => s.trim())[paragraph - 1]});
  for (const query of ['2024년 인구 10만 명당 사망자 수는?', '2024년 사망자 수는 10%인가?',
    '2024년 사망자 수의 비율은?', '2024년 사망자와 부상자는 몇 명?', '2023년과 2024년 사망자 수는?',
    '2024년 3월 사망자 수는?', '2024년 전년 대비 사망자 수는?', '2024년 사망자 중 부상자의 비중은?',
    '2024년 사망자 대비 부상자 수는?', '2024년 비사망자 수는?', '2024년 사망자 증가분은?']) {
    assert.equal(cell(lines, query), null, query);
  }
  const differentMeasures = ['연도\t사망자수\t인구 10만 명당 사망자수\t치사율(%)', '2023\t63\t1.2\t2.1%', '2024\t68\t1.3\t2.3%'];
  assert.equal(cell(differentMeasures, '2024년 사망자 수는?').value, '68');
  assert.equal(cell(differentMeasures, '2024년 인구 10만 명당 사망자는?').value, '1.3');
  assert.equal(cell(differentMeasures, '2024년 인구 1만 명당 사망자는?'), null);
  assert.equal(cell(differentMeasures, '2024년 치사율은 몇 퍼센트인가?').value, '2.3%');
  assert.equal(cell(differentMeasures, '2024년 치사율은 몇 명인가?'), null);
  assert.equal(cell(differentMeasures, '2024년 치사율과 사망자는?'), null);
  assert.equal(cell(differentMeasures, '2024년 사망자와 인구 10만 명당 사망자는?'), null);
  const query = '2024년 사망자 수는?';
  for (const head of ['순번\t사망자수\t부상자수','연도\t사망자수\t사망자 수','연도\t사망자수(인구 10만명당)\t부상자수']) {
    assert.equal(cell([head,...lines.slice(1)],query),null,head);
  }
  for (const tail of ['2024\t72\t98', '2025\t\t120', '2025\t90', '2025\t70\t90\t100']) {
    assert.equal(cell([...lines,tail],query), null,tail);
  }
  assert.equal(cell([lines[0], lines[1], '', lines[2]], query),null);
  assert.equal(cell([lines[0], lines[1], '\f' + lines[2]], query),null);
  assert.equal(cell([lines[0], lines[1], '2024\t-\t95'],query),null);
});

test('원표에 없는 집단·지역을 물으면 전체를 집단의 수치로 표시하지 않는다', () => {
  const source = '연도\t사망자수\t어린이 사망자수\n2023\t300\t19\n2024\t350\t20';
  const find = query => search(source, query).passages.map(p => columns.annualMetricCell(source, query, p)).filter(Boolean);
  for (const query of ['2024년 여성 사망자 수는?', '2024년 사망자 중 65세 이상은 몇 명인가?',
      '2024년 부산에서 발생한 사망자는?', '2024년 청소년 사망자는 350명인가?',
      '2024년 대전 지역 어린이 사망자는?', '2024년 야간 교통사고 사망자 수는?', '2024년 음주운전 사고 사망자 수는?']) {
    assert.deepEqual(find(query), [], query);
  }
  assert.equal(find('2024년 어린이 사망자는?')[0].value, '20');
  assert.equal(find('공식 통계에서 2024년 사망자는 몇 명인가?')[0].value, '350');
  assert.deepEqual(find('2024년 교통사고 통계에서 사망자는 몇 명인가?'), []);
});

test('보관된 연간 전체 수치를 지역·교통수단·표준 분야의 값으로 특정하지 않는다', () => {
  const road = require('../experiments/evidence-retrieval-transfer/nov25/holdout.json').lines;
  const standards = require('../experiments/evidence-retrieval-transfer/annual-cells/holdout.json').lines;
  const read = (lines, q) => {
    const text = lines.join('\n');
    const answer = search(text, q).passages.map(p => columns.inspectAnnualRow(text, q, p)).find(Boolean);
    assert.ok(answer, q);
    return answer;
  };
  for (const q of ['2024년 서울 교통사고 사망자 수는 몇 명이었나?', '2024년 자전거 교통사고 사망자는 2,521명이었다.',
    '횡단보도 교통사고의 2024년 사망자 수는?', '2024년 교통사고 사망자 수는 서울시 기준 몇 명이었나?',
    '2024년 사망자는 몇 명인가? 자전거 사고만 따지면?']) {
    const a = read(road, q);
    assert.equal(a.scopeIssue, 'population', q);
    assert.equal(a.metric, null, q);
    assert.equal(a.cells.find(c => c.heading === '사망자수').value, '2521');
  }
  for (const q of ['2023년 환경 분야 폐지된 한국산업표준은 몇 종이었나?',
    '2023년 환경 부문에서 폐지된 한국산업표준은 몇 종이었나?', '2023년에 폐지된 일본산업표준은 몇 종이었나?']) {
    const a = read(standards, q);
    assert.equal(a.scopeIssue, 'population', q);
    assert.equal(a.metric, null, q);
  }
  for (const q of ['사망자는 2024년에 몇 명인가?', '공식 통계에 따르면 2024년 교통사고 사망자 수는 몇 명인가?'])
    assert.equal(read(road, q).metric.value, '2521', q);
  const detail = ['연도\t사망자수\t서울 자전거 사망자수', '2024\t51\t7'];
  assert.equal(read(detail, '2024년 서울 자전거 사망자는 몇 명인가?').metric.value, '7');
  assert.equal(read(detail, '2024년 서울 자전거 사망자는 강동구에서 몇 명인가?').metric, null);
  assert.equal(read(['연도\t폐지\t보유도로수', '2023\t17\t95'], '2023년에 폐지된 도로는 몇 곳인가?').metric.value, '17');
  for (const i of [0,1,3]) {
    const item = require('../experiments/evidence-retrieval-transfer/annual-cells/holdout.json').cases[i];
    assert.equal(read(standards, item.query).metric.value, item.expected.value);
  }
});

test('연간 기준·조회·기사 서술의 표현이 바뀌어도 대상이 명시된 부분집단과 전체를 구분한다', () => {
  const road = require('../experiments/evidence-retrieval-transfer/nov25/holdout.json').lines.join('\n');
  const demand = '연도\t신청건수\t성인 신청건수\n2024\t36\t11';
  function value(source, q) {
    const found = search(source, q).passages.map(p => columns.inspectAnnualRow(source, q, p)).find(Boolean);
    assert.ok(found, q);
    return found.metric?.value ?? null;
  }
  for (const q of ['2024년 기준 교통사고 사망자 수는 몇 명인가?', '2024년 한 해 교통사고 사망자 수는 2521명이다.',
    '2024년 교통사고로 인한 사망자 수는 몇 명인가?', '2024년에 교통사고 사망자 수가 2,521명으로 집계되었다.',
    '2024년 교통사고 사망자 수를 확인해줘.']) assert.equal(value(road, q), '2521', q);
  for (const q of ['2024년 서울 기준 교통사고 사망자 수는 몇 명인가?', '2024년 교통사고로 인한 보행자 사망자 수를 확인해줘.',
    '2024년 교통사고 사망자 수는 농촌 기준 몇 명인가?']) assert.equal(value(road, q), null, q);
  for (const q of ['2024년 기준으로 신청건수가 36건으로 기록되었습니다.', '2024년 한 해 성인 신청건수를 조회해 주세요.',
    '2024년 기준 성인 신청건수가 11건인지 확인해 줘.'])
    assert.equal(value(demand, q), q.includes('성인') ? '11' : '36', q);
  assert.equal(value(demand, '2024년 기준 성인 중 주민 신청건수를 확인해 줘.'), null);
});

test('화재·산재·일반 사망자를 교통사고 사망자로 자동 연결하지 않고 인쇄된 사건 종류를 확인한다', () => {
  const question = '2024년 교통사고 사망자 수는 몇 명인가?';
  const check = (header, row, q = question) => {
    const source = header + '\n' + row;
    return search(source, q).passages.map(p => columns.inspectAnnualRow(source, q, p)).find(Boolean);
  };
  for (const event of ['화재건수', '산업재해건수', '인원', '사고건수']) {
    const header = '연도\t' + event + '\t사망자수';
    const result = check(header, '2024\t100\t7');
    assert.equal(result.metric, null, event);
    assert.equal(result.scopeIssue, 'population', event);
    assert.equal(check(header, '2024\t100\t7', '2024년 사망자 수를 확인해줘.').metric.value, '7');
  }
  const mixed = '연도\t교통사고건수\t화재건수\t사망자수';
  assert.equal(check(mixed, '2024\t83\t17\t7').metric, null);
  for (const heading of ['교통사고건수', '교통사고 발생건수(건)'])
    assert.equal(check('연도\t' + heading + '\t사망자수', '2024\t100\t7').metric.value, '7');
  const categories = '연도\t교통사고 사망자수\t화재 사망자수';
  assert.equal(check(categories, '2024\t3\t7').metric.value, '3');
  assert.equal(check(categories, '2024\t3\t7', '2024년 화재 사망자 수를 확인해 줘.').metric.value, '7');
});

test('연도별 비율과 퍼센트포인트 변화량을 같은 셀로 안내하지 않는다', () => {
  const rates = '연도\t영업이익률(%)\n2023\t13.5%\n2024\t17.1%';
  const reported = '연도\t영업이익률(%)\t영업이익률 증감폭(%p)\n2023\t13.5%\t+1.2%p\n2024\t17.1%\t+3.6%p';
  const row = (source, query) => {
    const passage = search(source, query).passages.find(p => p.text.startsWith('2024'));
    assert.ok(passage, query);
    return columns.inspectAnnualRow(source, query, passage);
  };
  for (const q of ['몇 %p 올랐나?', '몇 퍼센트 포인트 올랐나?', '3.6%포인트 높아졌나?',
    '몇 퍼센트 상승했나?', '얼마나 떨어졌나?', '얼마나 늘어났나?']) {
    const checked = row(rates, '2024년 영업이익률은 ' + q);
    assert.equal(checked.metric, null, q);
    assert.deepEqual(checked.cells.map(c => c.value), ['17.1%']);
  }
  assert.equal(row(reported, '2024년 영업이익률은 몇 퍼센트였나?').metric.value, '17.1%');
  const q = '2024년 영업이익률 증감폭은 몇 퍼센트포인트인가?';
  assert.equal(row(reported, q).metric.value, '+3.6%p');
  assert.equal(row(reported.replace('+3.6%p', '+3.6%'), q).metric, null);
  assert.equal(row(reported, '2024년 영업이익률 증감폭은 몇 퍼센트인가?').metric, null);
  assert.equal(row(reported, '2024년 영업이익률과 영업이익률 증감폭은 각각 몇 퍼센트포인트인가?').metric, null);
});

test('연도 행에서 지표에 직접 묻는 단위, 열 표제와 원문 값의 단위 및 배율이 일치해야 한다', () => {
  const read = (heading, value, question) => {
    const source = '연도\t' + heading + '\n2024\t25\n2025\t' + value;
    const passage = {paragraph:3, text:'2025\t' + value};
    return columns.inspectAnnualRow(source, '2025년 ' + question, passage);
  };
  for (const [heading, value, q] of [
    ['지원자수(명)', '300', '지원자수는 300건이었나?'],
    ['지원자수(명)', '300건', '지원자 수는 300명이었나?'],
    ['지원자수', '300건', '지원자 수는 몇 명인가?'],
    ['지원자수(명)', '300건', '지원자 수는 얼마인가?'],
    ['지원자수(천명)', '300', '지원자 수는 300명이었나?'],
    ['지원자수(명)', '3천 명', '지원자 수는 몇 명인가?'],
    ['예산(억원)', '300', '예산은 약 300만원이었나?'],
    ['예산(원)', '27', '예산은 27억 달러였나?'],
    ['매출(억원)', '27', '매출은 27억 달러인가?'],
    ['매출(억 달러)', '27억 유로', '매출은 27억 달러인가?'],
    ['매출(억 엔)', '27', '매출은 27만 엔인가?']
  ]) {
    const answer = read(heading, value, q);
    assert.equal(answer.metric, null, q);
    assert.equal(answer.scopeIssue, 'unit', q);
    assert.equal(answer.cells[0].value, value, q);
  }
  assert.equal(read('지원자수(천 명)', '3천명', '지원자 수는 3천 명인가?').metric.value, '3천명');
  assert.equal(read('지원자수(명)', '300명', '앞서 신고한 12건을 확인한 결과 지원자 수는 몇 명인가?').metric.value, '300명');
  assert.equal(read('지원자수(명)', '300명', '지원자 수는 300명인가? 별도 자료는 12건이었다.').metric.value, '300명');
  assert.equal(read('사망자수', '300', '사망자 수는 몇 명이었나?').metric.value, '300');
  assert.equal(read('수입중량(kg)', '3kg', '수입중량은 3킬로그램인가?').metric.value, '3kg');
  for (const currency of ['달러', '유로', '엔'])
    assert.equal(read('매출(억 ' + currency + ')', '27억 ' + currency,
      '매출은 27억 ' + currency + '인가?').metric.value, '27억 ' + currency);
});

test('집계 단계를 표제에 연결할 수 없으면 전체나 일부 합격자 수를 단정하지 않는다', () => {
  const table = '연도\t합격자수(명)\t최종 합격자수(명)\n2023\t124\t72\n2024\t143\t87';
  const row = q => columns.inspectAnnualRow(table, '2024년 ' + q, {paragraph:3, text:table.split('\n')[2]});
  for (const q of ['합격자 수는 최종 발표 기준 몇 명이었나?', '예비 합격자 수는 몇 명이었나?',
    '잠정 집계로 합격자 수는 몇 명인가?', '최종 합격자 수와 예비 합격자 수는?', '2차 심사에서 합격자 수는?']) {
    const checked = row(q);
    assert.equal(checked.metric, null, q);
    assert.deepEqual(checked.cells.map(c => [c.heading,c.value]), [['합격자수(명)','143'], ['최종 합격자수(명)','87']]);
  }
  assert.equal(row('최종 합격자 수는 몇 명이었나?').metric.value, '87');
  assert.equal(row('합격자 수는 몇 명이었나?').metric.value, '143');
});

test('연도 행은 항목별 원문 값을 제공하고, 명시한 행정 행위 건수만 활용형으로 연결한다', () => {
  const lines = ['연도\t지정\t취소\t확인\t보유시설수','2019\t8\t2\t51\t103','2020\t9\t3\t49\t108'];
  const table = lines.join('\n');
  const passage = {paragraph:3, text:lines[2]};
  function inspect(query, source=table) { return columns.inspectAnnualRow(source, query, passage); }
  for (const [q, value] of [['2020년에 새로 지정한 시설은 몇 곳이었나?', '9'],
      ['2020년에 취소된 시설이 2건이라는 주장은 맞나?', '3']]) {
    assert.equal(columns.annualMetricCell(table, q, passage).value, value);
  }
  for (const q of ['2020년에 취소된 인증이 2건이라는 주장은 맞나?', '2020년에 확인한 결과 인증서는 몇 장이었나?', '2020년에 지정한 시설에서 나온 지출은 몇 건인가?',
    '2020년에 중소기업이 새로 지정한 시설은 몇 곳이었나?', '2020년에 지정한 시설 가운데 서울에 있는 것은 몇 곳이었나?', '2020년에 취소하지 않은 인증은 몇 건인가?',
    '2020년에 지정한 시설과 취소된 인증은 몇 건인가?', '2020년에 보유한 국립시설은 몇 곳인가?',
    '2020년 표의 이용 조건은 무엇인가?']) {
    const row = inspect(q);
    assert.equal(row.metric, null, q);
    assert.deepEqual(row.cells.map(c => [c.column, c.heading, c.value]),
      [[2,'지정','9'],[3,'취소','3'],[4,'확인','49'],[5,'보유시설수','108']],q);
    assert.equal(row.headerParagraph,1);
    assert.equal(row.rowParagraph,3);
  }
  assert.equal(inspect('2019년과 2020년 시설은 몇 곳인가?'),null);
  assert.equal(inspect('2018년 지정한 시설은 몇 곳이었나?'),null);
  assert.equal(inspect('2020년 표의 항목은?', table.replace('확인', '2021년')),null);
  assert.equal(inspect('2020년에 지정한 시설은?', table + '\n2021\t10\t4'),null);
});

test('연도가 가로로 인쇄된 표에서 이름과 물리적 행·열을 함께 찾고 질문 속 수치는 선택에 쓰지 않는다', () => {
  const rows = [['구분','2021년','2023년도','2022'], ['공구 반납(건)','31','92','17'],
    ['공구 대여(건)','81','1,270','92'], ['연장 대여(건)','90','51','92']];
  const q = '원표에서 2023년의 공구대여는 92건이라는 주장이 맞나?';
  for (const format of [parts => parts.join('\t'), parts => '| ' + parts.join(' | ') + ' |', parts => parts.join('   ')]) {
    const text = '\n' + rows.map(format).join('\n') + '\n';
    assert.deepEqual(columns.findYearMatrixCell(text,q), {
      headerParagraph:1,rowParagraph:3,rowLabel:'공구 대여(건)',year:'2023',heading:'2023년도',column:3,value:'1,270'
    });
  }
  const pipes = ['| 항목 | 2022 | 2023 |','|:---|---:|---:|','| 대여 | 11 | 17 |','| 수리 | 12 | 18 |'];
  const matrix = ['(단위: 만 원)',...pipes].join('\n');
  const cell = columns.findYearMatrixCell(matrix,'2022년 수리는 몇 만 원인가?');
  assert.equal(cell.value, '12');
  assert.equal(cell.headerParagraph, 2);
  assert.equal(cell.rowParagraph, 5);
  assert.equal(cell.column, 2);
  assert.equal(columns.findYearMatrixCell(matrix,'2022년 수리는 몇 원인가?'), null);
  const rentals = rows.map(parts => parts.join('\t')).join('\n');
  assert.equal(columns.findYearMatrixCell(rentals, '2023년 공구 대여 건수는 몇 건인가요?').value, '1,270');
  assert.equal(columns.findYearMatrixCell(rentals, '2023년 공구 대여(건)은 얼마였나?').value, '1,270');
  assert.equal(columns.findYearMatrixCell(rentals, '2023년 공구 대여(명)은 얼마였나?'), null);
  assert.equal(columns.findYearMatrixCell(rentals, '2023년 공구 대여 인원은?'), null);
  const counts = '구분\t2022\t2023\n회수 건수\t20\t13';
  assert.equal(columns.findYearMatrixCell(counts,'2023년 회수 건수는 몇 건인가?').value,'13');
  assert.equal(columns.findYearMatrixCell('단위: 명\n' + counts,'2023년 회수 건수는 몇 명인가?'),null);
});

test('합계·부분 집단·단위·기간·질문 종류의 차이를 해당 연도 셀로 대신하지 않는다', () => {
  const table = '구분\t2022\t2023\n재사용(건)\t12\t17\n최종 재사용(건)\t11\t16\n합계(건)\t30\t31';
  for (const q of ['2021년 재사용은 몇 건인가?', '올해 재사용은 몇 건인가?', '2023년 4분기 재사용은?',
    '2023년 9월 재사용은?', '2022~2023년 재사용은 몇 건인가?', '2023년 재사용은 전년 대비 얼마나 올랐나?',
    '2023년 재사용과 최종 재사용은?', '2023년 재사용은 몇 명인가?', '2023년 재사용은 17%인가?',
    '2023년 재사용 비중은?', '2023년 잠정 재사용은 몇 건인가?', '2023년 재사용은 동부 지점에서 몇 건인가?',
    '2023년 길잡이 프로그램 재사용은?', '2023년 바다팀의 합계는 몇 건인가?', '2023년 재사용은 원래 몇 건인가?',
    '2023년 미재사용은 몇 건인가?', '2023년 합계에서 재사용을 제외한 값은?', '2023년 재사용의 원인은?',
    '2023년 재사용의 단위는?', '2023년 재사용은 구입 비용이 17원인가?']) {
    assert.equal(columns.findYearMatrixCell(table, q), null, q);
  }
  assert.equal(columns.findYearMatrixCell(table, '2023년에 최종 재사용은 몇 건인가?').value, '16');
  assert.equal(columns.findYearMatrixCell(table, '2023년 합계는 몇 건인가?').value, '31');
});

test('연도 행렬의 결측·중복·밀린 셀·다른 표를 건너뛰어 임의로 값을 만들지 않는다', () => {
  const q = '2023년 점검은 몇 건인가?';
  const match = lines => columns.findYearMatrixCell(lines.join('\n'), q);
  const header = '구분\t2022\t2023', row = '점검(건)\t10\t21';
  for (const grid of [[header,row,'점 검(명)\t5\t9'], [header,row,'점검(건)\t1\t2'],
    ['구분\t2023\t2023',row], [header,'점검(건)\t10\t'], [header,'점검(건)\t10\t—'],
    [header,'점검(건)\t10\t21명'], [header,'점검\t10\t21'], [header,row,'\t점검(건)\t10\t21'],
    ['\t'+header,row], [header,row,'유지\t10'], [header,row,header,'정비\t10\t3'],
    [header,'정비\t11\t22','',row], [header,'\f'+row], ['단위: 명', header,row], [header,'점검(건)\t\t10\t21']]) {
    assert.equal(match(grid), null, JSON.stringify(grid));
  }
  assert.equal(match([header,'점검(건)\t\t21']).value,'21');
  assert.equal(match(['구분(건)\t2022\t2023','점검\t10\t21']).value,'21');
  assert.equal(match([header,'점검\t10건\t21건']).value,'21건');
  const rates = header + '\n달성률(%)\t30%\t41%\n조정폭(%p)\t+3%p\t−2.5%p';
  assert.equal(columns.findYearMatrixCell(rates, '2023년 달성률은 몇 퍼센트인가?').value,'41%');
  assert.equal(columns.findYearMatrixCell(rates, '2023년 조정폭은 몇 퍼센트포인트인가?').value,'−2.5%p');
  assert.equal(columns.findYearMatrixCell(rates, '2023년 달성률은 몇 %p인가?'),null);
  assert.equal(columns.findYearMatrixCell(rates, '2023년 조정폭은 몇 퍼센트인가?'),null);
});

test('직접 볼 수 있는 행렬에는 원문 표제·단위 줄·빈 셀·줄 전체와 검색기 문단 번호가 남는다', () => {
  const raw = '  | 정기 작업(건) | 1,005 |   |  ';
  const source = ['','','  (단위: 건) ', '| 구분 | 2022년 | 2023년도 |', '|:---|---:|---:|', raw,
    '| 야간 정비 | — | +8 |','',''].join('\r\n');
  const matrix = columns.parseYearMatrix(source);
  assert.deepEqual(matrix, {headerParagraph:2, headers:['구분','2022년','2023년도'], years:['2022','2023'],
    rows:[{paragraph:4,label:'정기 작업(건)',values:['1,005',''],text:raw},
      {paragraph:5,label:'야간 정비',values:['—','+8'],text:'| 야간 정비 | — | +8 |'}],
    caption:null,legend:{paragraph:1,text:'  (단위: 건) '}});
  const {find} = require('../docs/reader/evidence-finder.js');
  const passage = find(source,'정기 작업에서 나온 자료', {includeContext:true}).find(p => p.text === raw);
  assert.equal(passage.paragraph, matrix.rows[0].paragraph);
  for (const extra of ['\n다른 설명', '\n\n구분\t2022\t2023\n다른 행\t1\t2', '\f']) {
    assert.equal(columns.parseYearMatrix(source + extra),null);
  }
  assert.equal(columns.parseYearMatrix('구분\t2022\t2023'),null);
  const noLegend = columns.parseYearMatrix('대상\t2022\t2023\n지점별\t+7\t14');
  assert.equal(noLegend.legend,null);
  assert.deepEqual(noLegend.headers,['대상','2022','2023']);
});

test('긴 질문은 이름이 명시된 한 행으로만 이동하고 단위와 하위 집단을 대입하지 않는다', () => {
  const source = '구분\t2022\t2023\n정기 정비\t7\t9\n정비\t6\t8\n반납\t11\t12\n갑\t3\t4';
  const matrix = columns.parseYearMatrix(source);
  const target = {headerParagraph:1, rowParagraph:2, rowLabel:'정기 정비',year:'2023'};
  for (const q of ['2023년 정기 정비 중 특수 차량에 쓰인 금액은 몇 만 원이었나?',
    '원문을 보면 2023년 별관에서 시행한 정기 정비에는 몇 명이 참여했나?',
    '2023년에 정기정비의 전체 건수가 얼마였는지 확인할 수 있을까요?']) {
    assert.equal(columns.findYearMatrixCell(matrix,q),null,q);
    assert.deepEqual(columns.findYearMatrixRow(matrix,q),target,q);
  }
  for (const q of ['2023년 정기 정비와 정비 기록은?', '2023년 반납과 정기정비의 실적은?',
    '2023년 미정비는 몇 건인가?', '2023년 정비소에서 작업했나?', '2023년 갑은 왜 많은가?',
    '정기 정비 내역은?', '2024년 정기 정비 기록을 알려줘', '2022년부터 2023년까지 정기정비는?',
    '올해 정기 정비는?', '2023년 정기 정비가 전년보다 얼마나 늘었나?', '2023년 정기 정비는 얼마나 늘어났나?',
    '3월 자료를 보면 2023년에 정비는 얼마나 잦았나?']) {
    assert.equal(columns.findYearMatrixRow(matrix,q),null,q);
  }
  assert.equal(columns.findYearMatrixRow(columns.parseYearMatrix(source+'\n정 비(건)\t0\t1'),'2023년 정비는?'),null);
  const overlap = columns.parseYearMatrix('구분\t2022\t2023\n기록 센터\t1\t2\n센터 방문\t3\t4');
  assert.equal(columns.findYearMatrixRow(overlap, '2023년 기록 센터 방문 현황을 알려줘'),null);
});

test('표의 기준과 네 위치의 인쇄 단위를 지키고 유니코드 공백 TSV 칸을 이동시키지 않는다', () => {
  const header = '구분\t2023년\t2024년', row = '방문자 수(명)\t+5\t+8';
  const q = '2024년 방문자 수는 몇 명인가?';
  for (const stub of ['구분(전년 대비 증감)', '잠정 인원', '항목(유료 회원만)']) {
    const matrix = columns.parseYearMatrix(header.replace('구분',stub) + '\n' + row);
    assert.equal(matrix.headers[0],stub);
    assert.equal(columns.findYearMatrixCell(matrix,q),null);
    assert.deepEqual(columns.findYearMatrixRow(matrix,q),{headerParagraph:1,rowParagraph:2,rowLabel:'방문자 수(명)',year:'2024'});
  }
  for (const whitespace of ['', ' ', '\u00a0', '\u3000']) {
    assert.equal(columns.parseYearMatrix(header + '\n' + whitespace + '\t' + row),null);
    assert.equal(columns.parseYearMatrix(whitespace + '\t' + header + '\n' + row),null);
  }
  const source = '단위: 명\n구분(명)\t2023년\t2024년\n방문자 수(명)\t+5명\t−8명';
  assert.equal(columns.findYearMatrixCell(columns.parseYearMatrix(source),q).value,'−8명');
  for (const changed of [source.replace('단위: 명','단위: 천 명'),source.replace('구분(명)','구분(건)'),
    source.replace('수(명)','수(천 명)'),source.replace('−8명','−8건')]) {
    assert.equal(columns.findYearMatrixCell(columns.parseYearMatrix(changed),q),null);
  }
});

test('한글·라틴 약어·한자 행을 같은 표로 읽고 대소문자만 다른 중복 및 숫자만 있는 표제는 유보한다', () => {
  const source = '구분\t2022년\t2023년\n공구 대여(건)\t7\t9\nPV\t2\t3\nLNG\t10\t14\n甲種\t3\t6';
  const matrix = columns.parseYearMatrix(source);
  assert.deepEqual(matrix.rows.map(row => row.label), ['공구 대여(건)','PV','LNG','甲種']);
  assert.equal(columns.findYearMatrixCell(matrix,'2023년 공구 대여는 몇 건인가?').value,'9');
  assert.equal(columns.findYearMatrixRow(matrix,'2023년 PV를 어느 곳에 두었나?').rowParagraph,3);
  assert.equal(columns.findYearMatrixRow(matrix,'2023년 PV와 LNG 실적은?'),null);
  for (const name of ['Pv','12.5','']) assert.equal(columns.parseYearMatrix(source+'\n'+name+'\t4\t5'),null);
});

test('번호가 붙은 원문 표 제목과 선택적 단위의 위치를 유지하고 제목의 적용 범위를 수치로 단정하지 않는다', () => {
  const rows = ['구분\t2021년\t2022년','열람 신청(건)\t7\t+9','원문 대출(건)\t17\t11'];
  const query = '2022년 열람 신청은 몇 건인가?';
  assert.equal(columns.findYearMatrixCell(rows.join('\n'),query).value,'+9');
  const {find} = require('../docs/reader/evidence-finder.js');
  for (const caption of ['표 8. 1월 열람 실적','  <표 12> 정회원 연간 이용 건수의 전년 대비 증감  ',
    '[표 7-1] 야간 이용자 합계']) {
    for (const units of [[],['  (단위： 건) ']]) {
      const source = ['',caption,...units,...rows,''].join('\n');
      const grid = columns.parseYearMatrix(source);
      assert.deepEqual(grid.caption,{paragraph:1,text:caption});
      assert.deepEqual(grid.legend,units.length ? {paragraph:2,text:units[0]} : null);
      assert.equal(grid.headerParagraph,2 + units.length);
      const row = grid.rows[0];
      assert.deepEqual(row,{paragraph:3 + units.length, label:'열람 신청(건)',values:['7','+9'],text:rows[1]});
      const hit = find(source,'열람 신청', {includeContext:true}).find(p => p.text === rows[1]);
      assert.equal(hit.paragraph,row.paragraph);
      assert.equal(columns.findYearMatrixCell(grid,query),null);
      assert.deepEqual(columns.findYearMatrixRow(grid,query),{headerParagraph:grid.headerParagraph,
        rowParagraph:row.paragraph,rowLabel:row.label,year:'2022'});
    }
  }
});

test('표 번호만 있거나 다른 문단·제목·표가 끼면 행렬에 임의로 붙이지 않는다', () => {
  const grid = '항목\t2021\t2022\n보수\t8\t9';
  for (const preamble of ['표 4', '[표 4]', '<표 3> 2022년도', '표 7 (단위: 건)', '표 7 단위: 건',
    '<표 3] 외부 열람', '위 표 4의 설명', '표 4를 참고하면', '표 4 에 따르면', '표 4 참조',
    '표 4 보수 내역을 설명한다.', '표 4 보수 내역을 설명한다', '[표 4] [표 5] 보수 내역', '표 7\t보수 내역', '그림 4. 보수 내역',
    '보수 내역', '자료를 옮겼다.\n표 4 보수 내역', '<표 4> 보수 내역\n[표 5] 대출 현황',
    '표 4 보수 내역\n다음 쪽 통계에서 발췌', '단위: 건\n표 4 보수 내역', '표 4 보수 내역\n단위: 건\n단위: 명']) {
    assert.equal(columns.parseYearMatrix(preamble+'\n'+grid),null,preamble);
  }
  assert.equal(columns.parseYearMatrix('표 4 보수 내역\n'+grid+'\n[표 5] 정비 현황\n'+grid),null);
});
