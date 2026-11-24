const {test} = require('node:test');
const assert = require('node:assert/strict');
const {find, tableAmbiguities} = require('../docs/reader/evidence-finder.js');

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

test('본문 표와 뒤쪽 통계표 번호가 같으면 제목과 붙여넣은 문단 위치를 구분한다', () => {
  const doc = [
    '[표 1] 출생아 수, 조출생률 및 합계출산율, 2013-2023',
    '[표 12] 다태아 출생, 2013-2023',
    '',
    '\f 통    계    표',
    '1. 출생아 수, 조(粗)출생률 및 합계출산율, 1970-2023 ······30',
    '12. 시군구별 출생아 수 및 합계출산율, 2023 ······41',
    '\f 1. 출생아 수, 조(粗)출생률 및 합계출산율, 1970-2023',
    '(단위: 명, 인구 1천 명당 명)',
    '\f 12. 시군구별 출생아 수 및 합계출산율, 2023',
    '지역    출생아 수    합계출산율',
    '전국    230,028    0.72'
  ].join('\r\n');
  const hits = tableAmbiguities(doc, '[표 12]에서 표 1과 비교한 수치는?');
  assert.deepEqual(hits.map(g => [g.number, g.headings.map(h => [h.kind, h.paragraph])]), [
    ['12', [['caption', 2], ['statistics', 8]]],
    ['1', [['caption', 1], ['statistics', 6]]],
  ]);
  assert.deepEqual(hits[0].headings.map(h => h.title), ['다태아 출생, 2013-2023', '시군구별 출생아 수 및 합계출산율, 2023']);
  assert.ok(find(doc, '표 12에서 출생아 수').length);
  for (const q of ['시군구별 출생아 수', '득표 12', '표 12개를 비교', '표 12-1', '표 1.2', '지표 12', '표 2']) {
    assert.deepEqual(tableAmbiguities(doc, q), [], q);
  }
});

test('다른 제목이 실재하는 표 본문이 없으면 목차·번호 매긴 설명·반복 제목만으로 경고하지 않는다', () => {
  const doc = [
    '[표 12] 지역별 조사 규모 ········8', '[표 12] 지역별 조사 규모',
    '[표 12] 지역별   조사 규모', '12. 별도 항목', '단위: 명',
    '통 계 표', '12. 조사 방법을 확인하세요.', '조사는 대상과 기간을 다룬다.',
    '12. 운영 안내', '차례를 따라 작성한다.',
    '12. 다른 통계표 이름 ······35', '12. 지역별 조사 규모', '단위: 명',
    '부록  조사 개요', '12. 부록의 다른 항목', '단위: 명',
  ].join('\n');
  assert.deepEqual(tableAmbiguities(doc, '표 12에 따르면'), []);
  const plain = '12. 첫 번째 설명\n12. 두 번째 설명\n1 2 3';
  assert.deepEqual(tableAmbiguities(plain, '표 12'), []);
  assert.deepEqual(tableAmbiguities('[표 1] 큰 제목\n부록\n1. 다른 항목', '표 1'), []);
});

test('연도·단위·열 제목이 떨어진 지출 표에서도 반증할 행을 찾고 원문을 그대로 돌려준다', () => {
  const amount = '  지출액      13,091     2,121      738     10,970';
  const doc = [
    '1. 일반회계 예비비 규모 ······20',
    '다른 기금의 2023년도 지출액은 당초 예산보다 늘었다.',
    '[최근 4년간 일반회계 예비비 집행 실적]', '(단위: 억원)', '일반회계   목적예비비',
    '예비비   소계   재해대책   일반예비비',
    '2022 지출결정액   49,415    33,888     5,437    15,527',
    '지출액     47,049    33,473     5,437    13,575',
    '예산      46,000    28,000         -    18,000',
    '2023 지출결정액   13,940     2,121       738    11,818', amount,
    '\f', '다음 쪽의 다른 표'
  ].join('\n');
  const [hit] = find(doc, '2023년 일반회계 예비비 지출액은 13,091억원이었다.', {includeContext: true});
  assert.equal(hit.text, amount);
  assert.equal(hit.paragraph, 11);
  assert.ok(hit.matched.includes('13091억'));
  assert.deepEqual(hit.context.map(x => x.paragraph), [3, 4, 5, 6, 9, 10]);
  assert.ok(find(doc, '2023년 일반회계 예비비 지출액은 1조 3,940억 원이었다.').some(x => x.text === amount));
});

