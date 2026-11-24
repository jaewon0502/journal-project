const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const dir = path.join(__dirname, '../docs/reader');
const axisIds = ['wording', 'framing', 'omission', 'standards'];

function record(before, after, scores, changed = false) {
  return {
    format: 'journal-revision-series-record', version: 1, demo: true,
    before: {articleSha256: before.repeat(64), sourcesSha256: 'e'.repeat(64)},
    after: {articleSha256: after.repeat(64), sourcesSha256: (changed ? 'f' : 'e').repeat(64)},
    dimensions: axisIds.map((id, i) => {
      const [a, b, c, d] = scores[i];
      return {id, first: {before: a, after: b}, second: {before: c, after: d}};
    }),
  };
}

const one = record('1', '2', [[2, 1, 3, 0], [0, 2, 1, 3], [0, 0, 1, 2], [null, null, null, null]]);
const two = record('3', '4', [[2, 2, 3, 2], [3, 2, 3, 2], [2, 3, 3, 3], [2, null, 3, 'na']], true);
const file = (name, data) => ({name, text: async () => JSON.stringify(data)});

function page(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, 'revision-series.html'), 'utf8'), {
    url: 'file:///reader/revision-series.html', runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const {window} = dom;
  const get = id => window.document.getElementById(id);
  for (const script of window.document.querySelectorAll('script[src]')) {
    window.eval(fs.readFileSync(path.join(dir, script.getAttribute('src')), 'utf8'));
  }
  function select(...files) {
    const input = get('series-files');
    Object.defineProperty(input, 'files', {configurable: true, value: files});
    input.dispatchEvent(new window.Event('change'));
  }
  function empty() {
    assert.equal(get('result').hidden, true);
    assert.equal(get('output').textContent, '');
    assert.equal(get('result-title').textContent, '집계 결과');
  }
  return {get, select, empty, document: window.document};
}
const flushed = () => new Promise(resolve => setImmediate(resolve));
const factCells = (section, key) => [...section.querySelectorAll('[data-fact-row="' + key + '"] td')].map(cell => cell.textContent);

test('편향이 나아진 기사에 남은 사실 충돌·미결과 이전 요약의 자료 부재를 분리한다', async t => {
  const p = page(t);
  const current = {...one, version:2, facts:{
    before:[{outcome:'contradicted',flag:'article'}, {outcome:'pending',flag:'none'}, {outcome:'excluded',flag:'none'}],
    after:[{outcome:'supported',flag:'none'}, {outcome:'pending',flag:'quote'}, {outcome:'shared',flag:'article'}]
  }};
  p.select(file('종전.json', one), file('새 요약.json', current), file('다른 기사.json', two));
  await flushed();
  const section = p.get('series-facts');
  assert.match(section.textContent, /구절별 검토 상태가 담긴 기사 1\/2건.*이전 형식 요약 1건/);
  assert.match(section.textContent, /편향 개선과 함께 수정본에 충돌 표시가 있는 기사 1건.*새 요약.json · 수정본 충돌 표시 2개 구절/);
  assert.match(section.textContent, /미결·판정 불일치·동일 판정 기록이 있는 기사 1건/);
  assert.deepEqual(factCells(section, 'support'), ['0% (0/1)', '100% (1/1)']);
  assert.deepEqual(factCells(section, 'coverage'), ['50% (1/2)', '33.3% (1/3)']);
  assert.deepEqual(factCells(section, 'shared'), ['0개', '1개']);
  assert.deepEqual(factCells(section, 'quoteFlagged'), ['0개', '1개']);
  p.select(file('종전.json', one));
  await flushed();
  assert.match(p.get('series-facts').textContent, /구절별 검토 상태가 담긴 기사 0\/1건/);
  assert.equal(p.get('series-facts').querySelector('table'), null);
});

