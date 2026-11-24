const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const folder = path.join(__dirname, '../docs/reader');
const header = '구분\t2023년 결산\t2024년 예산\t2024년 결산\t2024년 예산 대비';
const total = '총지출\t610.7\t656.6\t638.0\t△18.6';
const funds = '기금\t196.5\t218.4\t214.5\t△3.9';
const table = ['단위: 조 원', header, total, funds].join('\n');
const spent = '2024회계연도 총지출 결산액은 656.6조 원인가?';

function openFinder(t) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(readFileSync(path.join(folder, 'factcheck.html'), 'utf8'), {
    url:'https://journal.example/factcheck.html', runScripts:'outside-only', virtualConsole:console
  });
  const w = dom.window, doc = w.document;
  w.TextEncoder = TextEncoder;
  for (const script of doc.querySelectorAll('script[src]'))
    w.eval(readFileSync(path.join(folder, script.getAttribute('src')), 'utf8'));
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  const el = id => doc.getElementById(id);
  function set(id, value) {
    el(id).value = value;
    el(id).dispatchEvent(new w.Event('input', {bubbles:true}));
  }
  function find(source, query) {
    set('document-text', source);
    set('document-query', query);
    el('find-passages').click();
    return el('finder-results');
  }
  set('article', spent);
  el('article-form').requestSubmit();
  el('go-find').click();
  return {w, doc, el, set, find};
}

