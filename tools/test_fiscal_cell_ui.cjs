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
const totalArchive = ['단위: 조 원', header, total].join('\n');
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

test('재정표에서 질문의 숫자와 다른 결산 열을 보여 주고 선택한 행과 원래 열·단위를 함께 옮긴다', t => {
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
  assert.equal(button.textContent, '금액 행과 표 머리글·단위 발췌');
  button.click();
  assert.equal(el('source-excerpt').value, totalArchive);
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
  assert.equal(el('source-excerpt').value, totalArchive);

  w.confirm = () => true;
  budgetButton.click();
  assert.match(el('source-locator').value, /총지출.*2024년 예산.*3번째 열/);
  const manual = '편집자가 대조한 인쇄본 4쪽 표 2';
  set('source-locator', manual);
  const fundsButton = find(table, '2024년 기금 결산액은 얼마인가?').querySelector('.source > button');
  w.confirm = text => { assert.match(text, /직접 적은 위치는 유지/); return false; };
  fundsButton.click();
  assert.equal(el('source-excerpt').value, totalArchive);
  w.confirm = () => true;
  fundsButton.click();
  assert.equal(el('source-excerpt').value, ['단위: 조 원', header, '[…]', funds].join('\n'));
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
  assert.equal(el('source-excerpt').value, source);
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
  assert.equal(saved.sources[0].excerpt, totalArchive);

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
  assert.match(reader.el('source-list').querySelector('.registered-amount').textContent,/결산 · 원문 표기 638\.0 \(단위 조 원\)/);
  assert.equal(reader.el('source-list').querySelector('blockquote').textContent,totalArchive);
  assert.equal(reader.doc.querySelector('#row-sources input:checked').value, saved.sources[0].id);
  assert.equal(reader.el('verdict').value, '');
});

test('등록된 금액의 원문 셀을 다시 읽어 다른 연도·예산 단계의 같은 숫자를 제외한다', t => {
  const {w} = openFinder(t);
  const input = '2024년 총지출 결산액은 656.6조 원이었다.';
  const source = (id, heading, column, excerpt = totalArchive) => ({
    id, title:'총지출 재정 자료', url:'https://office.example/report.pdf', version:'확정본', excerpt,
    locator:'PDF 32쪽 · ‘총지출’ 행 · ‘' + heading + '’ 열 (왼쪽에서 ' + column + '번째 열) · 단위 조 원'
  });
  const right = source('spent','2024년 결산',4), budget = source('budget','2024년 예산',3);
  const old = source('previous','2023년 결산',2);
  const analyze = sources => w.JournalFactcheck.prepare(input, sources).rows[0];
  const good = analyze([budget,old,right]);
  assert.deepEqual(Array.from(good.sourceIds), ['spent']);
  assert.match(good.sourceMatches[0].reason,/원문 표기 638\.0/);
  assert.equal(good.status,'pending');
  for (const edited of [source('wrong-index','2024년 결산',3),
    {...right, locator:right.locator.replace('단위 조 원','단위 억 원')},
    {...right, excerpt:totalArchive.replace('2024년 예산','2024년 결산')},
    {...right, excerpt:totalArchive.replace('638.0','—')}]) {
    assert.equal(w.JournalEvidenceFiscalTable.registeredCell(edited),null);
    assert.equal(analyze([edited]).sourceIds.length,0);
  }
  assert.equal(analyze([budget,old]).sourceIds.length,0);
  const legacy = {...right,excerpt:total};
  assert.equal(w.JournalEvidenceFiscalTable.registeredCell(legacy),null);
  assert.equal(analyze([legacy]).sourceIds.length,1);
  assert.doesNotMatch(analyze([legacy]).sourceMatches[0].reason,/원표의|원문 표기/);
});

test('긴 원표의 마지막 금액에는 머리글·생략 표시·선택 행만 저장한다', t => {
  const {el,find,w} = openFinder(t);
  const rows = Array.from({length:1200}, (_,i) => '사업' + i + '\t456.7\t638.0\t656.6\t△18.6');
  const source = ['단위: 조 원',header,...rows,total].join('\n');
  find(source,spent).querySelector('.source > button').click();
  const excerpt = el('source-excerpt').value, locator = el('source-locator').value;
  assert.equal(excerpt,['단위: 조 원',header,'[…]',total].join('\n'));
  assert.equal(w.JournalEvidenceFiscalTable.registeredCell({excerpt,locator}).value,'638.0');
});

