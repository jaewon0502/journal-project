const {test} = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');
const finder = require('../docs/reader/evidence-finder.js');
const fixture = require('../experiments/evidence-retrieval-transfer/base-rate-dates/holdout.json');

test('질문의 수치가 틀려도 원표 날짜의 행을, 역조회하면 인쇄값의 변경일을 찾는다', () => {
  for (const split of [false,true]) {
    const lines = !split ? fixture.lines : fixture.lines.map(line =>
      line.replace('(%)','').replace(/^(\d{4})년 /u,'$1\t').replace(' | ','\t'));
    for (const {id, query, expectedLine} of fixture.cases) {
      const {passages, gap, notice} = search(lines.join('\n'), query);
      if (!expectedLine) {
        assert.deepEqual(passages, []);
        assert.match(gap, /변경일자.*질문의 날짜가 없습니다/);
      } else {
        assert.equal(passages[0].paragraph, expectedLine);
        assert.equal(passages[0].text, lines[expectedLine - 1]);
        assert.deepEqual(passages[0].datedCell, {heading:split ? '기준금리' : '기준금리(%)',
          column:split ? 3 : 2, value:lines[expectedLine - 1].split(split ? '\t' : ' | ').at(-1)});
        assert.deepEqual(passages[0].context, [{paragraph:1, text:lines[0]}]);
        if (split && id !== 'bok-november-date') assert.match(notice, /단위가 없습니다/);
        assert.equal(gap, null);
      }
    }
    if (split) {
      const raw = search(lines.join('\n'), '원표에서 기준금리 수치가 2.250인 날짜는?');
      assert.deepEqual(raw.passages.map(p => p.paragraph), [6]);
      assert.match(raw.notice,/단위가 없습니다/);
    }
  }
});

test('같은 원문 값은 여러 날짜와 함께 두고 다른 열·단위·부호의 값은 가져오지 않는다', () => {
  const lines = ['관측일\t시험 농도(%)\t농도차(%p)',
    '2022-05-01\t0.50\t1.5', '2022-05-02\t1.5%\t0.5', '2022-05-03\t+1.50\t0', '2022-05-04\t−1.50\t1.5'];
  const query = '시험 농도가 1.50퍼센트인 날짜를 찾아줘.';
  assert.deepEqual(search(lines.join('\r\n'),query).passages.map(p => p.text), lines.slice(2,4));
  assert.deepEqual(search(lines.join('\n'),'농도차가 1.5%포인트인 날짜는?').passages.map(p => p.text), [lines[1],lines[4]]);
  const wrongUnit = '농도차가 1.5%인 날짜는?';
  assert.deepEqual(search(lines.join('\n'),wrongUnit).passages, finder.find(lines.join('\n'),wrongUnit,{includeContext:true}));
  const money = '공시일\t거래액(만원)\n2023.01.12\t27\n2023.02.25\t35';
  const otherScale = '거래액이 27억원인 날짜는?';
  assert.deepEqual(search(money,otherScale).passages, finder.find(money,otherScale,{includeContext:true}));
});

test('역조회의 연도·월과 값이 동시에 맞는 날짜만 남기고 여러 시점은 일반 검색에 맡긴다', () => {
  const lines = ['공시일\t가격(원)', '2022-05-01\t25', '2022-05-09\t34', '2022-06-01\t25', '2023-05-01\t25'];
  const doc = lines.join('\n');
  for (const [period, expected] of [['2022년',[2,4]], ['2022년 5월',[2]], ['2022년 5월 9일',[]]]) {
    const result = search(doc, period + ' 가격이 25원을 기록한 날짜는?');
    assert.deepEqual(result.passages.map(p => p.paragraph),expected);
    if (!expected.length) assert.match(result.gap, /기간과 수치/);
  }
  for (const prefix of ['지난해','2022년과 2023년','4월과 5월','전년 대비']) {
    const query = prefix + ' 가격이 25원인 날짜는?';
    assert.deepEqual(search(doc,query).passages, finder.find(doc,query,{includeContext:true}));
  }
});

