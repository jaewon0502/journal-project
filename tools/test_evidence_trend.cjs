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
