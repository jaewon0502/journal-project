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