test('재정표에서 질문의 숫자와 다른 결산 열을 보여 주고 선택한 행과 위치만 옮긴다', t => {
  const {el, find, doc} = openFinder(t);
  const report = el('report-rows').textContent, sources = el('source-list').textContent;
  const area = find(table, spent);
  const card = area.querySelector('.source');
  assert.equal(card.querySelector('blockquote').textContent, total);
  assert.match(card.textContent, /결산·실제 집행액/);
  assert.match(card.textContent, /총지출.*2024년 결산.*4번째 열/);
  assert.match(card.textContent, /원문 표기 638\.0 · 단위 조 원 · 머리글 2문단/);
  assert.match(card.textContent, /원본에서.*쪽.*단위/);
  assert.doesNotMatch(area.textContent, /번째 수치 열|연도 머리글\(|원표 항목 \d+개 보기/);
  assert.equal(el('source-excerpt').value, '');
  assert.equal(el('source-locator').value, '');

  const button = card.querySelector(':scope > button');
  assert.equal(button.textContent, '이 행을 발췌하고 표 위치 확인');
  button.click();
  assert.equal(el('source-excerpt').value, total);
  assert.equal(el('source-locator').value, '‘총지출’ 행 · ‘2024년 결산’ 열 (왼쪽에서 4번째 열) · 단위 조 원');
  assert.equal(doc.activeElement, el('source-locator'));
  assert.match(el('source-status').textContent, /원본에서 쪽번호/);
  assert.equal(el('source-list').textContent, sources);
  assert.equal(el('report-rows').textContent, report);
  assert.equal(el('verdict').value, '');
});

test('재검색에서 자동 위치를 바꾸기 전에 묻고 직접 쓴 쪽번호와 취소한 발췌문을 보존한다', t => {
  const {el, find, set, w} = openFinder(t);
  find(table, spent).querySelector('.source > button').click();
  const first = el('source-locator').value;
  const budgetButton = find(table, '2024년 총지출 예산액은 얼마인가?').querySelector('.source > button');
  const prompts = [];
  w.confirm = text => { prompts.push(text); return false; };
  budgetButton.click();
  assert.equal(prompts.length, 1);
  assert.equal(el('source-locator').value, first);
  assert.equal(el('source-excerpt').value, total);

  w.confirm = () => true;
  budgetButton.click();
  assert.match(el('source-locator').value, /총지출.*2024년 예산.*3번째 열/);
  const manual = '편집자가 대조한 인쇄본 4쪽 표 2';
  set('source-locator', manual);
  const fundsButton = find(table, '2024년 기금 결산액은 얼마인가?').querySelector('.source > button');
  w.confirm = text => { assert.match(text, /직접 적은 위치는 유지/); return false; };
  fundsButton.click();
  assert.equal(el('source-excerpt').value, total);
  w.confirm = () => true;
  fundsButton.click();
  assert.equal(el('source-excerpt').value, funds);
  assert.equal(el('source-locator').value, manual);
  assert.equal(el('verdict').value, '');
});

test('같은 결산 열이 중복된 표는 표현이 겹친 위치를 접고 열이나 금액을 추천하지 않는다', t => {
  const {el, find} = openFinder(t);
  const area = find(table.replace('2024년 예산\t', '2024년 결산\t'), spent);
  const fallback = area.querySelector('details');
  assert.match(el('finder-status').textContent, /확인|어렵|특정|중복/);
  assert.ok(fallback);
  assert.equal(fallback.open, false);
  assert.match(fallback.querySelector('summary').textContent, /표현이 겹친 위치/);
  assert.doesNotMatch(area.textContent, /원문 표기|번째 수치 열|원표 항목 \d+개 보기|이 행을 발췌하고/);
  assert.equal(el('source-excerpt').value, '');
  assert.equal(el('source-locator').value, '');
});

test('단위 누락과 혼합 단위에서 위치와 인쇄값은 보이고 금액 단위는 원표에서 확인하도록 남긴다', t => {
  const {el, find} = openFinder(t);
  for (const legend of ['', '(단위: 조원, %, %p)']) {
    const source = [legend, header, total, funds].filter(Boolean).join('\n');
    const area = find(source, spent);
    const card = area.querySelector(':scope > .source');
    assert.ok(card);
    assert.match(el('finder-status').textContent, /단위/);
    assert.match(card.textContent, /원문 표기 638\.0 · 단위 미확인/);
    assert.match(card.textContent, new RegExp('머리글 ' + (legend ? 2 : 1) + '문단을 원본과 대조'));
    assert.doesNotMatch(card.textContent, /원문 표기 638\.0 · 단위 조원|결산·실제 집행액|번째 수치 열/);
    card.querySelector(':scope > button').click();
    assert.equal(el('source-locator').value, '‘총지출’ 행 · ‘2024년 결산’ 열 (왼쪽에서 4번째 열) · 단위 확인 필요');
    assert.equal(el('source-excerpt').value, total);
    assert.equal(el('verdict').value, '');
  }
});

test('고정폭 원문의 여러 줄 머리글은 제목과 행만 발췌 위치에 남긴다', t => {
  const {el, find} = openFinder(t);
  const caption = '[2024회계연도 기금 결산]';
  const line = '    기금      51.1     60.3      56.4';
  const source = [caption, '                     (단위: 조원)', '        2023               2024',
    ' 구   분     결산       예산      결산', '             (A)        (B)       (C)', line].join('\n');
  const area = find(source, '2024년 기금 결산액은 얼마인가?');
  const card = area.querySelector(':scope > .source');
  assert.ok(card);
  assert.equal(card.querySelector('blockquote').textContent, line);
  assert.match(card.textContent, /원본에서 연도·예산 단계·단위를 대조/);
  assert.doesNotMatch(card.textContent, /원문 표기|번째 열|번째 수치 열/);
  const button = card.querySelector(':scope > button');
  assert.equal(button.textContent, '이 행을 발췌하고 원표 위치 확인');
  button.click();
  assert.equal(el('source-locator').value, caption + ' · ‘기금’ 행');
  assert.equal(el('source-excerpt').value, line);
  assert.equal(el('verdict').value, '');
});

test('연도가 윗줄에 있는 머리글은 해당 연도와 아랫줄 열 기호, 음수 표기를 보존한다', t => {
  const {el, find, w} = openFinder(t);
  const row = '기금\t38.50\t42.00\t△1.20';
  const source = ['단위: 억 원', '구분\t2023년\t2024년\t', '구분\t결산(A)\t예산(B)\t결산(C)', row].join('\n');
  const area = find(source, '2024년 기금 결산액은 얼마인가?');
  const card = area.querySelector(':scope > .source');
  assert.match(card.textContent, /2024년 · ‘기금’ 행 · ‘결산\(C\)’ 열 \(왼쪽에서 4번째 열\)/);
  assert.match(card.textContent, /원문 표기 △1\.20 · 단위 억 원/);
  const nearby = card.querySelector('details');
  nearby.open = true;
  nearby.dispatchEvent(new w.Event('toggle'));
  nearby.querySelector('button').click();
  assert.equal(el('source-excerpt').value, row);
  assert.equal(el('source-locator').value, '2024년 · ‘기금’ 행 · ‘결산(C)’ 열 (왼쪽에서 4번째 열) · 단위 억 원');
  const headerChoice = nearby.querySelector('li[value="3"] input');
  headerChoice.click();
  w.confirm = () => true;
  nearby.querySelector('button').click();
  assert.equal(el('source-excerpt').value, '구분\t결산(A)\t예산(B)\t결산(C)');
  assert.equal(el('source-locator').value, '');
});

test('원자료를 문장에 연결하고 작업 파일을 다시 열어도 행 밖에 적힌 단위가 남는다', {timeout:3000}, async t => {
  const writer = openFinder(t);
  writer.find(table, spent).querySelector('.source > button').click();
  for (const [field, value] of Object.entries({title:'결산표', url:'https://office.example/settlement', version:'확정본'}))
    writer.set('source-' + field, value);
  writer.el('source-save-link').click();

  let blob;
  writer.w.URL.createObjectURL = value => { blob = value; return 'blob:workspace'; };
  writer.w.URL.revokeObjectURL = () => {};
  writer.doc.addEventListener('click', event => {
    if (event.target.closest('a[download]')) event.preventDefault();
  });
  writer.el('save-work').click();
  const data = await blob.text();
  const saved = JSON.parse(data);
  const location = '‘총지출’ 행 · ‘2024년 결산’ 열 (왼쪽에서 4번째 열) · 단위 조 원';
  assert.equal(saved.sources.length, 1);
  assert.equal(saved.sources[0].locator, location);
  assert.equal(saved.sources[0].excerpt, total);

  const reader = openFinder(t);
  reader.w.confirm = () => true;
  const file = new reader.w.File([data], 'work.json', {type:'application/json'});
  const input = reader.el('import-file');
  Object.defineProperty(input, 'files', {value:[file]});
  const status = reader.el('file-status');
  const opened = new Promise(resolve => {
    const observer = new reader.w.MutationObserver(() => { observer.disconnect(); resolve(status.textContent); });
    observer.observe(status, {childList:true});
  });
  input.dispatchEvent(new reader.w.Event('change'));
  assert.match(await opened, /작업 파일을 열었습니다/);
  assert.ok(reader.el('source-list').textContent.includes(location));
  assert.equal(reader.doc.querySelector('#row-sources input:checked').value, saved.sources[0].id);
  assert.equal(reader.el('verdict').value, '');
});