test('두 해의 고용률과 공표 증감을 따로 읽고 연령대에 맞는 원문만 다음 편집자에게 넘긴다', t => {
  const {el, find, w} = openFinder(t);
  const years = '          ’23년    ’24년';
  const age64 = ' 15～64세  고용률(%)     69.2    69.5';
  const age15 = ' 15세이상  고용률(%)    62.6    62.7';
  const change64 = ' (전년대비 증감, %p)    ( 0.7) ( 0.3)';
  const change15 = ' (전년대비 증감, %p)    ( 0.5) ( 0.1)';
  const source = ['2024년 연간 고용동향', years, age64, change64, age15, change15].join('\n');
  const ask = '2024년 15세 이상 고용률은 2023년보다 5%p 올랐나?';
  const card = find(source, ask).querySelector('.annual-rate');
  assert.ok(card);
  assert.match(card.textContent, /2023년 62\.6% → 2024년 62\.7%/);
  assert.match(card.textContent, /원표 표기 0\.1%p/);
  assert.equal(card.querySelector('details').open, false);
  assert.match(card.querySelector('details').textContent, /약 0\.16%/);
  const raw = [years, '[…]', age15, change15].join('\n');
  assert.equal(card.querySelector('blockquote').textContent, raw);
  card.querySelector('button').click();
  assert.equal(el('source-excerpt').value, raw);
  assert.match(el('source-locator').value, /15세 이상 고용률 행.*2023년·2024년 열.*증감\(%p\) 행/);
  assert.equal(el('verdict').value, '');

  const relative = '2024년 15~64세 고용률의 상대 변화율은 전년 대비 얼마인가?';
  const second = find(source, relative).querySelector('.annual-rate');
  assert.ok(second.querySelector('details').open);
  assert.match(second.textContent, /약 0\.43%/);
  assert.match(second.textContent, /원표 표기 0\.3%p/);
  w.confirm = () => true;
  second.querySelector('button').click();
  assert.equal(el('source-excerpt').value, [years, age64, change64].join('\n'));
  assert.equal(find(source, ask.replace('15세 이상', '서울 15세 이상')).querySelector('.annual-rate'), null);
  assert.equal(el('source-excerpt').value, [years, age64, change64].join('\n'));
  const zero = find(source.replace('69.2', '0.0'), relative).querySelector('.annual-rate');
  assert.match(zero.querySelector('details').textContent, /0%여서 상대 변화율을 계산할 수 없습니다/);
  assert.doesNotMatch(zero.textContent, /Infinity|NaN/);
});

test('한 사업의 집행률 두 개를 원표 분모로 구분하고 발췌문에 열 이름을 함께 저장한다', t => {
  const {el, find, w} = openFinder(t);
  const titles = '회계연도\t사업명\t본예산(억원)\t예산현액(억원)\t집행액(억원)\t본예산 대비 집행률(%)\t집행률(예산현액 기준)(%)';
  const line = '2024\t별빛 돌봄\t100\t120\t90\t90.0\t75.0';
  const source = [titles, line, '2025\t별빛 돌봄\t120\t160\t120\t100.0\t75.0'].join('\n');
  for (const [basis, value] of [['본예산','90.0'], ['예산현액','75.0']]) {
    const result = find(source, '2024년 별빛 돌봄 사업의 ' + basis + ' 대비 집행률은 100%인가?');
    const card = result.querySelector(':scope > .source');
    assert.ok(card);
    assert.ok(card.textContent.includes('원문 표기 ' + value + ' · 단위 %'));
    assert.ok(card.textContent.includes('원표에 적힌 집행률의 분모 · ' + basis));
    w.confirm = () => true;
    card.querySelector(':scope > button').click();
    assert.equal(el('source-excerpt').value, [titles, line].join('\n'));
    assert.ok(el('source-locator').value.includes(basis));
  }
  const ambiguous = find(source, '2024년 별빛 돌봄 사업의 집행률은 얼마인가?');
  assert.match(el('finder-status').textContent, /분모/);
  assert.doesNotMatch(ambiguous.textContent, /원표에 적힌 집행률의 분모|원문 표기/);
  const simple = '구분\t2024년 집행률(%)\n총지출\t97.2';
  const unstated = find(simple, '2024년 총지출의 집행률은 얼마인가?');
  assert.match(unstated.textContent, /분모가 적혀 있지 않습니다/);
  assert.equal(el('verdict').value, '');
});

test('저장한 집행률의 분모와 값을 보고서에서도 함께 읽고 다른 분모의 자료는 직접 선택한다', t => {
  const {w, doc, el, set, find} = openFinder(t);
  const titles = '구분\t2024년 본예산 대비 집행률(%)\t2024년 예산현액 대비 집행률(%)\t2023년 예산현액 대비 집행률(%)';
  const source = titles + '\n별빛돌봄\t90.0\t75.0\t90.0';
  const claim = '2024년 별빛돌봄 예산현액 대비 집행률은 75.0%였다.';
  w.confirm = () => true;
  set('article', claim);
  el('article-form').requestSubmit();
  function register(basis) {
    el('go-find').click();
    const result = find(source, '2024년 별빛돌봄 ' + basis + ' 대비 집행률은 얼마인가?');
    result.querySelector('.source > button').click();
    set('source-title', basis + ' 자료');
    set('source-url', 'https://report.example/settlement');
    set('source-version', '확정본');
    el('source-save-link').click();
  }
  register('본예산');
  assert.match(el('row-sources').textContent, /등록 자료에서.*분모를 확인/);
  assert.equal(el('row-sources').querySelectorAll('.badge').length, 0);
  assert.match(el('source-list').querySelector('.registered-rate').textContent, /2024년 별빛돌봄 · 본예산 기준 집행률 90\.0%/);
  register('예산현액');
  assert.equal(el('row-sources').querySelectorAll('.badge').length, 1);
  assert.match(el('row-sources').querySelector('.badge').parentElement.textContent, /예산현액 자료/);
  assert.doesNotMatch(el('row-sources').textContent, /등록 자료에서.*분모를 확인/);
  const statement = '2024년 별빛돌봄 · 예산현액 기준 집행률 75.0%';
  const refs = [...el('row-sources').querySelectorAll('input[type=checkbox]')];
  for (const ref of refs) if (ref.checked && ref.parentElement.textContent.includes('본예산')) ref.click();
  assert.equal(el('verdict').value, '');
  set('verdict', 'fact');
  el('verdict').dispatchEvent(new w.Event('change'));
  set('reason', '예산현액 기준 집행률 열에서 75.0%를 확인했다.');
  el('acknowledged').click();
  el('decision-form').requestSubmit();
  assert.equal(doc.querySelector('#report-rows .registered-rate')?.textContent, statement);
  assert.equal(doc.querySelector('#report-rows blockquote')?.textContent, source);
});
