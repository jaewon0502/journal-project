'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash, webcrypto} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');

const readerDir = path.join(__dirname, '../docs/reader');
const pdfBytes = Buffer.from('%PDF-1.7\n% local file identity test\n%%EOF');
const heading = '  2021년 연간 고용동향(요약)';
const quote = ' ○ 청년층(15~29세) 실업률은 7.1%로 전년과 동일';
const query = '2021년 연간 청년층(15~29세) 실업률이 0.3%p 올랐다는 주장은 맞나?';
const pages = [' 2021년 9월 고용동향(요약)\n ○ 청년층(15~29세) 실업률은 7.1%로 전년동월대비 0.3%p 상승', '', '\n  ',
  [heading, ' □ 실업률은 3.1%로 전년대비 0.2%p 하락', quote].join('\n')];
const searchFile = JSON.stringify({format:'journal-pdf-text-v1', pdfName:'고용동향.pdf',
  pdfSha256:createHash('sha256').update(pdfBytes).digest('hex'), pages});

function editor(t, digest = (name, data) => webcrypto.subtle.digest(name, new Uint8Array(data))) {
  const errors = [], revoked = [], created = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', err => errors.push(err.message));
  const dom = new JSDOM(readFileSync(path.join(readerDir, 'factcheck.html'), 'utf8'), {
    runScripts:'outside-only', url:'https://journal.example/factcheck.html', virtualConsole
  });
  const w = dom.window, doc = w.document;
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  w.confirm = () => true;
  Object.defineProperty(w.crypto, 'subtle', {value:{digest}});
  w.URL.createObjectURL = blob => { created.push(blob); return 'blob:local-' + created.length; };
  w.URL.revokeObjectURL = url => revoked.push(url);
  for (const script of doc.querySelectorAll('script[src]')) {
    w.eval(readFileSync(path.join(readerDir, script.getAttribute('src')), 'utf8'));
  }
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  const el = id => doc.getElementById(id);
  function type(id, value) {
    el(id).value = value;
    el(id).dispatchEvent(new w.Event('input', {bubbles:true}));
  }
  function choose(id, name, contents) {
    const input = el(id);
    Object.defineProperty(input, 'files', {value:[new w.File([contents], name)], configurable:true});
    input.dispatchEvent(new w.Event('change', {bubbles:true}));
  }
  // A no-op or cancellation can leave the public status unchanged. Wait for
  // the source file read and its completion handler without a fixed sleep.
  async function selectSource(name, contents) {
    const read = Promise.withResolvers(), NativeReader = w.FileReader;
    w.FileReader = class extends NativeReader {
      readAsArrayBuffer(...args) {
        this.addEventListener('loadend', () => setImmediate(read.resolve), {once:true});
        return super.readAsArrayBuffer(...args);
      }
    };
    try {
      choose('document-file', name, contents);
      await read.promise;
    } finally { w.FileReader = NativeReader; }
  }
  async function upload(id, name, contents, expected) {
    if (id === 'document-file') {
      await selectSource(name, contents);
      await t.waitFor(() => assert.match(el('document-file-status').textContent, expected));
      return;
    }
    choose(id, name, contents);
    await t.waitFor(() => assert.match(el('document-file-status').textContent, expected));
  }
  function find(value = query) {
    type('document-query', value); el('find-passages').click();
    return el('finder-results');
  }
  type('article', query); el('article-form').requestSubmit(); el('go-find').click();
  return {w, el, type, choose, selectSource, upload, find, created, revoked};
}

