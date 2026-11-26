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
  assert.ok(report.includes('https://agency.example/report.pdf#page=4&zoom=100\nPDF 파일 4쪽 · 원문이 내려받아지면 파일을 열어 이 쪽을 확인하세요.'));
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

const commonFields = ['title', 'url', 'version', 'originUrl'];

function pdfEdition(key, lines) {
  const bytes = Buffer.from('%PDF-1.7\n' + key + '\n%%EOF');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const json = JSON.stringify({format:'journal-pdf-text-v1', pdfName:'원자료.pdf', pdfSha256:hash, pages:lines});
  return {bytes, hash, json, lines};
}

const editionA = pdfEdition('A', ['수목원 관찰 일지에는 느티나무가 등장한다.', '온실 관리 기록에는 동백나무가 등장한다.']);
const editionB = pdfEdition('B', ['마을 축제에 풍물패가 참여했다.']);
const infoA = {title:'수목원 기록', url:'https://agency.example/trees.pdf', version:'현장 조사판', originUrl:'https://archive.example/trees'};
const infoB = {title:'축제 기록', url:'https://agency.example/music.pdf', version:'결산판', originUrl:'https://archive.example/music'};

async function openEdition(p, edition) {
  await p.upload('document-file', '원자료.json', edition.json, /쪽을 불러왔습니다/);
  await p.upload('document-pdf', '원자료.pdf', edition.bytes, /연결 완료/);
}

function choosePassage(p, text) {
  const cards = [...p.find(text).querySelectorAll('.source')];
  const card = cards.find(item => item.querySelector('blockquote')?.textContent.trim() === text);
  assert.ok(card, text);
  const button = [...card.querySelectorAll('button')].find(b => b.textContent === '이 문단을 발췌문으로 사용');
  button.click();
  assert.equal(p.el('source-excerpt').value.trim(), text);
}

function commonInput(p) {
  return Object.fromEntries(commonFields.map(k => [k, p.el('source-' + k).value]));
}

function enterCommon(p, info) {
  for (const k of commonFields) p.type('source-' + k, info[k]);
}

function availableSources(p) {
  return [...p.el('pdf-source-options').querySelectorAll('button[data-source-id]')]
    .filter(button => !button.closest('[hidden]'));
}

function commitPdfPage(p) {
  p.el('use-pdf-location').click();
  p.el('source-save').click();
}

test('A와 B를 오가며 같은 PDF의 새 구절을 등록해도 이름·주소·판본과 실제 PDF 지문이 일치한다', async t => {
  const p = editor(t);
  await openEdition(p, editionA);
  choosePassage(p, editionA.lines[0]);
  enterCommon(p, infoA);
  commitPdfPage(p);
  choosePassage(p, editionA.lines[1]);
  assert.deepEqual(commonInput(p), infoA);
  assert.equal(p.el('source-pdfPage').value, '');
  commitPdfPage(p);
  await openEdition(p, editionB);
  choosePassage(p, editionB.lines[0]);
  assert.deepEqual(Object.values(commonInput(p)), ['', '', '', '']);
  enterCommon(p, infoB);
  commitPdfPage(p);
  await openEdition(p, editionA);
  p.el('go-find').click();
  choosePassage(p, editionA.lines[1]);
  assert.deepEqual(Object.values(commonInput(p)), ['', '', '', '']);
  p.type('source-locator', '온실 관리 기록 두 번째 구절');
  const choices = availableSources(p);
  assert.equal(choices.length, 1);
  choices[0].click();
  assert.deepEqual(commonInput(p), infoA);
  assert.equal(p.el('source-locator').value, '온실 관리 기록 두 번째 구절');
  assert.equal(p.el('source-excerpt').value.trim(), editionA.lines[1]);
  assert.equal(p.el('source-pdfPage').value, '');
  assert.equal(p.el('source-save-link').hidden, false);
  p.el('use-pdf-location').click();
  p.el('source-save-link').click();
  const w = await savedWork(p);
  assert.deepEqual(w.sources.map(source => [source.title, source.url, source.version, source.originUrl, source.pdfPage, source.pdfSha256]),
    [[infoA, '1', editionA], [infoA, '2', editionA], [infoB, '1', editionB], [infoA, '2', editionA]]
      .map(([info, page, edition]) => [info.title, info.url, info.version, info.originUrl, page, edition.hash]));
  assert.equal(w.sources[3].excerpt.trim(), editionA.lines[1]);
  assert.equal(w.sources[3].locator, '온실 관리 기록 두 번째 구절');
  assert.equal(w.receipts.length, 0);
  assert.equal(p.el('verdict').value, '');
});

