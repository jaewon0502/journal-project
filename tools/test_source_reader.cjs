const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash, webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');

function source(url, page = '7') {
  return {id:'report', title:'예산서', version:'확정본', locator:'세출표', excerpt:'세출은 10억 원이다.', url, pdfPage:page};
}
function snapshot(s) {
  const article = '세출은 10억 원이다.';
  return workspace.read({format:workspace.schema, article, articleDraft:article, demo:false, sources:[s], receipts:[], rowDrafts:[],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(key => [key,'']))}});
}

test('문서를 지정하는 주소 조각은 페이지 이동, 재사용, 독립 입력 비교에서 보존한다', () => {
  for (const relative of ['viewer#/documents/', 'viewer.html#/documents/', 'reader#!document/', 'viewer#file=', 'editions.pdf#docId=']) {
    const a = source('https://agency.example/' + relative + '42');
    const b = source('https://agency.example/' + relative + '43');
    assert.deepEqual(engine.sourceTarget(a), {href:a.url, page:null, localPage:'7'});
    assert.equal(workspace.sourceDefaults(a).url, a.url);
    assert.notEqual(snapshot(a).sourceKey, snapshot(b).sourceKey);
    assert.notEqual(snapshot(a).sourceKey, snapshot({...a, pdfPage:'8'}).sourceKey);
    assert.equal(snapshot(a).sourceKey, snapshot({...a, id:'again'}).sourceKey);
  }
  const download = source('https://agency.example/download.do?file=42#page=2&zoom=100');
  assert.equal(engine.sourceTarget(download).href, 'https://agency.example/download.do?file=42#page=7&zoom=100');
  assert.equal(workspace.sourceDefaults(download).url, 'https://agency.example/download.do?file=42');
});