test('UTF-8 TXT에서 문단을 찾되 일반 텍스트의 쪽 표지를 PDF 연결로 바꾸지 않는다', async t => {
  const p = editor(t);
  const text = ' 표 1   월간 조사\n\n\f\n  2024년 7월 참가자는 92명이다.  ';
  await p.upload('document-file', '조사.txt', Buffer.from(text, 'utf8'), /조사\.txt 본문을 불러왔습니다/);
  assert.equal(p.el('document-text').value, text);
  assert.ok(p.el('document-pdf-panel').hidden);
  const area = p.find('2024년 7월 참가자는 92명이다.');
  assert.match(area.textContent, /92명/);
  assert.equal(area.querySelector('[data-source-physical-page]'), null);
  for (const [name, contents, pattern] of [['빈.txt', ' \n\t', /본문이 있는 UTF-8/], ['다른.json', '{"format":"other"}', /PDF 검색 파일 형식/],
    ['원본.pdf', pdfBytes, /TXT 또는 PDF에서 만든 검색 파일/]]) {
    await p.upload('document-file', name, contents, pattern);
    assert.equal(p.el('document-text').value, text);
    assert.match(area.textContent, /92명/);
  }
  const quoted = '원문에 인쇄된 문자 �를 보존한다.';
  await p.upload('document-file', '인용.txt', Buffer.from(quoted), /인용\.txt 본문을 불러왔습니다/);
  assert.equal(p.el('document-text').value, quoted);
  await p.upload('document-file', 'UTF16.txt', Buffer.from('\uFEFF정상 문자열', 'utf16le'), /UTF-8로 저장/);
  assert.equal(p.el('document-text').value, quoted);
  await p.upload('document-file', '손상.txt', Uint8Array.from([0xff, 0xfe, 0xfd]), /UTF-8로 저장/);
  assert.equal(p.el('document-text').value, quoted);
});

test('빈 PDF 쪽을 세고 올바른 판본을 연결한 뒤 기존 후보에서 해당 쪽을 열고 기간과 행을 함께 발췌한다', async t => {
  const p = editor(t);
  await p.upload('document-file', '고용.journal-source.json', searchFile, /고용동향\.pdf · PDF 4쪽/);
  assert.equal(p.el('document-pdf-panel').hidden, false);
  assert.equal(p.el('document-text').value, pages.join('\n\f\n'));
  const area = p.find(), card = area.querySelector('.source'), slot = card.querySelector('[data-source-physical-page]');
  assert.equal(slot.dataset.sourcePhysicalPage, '4');
  assert.equal(slot.querySelector('a'), null);
  const local = 'blob:local-1#page=4';
  await p.upload('document-pdf', '다른이름.pdf', pdfBytes, /다른이름\.pdf 연결 완료/);
  assert.equal(slot.querySelector('a').href, local);
  assert.equal(p.created[0].type, 'application/pdf');
  await p.upload('document-pdf', '고용동향.pdf', Buffer.from('%PDF-1.7\n다른 판본'), /판본이 다릅니다/);
  assert.equal(slot.querySelector('a').href, local);
  await p.upload('document-pdf', '고용동향.pdf', '본문만 있는 파일', /원본 PDF 파일을 선택/);
  assert.equal(slot.querySelector('a').href, local);
  assert.deepEqual(p.revoked, []);
  const use = [...card.querySelectorAll('button')].find(button => button.textContent === '기간 표지와 구절을 함께 발췌');
  assert.ok(use); use.click();
  assert.equal(p.el('source-excerpt').value, [heading, '[…]', quote].join('\n'));
  assert.equal(p.el('source-pdfPage').value, '');
  assert.match(p.el('source-count').textContent, /0개/);
  assert.equal(p.el('verdict').value, '');

  const confirmation = Promise.withResolvers();
  p.w.confirm = question => { confirmation.resolve(question); return false; };
  p.choose('document-file', '교체.txt', '새 문서 내용');
  assert.match(await confirmation.promise, /바꿀까요/);
  assert.equal(p.el('document-text').value, pages.join('\n\f\n'));
  assert.equal(slot.querySelector('a').href, local);
  assert.deepEqual(p.revoked, []);
  p.type('document-text', quote);
  assert.ok(p.el('document-pdf-panel').hidden);
  assert.equal(area.querySelector('a'), null); assert.deepEqual(p.revoked, ['blob:local-1']);
  assert.equal(p.find(quote).querySelector('[data-source-physical-page]'), null);
});

test('작업을 교체하면 이전 PDF를 해제하고 진행 중이던 판본 대조가 새 작업에 링크를 만들지 않는다', async t => {
  const started = Promise.withResolvers(), release = Promise.withResolvers(), finished = Promise.withResolvers();
  let pause = false;
  const p = editor(t, async (name, bytes) => {
    const hash = await webcrypto.subtle.digest(name, new Uint8Array(bytes));
    if (pause) {
      started.resolve(); await release.promise;
      setImmediate(() => finished.resolve());
    }
    return hash;
  });
  await p.upload('document-file', '검색.json', searchFile, /PDF 4쪽을 불러왔습니다/);
  await p.upload('document-pdf', '첫번째.pdf', pdfBytes, /첫번째\.pdf 연결 완료/);
  assert.equal(p.find().querySelector('[data-source-physical-page] a').href, 'blob:local-1#page=4');
  pause = true;
  p.choose('document-pdf', '느린.pdf', pdfBytes);
  await started.promise;
  p.el('load-demo').click();
  release.resolve(); await finished.promise;
  assert.equal(p.el('document-text').value, '');
  assert.equal(p.el('document-file-status').textContent, '');
  assert.ok(p.el('document-pdf-panel').hidden);
  assert.equal(p.el('finder-results').querySelector('[data-source-physical-page]'), null);
  assert.deepEqual(p.revoked, ['blob:local-1']);
  assert.equal(p.created.length, 1);
});

