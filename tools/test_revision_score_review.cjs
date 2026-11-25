const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const {scoreDifferences} = require('../docs/reader/revision-bias-audit.js');
const {generate} = require('../experiments/bias-score-review/replay.cjs');
const example = require('../experiments/bias-score-review/summary.json');
const archive = require('../experiments/bias-score-review/coordinator-case.json');
const priorArchive = require('../experiments/bias-citation-audit/aligned-case.json');
const reader = path.join(__dirname, '../docs/reader');

function page(t, name, hash = '', demo = null) {
  const dom = new JSDOM(fs.readFileSync(path.join(reader,name), 'utf8'), {url:'file:///reader/' + name + hash, runScripts:'outside-only'});
  const {window} = dom, {document} = window;
  if (demo) {
    const data = document.createElement('script');
    data.id = 'bias-score-practice';
    data.type = 'application/json';
    data.textContent = JSON.stringify(demo);
    document.body.append(data);
  }
  window.TextEncoder = TextEncoder;
  Object.defineProperty(window,'crypto',{value:webcrypto});
  for (const s of document.querySelectorAll('script[src]')) window.eval(fs.readFileSync(path.join(reader,s.getAttribute('src')),'utf8'));
  t.after(()=>window.close());
  function choose(id, named) {
    const input = document.getElementById(id);
    Object.defineProperty(input,'files',{configurable:true,value:named.map(([name,data])=>({name,text:async()=>JSON.stringify(data)}))});
    input.dispatchEvent(new window.Event('change'));
  }
  return {document,choose};
}

test('수정본이 미평가여도 원본 두 숫자를 세고, 미평가와 해당 없음은 비교하지 않는다', async () => {
  const {summary,archive:generated} = await generate();
  assert.deepEqual(summary,example);
  assert.deepEqual(generated,archive);
  const {total,rated,differences} = scoreDifferences(example.dimensions);
  assert.equal(total,8);
  assert.equal(rated,3);
  assert.deepEqual(differences.map(d=>[d.id,d.role,[d.left,d.right].sort()]),[
    ['wording','before',[2,3]],['wording','after',[0,1]]]);
  assert.deepEqual(scoreDifferences([{id:'standards',first:{before:'na',after:null},second:{before:3,after:0}}]),
    {total:2, rated:0, differences:[]});
});

test('기사 대조에서 공동 개선과 별도로 두 등급 차이의 인용 위치·이유를 열어 본다', async t => {
  const ui = page(t,'article-compare.html');
  ui.choose('blind-bundle-files',[['진행자.json',archive]]);
  const doc = ui.document;
  await t.waitFor(()=>assert.ok(doc.getElementById('joint-score-review')));
  const panel = doc.getElementById('joint-score-review');
  assert.match(panel.textContent,/채점한 3\/8개 판본·항목 중 단계 차이 2개/);
  assert.match(panel.textContent,/인용 위치 겹침 1개 · 서로 다른 인용 확인 1개 · 인용 위치 미확정 0개/);
  assert.match(doc.getElementById('joint-bias-citations').textContent,/두 사람이 개선으로 본 1개/);
  const entries = [...panel.querySelectorAll('details')];
  assert.equal(entries.length,2);
  for (const element of entries) element.firstElementChild.click();
  assert.ok(entries.every(e=>e.open && e.querySelectorAll('mark').length === 2));
  assert.match(entries[0].querySelector('summary').textContent,/원본.*인용 위치 겹침/);
  assert.match(entries[1].querySelector('summary').textContent,/수정본.*서로 다른 인용 확인/);
  assert.match(entries[0].textContent,/정당의 주장을 의회가 확인한 결론으로 옮겼다/);
  assert.match(entries[0].textContent,/발언 주체를 바꿔 의혹을 공식 확인처럼 보이게 했다/);
  const sources = row => [...row.querySelectorAll(':scope > .pair > div > blockquote')].map(quote=>quote.textContent);
  const party = '다솔당은 봄빛당이 심사를 고의로 막았다고 주장했다.';
  const minutes = '두 정당의 간사는 심사를 다음 주로 연기하는 데 합의했다.';
  assert.deepEqual(sources(entries[0]),[party,party]);
  assert.deepEqual(sources(entries[1]).sort(),[party,minutes].sort());
});

