const {test} = require('node:test');
const assert = require('node:assert/strict');
const {find} = require('../docs/reader/evidence-trend.js');

const report = [
  '2023년 연간 통계',
  '< 서비스 이용 추이 >',
  '        ’21년   ’22년   ’23년',
  '독서실 이용자(만명, 전년대비증감)    8.4     3.8     2.1',
  '온라인 가입자(만명, 전년대비증감)    8.4     3.8     2.1',
  '독서실 이용자(외국인, 만명, 전년대비증감)    8.4     3.8     2.1',
].join('\n');
const ambiguous = '증가 폭이 절반 수준으로 줄었습니다.';
const ask = (name, doc = report) => find(doc, ambiguous, {articleContext: '2023년 ' + name + ' 증가 2만 1천 명'});

test('비교 대상이 없는 문장과 숫자만 있는 둔화 주장을 보류한다', () => {
  assert.equal(find(report, ambiguous).reason, 'missing-subject');
  const raw = find(report, '올해 2만 명대로 떨어지는 등 2년 연속 증가 폭이 둔화했습니다.');
  assert.equal(raw.state, 'needs-context');
  assert.deepEqual(raw.hits, []);
  assert.equal(raw.needsPublicationDate, true);
});

test('다른 분야의 비교 대상·기간·단위와 일치한 행과 원래 열 머리글을 돌려준다', () => {
  const r = ask('독서실 이용자');
  assert.equal(r.usedArticleContext, true);
  assert.deepEqual(r.hits.map(h=>h.paragraph), [4]);
  assert.deepEqual(r.hits[0].context.map(v=>v.paragraph), [2,3]);
  assert.equal(r.hits[0].text, report.split('\n')[3]);
  assert.deepEqual(r.hits[0].years, [2021,2022,2023]);
  assert.equal(ask('온라인 가입자').hits[0].paragraph, 5);
  assert.deepEqual(ask('수출품').hits, []);
  assert.deepEqual(ask('독서실 이용자', report.split('\n').filter(l=>!l.startsWith('독서실 이용자(만명')).join('\n')).hits, []);
});

test('표 머리글과 숫자 열 수가 다르거나 다른 시점·단위·하위집단이면 보류한다', () => {
  for (const altered of [
    report.replace('2023년 연간 통계','2023년 11월 통계'),
    report.replaceAll('만명,','만건,'),
    report.replace('’23년','’25년'),
    report.replaceAll('8.4     3.8','8.4     0.3     3.8'),
    report.replaceAll('전년대비증감','전년대비증감률'),
    report.replaceAll('전년대비증감','취업자'), // No year-over-year change label.
    report.replace('’21년   ’22년   ’23년','2016년 2017년 2018년'),
    report.replace('2023년 연간 통계','1923년 연간 통계'),
    report.replaceAll('만명, 전년대비증감','내국인, 만명, 전년대비증감'),
  ]) assert.deepEqual(ask('독서실 이용자', altered).hits, [], altered);
  assert.deepEqual(ask('20대 독서실 이용자').hits, []);
});

test('다른 수치를 주장해도 지표와 연도가 맞는 표는 후보가 된다', () => {
  const r = find(report, '독서실 이용자 증가폭이 반토막 났다.', {articleContext:'2023년 독서실 이용자 증가 99만 명'});
  assert.equal(r.hits[0]?.paragraph,4);
});

test('앞 행에서 지표를 이어받을 때 같은 표인지와 단위 한 가지를 확인한다', () => {
  const title='2019년 연간 자료';
  const header='구분 2017년 2018년 2019년';
  const label='가입자(천명)   200   230   245';
  const row='(전년대비 증감, 천명)     71    30    15';
  const options={articleContext:'2019년 가입자 증가 1만 5천 명'};
  const run=(...lines)=>find(lines.join('\n'), ambiguous, options);
  const r=run(title, header,label,row);
  assert.equal(r.hits[0]?.paragraph,4);
  assert.deepEqual(r.hits[0].context.map(x=>x.paragraph),[2,3]);
  assert.deepEqual(run(title,header,label,'\f'+row).hits, []);
  assert.deepEqual(run(title,header,label,'다른 지표',row).hits, []);
  assert.deepEqual(run(title,'(단위: 천명, 천원)',header,'가입자 전년대비증감     71    30    15').hits, []);
  assert.equal(run(title,'(단위: 천 명)',header,'가입자 전년대비증감     71    30    15').hits[0]?.paragraph,4);
});

test('고용률·분기 문장은 기존 검색기에 남기고 두 해 연속 주장은 연속 3년을 요구한다', () => {
  assert.equal(find(report, '고용률은 0.4%포인트 올랐다.').state, 'ordinary');
  assert.equal(find(report, '1분기 독서실 이용자 증가 폭이 둔화했다.').state, 'ordinary');
  const doc='2017년 2018년\n이용자(천명,증감)   20  15';
  assert.deepEqual(find(doc, '이용자 2년 연속 증가 폭 둔화').hits, []);
});