test('돈 단위를 열이 섞인 표·자료 주석·연도 이름에 옮겨 붙이지 않는다', () => {
  const doc = ['[표 1] 올해 예산', '[단위: 억원]', '2023    37     53', '주: 비교에 유의',
    '다른 지역   38     54', '[표 2] 전년 비교', '(단위: 억원, %)', '이전 지역   39     55'].join('\n');
  assert.equal(find(doc, '37억')[0].paragraph, 3);
  for (const q of ['2023억', '38억', '39억', '55억']) assert.deepEqual(find(doc, q), [], q);
});

test('음수·양수와 퍼센트포인트 단위를 구분하고 연도 범위의 끝을 양수로 찾는다', () => {
  const doc = '변동률 −0.8%\n변동률은 +0.8%p\n변동률 +0.8%\n2013-2023년 현황';
  assert.deepEqual(find(doc, '0.8 퍼센트').map(x => x.paragraph), [3]);
  assert.deepEqual(find(doc, '-0.8%').map(x => x.paragraph), [1]);
  assert.deepEqual(find(doc, '0.8퍼센트포인트').map(x => x.paragraph), [2]);
  assert.equal(find(doc, '2023년')[0].paragraph, 4);
});

test('연도·연월을 명시한 질문과 표 행의 첫 칸이 다를 때 두 날짜를 구분한다', () => {
  const {different} = require('../docs/reader/evidence-period.js');
  const hit = {text: '2021    17,432     7.8', paragraph: 4, context: [
    {paragraph: 1, text: '연도   거래액    비율'}, {paragraph: 3, text: '2020    16,094     6.5'}]};
  assert.deepEqual(different('2022회계연도 거래액은 17,432억 원이었다.', hit), {requested:'2022년', source:'2021년'});
  for (const label of ['2023년 11월', '2023. 11.', '2023-11', '2023/11']) {
    const row = {text:'| 2023. 10. | 32,890 | 42.5 |', paragraph: 2, context: []};
    assert.deepEqual(different(label+'의 매출은 32,890이었다.', row), {requested:'2023년 11월', source:'2023년 10월'});
  }
  assert.deepEqual(different('2022년 수치는 19.5다.', {text:'2021년  \t19.5', context:[]}), {requested:'2022년', source:'2021년'});
  assert.equal(different('2021년 1월 매출 17,432', hit), null);
});

test('비교 기간, 숫자 열, 돈·기간의 혼동, 같은 시점에는 날짜 차이를 단정하지 않는다', () => {
  const {different} = require('../docs/reader/evidence-period.js');
  const h = {text:'2021년 7월   42.5    495', paragraph:3, context:[]};
  for (const q of ['2020~2022년 매출 42.5', '2020년과 2022년의 값', '2022년 6월 전년 동월 대비', '2022년 1-6월의 거래액',
    '2022년 상반기 실적', '2022년부터 3개월간', '2022년 5월과 7월', '매출 2,022억원', '2021년 7월 42.5건']) assert.equal(different(q, h),null,q);
  for (const text of ['부산    2021    42.5', '2021년 4분기   42.5', '2021~2022  42.5', '2021년 7월 통계를 발표했다.',
    '2021년 8월   2020년 8월   42.5', '2021   42.5']) assert.equal(different('2022년 5월 실적', {text,context:[]}),null,text);
  for (const header of ['구분  2021년  2022년', '금액(원)   빈도']) {
    const ctx = [{paragraph:1,text:header},{paragraph:2,text:'2020   41.5'}];
    assert.equal(different('2022년 5월 거래액', {text:'2021    42.5',paragraph:3,context:ctx}),null);
  }
});

test('한 날짜의 관측값을 물으면 다른 날짜의 같은 수치보다 날짜·열이 맞는 행을 먼저 보여 준다', () => {
  const chart = [
    '관측일자\t저수율', '2025\t08월 09일\t78.5', '2025\t08월 06일\t65.7',
    '', '관측일자\t평균기온', '2025-08-06\t19.2', '2025-08-09\t18.4'
  ].join('\n');
  assert.equal(find(chart, '2025년 8월 6일 저수율은 78.5%였나?')[0].paragraph, 3);
  assert.equal(find(chart, '2025년 8월 9일 평균기온은 19.2도였나?')[0].paragraph, 6);
  const stamped = '설치일자\t보급률\n2025-07-01T13:00:00Z\t38.1\n2025-08-01T15:00:00Z\t46.2';
  assert.equal(find(stamped, '2025년 7월 1일 보급률은 46.2%였나?')[0].paragraph, 2);
});