test('여러 기사 화면의 원본·수정본 링크는 각각 해당 판본의 발췌 두 건만 열고 중복 요약을 빼며 다른 기사 입력을 거부한다', async t => {
  const ui = page(t,'revision-series.html');
  ui.choose('series-files',[['가상 의회.json',example],['같은 요약.json',example]]);
  await t.waitFor(()=>assert.ok(ui.document.getElementById('series-score-review')));
  const box = ui.document.getElementById('series-score-review');
  assert.match(box.querySelector('summary').textContent,/2\/3개/);
  assert.match(box.textContent,/미평가 또는 해당 없음 5개/);
  const links = [...box.querySelectorAll('a')];
  assert.equal(links.length,2);
  for (const [i,a] of links.entries()) {
    const edition = i ? 'after' : 'before';
    assert.ok(a.hash.endsWith('focus=bias-wording-'+edition));
    const review = page(t,'article-compare.html',a.hash), doc = review.document;
    review.choose('blind-bundle-files',i ? archive.items.map(({name,data})=>[name,data]) : [['진행자.json',archive]]);
    const selector = 'details[data-score-axis="wording"][data-score-edition="'+edition+'"][open]';
    await t.waitFor(()=>assert.ok(doc.querySelector(selector)));
    const selected = doc.querySelector(selector);
    assert.equal(selected.querySelector('summary'),doc.activeElement);
    assert.equal(doc.getElementById('output').querySelectorAll('[data-score-edition]').length,1);
    assert.equal(selected.querySelectorAll('mark').length,2);
    assert.equal(selected.querySelectorAll(':scope > .pair > div > blockquote').length,2);
    assert.match(selected.textContent,i ? /회의록에는 두 정당이 심사를 연기하기로 합의/ : /시의회는 봄빛당이 심사를 고의로 막았다고 확인/);
  }
  const wrong = page(t,'article-compare.html',links[0].hash);
  wrong.choose('blind-bundle-files',[['다른 기사.json',priorArchive]]);
  await t.waitFor(()=>assert.match(wrong.document.getElementById('blind-bundle-status').textContent,/일치하지/));
  assert.equal(wrong.document.getElementById('output').querySelector('[data-score-edition]'),null);
});

test('진행자 팩의 링크 한 번으로 두 판본의 실제 구절과 네 근거를 동시에 펼친다', async t => {
  const hash = '#review=' + archive.reviewId + '&focus=score-review&example=score';
  const {document} = page(t,'article-compare.html',hash,archive);
  await t.waitFor(()=>assert.equal(document.querySelectorAll('#joint-score-review [data-score-edition][open]').length,2));
  assert.equal(document.activeElement, document.querySelector('[data-score-edition="before"] > summary'));
  assert.equal(document.querySelectorAll('#joint-score-review mark').length,4);
  assert.match(document.getElementById('result-title').textContent,/두 판본에서 단계가 다른 항목/);
  const sourcePage = page(t,'article-compare.html',hash);
  assert.match(sourcePage.document.getElementById('review-target-status').textContent,/기록을 선택하세요/);
  assert.equal(sourcePage.document.getElementById('blind-bundle-files'), sourcePage.document.activeElement);
});

test('인용 위치를 확정할 수 없는 점수 차이는 서로 다른 인용으로 세지 않는다', async t => {
  const rubric = require('../docs/reader/article-rubric.js'), engine = require('../docs/reader/factcheck-engine.js');
  const items = structuredClone(archive.items);
  let index = 0;
  for (const {data} of items) {
    if (!data.blindReview || !data.article.includes('시의회는 봄빛당이')) continue;
    const {coreRowIds,ratings} = data.articleAssessment;
    ratings.wording.quote = ['고의로 막','막았다고'][index++];
    data.articleAssessment = rubric.save(engine.report(data.article,data.sources), data.sources,{coreRowIds,ratings});
  }
  assert.equal(index,2);
  const ui = page(t,'article-compare.html');
  ui.choose('blind-bundle-files',items.map(({name,data})=>[name,data]));
  await t.waitFor(()=>assert.ok(ui.document.getElementById('joint-score-review')));
  const panel = ui.document.getElementById('joint-score-review');
  assert.match(panel.textContent,/인용 위치 겹침 0개 · 서로 다른 인용 확인 1개 · 인용 위치 미확정 1개/);
  assert.match(panel.querySelector('[data-score-edition="before"] > summary').textContent,/미확정/);
});
