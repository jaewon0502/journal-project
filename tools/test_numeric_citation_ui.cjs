const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const reader = path.join(__dirname, '../docs/reader');
function editor(t) {
  const errors = [], console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(readFileSync(path.join(reader, 'factcheck.html'), 'utf8'), {
    url:'https://journal.example/factcheck.html', runScripts:'outside-only', virtualConsole:console
  });
  const w = dom.window, doc = w.document, el = id => doc.getElementById(id);
  let download;
  w.TextEncoder = TextEncoder;
  w.confirm = () => true;
  w.URL.createObjectURL = blob => { download = blob; return 'blob:journal'; };
  w.URL.revokeObjectURL = () => {};
  doc.addEventListener('click', e => { if (e.target.closest('a[download]')) e.preventDefault(); });
  for (const script of doc.querySelectorAll('script[src]'))
    w.eval(readFileSync(path.join(reader, script.getAttribute('src')), 'utf8'));
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  function set(id, value) {
    el(id).value = value;
    el(id).dispatchEvent(new w.Event('input', {bubbles:true}));
  }
  function find(article, lines, query, context = '') {
    set('article', article);
    el('article-form').requestSubmit();
    el('go-find').click();
    set('document-text', lines.join('\n'));
    set('document-query', query);
    set('search-context', context);
    el('find-passages').click();
    return el('finder-results').querySelector('.source');
  }
  async function save(id) {
    download = null;
    el(id).click();
    assert.ok(download, el('file-status').textContent);
    const file = new w.FileReader();
    const result = new Promise((resolve, reject) => {
      file.onload = () => resolve(file.result);
      file.onerror = () => reject(file.error);
    });
    file.readAsText(download);
    return result;
  }
  async function importFile(json) {
    const file = new w.File([json], 'review.json', {type:'application/json'});
    Object.defineProperty(el('import-file'), 'files', {value:[file]});
    el('import-file').dispatchEvent(new w.Event('change'));
    await t.waitFor(() => assert.ok(el('file-status').textContent));
    assert.doesNotMatch(el('file-status').textContent, /열지 못했습니다/);
  }
  return {el, set, find, save, importFile};
}

const examples = [
  {
    name:'세로 연도표', article:'2024년 교통사고 사망자는 2,521명이었다.',
    query:'2024년 교통사고 사망자는 2,551명이었다는 주장이 통계와 일치하나?',
    lines:['발생년\t교통사고건수\t사망자수', '2023\t198296\t2551', '2024\t196349\t2521'],
    locator:'‘2024년’ 행 · ‘사망자수’ 열'
  }, {
    name:'날짜 역조회', article:'3월 8일 조사에서 여당 지지율은 40%였다.',
    query:'여당 지지율이 40%인 날짜는?',
    lines:['조사일\t여당 지지율（％）\t야당 지지율（％）', '2024-03-01\t33\t40', '2024-03-08\t４０．００\t28  '],
    locator:'‘2024-03-08’ 행 · ‘여당 지지율（％）’ 열 (붙여넣은 본문 3문단 · 자료 행 2열)'
  }, {
    name:'가로 연도표', article:'2023년 장비 대여는 31건이었다.', query:'2023년 장비 대여는 87건인가?',
    lines:['구분\t2022년\t2023년', '장비 반납(건)\t48\t87', '장비 대여(건)\t29\t31'],
    locator:'‘장비 대여(건)’ 행 · ‘2023년’ 열'
  }
];
for (const {name, article, query, lines, locator} of examples) {
  test(name + '의 머리글·원문행·좌표를 판단 기록과 독립 평가에 전달한다', async t => {
    const p = editor(t);
    const card = p.find(article, lines, query);
    assert.equal(card.querySelector('blockquote').textContent, lines[2]);
    assert.equal(p.el('source-excerpt').value, '');
    card.querySelector(':scope > button').click();
    const excerpt = [lines[0], '[…]', lines[2]].join('\n');
    assert.equal(p.el('source-excerpt').value, excerpt);
    assert.equal(p.el('source-locator').value, locator);
    assert.match(p.el('source-status').textContent, /생략한 행/);
    p.set('source-title', '편집부 대조용 원표');
    p.set('source-url', 'https://source.example/data');
    p.set('source-version', '확정본');
    p.el('source-save-link').click();
    assert.ok(p.el('row-sources').querySelector('input:checked'));
    assert.equal(p.el('verdict').value, '');
    p.set('verdict', 'fact');
    p.set('reason', '원표에서 해당 시점의 수치와 항목을 직접 대조했다.');
    p.el('acknowledged').click();
    p.el('decision-form').requestSubmit();
    const work = JSON.parse(await p.save('save-work'));
    assert.equal(work.sources[0].excerpt, excerpt);
    assert.equal(work.sources[0].locator, locator);
    assert.deepEqual(work.receipts[0].sourceIds, [work.sources[0].id]);
    const report = await p.save('export-report');
    assert.ok(report.includes(excerpt)); assert.ok(report.includes(locator));
    const packet = await p.save('save-review-input');
    const independent = editor(t);
    await independent.importFile(packet);
    assert.equal(independent.el('verdict').value, '');
    const source = independent.el('row-sources').querySelector('details');
    source.open = true;
    assert.equal(source.querySelector('summary').textContent, locator);
    assert.equal(source.querySelector('blockquote').textContent, excerpt);
  });
}

test('원표가 질문의 범위나 추가 문맥을 뒷받침하지 않으면 자료 행에 자동 좌표를 붙이지 않는다', t => {
  const {lines, article, query} = examples[0];
  for (const [question, context] of [['2024년 교통사고 어린이 사망자는 몇 명이었나?', ''], [query, '수도권을 따로 집계한다.']]) {
    const p = editor(t);
    const card = p.find(article, lines, question, context);
    assert.doesNotMatch(card.textContent, /원문 값/);
    const raw = card.querySelector('blockquote').textContent;
    card.querySelector(':scope > button').click();
    assert.equal(p.el('source-excerpt').value, raw);
    assert.equal(p.el('source-locator').value, '');
  }
});

test('분리된 연·월일 셀과 단위 없는 머리글을 원표대로 인용한다', t => {
  const p = editor(t);
  const lines = ['변경일자\t기준금리', '2022\t11월 24일\t３．２５', '2023\t01월 13일\t３．５０'];
  const card = p.find('기준금리 원자료를 확인한다.', lines, '원표에서 기준금리 수치가 3.50인 날짜는?');
  assert.match(p.el('finder-status').textContent, /단위가 없습니다/);
  card.querySelector(':scope > button').click();
  assert.equal(p.el('source-locator').value, '‘2023 01월 13일’ 행 · ‘기준금리’ 열 (붙여넣은 본문 3문단 · 자료 행 3열)');
  assert.equal(p.el('source-excerpt').value, [lines[0], '[…]', lines[2]].join('\n'));
});