test('적용기간 밖의 공고일과 금액에 끌리지 않고 비교 문장은 기존 일반 검색으로 살핀다', () => {
  const a = "'24.03.01 ~ '25.02.28\t1,200\t2024.02.15";
  const b = "'25.03.01 ~ '26.02.28\t1,350\t2025.02.17";
  const src = ['적용기간\t운임\t공고일자', a, b].join('\n');
  const [hit] = find(src, '2025년 2월 운임은 1,350원이었나?');
  assert.equal(hit.text, a);
  assert.equal(hit.paragraph, 2);
  assert.equal(find(src, '2025년 3월 운임은 1,200원이었나?')[0].text, b);
  assert.equal(find(src, '운임은 2025년 2월 전월 대비 1,350원 증가했다')[0].text, b);
});

test('같은 날짜만 있는 다른 항목의 표보다 질문한 항목의 일반 원문이 앞선다', () => {
  const doc = '측정일시\t수온\n2025년 7월 1일\t27.1\n강수량은 54.1 mm로 관측됐다.';
  assert.equal(find(doc, '2025년 7월 1일 강수량은 54.1 mm였나?')[0].paragraph, 3);
});

test('열 이름을 풀어 쓴 질문에서도 숫자가 같은 다른 연도보다 올바른 연도 행을 찾는다', () => {
  const doc = ['< 연도별 도서관 운영 >','연도\t도서대출건수(건)\t대여기간(일)',
    '2019년\t420\t18','2020년\t316\t15','2021년\t802\t12','3년평균\t512.7\t15'].join('\n');
  const hit = find(doc, '2020년에 도서 대출이 802건이라는 설명을 어느 행에서 확인할까?', {includeContext: true})[0];
  assert.equal(hit.paragraph,4);
  assert.equal(hit.text,'2020년\t316\t15');
  assert.ok(hit.context.some(r=>r.text.includes('도서대출건수')));
  assert.equal(find(doc,'한 해 평균 도서 대출은 몇 건이었을까?')[0].paragraph,6);
});

test('단위 머리글이 따로 있으면 지표명과 위치를 맞추고 통계표 밖의 문장에 연결하지 않는다', () => {
  const doc=['연도\t대여건수\t이용자수','(건)\t(명)','2019\t410\t24','2020\t362\t30'].join('\n');
  assert.equal(find(doc,'이 통계에서 대여 건수와 이용자 수의 단위는 각각 무엇인가?')[0].paragraph,2);
  assert.equal(find(doc,'이 표의 단위는 무엇인가?')[0].paragraph,2);
  const text = doc + '\n별도 조사에 따르면 2020년 야외 행사 대여 장비는 512세트였다.';
  assert.equal(find(text,'2020년 야외 행사 대여 장비는 512세트였나?')[0].paragraph,5);
});

test('여러 표, 겹치는 연도 키, 금액 식별자는 한 표의 연도 키로 간주하지 않는다', () => {
  const q='2019년 도서 대출은 789건이 맞나?';
  const first='연도\t도서대출건수(건)\n2019년\t91\n2020년\t478';
  const other='연도\t장비대여건수(건)\n2019년\t51\n2020년\t789';
  assert.equal(find(first+'\n'+other+'\n2019년 도서 대출 공식 집계는 72건이었다.',q)[0].paragraph,7);
  assert.equal(find(first+'\n2019년\t789',q)[0].paragraph,4);
  const prices='금액(원)\t물품거래건수(건)\t수량(개)\n2019\t44\t11\n2020\t789\t25';
  assert.equal(find(prices,'2019년 물품 거래가 789건, 수량 25개였나?')[0].paragraph,3);
});

test('기간 평균·합계의 기간과 집계방식이 맞는 행만 우선한다', () => {
  const doc=['연도\t이용건수(건)','2018\t800','2019\t920','2020\t620',
    '2년평균\t770','3년평균\t780','3년합계\t2340'].join('\n');
  assert.equal(find(doc, '최근 2년 간 이용 건수 평균이 780건인가?')[0].paragraph,5);
  assert.equal(find(doc, '최근 3년간 이용 건수 합계는 몇 건인가?')[0].paragraph,7);
  // An explicitly bounded period does not designate the generic three-year summary.
  assert.notEqual(find(doc,'2019년 이용 건수 평균은 920건인가?')[0].paragraph,6);
});

