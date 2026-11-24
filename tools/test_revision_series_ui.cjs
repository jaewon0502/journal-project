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
  window.TextEncoder = TextEncoder;
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

test('조건부 개선 100% 곁에 같은 8개 항목의 12.5%→50%와 판단이 갈린 기준별 근거를 표시한다', async t => {
  const p = page(t);
  const a = record('1','2', [[2,0,2,0], [0,2,2,2], [2,2,0,2], [1,0,0,1]]);
  const b = record('3','4', [[2,2,0,2], [0,2,2,2], [0,0,0,0], [0,0,0,0]], true);
  const v3 = {...a, version:3, facts:{before:[{outcome:'pending', flag:'none'}],after:[{outcome:'pending', flag:'none'}]}, factMatches:[]};
  p.select(file('예전 A.json', a), file('같은 자료 A.json', v3), file('새 자료 B.json', b));
  await flushed();
  assert.match(p.get('series-improved').textContent, /100%1\/1/);
  assert.match(p.get('series-worsened').textContent, /0%0\/3/);
  const area = p.get('series-severity');
  assert.match(p.get('series-severity-change').textContent, /원본 12\.5% \(1\/8\) → 수정본 50% \(4\/8\) · 37\.5%p 증가/);
  assert.match(area.textContent, /원자료가 같은 기사 1건만 보면 · 원본 25% \(1\/4\) → 수정본 50% \(2\/4\)/);
  assert.match(area.textContent, /수정본에서는 두 사람 모두 중요하다고 본 항목 4개/);
  assert.match(area.textContent, /한 편집자는 단계를 높이고 다른 편집자는 낮춘 항목 1개/);
  assert.deepEqual([...area.querySelectorAll('tbody tr')].map(r=>[...r.cells].slice(1).map(cell=>cell.textContent)),
    [['3개','0개','0개'],['0개','0개','4개'],['1개','0개','0개']]);
  const follow = p.get('series-bias-follow-up');
  assert.match(follow.querySelector('summary').textContent,/5개 항목/);
  const digest = require('../docs/reader/revision-series.js').reviewId(v3);
  assert.deepEqual([...follow.querySelectorAll('a')].map(a => a.hash), ['framing','omission','standards']
    .map(id => '#review=' + digest + '&focus=bias-' + id));
  assert.doesNotMatch(follow.textContent, /예전 A/);
  assert.match(follow.textContent, /새 자료 B/);
  p.select(file('빈 기록', record('5','6', Array(4).fill([null,null,null,null]))));
  await flushed();
  assert.match(p.get('series-severity').textContent,/0\/4개.*비교할 수 있는 항목이 생기면/);
  assert.equal(p.get('series-severity-change'),null);
  assert.equal(p.get('series-bias-follow-up'),null);
});

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
  assert.equal(section.querySelector('.review-evidence').hash, '#review=' + require('../docs/reader/revision-series').reviewId(current));
  assert.deepEqual(factCells(section, 'support'), ['0% (0/1)', '100% (1/1)']);
  assert.deepEqual(factCells(section, 'coverage'), ['50% (1/2)', '33.3% (1/3)']);
  assert.deepEqual(factCells(section, 'shared'), ['0개', '1개']);
  assert.deepEqual(factCells(section, 'quoteFlagged'), ['0개', '1개']);
  p.select(file('종전.json', one));
  await flushed();
  assert.match(p.get('series-facts').textContent, /구절별 검토 상태가 담긴 기사 0\/1건/);
  assert.equal(p.get('series-facts').querySelector('table'), null);
});

test('편향 개선이 0건이어도 수정본에 충돌 표시가 있는 기사로 이동한다', async t => {
  const p = page(t);
  const marked = {...two, version:2, facts:{before:[{outcome:'pending', flag:'none'}], after:[{outcome:'quotedConflict',flag:'quote'}]}};
  p.select(file('개선 없음.json', marked), file('옛 형식.json', one));
  await flushed();
  const section = p.get('series-facts');
  assert.match(section.textContent, /편향 개선과 함께 수정본에 충돌 표시가 있는 기사 0건/);
  const links = section.querySelectorAll('a.review-evidence');
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, '개선 없음.json · 수정본 충돌 표시 1개 구절');
  assert.match(links[0].hash, /^#review=[a-f0-9]{64}$/);
});