test('선택한 로컬 PDF를 같은 뷰어의 다른 문서나 다른 판본에 연결하지 않는다', async t => {
  const dom = new JSDOM('<!doctype html><body></body>', {url:'https://journal.example/',runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  w.JournalFactcheck = engine;
  w.eval(fs.readFileSync(path.join(__dirname,'../docs/reader/source-reader.js'),'utf8'));
  w.URL.createObjectURL = () => 'blob:local-pdf';
  const first = source('https://agency.example/viewer#/documents/42');
  const entries = [first, {...first,pdfPage:'9'}, {...first,version:'초안'}, source('https://agency.example/viewer#/documents/43')];
  const links = entries.map(entry => w.JournalSourceReader.link(entry));
  const control = w.JournalSourceReader.localControl(first);
  doc.body.append(...links, control);
  const input = control.querySelector('input'), status = control.querySelector('[role=status]');
  const done = new Promise(resolve => {
    const observer = new w.MutationObserver(() => { observer.disconnect(); resolve(); });
    observer.observe(status,{childList:true});
  });
  Object.defineProperty(input,'files',{value:[new w.File(['%PDF-1.7'], 'report-42.pdf')]});
  input.dispatchEvent(new w.Event('change'));
  await done;
  assert.equal(links[0].querySelector('a').href, first.url);
  assert.match(links[0].textContent, /7쪽/);
  assert.deepEqual(links.map(link => link.querySelector('[data-pdf-key] a')?.href || null),
    ['blob:local-pdf#page=7','blob:local-pdf#page=9',null,null]);
});

test('기록한 PDF 판본과 쪽이 판단·독립 평가·편집 초안의 자료 식별에 반영되고 구형 자료의 키는 유지된다', () => {
  const old = source('https://agency.example/report.pdf'), hash = 'a'.repeat(64);
  const bound = {...old, pdfSha256:hash}, newer = {...old, pdfSha256:'b'.repeat(64)};
  assert.equal(engine.prepare(old.excerpt, [old]).rows[0].binding, '8e37f7f5057442e24c84937a6625b9e1b219fdc3b6b5ff23eb396e5ddadcea4c');
  assert.equal(workspace.sourceIdentity(old), JSON.stringify([old.url, '', old.version, old.locator, old.excerpt, '7']));
  assert.notEqual(snapshot(bound).sourceKey, snapshot(newer).sourceKey);
  assert.notEqual(snapshot(bound).sourceKey, snapshot(old).sourceKey);
  for (const fields of [{pdfPage:undefined}, {pdfPage:'0'}, {pdfSha256:'A'.repeat(64)}, {pdfSha256:null}, {pdfSha256:''}])
    assert.throws(() => engine.prepare(old.excerpt, [{...bound, ...fields}]), /PDF/);
  const row = engine.prepare(old.excerpt, [bound]).rows[0];
  const receipt = engine.decide(row, {status:'fact', reason:'세출표의 원문을 대조했다.', sourceIds:[bound.id], acknowledged:true}, [bound]);
  assert.equal(engine.prepare(old.excerpt, [bound], [receipt]).confirmedCount, 1);
  assert.equal(engine.prepare(old.excerpt, [newer], [receipt]).confirmedCount, 0);
  assert.equal(engine.prepare(old.excerpt, [old], [receipt]).confirmedCount, 0);
  const mirrored = {...bound,id:'copy',url:'https://mirror.example/report.pdf'};
  assert.ok(engine.sameSourceDocument([bound, mirrored], bound, mirrored));
  const fields = Object.fromEntries(workspace.sourceFields.map(key => [key, bound[key] || '']));
  const work = {format:workspace.schema, article:old.excerpt, articleDraft:old.excerpt, demo:false, sources:[bound], receipts:[receipt], rowDrafts:[],
    sourceDraft:{id:bound.id, fields, pdfSha256:hash}};
  assert.equal(workspace.read(work).sourceDraftPending, false);
  const independent = workspace.independentInput(work);
  assert.equal(independent.sources[0].pdfSha256, hash); assert.equal(independent.sourceDraft.pdfSha256, undefined);
  assert.equal(workspace.read({...work, sourceDraft:{id:bound.id, fields}}).sourceDraftPending, true);
  assert.throws(() => workspace.read({...work, sourceDraft:{pdfSha256:hash, fields:{...fields, pdfPage:''}}}), /PDF/);
});

test('후보에서 확인해 넘긴 원본은 같은 해시의 쪽에만 재사용하고 작업 재개 시 잘못된 파일과 늦은 업로드를 거부한다', async t => {
  const dom = new JSDOM('<!doctype html><body></body>', {url:'https://journal.example/',runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document, issued = [], revoked = [];
  w.JournalFactcheck = engine;
  w.URL.createObjectURL = blob => { issued.push(blob); return 'blob:local-' + issued.length; };
  w.URL.revokeObjectURL = url => revoked.push(url);
  let deferred;
  Object.defineProperty(w.crypto, 'subtle', {value:{digest: async (algorithm, bytes) => {
    const result = await webcrypto.subtle.digest(algorithm, new Uint8Array(bytes));
    if (deferred) {
      deferred.started.resolve(); await deferred.release.promise;
      setImmediate(deferred.done.resolve);
    }
    return result;
  }}});
  w.eval(fs.readFileSync(path.join(__dirname,'../docs/reader/source-reader.js'),'utf8'));
  const reader = w.JournalSourceReader;
  const bytes = '%PDF-1.7\noriginal PDF bytes';
  const file = new w.File([bytes], '원본.pdf');
  const other = new w.File(['%PDF-1.7\nother PDF bytes'], '원본.pdf');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const old = source('https://agency.example/report.pdf'), bound = {...old, pdfSha256:hash};
  const links = [bound,{...bound,url:'https://mirror.example/file.pdf',pdfPage:'28'},{...bound,pdfSha256:'0'.repeat(64)},old].map(reader.link);
  const control = reader.localControl(bound);
  doc.body.append(...links, control);
  const local = link => link.querySelector('[data-pdf-key] a')?.getAttribute('href') || null;
  reader.rememberVerifiedPdf(hash,file); reader.rememberVerifiedPdf(hash,file);
  assert.deepEqual(links.map(local), ['blob:local-1#page=7','blob:local-1#page=28',null,null]);
  assert.equal(local(reader.link(bound)), 'blob:local-1#page=7'); assert.equal(issued.length, 1);
  function select(file) {
    const input = control.querySelector('input');
    Object.defineProperty(input, 'files', {value:[file],configurable:true});
    input.dispatchEvent(new w.Event('change'));
  }
  const status = control.querySelector('[role=status]');
  reader.clearLocal();
  assert.deepEqual(links.map(local), [null,null,null,null]);
  assert.equal(links[0].querySelector('a').href, old.url+'#page=7');
  select(other); await t.waitFor(() => assert.match(status.textContent,/판본이 다릅니다/));
  assert.equal(local(links[0]), null); assert.equal(issued.length,1);
  select(file); await t.waitFor(() => assert.equal(local(links[0]),'blob:local-2#page=7'));
  select(other); await t.waitFor(() => assert.match(status.textContent,/판본이 다릅니다/));
  assert.equal(local(links[1]), 'blob:local-2#page=28');
  deferred = {started:Promise.withResolvers(), release:Promise.withResolvers(), done:Promise.withResolvers()};
  select(file); await deferred.started.promise; reader.clearLocal(); deferred.release.resolve(); await deferred.done.promise;
  assert.deepEqual(links.map(local), [null,null,null,null]);
  assert.equal(issued.length,2); assert.deepEqual(revoked,['blob:local-1','blob:local-2']);
});
