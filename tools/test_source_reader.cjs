const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