test('기사에 연도와 수치가 붙어 있으면 같은 연도의 열에서만 수치 겹침을 센다', () => {
  const document = [
    '2021년 2022년 2023년',
    '수입(억원, 전년대비 증감)  3  5  8',
    '\f2021년 2022년 2023년',
    '수입(억원, 전년대비 증감)  8  5  3'
  ].join('\n');
  const r = find(document, '수입 증가폭이 절반으로 줄었다.', {articleContext:'2021년 8억 원 2023년 3억 원'});
  assert.deepEqual(r.hits.map(row=>row.paragraph), [4, 2]);
  assert.equal(ask('수입',document).hits.length,0);
});

test('다른 탭의 기사나 날짜 없이 이 해의 절대 연도 또는 판정을 추론하지 않는다', () => {
  const unresolved = find(report, '올해 증가폭이 절반으로 줄었다.');
  assert.deepEqual(unresolved.hits, []);
  assert.equal(unresolved.needsPublicationDate,true);
  const input = {articleContext:'2023년 독서실 이용자 2만 1천 명 증가'};
  const row = find(report, '올해 증가폭이 절반으로 줄었다.', input);
  assert.equal(row.hits.length,1);
  assert.equal(row.needsPublicationDate,true);
  assert.ok(!('verdict' in row));
});

const labourTable = [
  '2024년 연간 고용동향', '2. 취업자 동향', '가. 취업자 및 고용률',
  '          ’20년    ’21년    ’22년    ’23년    ’24년',
  '취 업 자(천명)  26,904  27,273  28,089  28,416  28,576',
  '(전년대비 증감, 천명)  (-218)  (369)  (816)  (327)  (159)',
  ' 15～64세  고용률(%)     65.9    66.5    68.5    69.2    69.5',
  ' (전년대비 증감, %p)    (-0.9) ( 0.6) ( 2.0) ( 0.7) ( 0.3)',
  ' 15세이상  고용률(%)    60.1    60.5    62.1    62.6    62.7',
  ' (전년대비 증감, %p)    (-0.8) ( 0.4) ( 1.6) ( 0.5) ( 0.1)'
];
const rateQuery = '2024년 연간 15세 이상 고용률은 2023년보다 몇 퍼센트포인트 올랐나?';
const annualHit = (source, question = rateQuery, articleContext = '') =>
  find(source.join('\n'), question, {articleContext}).hits[0]?.annualRate;

test('같은 연령대의 이전·현재 비율과 다음 줄에 인쇄된 퍼센트포인트를 근거 행에 연결한다', () => {
  const [hit] = find(labourTable.join('\n'), rateQuery).hits;
  assert.deepEqual([hit.paragraph, hit.text], [9, labourTable[8]]);
  assert.deepEqual(hit.context.map(r => r.text), [labourTable[3], labourTable[9]]);
  assert.deepEqual(hit.annualRate, {population:'15세이상', measure:'고용률', requestedUnit:'%p',
    headerParagraph:4, changeParagraph:10, previous:{year:2023, value:'62.6'}, current:{year:2024,value:'62.7'},
    change:{year:2024,value:'0.1',unit:'%p'}});
  assert.equal(annualHit(labourTable, '2024년 연간 15~64세 고용률은 전년보다 몇 %p 올랐나?').change.value, '0.3');
  assert.equal(annualHit(labourTable, '15세 이상 고용률은 99.9%로 전년보다 5%p 올랐습니다.', '2024년').current.value, '62.7');
  assert.equal(annualHit(labourTable, '2023년보다 2024년 15세 이상 고용률의 상대 변화율은 몇 퍼센트인가?').requestedUnit, '%');
  assert.equal(annualHit(labourTable, '2024년 연간 15세 이상 고용률은 전년 대비 상대 증가율이 얼마인가?').change.unit, '%p');
  assert.equal(annualHit(labourTable.slice(0,-1).concat(labourTable.at(-1).replace('( 0.1)', '( −0.2)'))).change.value, '−0.2');
});

test('인접하지 않은 연도, 다른 분모와 월·지역·성별 한정 또는 모호한 퍼센트에는 두 셀을 특정하지 않는다', () => {
  for (const query of [
    rateQuery.replace('2023년', '2022년'), rateQuery.replace('2024년', '2021년'),
    rateQuery.replace('연간', '12월'), rateQuery.replace('연간', '분기별'), rateQuery.replace('연간', '서울'),
    rateQuery.replace('연간', '여성'), rateQuery.replace('15세 이상', '15세 이하'),
    rateQuery.replace('고용률', '실업률'), rateQuery.replace('퍼센트포인트', '퍼센트'),
    rateQuery.replace('고용률은', '고용률과 실업률은'), rateQuery.replace('올랐나', '올랐고 0.2% 상승했나'),
    rateQuery.replace('퍼센트포인트', '퍼센트포인트 상대 변화율'), rateQuery.replace('2024년', '2024년보다')
  ]) assert.equal(annualHit(labourTable, query), undefined, query);
  assert.equal(annualHit(labourTable, rateQuery, '여성 자료'), undefined);
  assert.equal(annualHit(labourTable, rateQuery, '2022년'), undefined);
});