test('표에 없는 물리량을 요청하면 같은 연도만 있는 후보를 보류하되 계산 요청은 보존한다', () => {
  const doc=['연도\t물류센터등록건수(건)\t저장중량(kg)','2018\t12\t410','2019\t17\t453'].join('\n');
  assert.deepEqual(find(doc,'2019년 물류센터 진입로는 몇 킬로미터였나?'), []);
  assert.equal(find(doc,'2019년 저장 중량이 410킬로그램이었나?')[0].paragraph,3);
  const plot=['연도\t정원길이(m)\t너비(m)','2018\t10\t20','2019\t14\t30'].join('\n');
  assert.ok(find(plot,'2019년 정원 길이와 너비로 계산한 면적은 몇 제곱미터인가?').length);
});

test('다단 표는 범위 표기와 집단을 맞추고 수치가 같은 다른 집단을 우선하지 않는다', () => {
  const source=['【운동 참여율】','(단위: % / () 전기 대비 격차)','실내활동       실외활동','구     분',
    '2018  2020  2022     2018  2020  2022',
    '전체          21  23  32(9)     42  41  47(6)',
    '18∼24세       12  13  14(1)     30  29  26(-3)',
    '연', '25∼34세       21  75  84(9)     31  23  24(1)',
    '령', '35세이상      11  10  21(11)    41  40  84(44)',
  ].join('\n');
  const q='2020년 25세~34세의 실내활동 참여율이 84%였나?';
  const [hit]=find(source,q,{includeContext:true});
  assert.equal(hit.paragraph,9);
  assert.equal(hit.text,source.split('\n')[8]);
  assert.ok([1,2,3,5].every(i=>hit.context.some(c=>c.paragraph===i)));
  assert.equal(find(source,'2022년 35살 이상 실외활동 참여율이 궁금하다.')[0].paragraph,11);
  assert.equal(find(source,'2018년 전체 실내활동 참여율은 얼마인가?')[0].paragraph,6);
  assert.equal(find(source,'운동 참여율 표의 괄호 속 수치가 무엇을 가리키는가?')[0].paragraph,2);
});

test('이상·초과, 이하·미만을 분리하며 집단 수치와 메타데이터 질문을 구분한다', () => {
  const source=['【훈련 이수율】','(단위: %)','이수율   수료율','2017   2019',
    '합계     62      63', '5년미만     45      94', '5년이하    53      29',
    '5년이상    78      67', '5년초과    65      63',
    '주: 괄호 안 수치는 지난 조사와의 차이를 뜻한다.'
  ].join('\n');
  assert.equal(find(source,'근속 5년 이하 이수율은 94%인가?')[0].paragraph,7);
  assert.equal(find(source,'근속 5년 초과 수료율은 67%인가?')[0].paragraph,9);
  assert.equal(find(source,'근속 5년 이상 이수율은 65%인가?')[0].paragraph,8);
  assert.equal(find(source,'훈련 이수율에 적힌 괄호의 의미는 무엇인가?')[0].paragraph,10);
});

test('비율 표는 시간·가격의 직접 근거로 올리지 않으며 뒤에 있는 실제 시간 설명을 검색한다', () => {
  const source=['【활동별 참여】','(단위: %)','실외   실내','2018   2020',
    '전체    21  22','10∼19세    13  34','20세이상    41  42'].join('\n');
  const q='10~19세의 실외 활동은 하루 몇 분이었나?';
  assert.deepEqual(find(source,q), []);
  assert.deepEqual(find(source,'10~19세 실외 참가 가격이 34원이었나?'), []);
  const withText=source+'\n별도 조사에서 10~19세의 실외 활동은 하루 36분이었다.';
  assert.equal(find(withText,q)[0].paragraph,8);
});

test('같은 집단이 여러 열표에 나오면 주제까지 대조하고, 새로운 줄이나 쪽의 설명을 이어 붙이지 않는다', () => {
  const first=['【지역 소득】','근로소득    자산소득','2019    2021','전체    14  17','60세이상    15  18'].join('\n');
  const next=['【건강 조사】','걷기빈도     운동빈도','2019    2021','전체   22  18','60세이상   21  39'].join('\n');
  const [hit]=find(first+'\n\f'+next,'2021년 60세 이상 걷기빈도가 18이었나?',{includeContext:true});
  assert.equal(hit.paragraph,10);
  assert.ok(hit.context.every(h=>h.paragraph>5));
});

