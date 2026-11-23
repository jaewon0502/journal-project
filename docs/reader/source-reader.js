// Open the physical viewer page recorded for one source excerpt. Local file
// handles exist only for this tab and are never written to a workspace or TXT.
(function (root) {
  'use strict';
  const engine = root.JournalFactcheck;
  const files = new Map();
  const pending = new Map();

  function fileKey(source) {
    const doc = new URL(source.url);
    doc.hash = '';
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
    if (!target.page) return a;
    const wrap = document.createElement('span');
    wrap.className = 'source-page-links';
    const slot = document.createElement('span');
    slot.dataset.pdfKey = fileKey(source);
    slot.dataset.pdfPage = target.page;
    updateLocal(slot);
    wrap.append(a, slot);
    return wrap;
  }

  function signature(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('선택한 파일을 읽지 못했습니다.'));
      reader.onload = () => resolve(String.fromCharCode(...new Uint8Array(reader.result)) === '%PDF-');
      reader.readAsArrayBuffer(file.slice(0, 5));
    });
  }
  function localControl(source) {
    const target = engine.sourceTarget(source);
    if (!target?.page) return null;
    const key = fileKey(source);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '원문이 다운로드되면';
    const label = document.createElement('label');
    label.textContent = '위 주소에서 내려받은 같은 판본의 PDF 선택';
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
        if (!await signature(file)) throw new Error('PDF 형식의 파일을 선택하세요.');
        if (pending.get(key) !== request) return;
        const href = URL.createObjectURL(file.slice(0, file.size, 'application/pdf'));
        const previous = files.get(key);
        if (previous) URL.revokeObjectURL(previous.href);
        files.set(key, {href, name:file.name});
        for (const slot of document.querySelectorAll('[data-pdf-key]')) {
          if (slot.dataset.pdfKey === key) updateLocal(slot);
        }
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
  }
  root.JournalSourceReader = Object.freeze({link, localControl, clearLocal});
})(globalThis);
