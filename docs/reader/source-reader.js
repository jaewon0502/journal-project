// Open the physical viewer page recorded for one source excerpt. Local file
// handles exist only for this tab and are never written to a workspace or TXT.
(function (root) {
  'use strict';
  const engine = root.JournalFactcheck;
  const files = new Map();
  const pending = new Map();

  function fileKey(source, target) {
    if (source.pdfSha256) return 'sha256:' + source.pdfSha256;
    const doc = new URL(source.url);
    if (target.page) doc.hash = '';
    return JSON.stringify([doc.href, source.version]);
  }
  function anchor(href, label) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    return a;
  }
  function updateLocal(slot) {
    const local = files.get(slot.dataset.pdfKey);
    slot.replaceChildren();
    if (local) {
      const page = slot.dataset.pdfPage;
      const a = anchor(local.href + '#page=' + page, '연결한 PDF ' + page + '쪽 ↗');
      a.title = local.name;
      slot.append(a, document.createTextNode(' · ' + local.name));
    }
  }
  function link(source) {
    const target = engine.sourceTarget(source);
    if (!target) return null;
    const a = anchor(target.href, target.page ? '원문 PDF · ' + target.page + '쪽 ↗' : '원자료 열기 ↗');
    const page = target.page || target.localPage;
    if (!page) return a;
    const wrap = document.createElement('span');
    wrap.className = 'source-page-links';
    const slot = document.createElement('span');
    slot.dataset.pdfKey = fileKey(source, target);
    slot.dataset.pdfPage = page;
    updateLocal(slot);
    wrap.append(a);
    if (target.localPage) wrap.append(document.createTextNode('파일에서 ' + page + '쪽 확인'));
    wrap.append(slot);
    return wrap;
  }

  async function verifyFile(file, expectedHash) {
    const bytes = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('선택한 파일을 읽지 못했습니다.'));
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(expectedHash ? file : file.slice(0, 5));
    });
    if (String.fromCharCode(...new Uint8Array(bytes).subarray(0, 5)) !== '%PDF-') throw new Error('PDF 형식의 파일을 선택하세요.');
    if (!expectedHash) return;
    if (!root.crypto?.subtle) throw new Error('이 브라우저에서는 PDF 판본을 대조할 수 없습니다.');
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expectedHash) throw new Error('등록한 PDF와 판본이 다릅니다. 발췌 당시 확인한 PDF를 선택하세요.');
  }
  function attach(key, file) {
    const href = URL.createObjectURL(file.slice(0, file.size, 'application/pdf'));
    const previous = files.get(key);
    if (previous) URL.revokeObjectURL(previous.href);
    files.set(key, {href, name:file.name});
    for (const slot of document.querySelectorAll('[data-pdf-key]')) {
      if (slot.dataset.pdfKey === key) updateLocal(slot);
    }
  }
  // The finder has already matched these bytes to the search document at adoption.
  function rememberVerifiedPdf(hash, file) {
    const key = 'sha256:' + hash;
    pending.delete(key);
    if (!files.has(key)) attach(key, file);
  }
  function localControl(source) {
    const target = engine.sourceTarget(source);
    if (!target || !(target.page || target.localPage)) return null;
    const key = fileKey(source, target);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '원문이 다운로드되면';
    const label = document.createElement('label');
    label.textContent = source.pdfSha256 ? '발췌 때 확인한 원본 PDF 선택' : '위 주소에서 내려받은 같은 판본의 PDF 선택';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.className = 'hint';
    status.textContent = '파일을 선택하면 이 탭에서 해당 쪽을 다시 열 수 있습니다.';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const request = {};
      pending.set(key, request);
      try {
        await verifyFile(file, source.pdfSha256);
        if (pending.get(key) !== request) return;
        if (!source.pdfSha256 || !files.has(key)) attach(key, file);
        status.textContent = '이 판본을 인용한 문장 옆에 PDF 쪽 링크를 표시했습니다.';
      } catch (err) {
        if (pending.get(key) === request) status.textContent = err.message;
      } finally {
        if (pending.get(key) === request) pending.delete(key);
        input.value = '';
      }
    });
    label.append(input);
    details.append(summary, label, status);
    return details;
  }
  function clearLocal() {
    pending.clear();
    for (const value of files.values()) URL.revokeObjectURL(value.href);
    files.clear();
    for (const slot of document.querySelectorAll('[data-pdf-key]')) slot.replaceChildren();
  }
  root.JournalSourceReader = Object.freeze({link, localControl, clearLocal, rememberVerifiedPdf});
})(globalThis);
