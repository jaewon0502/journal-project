const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {withSourcePhrase} = require('../docs/reader/evidence-finder.js');
const {search} = require('../docs/reader/evidence-search.js');

const query = '10월 22일에 정관을 발표했다.';
const rows = [
  'October 22, 2023',
  'The team did not release the charter.',
  'A minority requested a charter.',
  'Review was scheduled for September 22.',
  'The draft charter was discussed the previous year.'
];
const documentText = rows.join('\n');
const phrase = 'The team released the charter';

test('원자료 표현의 상위 세 문단을 함께 유지하고 기사에서 찾은 다른 시점과 반대 진술을 보존한다', () => {
  const plain = search(documentText, query);
  assert.deepEqual(plain.passages.map(p => p.paragraph), [1, 4]);
  for (const same of ['', '   ', query]) assert.equal(withSourcePhrase(documentText, query, same, plain), plain);
  const mixed = withSourcePhrase(documentText, query, phrase, plain);
  assert.equal(mixed.phraseSearch, 'matched');
  assert.deepEqual(mixed.passages.slice(0,3).map(p => [p.paragraph,p.phraseMatch]), [[2,'phrase'],[3,'phrase'],[5,'phrase']]);
  assert.deepEqual(mixed.passages.slice(3).map(p => [p.paragraph,p.phraseMatch]), [[1,'article'],[4,'article']]);
  assert.equal(mixed.passages[0].text, rows[1]);
  assert.deepEqual(plain.passages.map(p => p.paragraph), [1, 4]);
  for (const hint of ['22 2023', 'the and is', 'not 22', 'ducklings 22']) {
    const absent = withSourcePhrase(documentText, query, hint, plain);
    assert.equal(absent.phraseSearch, 'no-match');
    assert.equal(absent.passages, plain.passages);
  }
});

test('같은 문단은 한 번 표시하고 기존 검색의 근거 부족·표·화자 조건을 유지한다', () => {
  const source = 'October 22, 2023\nThe charter session ran on October 22.\nThe charter petition is unsigned.';
  const plain = search(source, query);
  const mixed = withSourcePhrase(source, query, 'charter session', plain);
  assert.equal(mixed.passages[0].paragraph, 2);
  assert.equal(mixed.passages[0].phraseMatch, 'both');
  assert.ok(mixed.passages[0].matched.includes('charter'));
  assert.ok(mixed.passages[0].matched.includes('22'));
  assert.equal(new Set(mixed.passages.map(p => p.paragraph)).size, mixed.passages.length);
  const table = '수출액  |  2022년  |  2023년\n금속  |  40  |  55\n식품  |  22  |  33';
  const limits = search(table, '수출한 화물의 무게는 몇 톤인가?');
  assert.ok(limits.gap);
  const result = withSourcePhrase(table, query, '금속', limits);
  assert.equal(result.phraseSearch, 'structured');
  assert.equal(result.gap, limits.gap);
  assert.equal(result.passages, limits.passages);
});

test('실제 검토 화면에서 행별 원자료 표현을 복원하고 출처·판정·공유 파일과 분리한다', async t => {
  const dir = path.join(__dirname, '../docs/reader');
  const {window:w} = new JSDOM(readFileSync(path.join(dir,'factcheck.html'),'utf8'),
    {url:'https://local.invalid/factcheck.html',runScripts:'outside-only'});
  t.after(() => w.close());
  w.confirm = () => true;
  w.TextEncoder = TextEncoder;
  const el = id => w.document.getElementById(id);
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(readFileSync(path.join(dir,script.getAttribute('src')), 'utf8'));
  const set = (id, value) => {
    el(id).value = value;
    el(id).dispatchEvent(new w.Event('input', {bubbles:true}));
  };
  const choose = i => el('row-list').children[i].querySelector('button').click();
  const second = '협회는 다음 회의 일정을 밝혔다.';
  set('article', [query, second].join('\n'));
  el('article-form').requestSubmit();
  el('go-find').click();
  set('document-text', documentText);
  set('search-context', '해당 기관의 발표를 대조한다.');
  const typed = phrase + ' unpublished-query';
  set('source-phrase', typed);
  el('source-phrase').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter', bubbles:true}));
  assert.equal(el('document-query').value, query);
  assert.equal(el('search-context').value,'해당 기관의 발표를 대조한다.');
  assert.equal(el('finder-results').querySelector('blockquote').textContent, rows[1]);
  assert.match(el('finder-results').textContent, /입력한 원자료 표현으로 찾은 후보/);
  assert.equal(el('verdict').value, '');
  assert.equal(el('acknowledged').checked, false);
  assert.equal(el('source-excerpt').value, '');

  set('reason', '이전 날짜도 검토하는 중');
  choose(1);
  assert.equal(el('source-phrase').value, '');
  assert.equal(el('search-context').value, '');
  choose(0);
  el('go-find').click();
  assert.equal(el('reason').value, '이전 날짜도 검토하는 중');
  assert.equal(el('source-phrase').value, typed);
  assert.equal(el('search-context').value,'해당 기관의 발표를 대조한다.');
  assert.equal(el('finder-results').querySelector('blockquote').textContent, rows[1]);
  set('document-query', second);
  assert.equal(el('source-phrase').value,'');
  set('document-query', query);
  assert.equal(el('source-phrase').value, typed);

  let blob;
  w.URL.createObjectURL = value => {blob = value; return 'blob:test'};
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  for (const id of ['save-work', 'save-review-input']) {
    el(id).click();
    const saved = await blob.text();
    assert.doesNotMatch(saved,/unpublished-query/);
    const work = JSON.parse(saved);
    assert.equal(work.sources.length,0);
    assert.equal(work.receipts.length,0);
  }
  set('source-phrase','');
  el('find-passages').click();
  assert.equal(el('finder-results').querySelector('blockquote').textContent,rows[0]);
  set('source-phrase', typed);
  set('article', [query, '새 기사에서 같은 문장을 다시 검증한다.'].join('\n'));
  el('article-form').requestSubmit();
  assert.equal(el('source-phrase').value,'');

  const political = '[진보 성향 신문] 도서관 운영 경비는 얼마인가?';
  set('article', political);
  el('article-form').requestSubmit();
  el('go-find').click();
  set('document-text', 'Library operating expenses were 12 million.\nA liberal newspaper said library operating expenses were 13 million.');
  set('source-phrase', '[liberal newspaper] library operating expenses');
  el('find-passages').click();
  const top = () => el('finder-results').querySelector('blockquote').textContent;
  const toggle = () => [...el('finder-results').querySelectorAll('button')].find(b => b.textContent.startsWith('발행처 표지'));
  assert.match(el('finder-status').textContent,/검색어에서 제외/);
  assert.match(top(), /12 million/);
  toggle().click();
  assert.match(top(),/13 million/);
  assert.match(el('finder-status').textContent,/까지 포함/);
  toggle().click();
  assert.match(top(),/12 million/);
  assert.equal(el('document-query').value,political);
  assert.equal(el('verdict').value,'');
});