test('기사별 분모를 합산하고 고유 기사, 중복, 빠진 판정, 자료 변경을 화면에서 구분한다', async t => {
  const p = page(t);
  p.empty();
  assert.ok(p.get('series-files').multiple);
  assert.ok(p.get('series-clear').disabled);
  p.select(file('검토 <img>.json', one), file('두번째.json', two), file('같은기사.json', one));
  await flushed();
  assert.equal(p.get('result').hidden, false);
  assert.match(p.get('result-title').textContent, /가상 예시.*기사 2건/);
  assert.match(p.get('output').textContent, /선택한 파일 3개 · 고유 기사 2건 · 중복 제외 1개/);
  assert.match(p.get('series-improved').textContent, /25%1\/4개 항목 · 분모에 포함된 기사 2건/);
  assert.match(p.get('series-worsened').textContent, /50%1\/2개 항목 · 분모에 포함된 기사 1건/);
  const coverage = p.get('series-coverage').textContent;
  assert.match(coverage, /네 판정이 모두 있는 항목 6\/8개 · 기사 2\/2건/);
  assert.match(coverage, /미평가 5건, 해당 없음 1건/);
  assert.match(coverage, /수정본에서 한 명 이상 숫자 단계를 매기지 않은 항목 1개/);
  assert.match(coverage, /개선·악화·유지 판단이 갈린 항목 1개/);
  assert.match(p.get('output').textContent, /원자료 묶음이 달라진 기사 1건/);
  assert.match(p.get('output').textContent, /원자료가 같은 기사 1건만 보면 공통 개선율은 100% \(1\/1\)/);
  const rows = p.get('series-dimensions').querySelectorAll('tbody tr');
  assert.equal(rows.length, 4);
  assert.match(rows[0].textContent, /표현과 발언 귀속50% \(1\/2\)산출 대기 \(0\/0\)2\/2개/);
  const articles = p.get('series-articles');
  assert.equal(articles.querySelectorAll('summary').length, 2);
  assert.match(articles.textContent, /검토 <img>\.json · 공통 개선 1\/1 · 공통 악화 1\/2/);
  assert.match(articles.textContent, /원본 111111111111 → 수정본 222222222222/);
  assert.doesNotMatch(articles.textContent, /같은기사/);
  assert.equal(articles.querySelector('img'), null);
});

test('모든 파일을 확인한 뒤에만 집계하고 오류나 빈 선택이 이전 요약을 남기지 않는다', async t => {
  const p = page(t);
  const good = file('원본.json', one);
  for (const bad of [
    {name: '잘린.json', text: async () => '{'},
    {name: '읽기오류.json', text: async () => {throw new Error('io');}},
    file('작업파일.json', {format: 'journal-local-factcheck-v1'}),
    file('다른종류.json', {...two, demo: false}),
    file('판본중복.json', {...two, before: one.after}),
  ]) {
    p.select(good);
    await flushed();
    assert.equal(p.get('result').hidden, false);
    p.select(good, bad);
    p.empty();
    await flushed();
    p.empty();
    assert.equal(p.get('series-status').classList.contains('error'), true);
    assert.match(p.get('series-status').textContent, /집계할 수 없습니다\./);
    assert.ok(p.get('series-status').textContent.includes(bad.name), bad.name);
    if (['다른종류.json', '판본중복.json'].includes(bad.name)) {
      assert.ok(p.get('series-status').textContent.includes('원본.json'));
    }
  }
  p.select(good);
  await flushed();
  assert.equal(p.get('series-status').classList.contains('error'), false);
  p.select();
  p.empty();
  assert.equal(p.get('series-status').textContent, '');
  assert.equal(p.get('series-clear').disabled, true);
});

test('분모가 없는 개선율과 0% 악화율을 구분하고, 예시 구분은 파일과 함께 바뀐다', async t => {
  const p = page(t);
  p.select(file('예시.json', two));
  await flushed();
  assert.match(p.get('result-title').textContent, /가상 예시/);
  assert.match(p.get('output').textContent, /원자료가 같은 기사 0건만 보면 공통 개선율은 산출 대기 \(0\/0\)/);
  const actual = record('a', 'b', axisIds.map(() => [0, 1, 1, 0]));
  p.select(file('기사.json', {...actual, demo: false}));
  await flushed();
  assert.doesNotMatch(p.get('result-title').textContent, /가상 예시/);
  assert.match(p.get('series-improved').textContent, /산출 대기0\/0개 항목 · 분모에 포함된 기사 0건/);
  assert.match(p.get('series-worsened').textContent, /0%0\/4개 항목 · 분모에 포함된 기사 1건/);
  assert.doesNotMatch(p.get('output').textContent, /원자료가 같은 기사/);
});