test('같은 검색 파일을 다시 골라도 기존 카드와 PDF 링크를 유지하고 같은 본문의 다른 PDF 판본은 교체 전에 묻는다', async t => {
  const p = editor(t);
  await p.upload('document-file', '검색.json', searchFile, /PDF 4쪽/);
  await p.upload('document-pdf', '원본.pdf', pdfBytes, /연결 완료/);
  const card = p.find().querySelector('.source');
  const link = card.querySelector('[data-source-physical-page] a');
  assert.equal(link.href, 'blob:local-1#page=4');
  const prompts = [];
  p.w.confirm = prompt => { prompts.push(prompt); return false; };
  await p.selectSource('검색.json', searchFile);
  assert.deepEqual(prompts, []); assert.equal(card.isConnected, true); assert.ok(link.isConnected);
  assert.deepEqual(p.revoked, []);
  const revised = JSON.stringify({...JSON.parse(searchFile), pdfSha256:createHash('sha256').update('다른 PDF 판본').digest('hex')});
  await p.selectSource('검색.json', revised);
  assert.equal(prompts.length, 1); assert.ok(link.isConnected); assert.deepEqual(p.revoked, []);
  p.w.confirm = () => true;
  await p.selectSource('검색.json', revised);
  assert.equal(p.el('document-text').value, pages.join('\n\f\n'));
  assert.deepEqual(p.revoked, ['blob:local-1']);
  assert.equal(p.find().querySelector('[data-source-physical-page] a'), null);
  await p.upload('document-pdf', '원본.pdf', pdfBytes, /판본이 다릅니다/);
});

test('본문에 NUL만 있거나 페이지가 모두 비면 현재 검색 본문과 연결한 PDF를 유지한다', async t => {
  const p = editor(t);
  await p.upload('document-file', '검색.json', searchFile, /PDF 4쪽/);
  await p.upload('document-pdf', '자료.pdf', pdfBytes, /연결 완료/);
  const slot = p.find().querySelector('[data-source-physical-page]');
  for (const [invalid, reason] of [[['\u0000'], /PDF 검색 파일 형식/], [['', '  '], /읽을 수 있는 본문이 없습니다/]]) {
    const contents = JSON.stringify({...JSON.parse(searchFile), pages:invalid});
    await p.upload('document-file', '불량.json', contents, reason);
    assert.equal(p.el('document-text').value, pages.join('\n\f\n'));
    assert.equal(slot.querySelector('a').href, 'blob:local-1#page=4');
    assert.deepEqual(p.revoked, []);
  }
});

async function downloadText(p, button) {
  const stopDownload = event => { if (event.target.closest('a[download]')) event.preventDefault(); };
  p.w.document.addEventListener('click', stopDownload);
  try {
    p.el(button).click();
    return await new Promise((resolve, reject) => {
      const r = new p.w.FileReader();
      r.onerror = reject;
      r.onload = () => resolve(r.result);
      r.readAsText(p.created.at(-1));
    });
  } finally { p.w.document.removeEventListener('click', stopDownload); }
}

async function savedWork(p) {
  return JSON.parse(await downloadText(p, 'save-work'));
}