const equipmentTable = [
  '(단위: 천 원, %)', '기간\t2021년\t2022년', '3월\t4월\t3월\t4월',
  '대  여\t34\t52\t18\t41', '(전년동기대비)\t(8)\t(1)\t(△4)\t(6)',
  '(전월대비)\t(12)\t(4)\t(△7)\t(8)', '판  매\t9\t40\t68\t75',
  '(전년동기대비)\t(6)\t(5)\t(△2)\t(1)'
];

test('다단 원표의 지표와 비교 기준을 맞추고 헤더·상위 지표와 발췌문 공백을 보존한다', () => {
  const chart = equipmentTable.join('\n');
  assert.equal(find(chart, '2022년 3월 대여액이 68천 원인가?')[0].text, equipmentTable[3]);
  const [rate] = find(chart, '2022년 3월 대여는 전월 대비 몇 퍼센트 줄었나?', {includeContext:true});
  assert.equal(rate.text, equipmentTable[5]);
  assert.ok([0,1,2,3].every(i => rate.context.some(c => c.text === equipmentTable[i])));
  assert.equal(find(chart, '2022년 3월 판매는 전년 동기 대비 몇 퍼센트 변했나?')[0].text, equipmentTable[7]);
  assert.deepEqual(find(chart, '2022년 3월 대여 물량은 몇 kg인가?'), []);
});

test('열에 없는 기간이나 관련 없는 문장 뒤의 비교 행에 앞 지표의 이름을 부여하지 않는다', () => {
  const chart = equipmentTable.join('\n');
  const checks = [
    [chart, '2022년 7월 대여액이 68천 원인가?', equipmentTable[3]],
    [chart, '2022년 3월 판매는 전월 대비 몇 퍼센트 줄었나?', equipmentTable[7]],
    [chart.replace(equipmentTable[7], '별도 지표의 설명이다.\n' + equipmentTable[7]),
      '2022년 3월 판매는 전년 동기 대비 몇 퍼센트 줄었나?', equipmentTable[7]],
    [chart.replace('(단위: 천 원, %)', '(단위: 천 원)'), '2022년 3월 판매는 전년 동기 대비 몇 퍼센트 줄었나?', equipmentTable[7]]
  ];
  for (const [source, question, wrong] of checks) assert.notEqual(find(source, question)[0]?.text, wrong);
  const additional = '2022년 3월 대여 물량은 17 kg이었다.';
  assert.equal(find(chart + '\n' + additional, '2022년 3월 대여 물량은 몇 kg인가?')[0].text, additional);
});

test('명시한 단위가 없는 단독 표는 보류하고 주석과 다른 표에 있는 실제 자료는 계속 찾는다', () => {
  const chart = '장비 유형별 이용\n[단위: 건, 건/만 명, %]\n2019\t2020\n정비\t30\t18\n합계\t90\t85';
  const q = '2020년 정비 금액의 합계는 몇 원인가?';
  assert.deepEqual(find(chart, q), []);
  assert.deepEqual(find(chart + '\n1) 정비율 = 건수 ÷ 총인구', q), []);
  const note = '1) 2020년 정비 금액의 합계는 14만 원이다.';
  assert.equal(find(chart + '\n' + note, q)[0].text, note);
  const second = '정비 지출\n(단위: 원)\n2019\t2020\n정비 금액의 합계\t930\t1400';
  assert.equal(find(chart + '\n' + second, q)[0].text, '정비 금액의 합계\t930\t1400');
});

test('사건의 연도를 첫 열에 둔 표에서는 주장한 수가 다른 해에 있어도 요청한 연도·지표 행을 먼저 보여 준다', () => {
  const lines = ['신고년\t신고건수\t부상자수', '2018\t3800\t126', '2019\t4100\t132'];
  const doc = lines.join('\n');
  const hits = find(doc, '2018년 부상자는 132명이었나?', {includeContext: true});
  assert.equal(hits[0].paragraph, 2);
  assert.equal(hits[0].text, lines[1]);
  assert.ok(hits[0].context.some(row => row.text === lines[0]));
  const unrelated = ['번호\t부상자수', '2018\t126', '2019\t132'].join('\n');
  const [first] = find(unrelated, '2018년 부상자는 132명이었나?');
  assert.notEqual(first.paragraph, 2, '문서 번호에는 연도 표의 우선순위를 주지 않는다.');
});
