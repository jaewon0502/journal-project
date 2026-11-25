const {test} = require('node:test');
const assert = require('node:assert/strict');
const {search} = require('../docs/reader/evidence-search.js');

// NABO 2025 committee analysis, Ministry of Economy and Finance, PDF page 37.
// Layout retains the centered years and wrapped figures printed on separate lines.
const table = `                [최근 4년간 일반회계 예비비 집행 실적]
                                                      (단위: 억원)

                  일반회계             목적예비비
        구 분                                           일반예비비
                   예비비
                              소계        재해대책
          예산        56,100     42,100            -      14,000
                                            40,994
        지출결정액       55,992     42,056                   13,936
 2020                                      (11,743)
                                             40,167
          지출액       54,467     41,228                   13,239
                                           (11,152)
          예산        97,000     81,000             -     16,000
                                             58,420
        지출결정액       96,996     81,000                   15,996
 2021                                       (2,154)
                                            58,330
          지출액       92,721     78,713                   14,008
                                            (2,150)
          예산        55,000     37,000             -     18,000
 2022   지출결정액       49,415     33,888        5,437      15,527
          지출액       47,049     33,473        5,437      13,575
          예산        46,000     28,000            -      18,000
 2023   지출결정액       13,940      2,121          738      11,818
          지출액       13,091      2,121          738      10,970
주: 2020 · 2021년 괄호 안 수치는 코로나19 피해에 대한 재해대책비를 제외한 규모`;
const years = [
  [2020, '54,467', '55,992'], [2021, '92,721', '96,996'],
  [2022, '47,049', '49,415'], [2023, '13,091', '13,940']
];
const question = (year, name, amount) => year + '년 일반회계 예비비 ' + name + '은 ' + amount + '억 원이었다.';

test('예비비 지출액과 지출결정액은 원고 수치가 뒤바뀌어도 지정 연도·항목의 인쇄 행을 찾는다', () => {
  for (const [year, spent, decided] of years) {
    for (const [measure, printed] of [['지출액',spent], ['지출결정액',decided]]) {
      for (const amount of [spent,decided]) {
        const r = search(table, question(year, measure, amount));
        assert.equal(r.passages.length, 1);
        const [hit] = r.passages;
        assert.ok(hit.text.includes(printed));
        assert.ok(hit.text.includes(measure));
        assert.equal(hit.fiscalNavigation.rowLabel, year + '년 ' + measure);
        assert.equal(hit.fiscalCell, undefined);
        assert.deepEqual(hit.matched, [measure]);
        assert.match(r.notice, /일반회계 예비비.*단위는 억원/);
        assert.match(r.notice, /원표.*열과 주석/);
        assert.ok([hit, ...hit.context].some(row => row.text.trim().startsWith(String(year))));
        assert.ok(hit.context.some(row => /단위: 억원/.test(row.text)));
      }
    }
  }
  const compound = search(table, '2023년 일반회계 예비비 지출액은 1조 3,940억 원이었다.');
  assert.ok(compound.passages[0].text.includes('13,091'));
  const withBudget = search(table,'2023년도 일반회계 예비비 4조 6,000억 원 중 실제 지출액은 1조 3,940억 원이었다.');
  assert.equal(withBudget.passages.length, 1);
  assert.equal(withBudget.passages[0].fiscalNavigation.rowLabel, '2023년 지출액');
  assert.ok(withBudget.passages[0].context.some(row => row.text.includes('46,000')));
  assert.equal(withBudget.passages[0].fiscalCell, undefined);
});

test('다른 회계·연도·단위·중복 행의 표현을 지정한 행으로 안내하지 않는다', () => {
  const q = question(2023,'지출액','13,940');
  const special = table.replaceAll('일반회계','특별회계').replaceAll('13,091','99,999');
  const different = search(table + '\n\f\n' + special, q.replace('일반회계','특별회계'));
  assert.equal(different.passages.length, 1);
  assert.ok(different.passages[0].text.includes('99,999'));
  for (const [doc, query] of [
    [special, q], [table,q.replace('2023년','2019년')], [table.replace('단위: 억원','단위: 억원, %'),q],
    [table + '\n' + table,q], [table.replace('2023   지출결정액','2022   지출결정액'),q],
    [table.replace('지출액       13,091','지출결정액       13,091'),q],
    [table.replace('2023   지출결정액','       지출결정액').replace('지출액       13,091','                 2023\n          지출액       13,091'),q],
    [table.replace('지출액       13,091','\f\n          지출액       13,091'),q]
  ]) {
    const answer = search(doc,query);
    assert.ok(answer.gap);
    assert.ok(answer.passages.every(h => !h.fiscalCell && !h.fiscalNavigation));
  }
});

