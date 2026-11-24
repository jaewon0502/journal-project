const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const assignment = require('../experiments/labour-field-review/blind-tasks.json');
const original = require('../experiments/labour-field-review/blind-workspace.json');
const reader = path.resolve(__dirname, '../docs/reader');

function savedWork() {
  const work = structuredClone(original);
  work.article = work.articleDraft = 'PRIVATE-ARTICLE';
  work.sources[0] = {...work.sources[0], url:'https://agency.example/report.pdf#page=6&zoom=100',
    title:'PRIVATE-TITLE', version:'PRIVATE-EDITION', excerpt:'PRIVATE-EXCERPT', locator:'청년층 실업률 행, 2024년 열', pdfSha256:'c'.repeat(64)};
  work.sources[1] = {...work.sources[1], url:'https://agency.example/viewer#/documents/42', pdfPage:'7', locator:'시도별 취업자 행'};
  work.sourceDraft.fields.locator = 'PRIVATE-UNREGISTERED';
  work.sourceDraft.fields.url = 'https://private.example/unregistered';
  work.rowDrafts = [{rowId:'unit-0',data:{status:'held',reason:'PRIVATE-REASON',sourceIds:[],factSpan:'',opinionSpan:''}}];
  return work;
}

async function field(t, method = 'journal') {
  const errors = [], console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(reader,'field-review.html'),'utf8'), {
    url:'https://journal.example/field-review.html', runScripts:'outside-only', virtualConsole:console
  });
  const w = dom.window, el = id => w.document.getElementById(id);
  w.confirm = () => true; w.TextEncoder = TextEncoder;
  let download;
  w.URL.createObjectURL = blob => { download = blob; return 'blob:field'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  for (const s of w.document.querySelectorAll('script[src]')) w.eval(fs.readFileSync(path.join(reader,s.getAttribute('src')), 'utf8'));
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  const type = (id, value) => { el(id).value = value; el(id).dispatchEvent(new w.Event('input', {bubbles:true})); };
  const change = (id, value) => { el(id).value = value; el(id).dispatchEvent(new w.Event('change', {bubbles:true})); };
  function upload(id, file) {
    Object.defineProperty(el(id),'files',{value:[file],configurable:true});
    return el(id).onchange({target:el(id)});
  }
  function start(index=0) {
    type('participant','field-tester'); change('task',assignment.tasks[index].id); change('method',method); el('start').click();
    assert.equal(el('work').hidden,false);
  }
  await upload('case-file', new w.File([JSON.stringify(assignment)], 'tasks.json'));
  assert.equal(el('field-evidence').hidden,true);
  start();
  function load(work) {
    return upload('evidence-work', new w.File([typeof work === 'string' ? work : JSON.stringify(work)], 'PRIVATE-FILENAME.json'));
  }
  const downloadTrial = async () => { el('download').click(); return JSON.parse(await download.text()); };
  return {w,el,type,change,start,upload,load,downloadTrial};
}

