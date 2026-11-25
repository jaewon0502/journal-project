const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {search} = require('../docs/reader/evidence-search.js');
const dir = path.join(__dirname, '../experiments/evidence-retrieval-transfer/fiscal-tables');
const raw = fs.readFileSync(path.join(dir, 'settlement-layout.txt'), 'utf8');
const query = '2024년 특별회계 결산액은 344.5조 원인가?';

test('PDF에서 줄이 나뉜 머리글은 원문 행까지만 찾고 금액의 열은 지정하지 않는다', () => {
  const r = search(raw, query);
  assert.match(r.gap,/원표/);
  const [p] = r.passages;
  assert.equal(p.fiscalNavigation.rowLabel, '특별회계');
  assert.equal(p.fiscalNavigation.column,undefined);
  assert.equal(p.fiscalCell,undefined);
  assert.equal(raw.split('\n').filter(s=>s.trim())[p.paragraph - 1],p.text);
  assert.ok(p.context.some(c => c.text.includes('(단위: 조원)')));
});

test('여러 표, 누락 연도, 별도 지역 조건은 같은 이름의 행을 확정 위치로 쓰지 않는다', () => {
  for (const [source, q] of [[raw + '\n' + raw,query],[raw, query.replace('2024','2025')],
    [raw,query.replace('특별회계','서울시 특별회계')]]) {
    const result = search(source,q);
    assert.ok(result.passages.every(p => !p.fiscalNavigation && !p.fiscalCell));
  }
});

test('연도·단계를 지정해도 보충 문맥에 대상이 있으면 특정 셀로 안내하지 않는다', () => {
  const source = '단위: 조원\n구분\t2024년 예산\t2024년 결산\n특별회계\t81.7\t78.6';
  const result = search(source,query,{articleContext:'교육청이 집행한 부분만 집계했다.'});
  assert.match(result.gap,/기사 문맥/);
  assert.equal(result.passages[0].fiscalNavigation.rowLabel,'특별회계');
  assert.ok(result.passages.every(p => !p.fiscalCell && !p.fiscalNavigation?.column));
});

test('다른 열에 연도와 단계가 각각 있어도 다단 표의 교차 셀을 확정하지 않는다', () => {
  const text = '단위: 조원\n구분       2023년       2024년\n           결산         예산\n총지출     90           100';
  for (const q of ['2024년 총지출 결산액은 얼마인가?', '2023년 총지출 예산액은 얼마인가?']) {
    const r = search(text,q);
    assert.match(r.gap,/원표/);
    assert.equal(r.passages[0].fiscalNavigation.rowLabel,'총지출');
    assert.equal(r.passages[0].fiscalNavigation.column,undefined);
  }
});

test('보충 문맥이 단일 회계연도일 때만 원문 셀을 특정한다', () => {
  const source = '단위: 조원\n구분\t2024년 예산\t2024년 결산\n특별회계\t81.7\t78.6';
  const r = search(source,'특별회계 결산액은 얼마인가?',{articleContext:'2024회계연도'});
  assert.equal(r.usedArticleContext,true);
  assert.equal(r.passages[0].fiscalCell.value,'78.6');
  assert.match(r.notice,/2024년/);
  const conflict = search(source,query,{articleContext:'2023년'});
  assert.match(conflict.gap,/문맥/);
  assert.ok(conflict.passages.every(p=>!p.fiscalCell));
});