test('같은 PDF로 등록한 두 문서 정보를 명시적으로 고르고 직접 입력한 값을 취소하면 보존한다', async t => {
  const p = editor(t);
  const mirror = {...infoA, title:'기록관 보존본', url:'https://library.example/archive.pdf', version:'보존본'};
  await openEdition(p, editionA);
  choosePassage(p, editionA.lines[0]);
  enterCommon(p, infoA);
  commitPdfPage(p);
  choosePassage(p, editionA.lines[1]);
  enterCommon(p, mirror);
  commitPdfPage(p);
  await openEdition(p, editionB);
  choosePassage(p, editionB.lines[0]);
  enterCommon(p, infoB);
  commitPdfPage(p);
  await openEdition(p, editionA);
  // Preserve even a single field the editor entered while the other fields still
  // contain defaults from B. Selecting A explicitly may replace the group.
  p.type('source-version', '별도 확인 중');
  choosePassage(p, editionA.lines[1]);
  assert.equal(p.el('source-version').value, '별도 확인 중');
  const previous = commonInput(p);
  const choices = availableSources(p);
  assert.deepEqual(choices.map(b => b.dataset.sourceId).sort(), ['source-1', 'source-2']);
  let confirmations = 0;
  p.w.confirm = () => { confirmations++; return false; };
  choices.find(b => b.dataset.sourceId === 'source-2').click();
  assert.ok(confirmations > 0);
  assert.deepEqual(commonInput(p), previous);
  p.w.confirm = () => true;
  availableSources(p).find(b => b.dataset.sourceId === 'source-2').click();
  assert.deepEqual(commonInput(p), mirror);
  commitPdfPage(p);
  const w = await savedWork(p);
  assert.equal(w.sources[3].url, mirror.url);
  assert.equal(w.sources[3].pdfSha256, editionA.hash);
  assert.equal(w.sources[3].excerpt.trim(), editionA.lines[1]);
  assert.equal(w.receipts.length, 0);
});

test('동일 문서 주소·판본에 다른 PDF 지문을 등록할 때 재확인을 취소하면 기존 자료만 남는다', async t => {
  const p = editor(t);
  await openEdition(p, editionA);
  choosePassage(p, editionA.lines[0]);
  enterCommon(p, infoA);
  commitPdfPage(p);
  await openEdition(p, editionB);
  choosePassage(p, editionB.lines[0]);
  enterCommon(p, infoA);
  let confirmations = 0;
  p.w.confirm = () => { confirmations++; return false; };
  commitPdfPage(p);
  assert.ok(confirmations > 0);
  assert.deepEqual((await savedWork(p)).sources.map(s => s.pdfSha256), [editionA.hash]);
  assert.equal(p.el('source-excerpt').value.trim(), editionB.lines[0]);

  p.w.confirm = () => true;
  commitPdfPage(p);
  assert.deepEqual((await savedWork(p)).sources.map(s => s.pdfSha256), [editionA.hash, editionB.hash]);

  await p.upload('document-file', 'A.json', editionA.json, /쪽을 불러왔습니다/);
  await p.upload('document-pdf', '잘못 연결한 A.pdf', editionB.bytes, /판본이 다릅니다/);
  choosePassage(p, editionA.lines[0]);
  assert.equal(p.el('source-pdf-proposal').hidden, true);
  assert.deepEqual(availableSources(p), []);
});

test('다른 PDF로 돌아오면 직접 고친 문서 이름은 남고 직전의 자동 주소와 판본은 비워진다', async t => {
  const p = editor(t);
  await openEdition(p, editionA);
  choosePassage(p, editionA.lines[0]);
  enterCommon(p, infoA);
  commitPdfPage(p);
  await openEdition(p, editionB);
  choosePassage(p, editionB.lines[0]);
  enterCommon(p, infoB);
  commitPdfPage(p);
  p.type('source-title', '직접 적은 두 번째 인용');
  await openEdition(p, editionA);
  choosePassage(p, editionA.lines[1]);
  assert.equal(p.el('source-title').value, '직접 적은 두 번째 인용');
  assert.equal(p.el('source-url').value, '');
  assert.equal(p.el('source-version').value, '');
  assert.equal(p.el('source-originUrl').value, '');
  assert.equal(p.el('source-save').form.checkValidity(), false);
  p.w.confirm = () => false;
  availableSources(p)[0].click();
  assert.equal(p.el('source-url').value, '');
  p.w.confirm = () => true;
  availableSources(p)[0].click();
  commitPdfPage(p);
  const latest = (await savedWork(p)).sources.at(-1);
  assert.equal(latest.url, infoA.url);
  assert.equal(latest.pdfSha256, editionA.hash);
  assert.equal(latest.pdfPage, '2');
});