test('수정본의 새로운 지지 구절이 자리를 채워도 다시 대조할 원본 사실과 해당 기사 링크를 표시한다', async t => {
  const p = page(t);
  const supported = {outcome:'supported', flag:'none'};
  const data = {...one, version:3, facts:{before:[supported, supported], after:[supported, supported]},
    factMatches:[[0, 1], [1, null]]};
  const legacy = {...data, version:2};
  delete legacy.factMatches;
  p.select(file('이전 형식.json', legacy), file('정정한 기사.json', data));
  await flushed();
  const panel = p.get('series-facts');
  assert.equal(p.get('result').hidden, false);
  assert.match(p.get('series-improved').textContent, /100%1\/1개 항목/);
  assert.deepEqual(factCells(panel, 'support'), ['100% (2/2)', '100% (2/2)']);
  assert.match(panel.textContent, /원본 사실을 대조할 수 있는 기사 1건 중 원본 사실의 전체 지지를 다시 확인해야 하는 기사 1건/);
  assert.match(panel.textContent, /사실 확인 대상 구절 수가 줄어든 기사 0건/);
  const links = panel.querySelectorAll('a.review-evidence');
  assert.equal(links.length, 1);
  assert.equal(links[0].hash, '#review=' + require('../docs/reader/revision-series').reviewId(data) + '&focus=retention');
  assert.equal(links[0].textContent, '정정한 기사.json · 원본 사실 1개 다시 대조');
  assert.match(links[0].getAttribute('aria-label'), /새 탭/);
  assert.match(p.get('series-articles').textContent, /모두 구절 전체를 지지한 사실 1\/2개.*대응 구절 미확인 1개 · 대응 구절에서 전체 지지 미확인 0개/);
  assert.doesNotMatch(panel.textContent, /이전 형식\.json/);
  p.select(file('다시 대조.json', {...data, facts:{before:[supported, supported], after:[supported, {outcome:'limited', flag:'none'}]},
    factMatches:[[0, 1], [1, 0]]}));
  await flushed();
  assert.match(p.get('series-articles').textContent, /대응 구절 미확인 0개 · 대응 구절에서 전체 지지 미확인 1개/);
});

