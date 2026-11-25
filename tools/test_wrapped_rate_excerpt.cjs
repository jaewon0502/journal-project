const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {search} = require('../docs/reader/evidence-search.js');
const {find} = require('../docs/reader/evidence-finder.js');

// Physical page 32 of Statistics Korea's 2024 annual employment report.
const head = '  □ 2024년 15세이상 취업자는 2,857만 6천명으로 전년대비 15만 9천명';
const detail = '          (0.6%)    증가하였고, 고용률은 62.7%로 전년대비 0.1%p 상승하였음';
const nextGroup = '      ○ 성별로 보면 남자는 1,592만 4천명으로 전년대비 2만 9천명(-0.2%)';
const query = '15세 이상 고용률은 62.7%로 전년보다 0.1%포인트 올랐습니다.';
const source = [head, detail, nextGroup].join('\n');

function combined(text, claim = query) {
  return find(text, claim, {includeContext:true}).filter(hit => hit.wrappedOpening);
}

test('편집자가 찾은 바로 앞 총괄 문장에 인쇄된 연도와 연령을 그대로 남긴다', () => {
  const [hit] = search(source, query).passages;
  assert.equal(hit.paragraph, 2);
  assert.equal(hit.text, detail);
  assert.deepEqual(hit.wrappedOpening, {paragraph:1, text:head});
  assert.equal(combined(source, query.replace('62.7%', '60.8%')).length, 1);
  assert.equal(combined(source.replaceAll('2024', '2021').replaceAll('15세', '18세'), '18세 이상 고용률은 얼마인가?').length, 1);
});

test('빈 줄·물리 쪽·목록 항목·표·다른 연령과 대상·월에 걸친 인용은 제안하지 않는다', () => {
  const textCases = [
    [head, '', detail], [head, '\f', detail], [head, '\f' + detail],
    [head, nextGroup, detail], [head, detail.trimStart()], [head, detail.replace('(0.6%)','○ (0.6%)')],
    [head.replace('□', '○'), detail], [head.replace('2024년', '2024년 12월'), detail],
    [head.replace('15세이상', '15~64세'), detail], [head.replace('취업자는', '여성 취업자는'), detail],
    [head.replace('2,857만 6천명', '명'), detail],
    [head, detail + ' · 여성은 61.2%'], [head, detail.replace('고용률은', '여성 고용률은')],
    [head, detail.replace('    증가','\t증가')], ['[표 1] 통계', '기간\t자료', '2024년\t62.7%', detail]
  ];
  for (const lines of textCases) assert.deepEqual(combined(lines.join('\n')), [], lines.join('\n'));
  for (const claim of ['2023년 ' + query, '서울 ' + query, query.replace('15세 이상','청년층'),
    query.replace('15세 이상','15~64세'), query.replace('고용률','남자 고용률'),
    query.replace('62.7%', '12월 서울에서 62.7%'), query.replace('고용률','실업률')]) {
    assert.deepEqual(combined(source, claim), [], claim);
  }
});

test('실제 검색 카드에서 단일 문단과 두 문단을 직접 선택하고 원자료 초안에서 정확한 원문을 대조한다', t => {
  const folder = path.join(__dirname, '../docs/reader');
  const dom = new JSDOM(readFileSync(path.join(folder, 'factcheck.html'),'utf8'), {
    url:'https://journal.example/factcheck.html', runScripts:'outside-only'
  });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document, el = id => doc.getElementById(id);
  w.TextEncoder = TextEncoder;
  for (const tag of doc.querySelectorAll('script[src]')) w.eval(readFileSync(path.join(folder, tag.getAttribute('src')), 'utf8'));
  const set = (id, value) => { el(id).value = value; el(id).dispatchEvent(new w.Event('input', {bubbles:true})); };
  set('article', query); el('article-form').requestSubmit(); el('go-find').click();
  set('document-text', source); el('find-passages').click();
  const card = el('finder-results').querySelector('.source');
  const preview = [...card.querySelectorAll('details')].find(d => d.querySelector('summary').textContent.includes('1~2문단'));
  assert.ok(preview); assert.equal(preview.open, false);
  assert.equal(preview.querySelector('blockquote').textContent, head + '\n' + detail);
  assert.equal(el('source-excerpt').value, '');
  [...card.querySelectorAll('button')].find(b => b.textContent === '이 문단을 발췌문으로 사용').click();
  assert.equal(el('source-excerpt').value, detail);
  preview.querySelector('summary').click(); assert.equal(preview.open, true);
  w.confirm = () => false; preview.querySelector('button').click();
  assert.equal(el('source-excerpt').value, detail);
  w.confirm = () => true; preview.querySelector('button').click();
  assert.equal(el('source-excerpt').value, head + '\n' + detail);
  assert.equal(el('source-locator').value, ''); assert.equal(el('source-pdfPage').value, '');
  assert.equal(el('verdict').value, '');
  set('search-context', '서울의 12월 고용률'); el('find-passages').click();
  assert.ok(!el('finder-results').textContent.includes('이 두 문단을 함께 발췌'));
});