test('상대 변화율은 공표 증감 행이 없어도 같은 연간 비율 행과 지정한 두 열로 대조한다', () => {
  // Frozen p.32 rows, as when only the year header and the two level rows are copied.
  const levels = labourTable.filter(row => !row.includes('증감, %p'));
  const question = '2024년 연간 15세 이상 고용률은 2023년보다 상대 0.1% 증가했다.';
  const hit = annualHit(levels,question);
  assert.deepEqual([hit.previous,hit.current],[{year:2023,value:'62.6'},{year:2024,value:'62.7'}]);
  assert.equal(hit.change,undefined);
  assert.deepEqual(find(levels.join('\n'),question).hits[0].context.map(r => r.text),[labourTable[0],labourTable[3]]);
  assert.equal(annualHit(levels,question.replace('15세 이상','15~64세')).previous.value,'69.2');
  assert.equal(annualHit(labourTable,question).change.value,'0.1');
  for (const q of [rateQuery,question.replace('상대 ',''),question.replace('연간','12월'),
    question.replace('15세 이상','여성 15세 이상'),question.replace('2023년','2021년')]) {
    assert.equal(annualHit(levels,q),undefined,q);
  }
  for (const malformed of [levels.concat(levels.at(-1)),levels.concat('(전년대비 증감, %p) (0.1)'),
    levels.map(line => line.replace('62.6    62.7','62.6    -'))]) {
    assert.equal(annualHit(malformed,question),undefined);
  }
});

test('연간 표제·명시된 연도·정확한 행 개수·원문 단위를 확인하고 다른 표의 행은 연결하지 않는다', () => {
  const source = labourTable.join('\n'), ask = text => find(text, rateQuery).hits;
  for (const altered of [
    source.replace('연간', '12월'), source.replace('연간', '2분기'), source.replace('2024년 연간', '2018년 연간'),
    source.replace('가. 취업자 및 고용률', '가. 서울시 여성 조사'),
    source.replace('취 업 자(천명)', '서울 총계(천명)'),
    source.replace('’23년', '’22년'), source.replace('62.6    62.7', '62.6    -'),
    source.replace('( 0.5)', '( 0.5) (0.2)'), source.replace('( 0.1)', '(0.1%)'),
    source.replace('15세이상  고용률(%)', '15세이상  고용률(%p)'),
    source.replace('15세이상  고용률(%)', '남성 15세이상 고용률(%)'),
    source.slice(0,source.lastIndexOf('\n')), source.replaceAll('전년대비 증감, %p', '전년동월대비 증감, %p'),
    source.replaceAll('전년대비 증감, %p', '전년대비 증감, %'),
    source.replace('(-0.8)', '(.)'), source.replace(' (전년대비 증감, %p)    (-0.8)', '\f (전년대비 증감, %p)    (-0.8)'),
    source + '\n' + source, source + '\n' + labourTable[8]
  ]) assert.deepEqual(ask(altered), [], altered);
});

test('장기 기록과 최근 증감을 함께 물으면 원표에서 찾은 기간과 빠진 연도를 구분한다', () => {
  const q = '2021년에는 8만 명가량 늘어나며 2001년(9만 명) 이후 20년 만의 최대 폭을 기록했지만, 이후 2022년 4만 명으로 축소한 데 이어 올해 2만 명대로 떨어지는 등 2년 연속 증가 폭이 둔화했다.';
  const options = {articleContext:'독서실 이용자'};
  const result = find(report, q, options);
  assert.equal(result.state, 'partial-series');
  assert.deepEqual(result.hits.map(row => row.paragraph), [4]);
  assert.deepEqual(result.hits[0].years, [2021, 2022, 2023]);
  assert.deepEqual(result.hits[0].yearCoverage.missingYears, [2001]);
  assert.equal(result.needsPublicationDate, true);
  assert.equal(find(report, q).reason, 'missing-subject');
  // A date also requested outside the historical record still requires its own column.
  for (const context of ['2001년 독서실 이용자', '2026년 독서실 이용자', '청소년 독서실 이용자', '3월 독서실 이용자', '30대 독서실 이용자']) {
    assert.equal(find(report, q, {articleContext:context}).hits.length, 0, context);
  }
  for (const title of ['< 수도권 서비스 이용 추이 >', '< 여성 서비스 이용 추이 >', '< 20대 서비스 이용 추이 >']) {
    assert.deepEqual(find(report.replace('< 서비스 이용 추이 >', title), q, options).hits, [], title);
  }
  const percent = find(report, q, {articleContext:'독서실 이용자 증가 폭 99%'});
  assert.deepEqual(percent.hits, []);
  assert.equal(percent.reason, 'comparison-unit');
  assert.equal(find(report, q.replace('2001년(', '2002년('), options).reason, 'record-period');
  assert.deepEqual(find(report, '독서실 이용자 증가 폭은 2001~2023년 최대 폭을 기록했다.').hits, []);
  assert.equal(find(report, q.replace('2만 명대', '2만 건대'), options).hits.length, 0);
  assert.deepEqual(find(report, q.replace('2022년', '2021년'), options).hits, []);
});