const webTitle = '관측 자료 복구 공지';
const webAddress = 'https://mission.example/reports/recovery';
const webPublished = '2024-06-13T19:48:23-04:00';
const webModified = '2024-06-14T09:38:09-04:00';
const webClaim = 'Four instruments returned usable observations.';
function webPage({title = webTitle, address = webAddress, published = webPublished, modified = webModified, extra = '', body = ''} = {}) {
  return '<!doctype html><html><head><title>' + title + '</title>' +
    '<link rel="canonical" href="' + address + '">' +
    (published ? '<meta property="article:published_time" content="' + published + '">' : '') +
    (modified ? '<meta property="article:modified_time" content="' + modified + '">' : '') + extra +
    '</head><body><nav>메뉴</nav><article><p>' + webClaim + '</p>' + body + '</article></body></html>';
}
function useWebExcerpt(p) {
  const candidate = p.find(webClaim).querySelector('.source');
  const apply = [...candidate.querySelectorAll('button')].find(button => button.textContent === '이 문단을 발췌문으로 사용');
  apply.click();
  return p.el('web-source-options').querySelector('button');
}

test('저장된 웹문서에서 발췌한 뒤에만 파일의 게시·수정 표지를 입력하고 판단은 미결로 둔다', async t => {
  const p = editor(t);
  await p.upload('document-file', '발표.html', webPage(), /게시 2024-06-13.*수정 2024-06-14/);
  assert.equal(p.el('document-text').value, webClaim);
  assert.equal(p.el('web-source-options').hidden, true);
  assert.equal(p.el('document-pdf-panel').hidden, true);
  const use = useWebExcerpt(p);
  assert.equal(p.el('source-version').value, '');
  assert.equal(p.el('source-excerpt').value, webClaim);
  use.click();
  assert.equal(p.el('source-title').value, webTitle);
  assert.equal(p.el('source-url').value, webAddress);
  assert.equal(p.el('source-version').value, '게시 ' + webPublished + ' · 수정 ' + webModified);
  assert.equal(p.el('source-locator').value, '');
  assert.equal(p.el('verdict').value, '');
  p.type('source-locator', '복구 공지 본문 첫 단락');
  p.el('source-save').click();
  assert.match(p.el('source-list').textContent, /게시 2024-06-13.*수정 2024-06-14/);
  assert.equal(p.el('web-source-options').hidden, true);
  assert.equal(p.el('source-count').textContent, '· 1개');
});

test('같은 본문이어도 판본이 바뀌면 옛 제안을 무효화하고 직접 적은 내용은 취소 시 보존한다', async t => {
  const p = editor(t);
  await p.upload('document-file', '첫판.htm', webPage(), /게시 2024-06-13/);
  const previous = useWebExcerpt(p);
  p.type('source-title', '직접 입력한 제목');
  p.w.confirm = () => false;
  previous.click();
  assert.equal(p.el('source-title').value, '직접 입력한 제목');
  assert.equal(p.el('source-version').value, '');
  await p.selectSource('수정.htm', webPage({published:'', modified:'2024-09-01'}));
  assert.equal(p.el('web-source-options').hidden, false);
  p.w.confirm = () => true;
  await p.upload('document-file', '수정.htm', webPage({published:'', modified:'2024-09-01'}), /게시 확인 필요.*수정 2024-09-01/);
  assert.equal(p.el('web-source-options').hidden, true);
  previous.click();
  assert.equal(p.el('source-version').value, '');
  useWebExcerpt(p).click();
  assert.equal(p.el('source-version').value, '수정 2024-09-01');
  const last = p.el('web-source-options').querySelector('button');
  p.type('document-text', webClaim + ' Changed.');
  assert.equal(p.el('web-source-options').hidden, true);
  last.click();
  assert.equal(p.w.JournalDocumentFile.webInfo, null);
});

test('발표일과 사건 날짜·다른 기사의 메타데이터를 구분하고 표·본문 구조의 한계를 표시한다', async t => {
  const p = editor(t);
  const html = webPage({published:'2024-02-30', modified:'', extra:'<meta property="og:url" content="https://different.example/other">', body:
    '<p>발사일 <time datetime="2024-02-20">2월 20일</time></p>' +
    '<blockquote>원자료 요지 <p>괄호 안 조건</p> 후속 설명</blockquote><ul><li>항목 A<ul><li>하위 항목 B</li></ul></li></ul>' +
    '<article><meta itemprop="datePublished" content="1999-12-31"><p>연관 기사</p></article>' +
    '<aside><p>광고</p></aside><p hidden>숨김</p><table><tr><td>숫자 237</td></tr></table>'});
  await p.upload('document-file', '본문.html', html, /날짜 표시.*문서 주소.*표는 제외/);
  const extracted = p.el('document-text').value;
  for (const part of ['발사일','원자료 요지','괄호 안 조건','후속 설명','항목 A','하위 항목 B']) assert.ok(extracted.includes(part));
  assert.doesNotMatch(extracted, /연관 기사|광고|숨김|237/);
  useWebExcerpt(p).click();
  assert.equal(p.el('source-url').value,'');
  assert.equal(p.el('source-version').value,'');
  const parse = p.w.JournalWebDocument.parse;
  for (const address of ['file:///a', 'https://username@example.com/p', '/relative']) {
    assert.equal(parse(webPage({address})).web.url, '');
  }
  assert.equal(parse(webPage({extra:'<meta property="article:published_time" content="2024-06-12">'})).web.published, '');
  assert.equal(parse(webPage({published:'2024-02-29'})).web.published, '2024-02-29');
  assert.throws(() => parse('<article><p>가</p></article><article><p>나</p></article>'), /단일 기사/);
});