test('여러 날짜에서 값이 반복되면 보이는 후보 수를 밝히고 어느 열인지 불분명하면 일반 검색을 유지한다', () => {
  const dates = ['03','05','09','13'];
  const doc = ['고시일 | 게시 가격(원)', ...dates.map(day => '2024.02.' + day + ' | 10.00')].join('\n');
  const result = search(doc, '게시 가격이 10원인 날짜는?');
  assert.deepEqual(result.passages.map(p => p.paragraph), [2,3,4]);
  assert.match(result.notice, /4개 중 처음 3개/);
  assert.equal(result.gap, null);
  const ambiguous = ['고시일 | 판매 가격(원) | 매입 가격(원)',
    '2024.02.06 | 18 | 25', '2024.02.07 | 25 | 27'].join('\n');
  const query = '가격이 25원인 날짜는?';
  assert.deepEqual(search(ambiguous,query).passages, finder.find(ambiguous,query,{includeContext:true}));
  const scoped = '관측일\t비수도권 가격(원)\n2023-05-01\t25\n2023-05-02\t35';
  assert.deepEqual(search(scoped,'비수도권 가격이 25원인 날짜는?').passages.map(p=>p.paragraph), [2]);
  for (const source of [scoped,scoped.replace('비수도권 가격','가격')]) {
    for (const value of [25,80]) {
      const regional = '수도권 가격이 ' + value + '원인 날짜는?';
      const result = search(source,regional);
      assert.deepEqual(result.passages, finder.find(source,regional,{includeContext:true}));
      assert.equal(result.gap,null);
    }
  }
});

test('합쳐지지 않는 표, 적용 중인 값과 비교 조건, 추가 기사 문맥은 기존 탐색에 맡긴다', () => {
  const source = '변경일자\t요율(%)\n2023.01.12\t3.00\n2023.02.25\t3.25';
  const normal = (doc,q,context = '') => {
    const actual = search(doc,q,{articleContext:context});
    assert.deepEqual(actual.passages, finder.find(doc,q,{includeContext:true}));
    assert.doesNotMatch(actual.gap || '', /열에 질문의 날짜가 없습니다/);
  };
  const q = '2023년 2월 20일 변경된 요율은 얼마인가?';
  normal(source,q,'그 뒤 발표된 수정분을 사용한다.');
  normal(source,'2023년 2월 20일 현재 적용되는 요율은 얼마였나?');
  normal(source,'요율이 3.00%가 아니었던 날짜는?');
  normal(source,'요율이 3% 이상이었던 날짜는?');
  normal(source,'요율이 3% 오른 날짜는?');
  normal(source,'다른 지표가 3.25%로 바뀐 날짜는?');
  for (const doc of [source + '\n(주) 수정', source + '\n' + source,
    source.replace('2023.02.25', '2023.02.30'), source.replace('3.25', '3.25%p'),
    source.replace('2023.02.25', '2023\t02월 25일'), source.replace('2023.02.25','\f2023.02.25')]) normal(doc,q);
});

test('정당별 같은 지지율을 각 표기의 날짜로 찾고 표기가 없거나 다른 정당이면 일반 검색으로 돌린다', () => {
  const series = ['조사일\t여당 지지율(%)\t야당 지지율(%)',
    '2024-03-01\t40\t35', '2024-03-08\t33\t40'].join('\n');
  for (const [party, paragraph] of [['여당',2],['야당',3]]) {
    const query = party + ' 지지율이 40%인 날짜는?';
    const rows = search(series,query).passages;
    assert.deepEqual(rows.map(hit => hit.paragraph),[paragraph]);
    assert.deepEqual(rows[0].datedCell,{heading:party + ' 지지율(%)',column:paragraph,value:'40'});
  }
  const single = '조사일\t여당 지지율(%)\n2024-03-01\t40\n2024-03-08\t33';
  for (const [doc, query] of [[series,'지지율이 40%인 날짜는?'],[single,'야당 지지율이 40%인 날짜는?']]) {
    assert.deepEqual(search(doc,query).passages, finder.find(doc,query,{includeContext:true}));
  }
  const fullWidth = single.replace('(%)','（％）').replace('\t40','\t４０．００');
  const raw = search(fullWidth,'여당 지지율이 40%인 날짜는?').passages[0];
  assert.deepEqual(raw.datedCell,{heading:'여당 지지율（％）', column:2, value:'４０．００'});
});
