const {test} = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');
const finder = require('../docs/reader/evidence-finder.js');
const trend = require('../docs/reader/evidence-trend.js');

const lines = [
  '구분\t2022년\t2023년',
  '목재 대여(건)\t22\t15',
  '부품 점검(건)\t36\t92',
  '장비 반납(건)\t48\t87',
  '장비 대여(건)\t29\t31  ',
  '서류 등록(건)\t45\t22'
];
const source = '\r\n' + lines.join('\r\n') + '\r\n';

test('인접 항목에 인용값이 있어도 질문에 지정된 항목과 연도에 해당하는 원문을 먼저 보여 준다', () => {
  const result = search(source, '2023년 장비 대여는 87건인가?');
  const [first, ...rest] = result.passages;
  assert.equal(result.state, 'ordinary');
  assert.equal(first.paragraph, 5);
  assert.equal(first.text, lines[4]);
  assert.deepEqual(first.matrixCell, {
    headerParagraph: 1, rowParagraph: 5, rowLabel: '장비 대여(건)',
    year: '2023', heading: '2023년', column: 3, value: '31'
  });
  assert.ok(first.context.some(entry => entry.paragraph === 1 && entry.text === lines[0]));
  assert.ok(first.context.some(entry => entry.paragraph === 4 && entry.text === lines[3]));
  assert.ok(rest.every(passage => !passage.matrixCell));
});

test('키워드 상위 세 문단 밖의 지정 행도 포함하고 기존 후보 수 상한을 지킨다', () => {
  const rows = [lines[0], '장비 반납(건)\t20\t87', '장비 수리(건)\t87\t18',
    '장비 교체(건)\t87\t43', lines[4], '장비 점검(건)\t56\t44'];
  const doc = rows.join('\n');
  const query = '2023년 장비대여는 87건인가?';
  const hits = search(doc, query).passages;
  assert.equal(hits.length, 3);
  assert.equal(hits[0].text, rows[4]);
  assert.equal(hits[0].matrixCell.value, '31');
  assert.equal(new Set(hits.map(hit => hit.paragraph)).size, hits.length);
});

test('행이나 연도를 특정할 수 없거나 표 밖의 설명이 있으면 일반 검색의 순서와 문맥을 유지한다', () => {
  for (const [doc, query] of [
    [source, '장비 대여는 87건인가?'],
    [source, '2023년 장비 대여와 장비 반납은 몇 건인가?'],
    [source + '별도 자료에서 2023년 장비 대여는 87건으로 집계했다.', '2023년 장비 대여는 87건인가?'],
    [source.replace('36\t92', '36'), '2023년 장비 대여는 87건인가?']
  ]) {
    assert.deepEqual(search(doc, query).passages, finder.find(doc, query, {includeContext: true}));
  }
});

test('기간별 증감 비교는 기존 추세 후보와 연도 문맥을 유지한다', () => {
  const doc = '구분  2022년  2023년\n대여(건, 전년대비증감)  62  31';
  const query = '대여 증가폭이 반토막 났다.';
  const options = {articleContext: '2023년 대여 증가 31건'};
  const prior = trend.find(doc, query, options);
  assert.equal(prior.state, 'candidates');
  const current = search(doc, query, options);
  assert.equal(current.state, prior.state);
  assert.deepEqual(current.passages, prior.hits);
});