test('분리된 발행처 표지는 독립 사실 질문의 순위를 바꾸지 않고 직접 묻는 발언과 정당 이름은 보존한다', () => {
  const prose = [
    'Primary budget: library operating expenses were 12 million.',
    'A conservative newspaper said library operating expenses were 11 million.',
    'A liberal newspaper said library operating expenses were 13 million.',
    'The Conservative Party contested the library budget.',
    'The Liberal Party contested the library budget.'
  ].join('\n');
  const independent = '도서관 운영 경비는 얼마인가?';
  const topic = 'library operating expenses';
  for (const [ko, en, assertion, party] of [['보수','conservative',2,4], ['진보','liberal',3,5]]) {
    const article = '[' + ko + ' 성향 신문] ' + independent;
    const ordinary = search(prose,article);
    const tag = '[' + en + ' newspaper] ';
    assert.equal(search(prose, tag + topic).passages[0].paragraph,assertion);
    const neutral = withSourcePhrase(prose, article, tag + topic, ordinary);
    assert.equal(neutral.phraseLabelOmitted,true);
    assert.equal(neutral.passages[0].paragraph,1);
    const restored = withSourcePhrase(prose, article, tag + topic, ordinary,{keepPublisherTag:true});
    assert.equal(restored.phraseLabelIncluded,true);
    assert.equal(restored.passages[0].paragraph,assertion);
    const explicit = withSourcePhrase(prose, independent, '[publisher: ' + en + ' newspaper] ' + topic, search(prose,independent));
    assert.equal(explicit.passages[0].paragraph,1);
    assert.equal(explicit.phraseLabelOmitted,true);
    // An unmatched label can be the subject, and a cited denial can depend on a speaker.
    for (const [query, hint] of [[independent,tag + topic], [ko + ' 성향 신문이 경비를 얼마로 보도했나?',tag + topic],
      [article,tag + 'reported library operating expenses'], [article,tag + 'did not endorse the budget'],
      [article,tag + 'alleges undisclosed library expenses'], [article,tag + '“' + topic + '”'],
      [article,'[' + en + ' newspaper] [A section] library expenses'],[article,'[' + en + ' newspaper] ¿qué presupuesto?']]) {
      const result = withSourcePhrase(prose, query, hint, search(prose,query));
      assert.equal(result.phraseLabelOmitted,undefined,hint);
      assert.ok(result.passages[0].matched.includes(en),hint);
    }
    const named = withSourcePhrase(prose, article, en + ' party contested', ordinary);
    assert.equal(named.passages[0].paragraph,party);
    assert.equal(named.phraseLabelOmitted,undefined);
  }
});

test('우연히 같은 인용이 반복되면 서너 번째 후보를 합칠 때도 문단 위치를 구별한다', () => {
  const text = 'The minutes were withdrawn.\nThe minutes were withdrawn.\n연간 심의가 끝났다.';
  const article = '연간 심의가 끝났다.';
  const matched = withSourcePhrase(text, article, 'minutes withdrawn', search(text,article));
  assert.deepEqual(matched.passages.map(p => [p.paragraph,p.phraseMatch]), [[1,'phrase'],[2,'phrase'],[3,'article']]);
});