test('추가 기사 조건과 예비비 세부 항목은 전체 회계의 단일 금액으로 처리하지 않는다', () => {
  const q = question(2023,'지출액','13,940');
  const contextual = search(table,q,{articleContext:'태풍 재해대책에만 쓰인 금액'});
  assert.match(contextual.gap, /추가한 기사 문맥/);
  assert.equal(contextual.passages[0].fiscalNavigation.reason, 'context');
  for (const text of [q.replace('예비비','예비비 중 재해대책'),q.replace('지출액','배정액'),q.replace('지출액','예결위 의결액')]) {
    const r = search(table,text);
    assert.ok(r.passages.every(h => !h.fiscalCell && !h.fiscalNavigation));
  }
});

test('지출결정액·지출액을 함께 언급하면 물은 항목을 찾고 차액과 비교는 원표 대조로 남긴다', () => {
  const prefix = '2023년 일반회계 예비비 ';
  for (const [request, measure] of [
    ['지출결정액에서 실제 지출액은 얼마인가?', '지출액'],
    ['지출액에서 지출결정액은 얼마인가?', '지출결정액']
  ]) {
    const r = search(table,prefix + request);
    assert.equal(r.passages.length,1);
    assert.equal(r.passages[0].fiscalNavigation.rowLabel,'2023년 ' + measure);
  }
  for (const request of ['지출결정액과 지출액의 차액은 얼마인가?', '지출액과 지출결정액을 비교하면?',
    '지출결정액에서 실제 지출액을 빼면 얼마인가?', '지출액과 지출결정액 중 어느 쪽이 큰가?']) {
    const r = search(table,prefix + request);
    assert.match(r.gap,/단일 금액 셀/);
    assert.ok(r.passages.every(p => !p.fiscalCell && !p.fiscalNavigation));
  }
});

test('예비비 발췌에 같은 쪽의 원표 머리글·연도 묶음과 해당 주석을 원문 순서로 보존한다', t => {
  const {readFileSync} = require('node:fs');
  const path = require('node:path');
  const {JSDOM,VirtualConsole} = require('jsdom');
  const folder = path.join(__dirname,'../docs/reader');
  const errors = [], log = new VirtualConsole();
  log.on('jsdomError',e => errors.push(e.message));
  const dom = new JSDOM(readFileSync(path.join(folder,'factcheck.html'),'utf8'), {
    url:'https://journal.example/factcheck.html', runScripts:'outside-only', virtualConsole:log
  });
  t.after(() => { dom.window.close(); assert.deepEqual(errors,[]); });
  const w = dom.window, doc = w.document, el = id => doc.getElementById(id);
  w.TextEncoder = TextEncoder;
  w.confirm = () => true;
  for (const script of doc.querySelectorAll('script[src]'))
    w.eval(readFileSync(path.join(folder,script.getAttribute('src')),'utf8'));
  function set(id, text) {
    el(id).value = text;
    el(id).dispatchEvent(new w.Event('input',{bubbles:true}));
  }
  const note = '주: 2020 · 2021년 괄호 안 수치';
  const generic = '주 2: 이 표의 비교 기준을 확인할 것';
  const otherPage = '주: 다음 쪽의 다른 표에 대한 설명';
  const source = table + '\n' + generic + '\n\f\n' + otherPage;
  const allLines = source.split('\n').filter(line => line.trim());
  set('article','연도별 예비비의 지출액을 대조했다.');
  el('article-form').requestSubmit();
  el('go-find').click();
  for (const [year,spent,decided] of years) {
    const query = question(year,'지출액',decided);
    set('document-text',source);
    set('document-query',query);
    if (year === 2023) set('search-context','이 금액이 태풍 피해에만 쓰였다고 설명했다.');
    el('find-passages').click();
    const card = el('finder-results').querySelector(':scope > .source');
    assert.match(card.querySelector('blockquote').textContent,new RegExp(spent));
    const button = [...card.children].find(e => e.tagName === 'BUTTON');
    assert.equal(button.textContent,'선택한 행과 같은 해의 표 문맥 발췌');
    button.click();
    const excerpt = el('source-excerpt').value, locator = el('source-locator').value;
    assert.match(locator,new RegExp(year + '년 지출액'));
    assert.doesNotMatch(locator,/번째 열/);
    for (const label of ['[최근 4년간 일반회계 예비비 집행 실적]','(단위: 억원)','목적예비비','재해대책',String(year),spent,decided,generic])
      assert.ok(excerpt.includes(label),label);
    assert.equal(excerpt.includes(note),year <= 2021);
    assert.ok(!excerpt.includes(otherPage));
    const lineIndices = excerpt.split('\n').filter(line => line !== '[…]').map(line => allLines.indexOf(line));
    assert.ok(lineIndices.every((n,i) => n >= 0 && (i === 0 || n > lineIndices[i-1])));
    assert.equal(el('verdict').value,'');
  }
});