test('늦은 성공과 실패는 새 결과나 선택 해제를 덮어쓰지 않는다', async t => {
  const p = page(t);
  let finish, fail;
  const delayed = {name: '이전.json', text: () => new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  })};
  p.select(delayed);
  p.select(file('현재.json', two));
  await flushed();
  fail(new Error('old io error'));
  await flushed();
  assert.equal(p.get('result').hidden, false);
  assert.match(p.get('series-articles').textContent, /현재.json/);
  assert.equal(p.get('series-status').classList.contains('error'), false);
  p.select(delayed);
  p.select({name: '새오류.json', text: async () => '{'});
  await flushed();
  finish(JSON.stringify(one));
  await flushed();
  p.empty();
  assert.match(p.get('series-status').textContent, /새오류.json/);
  p.select(delayed);
  p.get('series-clear').click();
  finish(JSON.stringify(two));
  await flushed();
  p.empty();
  assert.equal(p.document.activeElement, p.get('series-files'));
  assert.equal(p.get('series-status').textContent, '');
  assert.equal(p.get('series-clear').disabled, true);
});

test('내장 예시와 직접 고른 기사 사이를 전환해도 한쪽 기록만 표시한다', async t => {
  const p = page(t);
  const actual = file('직접 고른 기사.json', {...one, demo: false});
  p.select(actual);
  await flushed();
  assert.doesNotMatch(p.get('result-title').textContent, /가상 예시/);
  p.get('series-example').click();
  assert.match(p.get('series-status').textContent, /가상 기사 2건을 채점한 모의 예시/);
  assert.match(p.get('result-title').textContent, /가상 예시.*기사 2건/);
  assert.match(p.get('output').textContent, /예시 파일 2개 · 고유 기사 2건/);
  assert.match(p.get('series-improved').textContent, /75%3\/4개 항목/);
  assert.match(p.get('series-coverage').textContent, /네 판정이 모두 있는 항목 4\/8개/);
  assert.match(p.get('series-coverage').textContent, /개선·악화·유지 판단이 갈린 항목 1개/);
  const facts = p.get('series-facts');
  assert.match(facts.textContent, /구절별 검토 상태가 담긴 기사 2\/2건/);
  assert.deepEqual(factCells(facts, 'support'), ['33.3% (1/3)', '100% (3/3)']);
  assert.deepEqual(factCells(facts, 'coverage'), ['33.3% (3/9)', '33.3% (3/9)']);
  assert.deepEqual(factCells(facts, 'articleFlagged'), ['2개', '0개']);
  assert.deepEqual(factCells(facts, 'quoteFlagged'), ['1개', '1개']);
  assert.match(facts.textContent, /편향 개선과 함께 수정본에 충돌 표시가 있는 기사 1건/);
  assert.deepEqual([...facts.querySelectorAll('li')].map(item => item.textContent), ['도서관 운영 연습 기사 · 수정본 충돌 표시 1개 구절']);
  const articles = [...p.get('series-articles').querySelectorAll('details')].map(item => item.textContent);
  assert.match(articles[0], /출생 통계 연습 기사.*두 판본의 원자료 묶음 같음.*두 편집자의 구절 전체 지지율 0% \(0\/1\) → 100% \(1\/1\).*수정본 공동 판정 범위 16.7% \(1\/6\)/);
  assert.match(articles[1], /도서관 운영 연습 기사.*두 판본의 원자료 묶음 같음.*두 편집자의 구절 전체 지지율 50% \(1\/2\) → 100% \(2\/2\).*수정본 공동 판정 범위 66.7% \(2\/3\)/);
  assert.doesNotMatch(p.get('series-articles').textContent, /직접 고른 기사/);
  p.select(actual);
  p.empty();
  await flushed();
  assert.equal(p.get('series-example').textContent, '가상 기사 2건으로 예시 보기');
  assert.match(p.get('output').textContent, /선택한 파일 1개 · 고유 기사 1건/);
  assert.doesNotMatch(p.get('result-title').textContent, /가상 예시/);
  p.get('series-example').click();
  p.get('series-example').click();
  p.empty();
  assert.ok(p.get('series-clear').disabled);
  p.get('series-example').click();
  p.get('series-clear').click();
  p.empty();
});

test('예시를 연 뒤에 끝난 이전 파일 읽기는 예시 집계를 덮어쓰지 않는다', async t => {
  const p = page(t);
  let finish;
  p.select({name: '늦은.json', text: () => new Promise(resolve => { finish = resolve; })});
  p.get('series-example').click();
  finish(JSON.stringify({...one, demo: false}));
  await flushed();
  assert.match(p.get('series-status').textContent, /모의 예시/);
  assert.match(p.get('series-improved').textContent, /75%3\/4개 항목/);
  assert.doesNotMatch(p.get('series-articles').textContent, /늦은.json/);
});
