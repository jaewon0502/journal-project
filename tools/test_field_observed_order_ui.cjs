const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const {example} = require('../experiments/field-reason-time/observed-order.cjs');

function screen(t) {
  const read = name => fs.readFileSync(path.join(__dirname,'../docs/reader',name),'utf8');
  const {window:w} = new JSDOM(read('field-summary.html'), {url:'https://example.org/field-summary.html',runScripts:'outside-only'});
  t.after(() => w.close());
  Object.defineProperty(w,'crypto',{value:webcrypto, configurable:true}); w.TextEncoder=TextEncoder;
  for (const name of ['field-review-core.js','field-order.js','field-time-report.js','field-summary.js']) w.eval(read(name));
  const el = id => w.document.getElementById(id);
  const load = async (id,data) => {
    const target=el(id);
    Object.defineProperty(target,'files',{configurable:true,value:[new w.File([JSON.stringify(data)],'receipt.json')]});
    await target.onchange({target});
  };
  return {el,load,w};
}

test('역순으로 들어온 네 완료 쌍의 실제 측정 순서, 시간과 성공 수를 화면과 공유 HTML에서 재현한다',async t=>{
  const {el,load,w}=screen(t), {roster,grades}=await example();
  await load('roster-file',{format:roster.format,assignments:roster.assignments.reverse()});
  await load('imports',{format:grades.format,entries:grades.entries.reverse()});
  assert.equal(el('crossover-observed-order'),null);
  el('toggle-results').click();
  const panel=el('crossover-observed-order'), save=el('editor-crossover').querySelector('button');
  await t.waitFor(()=>assert.equal(save.disabled,false));
  assert.match(panel.textContent,/순서 확인 4명/); assert.match(panel.textContent,/권장 순서와 일치 3명 · 반대 1명/);
  assert.match(panel.textContent,/80.0%/); assert.match(panel.textContent,/20.0%/);
  assert.match(panel.textContent,/평소 도구 먼저 집단.*평소 도구 2\/2명.*저널 0\/2명/);
  let saved; w.Blob=Blob; w.URL.createObjectURL=blob=>{saved=blob;return 'blob:test'};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=()=>{}; save.click();
  const html=await saved.text();
  assert.ok(html.includes('권장 순서와 일치 3명 · 반대 1명')); assert.doesNotMatch(html,/SYNTHETIC-|example\.invalid|sha256|[0-9a-f]{64}|감소분 20회/);
  const edited=structuredClone(grades.entries.find(e=>e.trial.previousCompletion));
  edited.trial.previousCompletion.sha256='1'.repeat(64);
  await load('imports',{format:grades.format,entries:[edited]});
  assert.match(el('status').textContent,/서로 다|다른|충돌/);
  if (el('toggle-results').getAttribute('aria-expanded') === 'true') el('toggle-results').click();
  assert.equal(el('crossover-observed-order'),null);
});

test('순서 정보가 없는 이전 파일은 시간 비교에 남고, 일치하지 않는 지문은 순서 비교에서 빠진다',async t=>{
  const {el,load}=screen(t), {roster,grades}=await example();
  const linked=grades.entries.filter(e=>e.trial.previousCompletion);
  delete linked[0].trial.previousCompletion;
  linked[1].trial.previousCompletion.sha256='f'.repeat(64);
  await load('roster-file',{format:roster.format,assignments:roster.assignments.map(({plannedPeriod,...rest})=>rest)});
  await load('imports',{format:grades.format,entries:grades.entries});
  el('toggle-results').click();
  const panel=el('crossover-observed-order'); await t.waitFor(()=>assert.match(panel.textContent,/순서 확인 2명/));
  assert.match(panel.textContent,/미연결 1명 · 연결 불일치 1명/);assert.match(panel.textContent,/순서 미기록 2명/);
  assert.match(panel.textContent,/순서별 시간·정확도 비교 대기/); assert.match(el('editor-crossover').textContent,/평소 도구 100.0초 · 저널 병행 70.0초/);
});