test('등록 자료를 직접 고른 뒤 문서 주소와 위치만 옮기고, 판정·원문·파일명은 참여 기록에서 제외한다', async t => {
  const p = await field(t), work = savedWork();
  await p.load(work);
  assert.equal(p.el('evidence-choices').options.length,3);
  assert.equal(p.el('evidence-choices').value,''); assert.ok(p.el('evidence-apply').disabled);
  assert.equal(p.el('evidence-preview').textContent,'');
  assert.doesNotMatch(p.el('field-evidence').textContent,/PRIVATE-(EXCERPT|ARTICLE|REASON|UNREGISTERED|FILENAME)/);
  p.change('evidence-choices','1');
  assert.match(p.el('evidence-preview').textContent,/viewer#\/documents\/42\n시도별 취업자 행 · PDF 7쪽/);
  p.change('evidence-choices','0'); p.el('evidence-apply').click();
  const url = 'https://agency.example/report.pdf#page=28&zoom=100', locator = '청년층 실업률 행, 2024년 열 · PDF 28쪽';
  assert.equal(p.el('documentUrl').value,url); assert.equal(p.el('locator').value,locator);
  for (const id of ['found','verdict','reason','journalUse']) assert.equal(p.el(id).value,'');
  p.el('submit').click(); assert.ok(p.el('ended').hidden);
  for (const [id, value] of Object.entries({found:'found',verdict:'contradicted',reason:'참여자가 작성한 이유',journalUse:'no'})) p.type(id,value);
  p.el('submit').click(); assert.equal(p.el('ended').hidden,false);
  const answer = await p.downloadTrial();
  assert.equal(answer.documentUrl,url); assert.equal(answer.locator,locator); assert.equal(answer.reason,'참여자가 작성한 이유');
  assert.equal(answer.verdict,'contradicted'); assert.equal(answer.journalUse,'no');
  for (const value of [JSON.stringify(answer), JSON.stringify({...p.w.localStorage})]) {
    assert.doesNotMatch(value,/PRIVATE-|private\.example|viewer#\/documents|pdfSha256|c{64}|sourceDraft|"sources"/);
  }
});

test('복사한 위치로 바꾸는 것을 취소하면 기존 답안을 유지하고 수락해도 주소와 위치만 바꾼다', async t => {
  const p = await field(t);
  const old = {documentUrl:'https://old.example/table',locator:'종전 위치',found:'missing',reason:'참여자가 적은 메모',verdict:'insufficient',journalUse:'no'};
  for (const [id,value] of Object.entries(old)) p.type(id,value);
  p.type('evidence-paste','이 텍스트에는 근거 위치 표지가 없다.');
  assert.ok(p.el('evidence-selection').hidden);
  const url = 'https://agency.example/report.pdf#page=9';
  p.type('evidence-paste',['Journal 근거 위치', url, '지출표 2', '3번 결산액 행'].join('\r\n'));
  assert.equal(p.el('evidence-choices').value,'0');
  let prompts = 0;
  p.w.confirm = () => { prompts++; return false; };
  p.el('evidence-apply').click(); assert.equal(prompts,1);
  for (const [id,value] of Object.entries(old)) assert.equal(p.el(id).value,value);
  p.w.confirm = () => true; p.el('evidence-apply').click();
  assert.equal(p.el('documentUrl').value,url); assert.equal(p.el('locator').value,'지출표 2\n3번 결산액 행 · PDF 9쪽');
  for (const id of ['found','reason','verdict','journalUse']) assert.equal(p.el(id).value,old[id]);
});

test('잘못된 파일·모의 검토·기사 수정 초안·등록되지 않은 자료를 가져오지 않는다', async t => {
  const p = await field(t), good = savedWork();
  const incomplete = {...good.sources[0]}; delete incomplete.version; delete incomplete.excerpt;
  const bad = ['broken{', {format:'journal-field-trial-v1'}, {...good,demo:true}, {...good,article:'',articleDraft:''},
    {...good,blindReview:{pairId:'b'.repeat(32),slot:'A'}},
    {...good,articleDraft:'수정 중'}, {...good,sources:[]}, {...good,sources:[incomplete]},
    {...good,sources:[{...good.sources[0],url:'https://mock.invalid/test.pdf'}]},
    {...good,sources:[good.sources[0],{...good.sources[1],originUrl:'https://mock.invalid/archive'}]},
    {...good,sources:[{...good.sources[0],pdfSha256:'malformed-hash'}]}];
  for (const file of bad) {
    await p.load(good); p.change('evidence-choices','0');
    await p.load(file);
    assert.ok(p.el('evidence-selection').hidden, typeof file === 'string' ? 'invalid JSON' : JSON.stringify(file));
    assert.equal(p.el('evidence-preview').textContent,'');
    p.el('evidence-apply').click(); assert.equal(p.el('documentUrl').value,'');
    assert.doesNotMatch(p.el('evidence-status').textContent,/PRIVATE-/);
  }
});

test('휴식·과제 교체 후 완료된 파일 읽기를 버리고 수동 배정에 자료 입력을 노출하지 않는다', async t => {
  const p = await field(t), saved = savedWork();
  for (const step of ['pause','next']) {
    const pending = Promise.withResolvers();
    const read = p.upload('evidence-work', {text:() => pending.promise});
    if (step === 'pause') {
      p.el('pause').click(); assert.ok(p.el('field-evidence').hidden); p.el('pause').click();
    } else {
      p.el('withdraw').click(); assert.ok(p.el('field-evidence').hidden); p.el('next').click(); p.start(1);
    }
    pending.resolve(JSON.stringify(saved)); await read;
    assert.ok(p.el('evidence-selection').hidden); assert.equal(p.el('evidence-preview').textContent,'');
    assert.equal(p.el('documentUrl').value,''); assert.equal(p.el('evidence-status').textContent,'');
  }
  const manual = await field(t,'manual'); assert.ok(manual.el('field-evidence').hidden);
  await manual.load(saved); manual.type('evidence-paste','Journal 근거 위치\nhttps://agency.example/report.pdf\n표 2');
  manual.el('evidence-apply').click(); assert.equal(manual.el('documentUrl').value,'');
  assert.ok(manual.el('evidence-selection').hidden);
});