test('다른 기사의 분모가 늘어도 감소한 편향 개선 기사 이름을 보여 주고 판본 간 대응을 알 수 없는 파일은 구분한다', async t => {
  const p = page(t);
  const supported = {outcome:'supported', flag:'none'}, pending = {outcome:'pending', flag:'none'};
  const shrank = {...one, version:2, facts:{before:[supported, pending], after:[supported]}};
  const grew = {...two, version:3, facts:{before:[supported], after:[pending, supported]}, factMatches:[[0, 1]]};
  p.select(file('확인 대상 감소.json', shrank), file('확인 대상 증가.json', grew));
  await flushed();
  const panel = p.get('series-facts');
  assert.deepEqual(factCells(panel, 'coverage'), ['66.7% (2/3)', '66.7% (2/3)']);
  assert.match(panel.textContent, /사실 판정이 있는 편향 개선 기사 1건 중 사실 확인 대상 구절 수가 줄어든 기사 1건/);
  assert.match(panel.textContent, /구절 대응 기록이 없는 이전 요약 1건은 원본 사실의 유지 여부를 집계할 수 없습니다/);
  assert.match(panel.textContent, /확인 대상 감소\.json · 사실 확인 대상 2개 → 1개/);
  assert.doesNotMatch(panel.textContent, /확인 대상 증가\.json/);
  assert.equal(panel.querySelector('a.review-evidence'), null);
  const [a,b] = p.get('series-articles').querySelectorAll('details');
  assert.match(a.textContent, /사실 확인 대상 2개 → 1개.*이전 요약에 구절 대응 기록이 없어/);
  assert.match(b.textContent, /사실 확인 대상 1개 → 2개.*모두 구절 전체를 지지한 사실 1\/1개/);
  p.select(file('아직 원본 미확인.json', {...shrank, version:3, facts:{before:[pending], after:[supported]}, factMatches:[]}));
  await flushed();
  assert.match(p.get('series-articles').textContent, /원본에서 두 편집자가 구절 전체를 근거로 확인한 사실이 없습니다/);
  assert.match(p.get('series-facts').textContent, /원본에서 두 편집자가 구절 전체를 지지한 판정이 없어 유지 여부를 계산할 수 없습니다/);
  assert.doesNotMatch(p.get('series-articles').textContent, /지지한 사실 0\/0/);
  assert.equal(p.get('series-facts').querySelector('a.review-evidence'), null);
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
    file('진행자용.json', {format:'journal-retention-case', notes:[{reason:'화면에 공개하지 않을 판단 이유'}]}),
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
    if (bad.name === '진행자용.json') {
      assert.match(p.get('series-status').textContent, /기사 평가 비교에서 다시 열고/);
      assert.doesNotMatch(p.document.body.textContent, /화면에 공개하지 않을 판단 이유/);
    }
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
  const links = [...facts.querySelectorAll('.review-evidence')];
  assert.deepEqual(links.map(link => link.textContent),
    ['도서관 운영 연습 기사 · 수정본 충돌 표시 1개 구절', '도서관 운영 연습 기사 · 원본 사실 1개 다시 대조']);
  assert.match(links[0].hash, /^#review=[a-f0-9]{64}&example=library$/);
  assert.equal(links[1].hash, links[0].hash.replace('&example=library', '&focus=retention&example=library'));
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

test('편향 개선 점수가 같아도 원본 핵심 사실 유지와 충돌 표시의 출처를 구별한다', async t => {
  const p = page(t);
  const supported = {outcome:'supported', flag:'none'};
  const flagged = {outcome:'contradicted', flag:'article'};
  const pending = {outcome:'pending', flag:'none'};
  const record = {...one, version:4, facts:{
    before:[supported, supported, flagged, pending], after:[supported, flagged, flagged, flagged]},
    factMatches:[[0,0], [1,null]], factContext:{beforeCore:[2,0,0,0], afterCore:[0,2,0,0], matches:[[0,0],[2,1],[3,2]]}};
  for (const [core, expected] of [[[2,0,0,0], '100% (1/1개)'], [[0,2,0,0], '0% (0/1개)']]) {
    record.factContext.beforeCore = core;
    p.select(file('비교할 기사.json', record));
    await flushed();
    const section = p.get('series-core-audit');
    assert.ok(section.textContent.includes(expected));
    assert.match(section.textContent, /충돌 표시가 있는 구절 3개 · 두 편집자가 모두 핵심으로 표시한 구절 1개/);
    assert.match(section.textContent, /원본에도 충돌 표시가 있던 구절 1개.*전체 내용을 확인한 구절 0개.*전체 지지도 확인되지 않은 구절 1개.*대응 구절을 찾지 못한 경우 1개/);
    assert.ok(p.get('series-articles').textContent.includes(expected));
  }
  p.select(file('이전 모의 기사.json', one));
  await flushed();
  assert.match(p.get('series-core-audit').textContent, /대조할 수 있는 기사 0건.*이전 형식으로 저장한 개선 기사 1건/);
  assert.doesNotMatch(p.get('series-core-audit').textContent, /0%|0\/0|충돌 표시가 있는 구절 0개/);
});

test('공통 개선 100%여도 수정본에서 확인된 중요한 왜곡과 원본 평가가 빠진 항목의 근거를 연다', async t => {
  const p = page(t);
  const scores = [[2,0,3,1],[null,2,'na',3],[0,1,0,null],[2,null,3,2]];
  const legacy = record('1','2',scores);
  const current = {...legacy, version:5, facts:{before:[{outcome:'pending', flag:'none'}],after:[{outcome:'pending', flag:'none'}]},
    factMatches:[], factContext:{beforeCore:[0],afterCore:[0],matches:[]}};
  p.select(file('구판',legacy),file('새 기사 요약',current));
  await flushed();
  assert.match(p.get('series-improved').textContent,/100%1\/1/);
  assert.match(p.get('series-severity').textContent,/수정본에서 두 사람 모두 중요한 왜곡으로 평가한 항목 1\/2개/);
  const unresolved = p.get('series-revised-unpaired');
  assert.equal(unresolved.querySelectorAll('li').length,1);
  assert.match(unresolved.textContent,/첫 편집자 미평가 → 2단계 · 둘째 편집자 해당 없음 → 3단계/);
  assert.match(unresolved.querySelector('a').href,/&focus=bias-framing$/);
  assert.ok(unresolved.querySelector('a').textContent.includes('새 기사 요약'));
  const onlyMissing = record('3','4',[[null,null,null,null],['na',2,null,3],[null,null,null,null],[null,null,null,null]]);
  p.select(file('원본 미평가',onlyMissing));
  await flushed();
  assert.equal(p.get('series-severity-change'),null);
  assert.match(p.get('series-worsened').textContent,/산출 대기/);
  assert.match(p.get('series-revised-unpaired').textContent,/원본 미평가.*미평가 → 3단계/);
  assert.equal(p.get('series-revised-unpaired').querySelector('a'),null);
});

test('보존율 1/1 옆에 대응 없는 핵심 발언의 증거 링크를 내고 예전 핵심 미기록은 제외한다', async t => {
  const p = page(t);
  const example = require('../experiments/core-quote-revision/series-summary.json');
  const legacy = {...structuredClone(example), version:3};
  delete legacy.factContext;
  const title = '발언 교체 연습.json';
  p.select(file('구버전', legacy), file(title, example), file('중복', example));
  await flushed();
  assert.match(p.get('series-core-audit').textContent, /100% \(1\/1개\)/);
  const section = p.get('series-core-context');
  assert.match(section.textContent, /원본 구절 1개 중 수정본 대응을 찾지 못한 구절 1개/);
  const links = [...section.querySelectorAll('a')];
  assert.equal(links.length, 1);
  const series = require('../docs/reader/revision-series.js');
  assert.equal(links[0].hash, '#review=' + series.reviewId(example) + '&focus=core-context');
  assert.ok(links[0].textContent.startsWith(title));
  assert.doesNotMatch(section.textContent, /야당 의원|무책임하다/);
  p.select(file('구버전', legacy));
  await flushed();
  assert.equal(p.get('series-core-context'), null);
  assert.match(p.get('series-core-audit').textContent,/이전 형식으로 저장한 개선 기사 1건/);
});
