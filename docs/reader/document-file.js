// Search files live only in the current tab. Paragraph numbers count nonblank
// lines exactly as the evidence finder does. Page numbers count every PDF page.
(function (root) {
  'use strict';
  const byId = id => document.getElementById(id);
  const body = byId('document-text');
  const sourceInput = byId('document-file');
  const pdfInput = byId('document-pdf');
  const pdfPanel = byId('document-pdf-panel');
  const status = byId('document-file-status');
  let current = null;
  let pdfUrl = '';
  let verifiedFile = null;
  let sourceRequest = 0;
  let pdfRequest = 0;

  function readBytes(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function parseSource(name, raw) {
    if (/\.txt$/iu.test(name)) {
      if (!raw.trim() || raw.includes('\u0000'))
        throw new Error('본문이 있는 UTF-8 텍스트 파일을 선택하세요.');
      return {text:raw, document:null};
    }
    if (!/\.json$/iu.test(name)) throw new Error('TXT 또는 PDF에서 만든 검색 파일(.json)을 선택하세요.');
    let file;
    try { file = JSON.parse(raw.replace(/^\uFEFF/u, '')); } catch { /* handled below */ }
    if (file?.format !== 'journal-pdf-text-v1' || typeof file.pdfName !== 'string' || !file.pdfName.trim() ||
        typeof file.pdfSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(file.pdfSha256) ||
        !Array.isArray(file.pages) || !file.pages.every(page => typeof page === 'string' && !/[\f\u0000]/u.test(page)))
      throw new Error('PDF 검색 파일 형식을 확인하세요.');
    const paragraphs = [];
    file.pages.forEach((page, index) => {
      for (const line of page.split(/\r\n|[\n\r\u2028\u2029]/u)) {
        if (line.trim()) paragraphs.push(index + 1);
      }
    });
    if (!paragraphs.length) throw new Error('검색 파일에 읽을 수 있는 본문이 없습니다.');
    return {text:file.pages.join('\n\f\n'), document:{name:file.pdfName, hash:file.pdfSha256, count:file.pages.length, paragraphs}};
  }

  function updatePage(slot) {
    const page = slot.dataset.sourcePhysicalPage;
    slot.replaceChildren();
    if (!pdfUrl) {
      slot.textContent = '후보 위치 · PDF ' + page + '쪽';
      return;
    }
    const link = document.createElement('a');
    link.href = pdfUrl + '#page=' + page;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '연결한 원본 PDF ' + page + '쪽 열기 ↗';
    slot.append(link);
  }

  function appendPageInfo(card, paragraph) {
    const page = current?.paragraphs[paragraph - 1];
    if (!page) return;
    const slot = document.createElement('p');
    slot.dataset.sourcePhysicalPage = page;
    updatePage(slot);
    card.append(slot);
  }

  function excerptLocation(entry) {
    if (!current || !verifiedFile) return null;
    const first = current.paragraphs[(entry.startParagraph ?? entry.paragraph) - 1];
    const last = current.paragraphs[entry.paragraph - 1];
    if (!first || !last || first > last) return null;
    return {first, last, hash:current.hash, file:verifiedFile};
  }

  function clear() {
    sourceRequest++;
    pdfRequest++;
    current = null;
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = '';
    verifiedFile = null;
    pdfPanel.hidden = true;
    status.textContent = '';
    for (const slot of document.querySelectorAll('[data-source-physical-page]')) slot.remove();
  }

  body.addEventListener('input', clear);
  sourceInput.addEventListener('change', async () => {
    const file = sourceInput.files[0];
    if (!file) return;
    const request = ++sourceRequest;
    sourceInput.value = '';
    try {
      const bytes = await readBytes(file);
      let raw;
      try { raw = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
      catch { throw new Error('파일을 UTF-8로 저장한 뒤 다시 선택하세요.'); }
      const source = parseSource(file.name, raw);
      if (request !== sourceRequest) return;
      // Textarea values use LF even when a TXT or a JSON page contains CRLF.
      const sameText = body.value === source.text.replace(/\r\n?/gu, '\n');
      if (sameText && current?.hash === source.document?.hash) {
        status.textContent = pdfUrl ? '같은 검색 파일입니다. 원본 PDF 연결을 유지했습니다.'
          : '이미 불러온 본문입니다. 현재 검색 결과를 유지했습니다.';
        return;
      }
      if (body.value.trim() && !confirm('검색할 원자료 본문과 판본을 선택한 파일로 바꿀까요?')) return;
      body.value = source.text;
      body.dispatchEvent(new Event('input', {bubbles:true}));
      current = source.document;
      pdfPanel.hidden = !current;
      status.textContent = current ? current.name + ' · PDF ' + current.count + '쪽을 불러왔습니다. 같은 원본 PDF를 연결하면 후보가 있는 쪽을 열 수 있습니다.'
        : file.name + ' 본문을 불러왔습니다.';
    } catch (error) {
      if (request === sourceRequest) status.textContent = error.message;
    }
  });

  pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files[0];
    if (!file || !current) return;
    const request = ++pdfRequest;
    pdfInput.value = '';
    try {
      const bytes = await readBytes(file);
      if (request !== pdfRequest) return;
      if (String.fromCharCode(...new Uint8Array(bytes).subarray(0, 5)) !== '%PDF-') throw new Error('원본 PDF 파일을 선택하세요.');
      if (!root.crypto?.subtle) throw new Error('이 브라우저에서는 PDF 판본을 대조할 수 없습니다. 원본에서 후보 쪽을 직접 여세요.');
      const digest = await root.crypto.subtle.digest('SHA-256', bytes);
      if (request !== pdfRequest) return;
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== current.hash) throw new Error('검색 파일에 기록된 PDF와 판본이 다릅니다. 검색 파일을 만들 때 사용한 PDF를 선택하세요.');
      const next = URL.createObjectURL(file.slice(0, file.size, 'application/pdf'));
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfUrl = next;
      verifiedFile = file;
      for (const slot of document.querySelectorAll('[data-source-physical-page]')) updatePage(slot);
      status.textContent = file.name + ' 연결 완료 · 검색 후보에서 해당 PDF 쪽을 열 수 있습니다.';
    } catch (error) {
      if (request === pdfRequest) status.textContent = error.message;
    }
  });
  root.JournalDocumentFile = Object.freeze({clear, appendPageInfo, excerptLocation});
})(globalThis);