test('발췌한 PDF 쪽을 주소와 대조해 적용하면 작업 파일과 독립 평가에 판본이 남는다', async t => {
  const p = editor(t), checksum = JSON.parse(searchFile).pdfSha256;
  await p.upload('document-file','검색.json',searchFile,/PDF 4쪽/);
  const useExcerpt = () => [...p.find().querySelectorAll('button')].find(b => b.textContent === '기간 표지와 구절을 함께 발췌').click();
  useExcerpt();
  assert.ok(p.el('source-pdf-proposal').hidden);
  await p.upload('document-pdf','편집자용.pdf',pdfBytes,/연결 완료/);
  useExcerpt();
  assert.equal(p.el('source-pdf-proposal').hidden,false);
  assert.match(p.el('source-pdf-proposal-text').textContent,/PDF 4쪽/);
  p.el('use-pdf-location').click();
  assert.equal(p.el('source-pdfPage').value,'');
  p.type('source-title','연간 고용 요약'); p.type('source-version','2021년 공표본');
  p.type('source-url','https://agency.example/report.pdf#page=1&zoom=100');
  p.el('use-pdf-location').click();
  assert.equal(p.el('source-url').value,'https://agency.example/report.pdf#page=4&zoom=100');
  assert.equal(p.el('source-locator').value,'PDF 4쪽');
  assert.equal(p.el('source-pdfPage').value,'4');
  const draft = await savedWork(p);
  assert.equal(draft.sourceDraft.pdfSha256,checksum); assert.deepEqual(draft.sources,[]);
  const current = p.w.JournalWorkspaceSnapshot;
  p.type('source-locator','연간 고용 요약 · PDF 뷰어 1~2쪽');
  p.el('source-save-link').click();
  assert.match(p.el('source-status').textContent,/PDF 쪽이 다릅니다/);
  assert.deepEqual((await savedWork(p)).sources,[]);
  p.type('source-locator','인쇄 1쪽 · PDF 4쪽 · 청년층 실업률');
  p.el('source-save-link').click();
  const completed = await savedWork(p);
  assert.equal(completed.sources[0].pdfSha256,checksum);
  assert.equal(completed.sources[0].pdfPage,'4');
  assert.equal(completed.receipts.length,0);
  assert.equal(completed.sourceDraft.pdfSha256,undefined);
  assert.equal(current.independentInput(completed).sources[0].pdfSha256,checksum);
  assert.ok(!JSON.stringify(completed).includes('편집자용.pdf'));
  assert.ok(!JSON.stringify(completed).includes('blob:local'));
  assert.match(p.el('source-list').querySelector('[data-pdf-key] a').href,/^blob:local-\d+#page=4$/);
  p.type('verdict','fact'); p.type('reason','문장과 해당 연간 요약을 대조했다.');
  p.el('acknowledged').click(); p.el('decision-form').requestSubmit();
  const report = await downloadText(p,'export-report');
  assert.ok(report.includes('PDF SHA-256 · ' + checksum));
  assert.ok(report.includes('https://agency.example/report.pdf#page=4&zoom=100'));
  assert.ok(!report.includes('편집자용.pdf') && !report.includes('blob:local'));
});

test('확인 쪽 적용 뒤 주소나 발췌를 변경하면 예전 파일 지문으로 새 근거를 등록하지 않는다', async t => {
  const p = editor(t);
  await p.upload('document-file','검색.json',searchFile,/PDF 4쪽/);
  await p.upload('document-pdf','공표.pdf',pdfBytes,/연결 완료/);
  const doc = p.w.JournalDocumentFile;
  assert.equal(doc.excerptLocation({startParagraph:1,paragraph:3}).first,1);
  assert.equal(doc.excerptLocation({startParagraph:1,paragraph:3}).last,4);
  p.type('source-url','https://agency.example/viewer#/documents/3');
  [...p.find().querySelectorAll('button')].find(b => b.textContent === '기간 표지와 구절을 함께 발췌').click();
  p.el('use-pdf-location').click();
  assert.equal(p.el('source-url').value,'https://agency.example/viewer#/documents/3');
  p.type('source-url','https://agency.example/viewer#/documents/4');
  assert.equal(p.el('source-pdfPage').value,''); assert.equal(p.el('source-locator').value,'');
  assert.equal((await savedWork(p)).sourceDraft.pdfSha256,undefined);
  p.el('use-pdf-location').click();
  p.type('source-locator','요약의 청년 행');
  p.type('source-excerpt','편집자가 새로 옮긴 구절');
  assert.equal(p.el('source-locator').value,'요약의 청년 행');
  assert.equal(p.el('source-location-review').hidden,false);
  assert.equal(p.el('source-location-checked').checked,false);
  assert.equal(p.el('source-pdf-proposal').hidden,true);
  assert.equal((await savedWork(p)).sourceDraft.pdfSha256,undefined);
});