test('같은 문서의 구조화 기사와 게시 표시만 교차 대조하고 같은 날 서로 다른 시각은 날짜까지만 제안한다', t => {
  const {w} = editor(t);
  const schema = data => '<script type="application/ld+json">' + JSON.stringify(data) + '</scr' + 'ipt>';
  const same = {'@type':'NewsArticle', mainEntityOfPage:{'@id': webAddress + '#webpage'}};
  const other = {...same, url:'https://other.example/related', datePublished:'1999-12-31'};
  const parse = (published, nodes, body = '') => w.JournalWebDocument.parse(webPage({
    published, modified:'', extra:schema({'@graph':nodes}), body})).web;
  assert.equal(parse('', [other, {...same,datePublished:'2024-10-29Z'}]).published,'2024-10-29');
  const competing = parse(webPublished,[{...same,datePublished:'2024-06-13T10:00:00-04:00',dateModified:webModified}]);
  assert.deepEqual([competing.published,competing.modified,competing.dateUncertain],['2024-06-13',webModified,true]);
  assert.equal(parse(webPublished,[{...same,datePublished:'2024-06-14T23:00:00Z'}]).published,'');
  const equivalent = parse(webPublished,[{...same,datePublished:'2024-06-13T23:48:23Z'}]);
  assert.deepEqual([equivalent.published,equivalent.dateUncertain],[webPublished,false]);
  for (const metadata of [other, {'@type':'Event',startDate:'1988-03-04',datePublished:'1990-01-01',url:webAddress},
    {'@type':'NewsArticle',datePublished:'2000-02-01'}]) assert.equal(parse('',[metadata]).published,'');
  const header = '<header><h1>자료 제목</h1><time class="post-date" datetime="2024-03-20">March 20</time></header>';
  assert.equal(parse('',[],header).published,'2024-03-20');
  for (const wrong of [header.replace('post-date','event'),header.replace('post-date','post-date updated'),
    header.replace('<h1>자료 제목</h1>','')]) assert.equal(parse('',[],wrong).published,'');
});

test('다른 기사 카드에만 본문 표지가 있어도 주 기사 날짜와 섞지 않는다', t => {
  const {w} = editor(t), parse = w.JournalWebDocument.parse;
  const head = '<title>Harbor bulletin</title>';
  const nested = '<article><div class="entry-content"><p>Related museum story.</p></div></article>';
  const first = '<article><h1>Harbor bulletin</h1><p>The port is open.</p>' + nested + '</article>';
  assert.equal(parse(head + first).text, 'Harbor bulletin\nThe port is open.');
  const sibling = '<article><h1>Another story</h1><div itemprop="articleBody"><p>Related museum story.</p></div></article>';
  assert.equal(parse(head + first + sibling).text, 'Harbor bulletin\nThe port is open.');
  assert.throws(() => parse(head + first.replace('<h1>Harbor bulletin</h1>', '') + sibling), /단일 기사/);
  assert.throws(() => parse(head + '<article>' + nested + '</article>'), /단일 기사/);
  assert.throws(() => parse(head + '<main><h1>Harbor bulletin</h1><p>The port is open.</p>' + sibling + '</main>'), /단일 기사/);
});

test('article 태그가 없는 문서는 정식 본문 표지와 같은 구역의 일치하는 제목을 요구한다', t => {
  const {w} = editor(t), parse = w.JournalWebDocument.parse;
  const title = '<title>Research bulletin</title>';
  const body = '<div><header><h1>Research bulletin</h1></header><div itemprop="articleBody"><p>First observation.</p></div></div>';
  assert.equal(parse(title + body).text,'First observation.');
  assert.throws(() => parse(title + body.replace('<h1>Research','<h1>Library')), /단일 기사/);
  assert.throws(() => parse(title + body + body), /단일 기사/);
});
