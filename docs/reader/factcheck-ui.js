(() => {
  'use strict';
  const engine = window.JournalFactcheck;
  const workspace = window.JournalWorkspaceSnapshot;
  const {schema, sourceFields, isMock} = workspace;
  const byId = id => document.getElementById(id);
  const labels = {
    partial: '일부 확인 · 나머지 보류', pending: '미검토', fact: '사실 확인', attribution: '발언 귀속 확인',
    opinion: '의견·가치판단', mixed: '사실과 평가 분리', held: '판단 보류', contradicted: '원자료와 충돌'
  };
  const coverageLimit = '기사에서 빠진 관점과 취재 대상 선정은 별도 검토가 필요합니다. 정당·인물을 바꿔도 같은 기준을 적용하고, 제목·통계의 기간과 분모·전재 기사의 최초 출처를 확인하세요.';
  const contentLabels = {unverified: '내용 미확인', opinion: '의견·전망', supported: '별도 원자료로 사실 확인', contradicted: '독립 원자료와 충돌'};
  const guidance = {
    partial: '확인한 사실 구절을 표시하고, 남은 주장을 판단하려면 어떤 자료가 필요한지 적으세요.',
    fact: '문장에 담긴 주체, 수치, 시점, 조건과 비교 기준을 모두 확인하세요.',
    attribution: '원발언에서 화자와 인용을 확인하세요. 인용 속 주장과 기자가 인용 밖에 덧붙인 사실은 각각 대조하세요. 한 구간에 미확인 사실이 남으면 ‘일부 사실만 확인’이나 ‘판단 보류’로 기록할 수 있습니다.',
    opinion: '비판과 옹호에 같은 기준을 적용합니다. 평가 속에 확인할 수 있는 사실 주장이 있으면 해당 구절을 따로 검토하세요.',
    mixed: '원자료로 확인한 사실 구절과 글쓴이의 평가 구절을 각각 기록합니다. 일부 구절 확인으로 원문 전체의 표현을 바꾸지 않습니다.',
    held: '원자료 부족, 반대 근거, 빠진 비교 기준 등 판단을 재개할 조건을 기록하세요.',
    contradicted: '원자료와 양립할 수 없는 대목을 구체적으로 적으세요. 원자료에서 찾지 못한 경우에는 보류를 선택하세요.'
  };
  const attestations = {
    partial: '해당 사실 구절을 원자료에서 직접 확인하고, 나머지 내용에 대한 판단을 보류했습니다.',
    fact: '원자료의 해당 위치를 열어 문장 전체의 사실 주장을 확인했습니다.',
    attribution: '원발언에서 발언자, 인용 내용과 문맥을 직접 확인했습니다.',
    mixed: '원자료에서 사실 구절을 직접 확인했고, 평가 구절 및 나머지 문맥을 대조했습니다.',
    opinion: '사실로 따로 확인해야 할 내용이 없는 의견임을 문맥에서 확인했습니다.',
    contradicted: '원자료의 해당 위치에서 주장과 충돌하는 근거를 직접 확인했습니다.',
    held: '보류 사유와 다시 판단할 때 필요한 근거를 기록했습니다.'
  };
  const mockArticle = [
    '해솔시의회는 돌봄버스 예산안에 찬성 7표, 반대 4표를 기록했다.',
    '들길당 대변인은 “운영비가 두 배가 될 것”이라고 주장했다.',
    '이 사업은 무책임한 선심성 정책이다.',
    '시의회가 3억 원을 의결한 것은 무책임한 결정이다.',
    '돌봄버스 도입으로 대기 시간이 전국에서 가장 짧아졌다.'
  ].join('\n');
  const mockSources = [
    {id: 'vote', title: '해솔시의회 본회의 의결록 (모의 자료)', url: 'https://example.invalid/journal/vote', version: '연습 판본 1', locator: '제3호 안건 의결 결과', excerpt: '돌봄버스 시범사업 예산안 3억 원. 표결 결과는 찬성 7표, 반대 4표로 가결되었다.'},
    {id: 'briefing', title: '들길당 브리핑 속기록 (모의 자료)', url: 'https://example.invalid/journal/briefing', version: '연습 판본 1', locator: '대변인 발언 02분 10초', excerpt: '들길당 대변인: 운영비가 두 배가 될 것이라고 봅니다. 이는 우리 당의 전망이며 시가 발표한 확정액은 아닙니다.'}
  ];
  let article = '', sources = [], receipts = [], demo = false, result = null;
  let loadedArticleDraft = '';
  let blindReview = null;
  let currentId = null, editingId = null, sourceForRow = null, dirty = false;
  let latestImport = 0;
  let drafts = new Map();
  let articleAssessment = null, articleAssessmentDraft = null;
  const rubric = window.JournalArticleRubric, rubricUI = window.JournalArticleRubricUI;
  const parameters = new URLSearchParams(location.search);
  const studyFrame = window !== window.parent && parameters.get('study') === '1';
  const fieldHandoff = window === window.parent && parameters.get('field') === '1' &&
    !parameters.has('study') && (!parameters.has('method') || parameters.get('method') === 'journal');
  let hasCommittedArticle = false;
  let fieldCopyResult = null;
  let studyNonce = null;
  const studyKitMeta = document.querySelector('meta[name="journal-editor-kit"]');
  const studyKit = studyKitMeta?.content.length === 64 && /^[a-f0-9]+$/.test(studyKitMeta.content) ? studyKitMeta.content : null;
  let studyPort = null;
  // Local file pages have opaque origins. Only the actual parent frame receives replies.
  const localFile = location.protocol === 'file:';
  const expectedMessageOrigin = localFile ? 'null' : location.origin;
  const parentOrigin = localFile ? '*' : location.origin;
  function studyReply(type, fields = {}) {
    const packet = {type, nonce:studyNonce, ...fields};
    if (studyPort) studyPort.postMessage(packet);
    else window.parent.postMessage(packet, parentOrigin);
  }

  function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function message(id, text, error = false) {
    const target = byId(id);
    target.textContent = text;
    target.classList.toggle('error', error);
  }
  function setArticleDraft(text) {
    loadedArticleDraft = text;
    byId('article').value = text;
  }
  function currentArticleDraft() {
    const value = byId('article').value;
    // A textarea exposes LF for CRLF and CR. Preserve the exact loaded edition while its display is unchanged.
    if (value === loadedArticleDraft.replace(/\r\n?/g, '\n')) return loadedArticleDraft;
    if (value === article.replace(/\r\n?/g, '\n')) return article;
    return value;
  }
  function articleIsCommitted() {
    return hasCommittedArticle && currentArticleDraft() === article;
  }
  function showBlindNotice() {
    const notice = byId('blind-notice');
    notice.hidden = !blindReview;
    const action = articleIsCommitted()
      ? '평가를 마치면 ‘작업 파일 내려받기’로 저장하세요.'
      : '원문을 수정 중입니다. 배부받은 원문으로 되돌려야 이 묶음에서 비교할 수 있습니다. 바꾼 원문을 확정하면 A/B 표지가 해제됩니다.';
    const text = blindReview ? '블라인드 평가 ' + blindReview.slot + ' · 묶음 ' + blindReview.pairId.slice(0, 8) + ' · ' + action : '';
    if (notice.textContent !== text) notice.textContent = text;
  }
  function button(text, action) {
    const el = node('button', text);
    el.type = 'button';
    el.addEventListener('click', action);
    return el;
  }
  function currentRow() {
    return result?.rows.find(row => row.id === currentId);
  }
  function isOpen(row) {
    return row.needsReview;
  }
  function download(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const link = node('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function statusCounts() {
    const counts = new Map(Object.keys(labels).map(key => [key, 0]));
    for (const row of result.rows) counts.set(row.status, counts.get(row.status) + 1);
    const summary = [...counts].filter(([, count]) => count).map(([key, count]) => labels[key] + ' ' + count + '개');
    if (result.attributedCount) summary.push('발언 내용 중 미확인 ' + result.contentUnverifiedCount + '개 · 의견/전망 ' + result.contentOpinionCount + '개 · 별도 근거 지지 ' + result.contentSupportedCount + '개 · 내용 충돌 ' + result.contentContradictedCount + '개');
    return summary;
  }
  function sourceSummary(s) {
    return [s.title || s.id, s.version, s.locator].join(' · ');
  }
  function sourceLink(source) {
    return window.JournalSourceReader.link(source) || node('small', '화면에 제공된 모의 원자료');
  }
  function citationAddress(source) {
    const target = engine.sourceTarget(source);
    const page = target?.page || target?.localPage;
    const address = page ? target.href + '\nPDF 파일 ' + page + '쪽 · 원문이 내려받아지면 파일을 열어 이 쪽을 확인하세요.' : source.url;
    return source.pdfSha256 ? address + '\nPDF SHA-256 · ' + source.pdfSha256 : address;
  }
  function sourceDetails(source, showLink = true) {
    const section = node('div', undefined, 'source');
    section.append(node('p', sourceSummary(source), 'meta'));
    if (showLink) section.append(sourceLink(source));
    const cell = window.JournalEvidenceFiscalTable.registeredCell(source);
    if (cell?.stage === 'executionRate') {
      const value = /(?:%|퍼센트)$/u.test(cell.value.normalize('NFKC').trim()) ? cell.value : cell.value + cell.unit;
      const basis = cell.basis ? cell.basis + ' 기준 집행률' : '집행률 (분모는 원표 주석 확인)';
      section.append(node('p', cell.year + '년 ' + cell.rowLabel + ' · ' + basis + ' ' + value, 'registered-rate'));
    } else if (cell) {
      section.append(node('p', cell.year + '년 ' + cell.rowLabel + ' · ' + cell.heading + ' · 원문 표기 ' +
        cell.value + ' (단위 ' + cell.unit + ')', 'registered-amount'));
    }
    section.append(node('blockquote', source.excerpt));
    const local = window.JournalSourceReader.localControl(source);
    if (local) section.append(local);
    if (source.originUrl) section.append(node('p', '최초 원문 · ' + source.originUrl, 'meta'));
    return section;
  }
  function clearFieldCopy() {
    fieldCopyResult?.remove();
    fieldCopyResult = null;
  }
  function addFieldCopy(part, source) {
    let text;
    try {
      const citation = window.JournalFieldCitation.fromSource(source);
      text = window.JournalFieldCitation.encode(citation);
    } catch { return; }
    const copy = button('현장 답안용 위치 복사', async () => {
      if (!copy.isConnected || byId('workspace').hidden) return;
      clearFieldCopy();
      const result = node('div'), status = node('p', '', 'message');
      status.setAttribute('role', 'status');
      result.append(status);
      copy.after(result);
      fieldCopyResult = result;
      try {
        await navigator.clipboard.writeText(text);
        if (fieldCopyResult === result) status.textContent = '원자료 주소와 확인 위치를 복사했습니다. 현장 답안에 붙여넣으세요.';
      } catch {
        if (fieldCopyResult !== result) return;
        const label = node('label', '현장 답안에 붙여넣을 원자료 위치');
        const field = node('textarea');
        field.readOnly = true;
        field.rows = 3;
        field.value = text;
        label.append(field);
        result.append(label);
        status.textContent = '아래 내용을 선택했습니다. 키보드로 복사해 현장 답안에 붙여넣으세요.';
        field.focus();
        field.select();
      }
    });
    part.append(copy);
  }
  if (fieldHandoff) {
    const leaveCopiedSource = event => {
      const next = event.target.closest('#source-list > details');
      if (next && fieldCopyResult && !next.contains(fieldCopyResult)) clearFieldCopy();
    };
    byId('source-list').addEventListener('click', leaveCopiedSource);
    byId('source-list').addEventListener('focusin', leaveCopiedSource);
  }
  function showSources() {
    const catalog = byId('source-list');
    catalog.replaceChildren();
    byId('source-count').textContent = '· ' + sources.length + '개';
    for (const source of sources) {
      const part = node('details', undefined, 'source');
      part.append(node('summary', source.title || source.id), sourceDetails(source));
      if (fieldHandoff && hasCommittedArticle && !demo && !blindReview) addFieldCopy(part, source);
      part.append(button('자료 수정', () => {
        if (sourceDraftIsDirty() && !confirm('입력 중인 자료를 비우고 이 자료를 수정할까요?')) return;
        clearFieldCopy();
        clearSourceTarget();
        suggestedLocator = '';
        offerPdfLocation(null);
        sourcePdfHash = source.pdfSha256 || '';
        setLocationReview(false);
        editingId = source.id;
        for (const field of sourceFields) byId('source-' + field).value = source[field] || '';
        byId('source-form-title').textContent = '원자료 수정';
        byId('source-save').textContent = '수정 적용';
        byId('source-cancel').hidden = false;
        updateSourceDraftNote();
        byId('source-title').focus();
      }));
      catalog.append(part);
    }
  }
  let sourceBaseline = {}, prefillId = null, suggestedLocator = '';
  let pdfProposal = null, sourcePdfHash = '';
  const documentFields = ['title', 'url', 'version', 'originUrl'];
  const typedDocumentFields = new Set();
  function documentFieldsMatch(values) {
    return documentFields.every(key => byId('source-' + key).value === (values[key] || ''));
  }
  function fillDocumentFields(source) {
    typedDocumentFields.clear();
    prefillId = source?.id || null;
    sourceBaseline = workspace.sourceDefaults(source);
    for (const key of documentFields) byId('source-' + key).value = sourceBaseline[key];
  }
  function offerDocumentInfo(proposal) {
    const area = byId('pdf-source-options');
    area.replaceChildren();
    area.hidden = true;
    if (!proposal || editingId) return;
    const inherited = sources.find(s => s.id === prefillId);
    const candidates = new Map();
    for (const source of sources) {
      if (source.pdfSha256 !== proposal.hash) continue;
      const info = workspace.sourceDefaults(source);
      const key = JSON.stringify(info);
      if (!candidates.has(key)) candidates.set(key, {source, info});
    }
    if (inherited?.pdfSha256 === proposal.hash && candidates.size === 1 && documentFieldsMatch(sourceBaseline)) return;
    if (inherited && (inherited.pdfSha256 !== proposal.hash || candidates.size > 1)) {
      for (const key of documentFields) {
        const field = byId('source-' + key);
        if (!typedDocumentFields.has(key) && field.value === sourceBaseline[key]) field.value = '';
      }
      prefillId = null;
      sourceBaseline = workspace.sourceDefaults();
      if (!candidates.size) {
        area.append(node('p', '이 PDF의 자료 이름·주소·판본을 확인하세요. 이전 문서에서 자동으로 채운 값은 비웠습니다.', 'hint'));
      }
    }
    if (candidates.size) {
      area.append(node('p', '같은 PDF 파일로 등록한 문서 정보입니다. 이번에 확인한 주소와 판본을 선택하세요.'));
      for (const {source, info} of candidates.values()) {
        const item = node('div', undefined, 'source');
        item.append(node('strong', info.title), node('p', info.url + ' · ' + info.version, 'meta'));
        if (info.originUrl) item.append(node('p', '최초 원문 · ' + info.originUrl, 'meta'));
        const use = button('이 문서 정보 사용', () => {
          if (pdfProposal !== proposal || editingId) return;
          if (!documentFieldsMatch({}) && !documentFieldsMatch(sourceBaseline) && !documentFieldsMatch(info) &&
              !confirm('작성한 자료 이름·주소·판본·최초 원문 주소를 선택한 문서 정보로 바꿀까요?')) return;
          fillDocumentFields(source);
          dirty = true;
          sourceDraftEdited();
          message('source-status', '‘' + info.title + '’의 문서 정보를 채웠습니다. 이번 발췌문의 위치를 원본과 대조하세요.');
          byId('use-pdf-location').focus();
        });
        use.dataset.sourceId = source.id;
        item.append(use);
        area.append(item);
      }
    }
    area.hidden = !area.childElementCount;
  }
  function offerPdfLocation(proposal) {
    pdfProposal = proposal;
    if (!proposal) {
      byId('pdf-source-options').replaceChildren();
      byId('pdf-source-options').hidden = true;
    }
    byId('source-pdf-proposal').hidden = !proposal;
    if (!proposal) {
      byId('source-pdf-proposal-text').textContent = '';
      return;
    }
    const pages = proposal.first === proposal.last ? 'PDF ' + proposal.first + '쪽' :
      '첫 구절 PDF ' + proposal.first + '쪽 · 마지막 구절 ' + proposal.last + '쪽';
    byId('source-pdf-proposal-text').textContent = proposal.file.name + ' · ' + pages +
      '. 위 문서 주소에서 받은 PDF가 맞는지 확인하면 쪽번호와 파일 식별값을 함께 기록합니다.';
  }
  function draftPageLabel() {
    const page = byId('source-pdfPage').value.trim();
    if (page) return 'PDF ' + page + '쪽';
    try {
      const hash = new URL(byId('source-url').value).hash;
      const pageInAddress = new URLSearchParams(hash.slice(1)).get('page');
      if (pageInAddress) return '문서 주소의 #page=' + pageInAddress;
    } catch { /* The editor may still be typing the document address. */ }
    return '';
  }
  function setLocationReview(visible, checked = false) {
    byId('source-location-review').hidden = !visible;
    byId('source-location-checked').checked = visible && checked;
    byId('source-location-summary').textContent = visible
      ? [draftPageLabel(), byId('source-locator').value.trim() || '확인 위치를 입력하세요.'].filter(Boolean).join(' · ') : '';
  }
  function sourceDraftIsDirty() {
    const original = sources.find(source => source.id === editingId) || sourceBaseline;
    return sourcePdfHash !== (original.pdfSha256 || '') || !byId('source-location-review').hidden ||
      sourceFields.some(field => byId('source-' + field).value !== (original[field] || ''));
  }
  function sourceDraftNote() {
    if (!result || !sourceDraftIsDirty()) return '';
    const source = sources.find(s => s.id === editingId);
    if (!source) return '등록 전인 새 원자료가 있습니다. 이 결과는 이미 등록한 자료로 계산했습니다.';
    const numbers = [];
    result.rows.forEach((row, i) => {
      const r = row.receipt;
      if (r && (r.sourceIds.includes(source.id) || r.contentSourceIds?.includes(source.id))) numbers.push(i + 1);
    });
    return '원자료 ‘' + (source.title || source.id) + '’ 수정 중입니다. 이 결과에는 수정 전 판본을 사용했습니다.' +
      (numbers.length ? ' 이 자료를 인용한 문장 번호는 ' + numbers.join(', ') + '입니다.' : '');
  }
  function updateNextSearch() {
    byId('save-find-next').hidden = !currentId || !byId('document-text').value.trim() || !!editingId ||
      sourceDraftIsDirty() || !result?.rows.some(row => row.id !== currentId && row.status === 'pending');
  }
  function updateSourceDraftNote() {
    updateNextSearch();
    const note = sourceDraftNote();
    const label = byId('source-draft-note');
    if (label.textContent !== note) label.textContent = note;
    byId('result-source-draft').hidden = !note;
  }
  function sourceDraftEdited() {
    if (sourceForRow && sourceForRow !== currentRow()?.articleBinding) clearSourceTarget();
    updateSourceDraftNote();
  }
  function clearSourceTarget() {
    sourceForRow = null;
    byId('source-save-link').hidden = true;
  }
  function targetSourceTo(row) {
    sourceForRow = row.articleBinding;
    const link = byId('source-save-link');
    link.textContent = (result.rows.indexOf(row) + 1) + '번 문장의 대조 자료로 추가';
    link.hidden = false;
  }
  function clearSourceForm(reuse = {}) {
    clearSourceTarget();
    suggestedLocator = '';
    offerPdfLocation(null);
    sourcePdfHash = '';
    setLocationReview(false);
    editingId = null;
    byId('source-form').reset();
    fillDocumentFields(reuse);
    byId('source-form-title').textContent = '원자료 추가';
    byId('source-save').textContent = '자료 추가';
    byId('source-cancel').hidden = true;
    updateSourceDraftNote();
  }
  function decisionDraft() {
    return {
      status: byId('verdict').value, reason: byId('reason').value,
      sourceIds: [...byId('row-sources').querySelectorAll('input:checked')].map(input => input.value),
      factSpan: byId('fact-span').value, opinionSpan: byId('opinion-span').value,
      contentStatus: byId('content-status').value,
      contentSourceIds: [...byId('content-sources').querySelectorAll('input:checked')].map(input => input.value),
      contentReason: byId('content-reason').value,
      contentChecked: byId('content-checked').checked,
      correction: byId('verdict').value === 'contradicted' ? byId('correction').value.trim() : '',
      correctionChecked: byId('verdict').value === 'contradicted' && byId('correction-checked').checked,
      acknowledged: byId('acknowledged').checked
    };
  }
  function updateGuidance() {
    const status = byId('verdict').value;
    byId('correction-part').hidden = status !== 'contradicted';
    const content = byId('content-status').value;
    byId('attribution-part').hidden = status !== 'attribution';
    byId('content-details').hidden = content === 'unverified';
    byId('content-conflict-note').hidden = content !== 'contradicted';
    byId('content-sources-part').hidden = !['supported','contradicted'].includes(content);
    const contentAttestations = {opinion: '발언에 추가로 확인해야 할 사실 주장이 없는 의견·전망임을 확인했습니다.',
      supported: '원발언과 독립된 원자료를 직접 대조해 발언 안의 사실 주장을 확인했습니다.',
      contradicted: '발언 당시의 같은 대상·기간·단위를 다룬 독립 원자료에서 이 사실 주장 전체와 양립할 수 없는 내용을 확인하고, 판단 이유에 그 차이를 적었습니다.'};
    byId('content-ack').textContent = contentAttestations[content] || '';
    byId('mixed-parts').hidden = !['partial', 'mixed'].includes(status);
    byId('opinion-part').hidden = status !== 'mixed';
    byId('verdict-help').textContent = guidance[status] || '정치적 표현을 만났다면 사실 주장, 발언의 귀속, 글쓴이의 평가를 구분하세요.';
    byId('ack-text').textContent = attestations[status] || '문장의 범위와 판단 이유를 확인했습니다.';
  }
  function showSourceChoices(row, selectedIds) {
    const area = byId('row-sources');
    area.replaceChildren();
    if (!sources.length) area.append(node('p', '연결할 원자료를 먼저 추가하세요.', 'hint'));
    else if (row.sourceCaution) area.append(node('p', row.sourceCaution, 'callout'));
    const matches = new Map((row.sourceMatches || []).map(match => [match.id, match.reason]));
    const suggested = new Set(row.sourceIds || []);
    const ranks = new Map(row.sourceIds.map((id, i) => [id, i]));
    const sorted = [...sources].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
    for (const source of sorted) {
      const part = node('div', undefined, 'source');
      const label = node('label', undefined, 'source-line');
      const check = node('input');
      check.type = 'checkbox';
      check.value = source.id;
      check.checked = selectedIds.includes(source.id);
      label.append(check, node('span', (source.title || source.id) + ' · ' + source.version));
      if (suggested.has(source.id)) label.append(node('span', '대조 후보', 'badge'));
      const details = node('details');
      details.open = row.sourceCaution ? check.checked : source.id === row.sourceIds[0];
      details.append(node('summary', source.locator), sourceDetails(source, false));
      if (matches.has(source.id)) details.append(node('small', matches.get(source.id)));
      part.append(label, sourceLink(source), details);
      area.append(part);
    }
    filterSources();
  }
  function filterSources() {
    const query = byId('source-search').value.trim().toLocaleLowerCase();
    for (const el of byId('row-sources').children) {
      if (el.classList.contains('source')) el.hidden = !el.textContent.toLocaleLowerCase().includes(query);
    }
  }
  function priorNote(row, draft) {
    let note = row.reviewNote || (row.receipt ? '같은 원문과 원자료로 기록한 기존 판단입니다. 변경하려면 새로 확인해 기록하세요.' : '');
    if (draft?.afterEdit) note = draft.sourceEdit
      ? '인용한 원자료를 수정해 이전 판단을 초안으로 옮겼습니다. 수정한 자료를 다시 대조한 뒤 기록하세요.'
      : '원문 수정 전의 판단을 초안으로 옮겼습니다. 이 구간과 주변 문맥은 같으며, 현재 기사를 대조한 뒤 다시 기록해야 합니다.';
    if (draft?.speechRecovery === 'attribution') note = '원발언 자료와 귀속 판단 이유만 초안으로 불러왔습니다. 발언 속 사실은 명부·결산표·현장 기록 등 다른 원자료로 확인하세요.';
    if (draft?.speechRecovery === 'edited') note = '같은 발언을 다시 인용한 이전 내용 판정은 제외했습니다. 작성 중인 판단을 대조한 뒤 다시 기록하세요.';
    if (draft?.speechCatalogChanged) note += ' 자료 목록도 달라졌습니다. 추가·변경된 자료를 확인하세요.';
    return note;
  }
  function showCase() {
    const row = currentRow();
    if (sourceForRow && sourceForRow === row?.articleBinding) targetSourceTo(row);
    else if (sourceDraftIsDirty()) byId('source-save-link').hidden = true;
    else clearSourceTarget();
    updateNextSearch();
    byId('case').hidden = !row;
    if (!row) return;
    const index = result.rows.indexOf(row);
    byId('row-heading').textContent = '문장 ' + (index + 1) + ' · ' + rowLabel(row) + (row.positions.length > 1 ? ' · 연속 반복 ' + row.positions.length + '곳' : '');
    byId('row-text').textContent = row.text;
    byId('row-context').textContent = row.context || row.text;
    byId('document-query').value = row.text;
    clearSearchContext();
    byId('finder-results').replaceChildren();
    message('finder-status', '');
    byId('row-hints').replaceChildren(...row.hints.map(hint => node('li', hint)));
    const savedDraft = drafts.get(row.id);
    const values = savedDraft || row.receipt || row.priorDecision || row.attributionDraft || {};
    byId('prior-note').textContent = priorNote(row, savedDraft);
    for (const option of byId('verdict').options) {
      option.disabled = !!option.value && !row.allowedStatuses.includes(option.value);
    }
    byId('verdict').value = values.status || '';
    byId('reason').value = values.reason || '';
    byId('fact-span').value = values.factSpan || '';
    byId('opinion-span').value = values.opinionSpan || '';
    byId('correction').value = values.correction || '';
    byId('content-status').value = values.contentStatus || 'unverified';
    byId('content-reason').value = values.contentReason || '';
    byId('content-checked').checked = savedDraft?.contentChecked === true;
    byId('content-sources').replaceChildren(...sources.map(s => {
      const item = node('div', undefined, 'source');
      const label = node('label', undefined, 'source-line');
      const input = node('input');
      input.type = 'checkbox';
      input.value = s.id;
      input.checked = (values.contentSourceIds || []).includes(s.id);
      label.append(input, node('span', sourceSummary(s)));
      const details = node('details');
      details.append(node('summary', '근거 위치와 발췌 보기'), sourceDetails(s, false));
      item.append(label, sourceLink(s), details);
      return item;
    }));
    byId('correction-checked').checked = savedDraft?.correctionChecked === true;
    byId('source-search').value = '';
    showSourceChoices(row, values.sourceIds || []);
    byId('acknowledged').checked = savedDraft?.acknowledged === true;
    updateGuidance();
  }
  function rowLabel(row) {
    return row.draftPending ? '판단 작성 중' : labels[row.status];
  }
  function reviewRow(row) {
    if (currentId === row.id) {
      byId('row-heading').focus();
      return;
    }
    if (!isOpen(row)) byId('row-filter').value = 'all';
    currentId = row.id;
    showQueue(true);
  }
  function reviewAction(row, number) {
    const actions = node('div', undefined, 'actions compact');
    actions.append(button(number + '번 문장 검토 열기', () => reviewRow(row)));
    return actions;
  }
  function showQueue(focus = false, keepForm = false) {
    const previousId = currentId;
    const list = byId('row-list');
    list.replaceChildren();
    const visible = result.rows.filter(row => byId('row-filter').value === 'all' || isOpen(row));
    if (!visible.some(row => row.id === currentId)) currentId = visible[0]?.id || null;
    for (const row of visible) {
      const index = result.rows.indexOf(row);
      const item = node('li');
      const pick = button('', () => reviewRow(row));
      pick.className = 'row-button';
      pick.setAttribute('aria-current', String(currentId === row.id));
      pick.append(node('strong', (index + 1) + ' · ' + rowLabel(row)), document.createTextNode(row.text.length > 60 ? row.text.slice(0, 60) + '…' : row.text));
      item.append(pick);
      list.append(item);
    }
    byId('queue-empty').hidden = !!visible.length;
    if (!keepForm || previousId !== currentId) showCase();
    else if (currentRow()) {
      const row = currentRow();
      byId('row-heading').textContent = '문장 ' + (result.rows.indexOf(row) + 1) + ' · ' + rowLabel(row);
      byId('prior-note').textContent = priorNote(row, drafts.get(row.id));
    }
    if (focus && currentId) byId('row-heading').focus();
  }
  function resultScope() {
    if (!result.rows.length) return '검토할 문장이 없습니다.';
    if (result.complete) return '모든 검토 항목의 판단을 기록했습니다. 항목별 확인 범위와 근거를 확인하세요.';
    return '추가 확인이 필요한 검토 항목은 ' + result.pendingCount + '개입니다.' + (result.contentUnverifiedCount
      ? ' 이 중 ' + result.contentUnverifiedCount + '개는 발언 사실을 확인했고, 발언 내용의 검증이 남았습니다.' : '');
  }
  const revisionInputs = new Map();
  function selectedRevisions() {
    return [...revisionInputs].filter(([input]) => input.checked).map(([, choice]) => choice);
  }
  function updateRevisionPreview() {
    const preview = byId('revision-preview');
    const selected = selectedRevisions();
    byId('download-revision').disabled = !selected.length;
    byId('revision-count').textContent = '정정 문구가 있는 ' + revisionInputs.size + '곳 중 ' + selected.length + '곳 선택';
    preview.hidden = !selected.length;
    byId('revision-preview-text').textContent = selected.length && preview.open
      ? window.JournalRevisionDraft.apply(result, selected) : '';
  }
  function showRevisions() {
    const panel = byId('revision-draft');
    const list = byId('revision-choices');
    const keys = new Set(selectedRevisions().map(choice => choice.binding + '/' + choice.start));
    revisionInputs.clear();
    list.replaceChildren();
    message('revision-status', '');
    const choices = blindReview || parameters.has('study') || !articleIsCommitted() ? [] : window.JournalRevisionDraft.proposals(result);
    panel.hidden = !choices.length;
    if (!choices.length) {
      panel.open = false;
      byId('revision-preview').open = false;
      updateRevisionPreview();
      return;
    }
    const rows = new Map(result.rows.map((row, i) => [row.id, {row, number:i + 1}]));
    for (const choice of choices) {
      const {row, number} = rows.get(choice.rowId);
      const item = node('div', undefined, 'source');
      const label = node('label', undefined, 'check-line');
      const input = node('input');
      input.type = 'checkbox';
      input.checked = keys.has(choice.binding + '/' + choice.start);
      revisionInputs.set(input, choice);
      const repeated = row.positions.length > 1;
      const occurrence = repeated ? ' · ' + row.positions.length + '곳 중 ' +
        (row.positions.findIndex(position => position.start === choice.start) + 1) + '번째' : '';
      label.append(input, document.createTextNode('구간 ' + number + occurrence));
      const original = node('p', '원문 · ', 'verbatim');
      if (repeated) original.append(result.article.slice(Math.max(0, choice.start - 50), choice.start));
      original.append(node('mark', choice.original));
      if (repeated) original.append(result.article.slice(choice.end, choice.end + 50));
      const evidence = node('details');
      evidence.append(node('summary', '정정의 근거와 판단 이유'));
      evidence.ontoggle = () => {
        if (!evidence.isConnected || !evidence.open || evidence.childElementCount > 1) return;
        evidence.append(node('p', row.receipt.reason));
        for (const id of row.receipt.sourceIds) evidence.append(sourceDetails(sources.find(s => s.id === id)));
      };
      item.append(label, original, node('p', '수정 · ' + choice.replacement, 'verbatim'), evidence);
      list.append(item);
    }
    updateRevisionPreview();
  }
  byId('revision-choices').addEventListener('change', () => {
    message('revision-status', '');
    updateRevisionPreview();
  });
  byId('revision-preview').addEventListener('toggle', updateRevisionPreview);
  byId('download-revision').addEventListener('click', () => {
    if (blindReview || parameters.has('study') || !articleIsCommitted()) return;
    try {
      const text = window.JournalRevisionDraft.apply(result, selectedRevisions());
      const packet = {...workspace.independentInput(currentWork()), article:text, articleDraft:text};
      download(JSON.stringify(packet, null, 2), 'journal-revision-draft.json', 'application/json');
      message('revision-status', '수정본 작업 파일 내려받기를 요청했습니다. 이 파일을 새 창에서 열어 바뀐 기사와 원자료를 대조하세요.');
    } catch (err) { message('revision-status', err.message, true); }
  });
  function showReport() {
    showRevisions();
    const rows = byId('report-rows');
    rows.replaceChildren();
    byId('result-tag').textContent = result.complete ? '문장 검토 완료' : '추가 확인 필요';
    byId('result-scope').textContent = resultScope();
    byId('coverage-limit').textContent = coverageLimit;
    byId('result-demo').hidden = !demo;
    byId('result-counts').replaceChildren(...statusCounts().map(text => node('span', text)));
    for (const [index, row] of result.rows.entries()) {
      const part = node('section', undefined, 'report-row');
      part.append(node('p', (index + 1) + ' · ' + rowLabel(row) + (row.positions.length > 1 ? ' · 원문 ' + row.positions.length + '곳' : ''), 'report-label'), node('p', row.text, 'verbatim'));
      if (!row.receipt && row.reviewNote) part.append(node('p', row.reviewNote, 'hint'));
      if (row.receipt) {
        const r = row.receipt;
        if (r.status === 'partial') part.append(node('p', '사실 구절 · ' + r.factSpan), node('p', '남은 구절 · ' + r.remainingSpans.join(' / ')));
        if (r.status === 'mixed') part.append(node('p', '사실 구절 · ' + r.factSpan), node('p', '평가 구절 · ' + r.opinionSpan));
        if (r.status === 'attribution') {
          part.append(node('p', '발언 내용 · ' + contentLabels[r.contentStatus]));
          if (r.contentClaim) part.append(node('p', '내용을 대조한 인용 구간 · ' + r.contentClaim));
          if (r.contentReason) part.append(node('p', r.contentReason, 'hint'));
        }
        if (r.correction) part.append(node('p', '근거와 대조한 수정 문구 · ' + r.correction));
        part.append(node('p', r.reason, 'hint'), node('small', '기록 시각 · ' + r.recordedAt));
        for (const id of [...r.sourceIds, ...(r.contentSourceIds || [])]) {
          const s = sources.find(source => source.id === id);
          const detail = node('details');
          const prefix = r.status === 'attribution' ? (r.contentSourceIds?.includes(id) ? '내용 근거 · ' : '원발언 · ') : '';
          detail.append(node('summary', prefix + sourceSummary(s)), sourceDetails(s, false));
          part.append(detail, sourceLink(s));
        }
      }
      if (!studyFrame) part.append(reviewAction(row, index + 1));
      rows.append(part);
    }
  }
  function refresh(keepForm = false, standardsDraft = null) {
    clearFieldCopy();
    result = workspace.activeReport(article, sources, receipts, drafts);
    if (standardsDraft) {
      // Adding another source leaves the existing citations intact. Carry only the
      // unfinished comparison to the new catalogue, with no previous score to reinstate.
      articleAssessmentDraft.entries.standards = {...standardsDraft, addedSourceBinding:rubric.bind(result)};
    }
    demo = demo || sources.some(isMock);
    byId('workspace').hidden = false;
    byId('demo-notice').hidden = !demo;
    byId('new-work').hidden = false;
    const occurrences = result.rows.reduce((n, row) => n + row.positions.length, 0);
    byId('counts').textContent = '원문 ' + occurrences + '곳 · 검토 항목 ' + result.rows.length + '개 · 추가 확인 ' + result.pendingCount + '개';
    if (!keepForm) showSources();
    showQueue(false, keepForm);
    showReport();
    updateSourceDraftNote();
    renderArticleAssessment();
  }
  function renderArticleAssessment() {
    if (studyFrame) return;
    rubricUI.render(byId('article-rubric'), result, sources, articleAssessment, value => {
      articleAssessment = value; dirty = true;
    }, articleAssessmentDraft, value => {
      articleAssessmentDraft = value; dirty = true;
    }, reviewAction);
  }
  function openSourceTools(find) {
    byId('sources-panel').open = true;
    if (editingId) {
      if (sourceDraftIsDirty() && !confirm('수정 중인 원자료의 변경을 비우고 새 자료를 추가할까요? 취소하면 현재 수정을 계속할 수 있습니다.')) {
        byId('source-title').focus();
        return;
      }
      clearSourceForm();
      message('source-status', '새 원자료를 추가합니다.');
    }
    const row = currentRow();
    if (row) {
      const target = result.rows.indexOf(row) + 1;
      if (!sourceDraftIsDirty() || row.articleBinding === sourceForRow ||
          confirm('작성 중인 원자료 초안을 ' + target + '번 문장의 대조 자료로 연결할까요? 취소하면 초안을 그대로 유지합니다.')) {
        targetSourceTo(row);
      } else {
        byId('source-save-link').hidden = true;
        message('source-status', '원자료 초안을 유지했습니다. ' + target + '번 문장과 연결하지 않았습니다.');
      }
    }
    if (find) {
      byId('finder').open = true;
      byId('document-query').value = row?.text || '';
      clearSearchContext();
      if (row && byId('document-text').value.trim()) {
        findPassages();
        byId('find-passages').focus();
        return;
      }
      byId('finder-results').replaceChildren();
      message('finder-status', '');
    }
    byId(find ? 'document-text' : 'source-title').focus();
  }
  function resetWork(text, initialSources, initialReceipts, sample, tag = null, committed = true) {
    revisionInputs.clear();
    byId('share-article-url').value = '';
    window.JournalSourceReader.clearLocal();
    // Clear transient text and decisions when opening a different workspace.
    articleAssessment = null;
    articleAssessmentDraft = null;
    article = text;
    hasCommittedArticle = committed;
    sources = initialSources;
    receipts = initialReceipts;
    demo = sample;
    blindReview = tag;
    drafts = new Map();
    currentId = null;
    clearSourceForm();
    setArticleDraft(text);
    showBlindNotice();
    window.JournalDocumentFile?.clear();
    byId('document-text').value = '';
    clearSearchContext();
    byId('finder-results').replaceChildren();
    byId('row-filter').value = 'open';
    byId('sources-panel').open = false;
    byId('finder').open = false;
    for (const id of ['file-status','source-status','review-status','result-status','finder-status','article-status']) message(id, '');
    refresh();
    byId('article-panel').open = false;
  }
  function hasWork() {
    return !!article || byId('article').value.trim().length > 0 || sources.length > 0;
  }
  function canReplace() {
    return !hasWork() || confirm('현재 화면의 작업을 교체할까요? 계속할 작업은 먼저 파일로 저장하세요.');
  }

  function carryDrafts(nextRows) {
    // Only a uniquely identifiable excerpt in the same local context is recoverable.
    const groupByContext = rows => {
      const groups = new Map();
      for (const row of rows) {
        const key = JSON.stringify([row.text, row.context, row.positions.length]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      return groups;
    };
    const oldGroups = groupByContext(result.rows), newGroups = groupByContext(nextRows);
    const recovered = new Map();
    let unmapped = 0;
    for (const [key, oldRows] of oldGroups) {
      for (const old of oldRows) {
        const d = drafts.get(old.id) || old.receipt || old.priorDecision;
        if (!d) continue;
        const target = newGroups.get(key) || [];
        if (oldRows.length !== 1 || target.length !== 1) { unmapped++; continue; }
        recovered.set(target[0].id, draftFrom(d));
      }
    }
    return {recovered, unmapped};
  }
  // An earlier decision becomes an unconfirmed draft: the reviewer must check it again.
  function draftFrom(d, afterEdit = true) {
    return {
      status: d.status || '', reason: d.reason || '', sourceIds: [...(d.sourceIds || [])],
      factSpan: d.factSpan || '', opinionSpan: d.opinionSpan || '', correction: d.correction || '',
      contentStatus: d.contentStatus || 'unverified', contentSourceIds: [...(d.contentSourceIds || [])],
      contentReason: d.contentReason || '', acknowledged: false, correctionChecked: false, contentChecked: false,
      afterEdit
    };
  }
  function speechRecovery(draft, kind = draft?.speechRecovery) {
    return ['attribution','edited'].includes(kind)
      ? {speechRecovery:kind, ...(draft?.speechCatalogChanged === true && {speechCatalogChanged:true})}
      : {};
  }

  byId('article-form').addEventListener('submit', event => {
    event.preventDefault();
    const text = currentArticleDraft();
    if (!text.trim()) return message('article-status', '검토할 기사를 붙여 넣으세요.', true);
    try {
      let recoveryMessage = '';
      if (article !== text && result) {
        const {recovered, unmapped} = carryDrafts(engine.prepare(text, sources).rows);
        if (unmapped && !confirm('검토한 구간 또는 주변 문맥이 달라져 이전 입력 ' + unmapped + '개를 새 기사에 옮길 수 없습니다. 계속할까요? 취소하면 기존 기사를 유지하므로 작업 파일을 먼저 저장할 수 있습니다.')) {
          setArticleDraft(article);
          byId('workspace').hidden = false;
          showBlindNotice();
          message('article-status', '기존 기사와 판단을 유지했습니다. 이전 작업을 보관하려면 작업 파일을 내려받으세요.');
          return;
        }
        drafts = recovered;
        receipts = [];
        currentId = null;
        if (recovered.size || unmapped) recoveryMessage = '이전 입력 ' + recovered.size + '개를 확인 전 초안으로 옮겼습니다. 문맥이 달라 옮기지 않은 입력은 ' + unmapped + '개입니다.';
        if (blindReview) {
          blindReview = null;
          recoveryMessage = ['원문을 변경해 A/B 표지를 해제했습니다.', recoveryMessage].filter(Boolean).join(' ');
        }
      }
      latestImport++;
      if (article !== text) byId('share-article-url').value = '';
      article = text;
      setArticleDraft(text);
      hasCommittedArticle = true;
      showBlindNotice();
      dirty = true;
      refresh();
      byId('article-panel').open = false;
      message('review-status', recoveryMessage);
      byId('row-heading').focus();
    } catch (err) { message('article-status', err.message, true); }
  });
  byId('article').addEventListener('input', () => {
    clearFieldCopy();
    dirty = true;
    showBlindNotice();
    byId('workspace').hidden = !articleIsCommitted();
    message('article-status', byId('workspace').hidden && article ? '변경한 원문을 검토하려면 검토 목록을 다시 만드세요.' : '');
  });
  byId('new-work').addEventListener('click', () => {
    if (!canReplace()) return;
    dirty = false;
    latestImport++;
    location.reload();
  });
  byId('load-demo').addEventListener('click', () => {
    if (!canReplace()) return;
    latestImport++;
    resetWork(mockArticle, mockSources.map(s => ({...s})), [], true);
    dirty = true;
    byId('row-heading').focus();
  });
  byId('source-cancel').addEventListener('click', () => clearSourceForm());
  byId('source-form').addEventListener('submit', event => {
    event.preventDefault();
    if (sourcePdfHash && engine.pdfPageInLocator(byId('source-locator').value, byId('source-pdfPage').value) === false) {
      message('source-status', '확인 위치에 적은 PDF 쪽과 발췌한 PDF 쪽이 다릅니다. 원본을 대조해 확인 위치를 고치세요.', true);
      byId('source-locator').focus();
      return;
    }
    if (!byId('source-location-review').hidden && !byId('source-location-checked').checked) {
      message('source-status', '등록하려면 위 확인 위치와 발췌문을 원문에서 대조한 뒤 확인란을 선택하세요.', true);
      byId('source-location-checked').focus();
      return;
    }
    const source = Object.fromEntries(sourceFields.map(field => {
      const value = byId('source-' + field).value;
      return [field, field === 'excerpt' ? value : value.trim()];
    }));
    let n = sources.length + 1;
    while (sources.some(s => s.id === 'source-' + n)) n++;
    source.id = editingId || 'source-' + n;
    if (!source.pdfPage) delete source.pdfPage;
    if (sourcePdfHash && source.pdfPage) source.pdfSha256 = sourcePdfHash;
    const linkToRow = event.submitter === byId('source-save-link') && !editingId && sourceForRow && currentRow()?.articleBinding === sourceForRow;
    const rowDraft = linkToRow ? {...drafts.get(currentId), ...decisionDraft()} : null;
    const next = editingId ? sources.map(s => s.id === editingId ? source : s) : [...sources, source];
    try {
      const selectedHash = sourcePdfHash || pdfProposal?.hash;
      if (selectedHash) {
        const selected = workspace.sourceDefaults(source);
        const conflict = sources.find(other => other.pdfSha256 && other.pdfSha256 !== selectedHash &&
          other.version === selected.version && workspace.sourceDefaults(other).url === selected.url);
        if (conflict && !confirm('같은 주소와 판본으로 등록한 ‘' + (conflict.title || conflict.id) +
          '’의 PDF와 이번 파일이 다릅니다. 이 주소에서 두 판본을 직접 대조했고, 지금 입력한 문서 정보로 등록할까요?')) {
          message('source-status', '등록을 보류했습니다. 이번 파일을 받은 주소와 판본을 확인하세요.');
          byId('source-url').focus();
          return;
        }
      }
      // Editing a cited source invalidates the receipts that cite it. Keep the reviewer's
      // input as an unconfirmed draft instead of blanking the sentence.
      const kept = new Set(engine.prepare(article, next, receipts).rows.filter(r => r.receipt || r.priorDecision).map(r => r.id));
      const moved = engine.report(article, sources, receipts).rows.filter(r => (r.receipt || r.priorDecision) && !kept.has(r.id));
      const comparison = !editingId && rubric.restoreDraft(result, sources, articleAssessmentDraft)?.entries.standards;
      sources = next;
      for (const row of moved) drafts.set(row.id, {...draftFrom(drafts.get(row.id) || row.receipt || row.priorDecision), sourceEdit: true});
      receipts = receipts.filter(r => !moved.some(row => row.id === r.rowId));
      if (rowDraft) {
        rowDraft.sourceIds.push(source.id);
        drafts.set(currentId, rowDraft);
      }
      for (const draft of drafts.values()) { draft.acknowledged = false; draft.correctionChecked = false; draft.contentChecked = false; }
      dirty = true;
      clearSourceForm(source);
      refresh(false, comparison && !comparison.previous ? comparison : null);
      if (rowDraft) {
        byId('sources-panel').open = false;
        byId('verdict').focus();
        message('review-status', '새 자료를 이 문장의 대조 자료로 선택했습니다. 발췌문과 판단 범위를 확인한 뒤 기록하세요.');
      }
      message('source-status', moved.length ? '원자료를 저장했습니다. 이 자료를 인용한 판단 ' + moved.length + '개를 다시 확인할 초안으로 옮겼습니다.'
        : '원자료를 저장했습니다. 문장 검토에서 연결할 수 있습니다.');
    } catch (err) { message('source-status', err.message, true); }
  });
  byId('go-add-source').addEventListener('click', () => openSourceTools(false));
  byId('go-find').addEventListener('click', () => openSourceTools(true));
  function useExcerpt(entry, tableLocation = '') {
    const excerpt = byId('source-excerpt'), locator = byId('source-locator');
    const maySetLocation = !locator.value.trim() || (suggestedLocator && locator.value === suggestedLocator);
    const replacingLocation = (maySetLocation || tableLocation) && locator.value !== tableLocation;
    const pageLabel = draftPageLabel();
    const inheritsLocation = !maySetLocation || !!pageLabel;
    if (excerpt.value && (excerpt.value !== entry.text || replacingLocation || inheritsLocation)) {
      const next = maySetLocation
        ? (tableLocation ? '표 위치도 ' + tableLocation + '로 바뀝니다.' : '이전 표의 자동 위치는 비웁니다.')
        : '직접 적은 위치는 유지됩니다. 이 구간과 일치하는지 확인하세요.';
      if (!confirm('선택한 원문으로 발췌문을 바꿀까요? ' + next + (pageLabel ? ' 남아 있는 쪽 지정은 ' + pageLabel + '입니다.' : ''))) return false;
    }
    if (maySetLocation) {
      locator.value = tableLocation;
      suggestedLocator = tableLocation;
    }
    excerpt.value = entry.text;
    sourcePdfHash = '';
    const proposal = window.JournalDocumentFile?.excerptLocation(entry);
    offerPdfLocation(proposal);
    offerDocumentInfo(proposal);
    setLocationReview(inheritsLocation);
    sourceDraftEdited();
    const span = entry.startParagraph && entry.startParagraph !== entry.paragraph
      ? entry.startParagraph + '~' + entry.paragraph : entry.paragraph;
    message('source-status', '붙여넣은 글의 ' + span + '번째 문단' +
      (entry.omitted ? ' 중 선택한 행을 옮겼습니다. […]는 생략한 행입니다. ' : '을 옮겼습니다. ') +
      (tableLocation ? '원본에서 쪽번호와 표 제목·단위를 대조하고 아래 위치를 확인하세요.' :
        '원본의 쪽·표·절 등 다시 찾을 수 있는 위치를 확인해 입력하세요.'));
    dirty = true;
    byId('source-locator').focus();
    return true;
  }
  byId('use-pdf-location').addEventListener('click', () => {
    if (!pdfProposal) return;
    const {first, last, hash, file} = pdfProposal;
    const url = byId('source-url'), locator = byId('source-locator');
    const page = String(first);
    let address, target;
    try {
      address = new URL(url.value);
      target = engine.sourceTarget({url:address.href, pdfPage:page});
      if (!target) throw new Error();
    } catch {
      message('source-status', '이 PDF를 내려받은 문서 주소를 먼저 확인해 입력하세요.', true);
      url.focus();
      return;
    }
    // A direct URL can carry an old page. Keep named document routes intact.
    const fragment = new URLSearchParams(address.hash.slice(1));
    if (target.page && fragment.has('page')) {
      fragment.set('page', page);
      address.hash = fragment.toString();
      url.value = address.href;
    }
    const location = 'PDF ' + first + (first === last ? '' : '~' + last) + '쪽';
    if ((!locator.value.trim() || locator.value === suggestedLocator) &&
        !locator.value.trim().split(' · ').includes(location)) {
      locator.value = [locator.value.trim(), location].filter(Boolean).join(' · ');
      suggestedLocator = locator.value;
    }
    byId('source-pdfPage').value = page;
    sourcePdfHash = hash;
    window.JournalSourceReader.rememberVerifiedPdf(hash, file);
    if (!byId('source-location-review').hidden) setLocationReview(true);
    byId('source-pdf-proposal').hidden = true;
    byId('pdf-source-options').replaceChildren();
    byId('pdf-source-options').hidden = true;
    dirty = true;
    sourceDraftEdited();
    message('source-status', location + '을 입력했습니다. 이 자료를 등록하면 같은 PDF 판본을 다시 대조할 수 있습니다.');
    locator.focus();
  });
  function citationRows(entries) {
    const ordered = [...new Map(entries.filter(Boolean).map(row => [row.paragraph, row])).values()]
      .sort((a, b) => a.paragraph - b.paragraph);
    let previous = ordered[0].paragraph - 1, omitted = false;
    const lines = [];
    for (const row of ordered) {
      if (row.paragraph > previous + 1) { lines.push('[…]'); omitted = true; }
      lines.push(row.text);
      previous = row.paragraph;
    }
    return {text:lines.join('\n'), startParagraph:ordered[0].paragraph, paragraph:previous, omitted};
  }
  function matrixLocation(label, heading, caption) {
    const coordinate = '‘' + label + '’ 행 · ‘' + heading + '’ 열';
    return caption ? caption.text.trim() + ' · ' + coordinate : coordinate;
  }
  function fiscalLocation(cell) {
    const year = cell.heading.includes(cell.year) ? '' : cell.year + '년 · ';
    return year + matrixLocation(cell.rowLabel, cell.heading) + ' (왼쪽에서 ' + cell.column + '번째 열)';
  }
  function matrixBrowser(matrix, header) {
    const details = node('details');
    details.append(node('summary', '원표의 행과 연도 직접 선택'));
    const rowSelect = node('select'), yearSelect = node('select');
    function setup() {
      if (!details.open || rowSelect.length) return;
      const rowLabel = node('label', '원표 행 · ' + matrix.headers[0]), yearLabel = node('label', '연도 열');
      rowLabel.append(rowSelect);
      yearLabel.append(yearSelect);
      for (const [select, options] of [[rowSelect, matrix.rows.map(row => row.label)], [yearSelect, matrix.headers.slice(1)]]) {
        select.append(node('option', '선택하세요'));
        for (const option of options) select.append(node('option', option));
      }
      const preview = node('p');
      preview.setAttribute('aria-live', 'polite');
      const use = button('직접 선택한 행을 발췌문으로 사용', () => {
        const row = matrix.rows[rowSelect.selectedIndex - 1];
        if (row && yearSelect.selectedIndex > 0)
          useExcerpt(citationRows([matrix.caption, matrix.legend, header, row]),
            matrixLocation(row.label, matrix.headers[yearSelect.selectedIndex], matrix.caption));
      });
      use.disabled = true;
      function showSelection() {
        const row = matrix.rows[rowSelect.selectedIndex - 1];
        const column = yearSelect.selectedIndex;
        use.disabled = !row || column < 1;
        if (use.disabled) { preview.textContent = ''; return; }
        const value = row.values[column - 1];
        preview.textContent = '직접 선택한 위치 · ' + matrixLocation(row.label, matrix.headers[column]) +
          ' · ' + (value ? '원문 표기 ' + value : '빈 셀') +
          ' (머리글 ' + matrix.headerParagraph + '문단 · 자료 ' + row.paragraph + '문단 · 왼쪽에서 ' + (column + 1) + '번째 열)';
      }
      rowSelect.addEventListener('change', showSelection);
      yearSelect.addEventListener('change', showSelection);
      details.append(node('p', '원표의 항목과 기간을 골라 인쇄된 값을 확인하세요. 단위와 대상 범위는 원본에서 대조하세요.'));
      if (matrix.caption) details.append(node('p', matrix.caption.text, 'verbatim'));
      if (matrix.legend) details.append(node('p', matrix.legend.text, 'verbatim'));
      details.append(rowLabel, yearLabel, preview, use);
    }
    details.addEventListener('toggle', setup);
    function openAt(rowParagraph, year) {
      details.open = true;
      setup();
      rowSelect.selectedIndex = 1 + matrix.rows.findIndex(row => row.paragraph === rowParagraph);
      yearSelect.selectedIndex = 1 + matrix.years.indexOf(year);
      yearSelect.dispatchEvent(new Event('change'));
      yearSelect.focus();
    }
    return {details, openAt};
  }
  function documentRows(text) {
    const rows = [];
    let page = 0;
    for (const line of text.split(/\r\n|[\n\r\u2028\u2029]/u)) {
      if (line.includes('\f')) page++;
      if (line.trim()) rows.push({paragraph: rows.length + 1, text: line, page});
    }
    return rows;
  }
  function addNearbyRows(details, list, passage, rows, tableLocation, excerpt) {
    const center = rows[passage.paragraph - 1];
    if (!center || center.text !== passage.text) return;
    const nearby = rows.slice(Math.max(0, passage.paragraph - 13), passage.paragraph + 12)
      .filter(row => row.page === center.page);
    const included = new Set([...passage.context, ...nearby].map(row => row.paragraph));
    list.replaceChildren();
    list.className = 'finder-lines';
    let selected = center;
    for (const index of [...included].sort((a, b) => a - b)) {
      const entry = rows[index - 1];
      const item = node('li');
      item.value = index;
      const label = node('label'), radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'finder-line-' + passage.paragraph;
      radio.value = String(index);
      radio.checked = entry === center;
      radio.addEventListener('change', () => { selected = entry; });
      label.append(radio, node('span', (entry === center ? '검색 후보 · ' : '') + entry.text, 'verbatim'));
      item.append(label);
      list.append(item);
    }
    details.insertBefore(node('p', passage.speaker
      ? '다른 화자의 질문과 대답도 함께 표시합니다. 검색 후보를 선택하면 발언자 표지부터 해당 문단까지 옮깁니다.'
      : '후보 앞뒤 최대 12문단과 표 머리글입니다. 발췌할 행을 선택하세요.'), list);
    details.append(button('선택한 행을 발췌문으로 사용', () => {
      if (selected === center) useExcerpt(excerpt, tableLocation);
      else useExcerpt(selected);
    }));
  }
  function clearSearchContext() {
    byId('search-context').value = '';
    byId('search-context-options').open = false;
    const row = currentRow();
    const sameQuery = row && row.text === byId('document-query').value.trim();
    byId('use-article-context').hidden = !sameQuery || !row.context || row.context === row.text;
    const lead = firstArticleLine();
    byId('use-article-title').hidden = !sameQuery || !lead || lead === row.text;
  }
  function firstArticleLine() {
    const lines = article.trim().split(/\r\n|[\n\r\u2028\u2029]/u);
    return lines.length > 1 ? lines[0].trim() : '';
  }
  function searchWithContext(context) {
    const row = currentRow();
    if (!context || row?.text !== byId('document-query').value.trim()) return;
    byId('search-context').value = context;
    if (byId('document-text').value.trim()) findPassages();
  }
  byId('use-article-context').addEventListener('click', () => searchWithContext(currentRow()?.context));
  byId('use-article-title').addEventListener('click', () => searchWithContext(firstArticleLine()));
  function addColumnHints(block, text, query, passage, separateContext, annual) {
    if (passage.datedCell) {
      const cell = passage.datedCell;
      block.append(node('p', '자료 행의 ' + cell.column + '열 · ' + cell.heading + ' · 원문 표기 ' + cell.value));
    }
    const period = window.JournalEvidencePeriod.different(query, passage);
    if (period) {
      block.append(node('p', '질문에 적힌 시점은 ' + period.requested + ', 이 행 첫 칸은 ' + period.source
        + '입니다. 원표에서 기준 시점을 확인하세요.', 'callout'));
    }
    if (passage.matrixNavigation) block.append(node('p', '질문에 적힌 ‘' + passage.matrixNavigation.rowLabel +
      '’ 행입니다. 질문의 세부 조건과 단위는 원표에서 확인하세요.'));
    const columns = !passage.matrixNavigation && window.JournalEvidenceColumns.forRow(text, query, passage);
    if (columns) {
      const values = columns.cells.map(c => c.year + '년 · ' + c.column + '번째 수치 열 ' + c.value);
      block.append(node('p', '연도 머리글(' + columns.headerParagraph + '문단) 기준 · ' + values.join(' / ')));
      if (columns.ambiguousYears.length)
        block.append(node('p', '같은 연도의 열이 여러 개입니다. 원표에서 각 열의 상위 제목과 단위를 확인하세요.', 'callout'));
    }
    const matrix = passage.matrixCell;
    if (matrix) {
      block.append(node('p', matrix.rowLabel + ' 행 · ' + matrix.heading + ' 열 · 원문 값 ' + matrix.value +
        ' (머리글 ' + matrix.headerParagraph + '문단 · 자료 ' + matrix.rowParagraph +
        '문단 · 왼쪽에서 ' + matrix.column + '번째 열)'));
    }
    const metric = !separateContext && annual?.metric;
    if (annual?.scopeIssue === 'period') {
      block.append(node('p', '질문은 한 해의 특정 기간을 묻습니다. 연간 합계와 구별해 그 기간을 따로 집계한 원표를 확인하세요.', 'callout'));
    } else if (annual?.scopeIssue === 'unit') {
      block.append(node('p', '수치의 단위가 서로 다릅니다. 질문·표 머리글·셀에 적힌 단위와 배율을 대조하세요.', 'callout'));
    } else if (separateContext && annual?.metric) {
      block.append(node('p', '추가한 기사 문맥의 조건이 이 표에 적용되는지 확인하세요. 아래에서 해당 연도의 원표 항목을 펼칠 수 있습니다.', 'callout'));
    }
    if (metric) {
      block.append(node('p', metric.year + '년 · ' + metric.heading + ' · 원문 값 ' + metric.value +
        ' (머리글 ' + metric.headerParagraph + '문단 · 자료 ' + metric.rowParagraph +
        '문단 · 왼쪽에서 ' + metric.column + '번째 열)'));
    }
    if (annual) {
      const details = node('details');
      details.append(node('summary', annual.year + '년 원표 항목 ' + annual.cells.length + '개 보기'));
      details.addEventListener('toggle', function showCells() {
        if (!details.open) return;
        details.removeEventListener('toggle', showCells);
        const list = node('ul');
        for (const cell of annual.cells)
          list.append(node('li', cell.column + '열 · ' + cell.heading + ' · ' + cell.value));
        details.append(node('p', '머리글 ' + annual.headerParagraph + '문단 · 자료 ' + annual.rowParagraph + '문단'), list);
      });
      block.append(details);
    }
    const changes = window.JournalEvidenceColumns.changeNote(text, query, passage);
    for (const diff of changes?.comparisons || []) {
      block.append(node('p', '같은 묶음의 ' + diff.prior.year + '년 ' + diff.prior.column + '번째 열은 ' +
        diff.prior.value + ', ' + diff.current.year + '년 ' + diff.current.column + '번째 열은 ' +
        diff.current.value + '입니다. 두 표시값과 괄호 증감이 어긋납니다. 원보고서나 통계표에서 확인하세요.', 'callout'));
    }
  }
  function priorChangeCard(passage) {
    const {previous:earlier, current} = passage.changeRows;
    const location = '‘' + earlier.datedRowLabel + '’·‘' + current.datedRowLabel + '’ 행 · ‘' + earlier.datedCell.heading + '’ 열';
    const excerpt = citationRows([...passage.context, passage]);
    const card = node('div', undefined, 'source');
    card.append(node('strong', earlier.datedCell.heading + ' · 변경 이력'),
      node('p', '표에서 앞선 변경일 ' + earlier.datedRowLabel + ' · 원문 표기 ' + earlier.datedCell.value),
      node('p', '질문의 변경일 ' + current.datedRowLabel + ' · 원문 표기 ' + current.datedCell.value),
      node('blockquote', excerpt.text, 'verbatim'),
      button('머리글과 두 변경일을 발췌', () => useExcerpt(excerpt, location)));
    return card;
  }
  function annualRateCard(passage) {
    const {population, measure, previous, current, change} = passage.annualRate;
    const label = population.replace(/세(이상|이하)/u, '세 $1') + ' ' + measure;
    const location = label + ' 행 · ' + previous.year + '년·' + current.year + '년 열 · 전년대비 증감(%p) 행';
    const card = node('div', undefined, 'source annual-rate');
    card.append(node('strong', label),
      node('p', previous.year + '년 ' + previous.value + '% → ' + current.year + '년 ' + current.value + '%'),
      node('p', current.year + '년 전년 대비 증감 · 원표 표기 ' + change.value + '%p'));
    const calculation = node('details');
    calculation.open = passage.annualRate.requestedUnit === '%';
    calculation.append(node('summary', '두 표시값으로 계산한 상대 변화율'));
    const base = Number(previous.value), end = Number(current.value);
    if (base > 0) {
      const pct = 100 * (end - base) / base;
      const value = Math.abs(pct) > 0 && Math.abs(pct) < 0.005
        ? (pct > 0 ? '0.005% 미만 증가' : '0.005% 미만 감소')
        : '약 ' + pct.toLocaleString('ko-KR', {maximumFractionDigits:2}) + '%';
      calculation.append(node('p', '(' + current.value + ' − ' + previous.value + ') ÷ ' + previous.value +
        ' × 100 = ' + value + '. 원표에 표시된 자릿수로 계산했습니다.'));
    } else calculation.append(node('p', '이전 해의 비율이 0%여서 상대 변화율을 계산할 수 없습니다.'));
    const entries = [...passage.context, passage];
    const snippet = citationRows(entries);
    card.append(calculation, node('p', '붙여넣은 본문에서 발췌할 연도 머리글과 두 행'), node('blockquote', snippet.text, 'verbatim'),
      button('연도 머리글과 두 행을 근거로 사용', () => useExcerpt(snippet, location)));
    return card;
  }
  function findPassages() {
    const text = byId('document-text').value;
    const query = byId('document-query').value.trim();
    const area = byId('finder-results');
    area.replaceChildren();
    if (!text.trim() || !query) return message('finder-status', '원자료 본문과 찾을 표현을 입력하세요.', true);
    const articleContext = byId('search-context').value.trim();
    const separateContext = articleContext && articleContext !== query;
    const lookup = window.JournalEvidenceSearch.search(text, query, {articleContext});
    const passages = lookup.passages;
    let rows;
    const ambiguities = window.JournalEvidenceFinder.tableAmbiguities(text, query);
    const annualRows = new Map();
    if (!lookup.fiscalTable && !lookup.transcript && !lookup.labourScope && !lookup.householdScope && !lookup.wageBasis) {
      for (const p of passages) if (!p.years && !p.annualRate && !p.changeRows && !p.labourYearRows) annualRows.set(p, window.JournalEvidenceColumns.inspectAnnualRow(text, query, p));
    }
    const notices = [];
    if ([...annualRows.values()].some(row => row?.scopeIssue === 'population'))
      notices.push('질문의 대상이나 범위를 이 표의 열에서 확인하기 어렵습니다. 해당 지역·집단·분야를 따로 집계한 자료인지 확인하세요.');
    if (lookup.notice) notices.push(lookup.notice);
    if (lookup.gap) notices.push(lookup.gap);
    if (lookup.state === 'needs-context') {
      const reasons = {
        'record-period':'기사에 적힌 기록 연도와 “몇 년 만”이라는 기간이 서로 맞는지 확인하세요.',
        'comparison-unit':'질문은 수량의 증감을 다루고 추가한 문맥에는 비율이 있습니다. 어느 단위를 비교할지 확인하세요.',
        'no-series':'이 지표와 기간을 함께 비교할 수 있는 연간 표를 확인하지 못했습니다. 자료의 기간과 표 머리글을 확인하세요.'
      };
      notices.push(reasons[lookup.reason] || '비교할 지표와 기간을 특정하기 어렵습니다. 기사 제목이나 앞뒤 문장의 지표·기간을 보충하세요.');
      byId('search-context-options').open = true;
    } else if (lookup.state === 'candidates') {
      notices.push('비교할 기간과 지표가 나타난 표의 행 ' + passages.length + '개를 찾았습니다.' +
        (lookup.usedArticleContext ? ' 입력한 기사 문맥을 함께 사용했습니다.' : ''));
    } else if (lookup.state === 'partial-series') {
      if (lookup.usedArticleContext) notices.push('입력한 기사 문맥을 함께 사용했습니다.');
    } else if (!lookup.gap && !lookup.transcript) {
      notices.push(passages.length ? '확인할 원문 후보 ' + passages.length + '개' : '해당 표현을 찾지 못했습니다. 다른 표현이나 원문의 표와 주석을 확인하세요.');
    }
    if (lookup.needsPublicationDate) notices.push('‘올해’처럼 상대적인 시점은 기사 발행일과 원표의 연도를 대조하세요.');
    if (ambiguities.length) notices.push('같은 번호의 표 제목이 여러 개 있습니다.');
    message('finder-status', notices.join(' '));
    for (const item of ambiguities) {
      const block = node('div', undefined, 'callout');
      block.append(node('strong', '표 ' + item.number + ' · 서로 다른 제목 ' + item.headings.length + '개'));
      const entries = node('ul');
      for (const h of item.headings) {
        entries.append(node('li', '붙여넣은 본문 ' + h.paragraph + '문단 · ' + h.title));
      }
      block.append(entries, node('p', '확인하려는 대상과 기간에 맞는 표를 고르고 원본에서 쪽과 표 제목을 확인하세요.'));
      area.append(block);
    }
    let results = area;
    const sourceRows = () => rows ??= documentRows(text);
    const matrixTable = !lookup.fiscalTable && !lookup.labourScope && lookup.yearMatrix;
    const matrixHeader = matrixTable && sourceRows()[matrixTable.headerParagraph - 1];
    const browser = matrixTable && matrixBrowser(matrixTable, matrixHeader);
    const fallbackCount = passages.filter(passage => !passage.fiscalNavigation).length;
    if (fallbackCount && (lookup.gap || lookup.state === 'needs-context')) {
      results = node('details');
      results.append(node('summary', '표현이 겹친 위치 ' + fallbackCount + '개 보기'));
    }
    for (const passage of passages) {
      if (passage.changeRows || passage.annualRate) {
        const card = passage.changeRows ? priorChangeCard(passage) : annualRateCard(passage);
        window.JournalDocumentFile?.appendPageInfo(card, passage.paragraph);
        results.append(card);
        continue;
      }
      const block = node('div', undefined, 'source');
      const years = passage.labourYearRows;
      const comparisonExcerpt = years && citationRows([...passage.context, passage]);
      if (years) {
        block.append(node('strong', years.previous + '년과 ' + years.current + '년 연간 ' + years.measure),
          node('blockquote', comparisonExcerpt.text, 'verbatim'));
      } else {
        block.append(node('strong', '붙여넣은 본문 ' + passage.paragraph + '문단'), node('blockquote', passage.text));
      }
      if (!lookup.fiscalTable && passage.fiscalStage) block.append(node('p', '찾은 예산 단계 · ' + window.JournalEvidenceFiscal.label(passage.fiscalStage)));
      const speaker = passage.speaker;
      let excerpt = speaker ? {text:speaker.excerpt, paragraph:passage.paragraph, startParagraph:speaker.paragraph} : passage;
      const includeSpeaker = speaker && speaker.paragraph !== passage.paragraph;
      if (speaker) {
        block.append(node('p', '회의록 발언자 · ' + speaker.label + ' (' + speaker.paragraph + '문단)'));
        if (speaker.match === 'adjacent-reply')
          block.append(node('p', '앞사람이 한 발언을 단서로 찾은 답변입니다. ‘주변 원문 확인’에서 누구의 표현인지 대조하세요.', 'callout'));
        else if (speaker.exactQuote === false)
          block.append(node('p', '인용문과 일부 단어가 겹칩니다. 발언의 실제 표현과 수치를 대조하세요.', 'callout'));
      }
      window.JournalDocumentFile?.appendPageInfo(block, passage.paragraph);
      const fiscal = passage.fiscalCell;
      let tableLocation = '';
      if (fiscal) {
        excerpt = citationRows([...passage.context, passage]);
        const coordinate = fiscalLocation(fiscal);
        tableLocation = coordinate + ' · 단위 ' + fiscal.unit;
        block.append(node('p', window.JournalEvidenceFiscal.label(fiscal.stage) + ' · ' + coordinate),
          node('p', '원문 표기 ' + fiscal.value + ' · 단위 ' + fiscal.unit + ' · 머리글 ' + fiscal.headerParagraph + '문단', 'verbatim'),
          node('p', '원본에서 이 표가 실린 쪽과 머리글·단위를 대조하세요.'));
        if (fiscal.amountComparison) {
          const {claimText, claimWon, cellWon, same} = fiscal.amountComparison;
          const won = value => BigInt(value).toLocaleString('ko-KR') + '원';
          const comparison = same
            ? '질문의 ‘' + claimText + '’과 표에 인쇄된 값은 모두 ' + won(cellWon) + '입니다.'
            : '질문의 ‘' + claimText + '’은 ' + won(claimWon) + ', 표에 인쇄된 값은 ' + won(cellWon) + '입니다. 원표의 반올림 자릿수와 주석을 확인하세요.';
          block.append(node('p', comparison, 'amount-comparison'));
        }
        if (fiscal.stage === 'executionRate') {
          block.append(node('p', fiscal.basis ? '원표에 적힌 집행률의 분모 · ' + fiscal.basis :
            '이 열에는 집행률의 분모가 적혀 있지 않습니다. 어떤 예산액을 기준으로 했는지 원표 주석을 확인하세요.'));
        }
      } else if (passage.fiscalNavigation) {
        const guide = passage.fiscalNavigation;
        const coordinate = guide.column ? fiscalLocation(guide) : '‘' + guide.rowLabel + '’ 행';
        const location = [guide.caption, coordinate].filter(Boolean).join(' · ');
        tableLocation = guide.column ? location + ' · 단위 확인 필요' : location;
        block.append(node('p', location));
        if (guide.reserveGroup) {
          excerpt = citationRows([...passage.context, passage]);
          block.append(node('p', '같은 해의 예산·지출결정액·지출액과 표 머리글·단위를 함께 발췌합니다. 필요한 금액 열은 원표에서 확인하세요.'));
        }
        if (guide.column) {
          block.append(node('p', '원문 표기 ' + guide.value + ' · 단위 미확인', 'verbatim'),
            node('p', '머리글 ' + guide.headerParagraph + '문단을 원본과 대조해 이 셀에 적용되는 단위를 확인하세요.'));
        } else if (guide.reason === 'context') {
          block.append(node('p', '이 행이 기사 문맥에서 지정한 범위를 따로 집계하는지 원표에서 확인하세요.'));
        } else if (!guide.reserveGroup) {
          block.append(node('p', '붙여넣은 표에서 이 행의 열을 구분하기 어렵습니다. 원본에서 연도·예산 단계·단위를 대조하세요.'));
        }
      } else if (years) {
        excerpt = comparisonExcerpt;
        tableLocation = passage.context[0].text.trim() + ' · ' + years.previous + '년·' + years.current + '년 연간 행 · ' + years.measure + ' 열';
      } else if (passage.years?.length) {
        const period = passage.years[0] + '~' + passage.years.at(-1) + '년';
        tableLocation = period + ' 연간 증감 행';
        block.append(node('p', '원표에 실린 기간 · ' + period));
        if (passage.yearCoverage) {
          const firstMissing = Math.min(...passage.yearCoverage.missingYears);
          const lastMissing = passage.years[0] - 1;
          const missing = firstMissing === lastMissing ? firstMissing + '년' : firstMissing + '년부터 ' + lastMissing + '년까지';
          const limit = missing + '의 기록은 추가 자료로 확인하세요.';
          block.append(node('p', limit, 'callout'));
          tableLocation += ' · ' + limit;
        }
        excerpt = citationRows([...passage.context, passage]);
      } else if (passage.labourScope) {
        block.append(node('p', '원자료의 기간 · ' + passage.context[0].text.trim()));
        excerpt = citationRows([...passage.context, passage]);
      } else if (passage.wageBasis) {
        block.append(node('p', passage.wageBasis.note, 'callout'));
        if (passage.wageBasis.periodHeading) {
          block.append(node('p', '붙여넣은 본문의 기간 표지 · ' + passage.wageBasis.periodHeading.text.trim()));
          excerpt = citationRows([passage.wageBasis.periodHeading, passage]);
        }
      } else if (!lookup.fiscalTable && !speaker && !lookup.householdScope && !lookup.wageBasis) {
        const annual = annualRows.get(passage);
        addColumnHints(block, text, query, passage, separateContext, annual);
        const metric = !separateContext && annual?.metric;
        if (passage.matrixCell) {
          tableLocation = matrixLocation(passage.matrixCell.rowLabel, passage.matrixCell.heading, matrixTable.caption);
          excerpt = citationRows([matrixTable.caption, matrixTable.legend, matrixHeader, passage]);
        } else if (passage.datedCell) {
          tableLocation = matrixLocation(passage.datedRowLabel, passage.datedCell.heading) +
            ' (붙여넣은 본문 ' + passage.paragraph + '문단 · 자료 행 ' + passage.datedCell.column + '열)';
          excerpt = citationRows([passage.context[0], passage]);
        } else if (metric) {
          tableLocation = matrixLocation(metric.year + '년', metric.heading);
          excerpt = citationRows([sourceRows()[metric.headerParagraph - 1], passage]);
        }
      }
      if (passage.context.length) {
        const details = node('details');
        details.append(node('summary', '주변 원문 확인'));
        const list = node('ol');
        const entries = [...passage.context, passage].sort((a, b) => a.paragraph - b.paragraph);
        for (const entry of entries) {
          const item = node('li');
          item.value = entry.paragraph;
          if (entry === passage) item.append(node('strong', '선택한 문단 '));
          item.append(node('span', entry.text, 'verbatim'));
          list.append(item);
        }
        details.append(list);
        details.addEventListener('toggle', function expand() {
          if (!details.open) return;
          details.removeEventListener('toggle', expand);
          addNearbyRows(details, list, passage, sourceRows(), tableLocation, excerpt);
        });
        block.append(details);
      }
      if (includeSpeaker) {
        const preview = node('details');
        preview.append(node('summary', '발췌할 발언 원문 (' + speaker.paragraph + '~' + passage.paragraph + '문단)'),
          node('blockquote', speaker.excerpt, 'verbatim'));
        block.append(preview);
      }
      if (tableLocation) {
        const label = passage.yearCoverage ? '표에 실린 기간만 발췌' : years ? '두 해의 행과 표 머리글·주석 발췌' :
          passage.fiscalNavigation?.reserveGroup ? '선택한 행과 같은 해의 표 문맥 발췌' :
          fiscal && fiscal.stage !== 'executionRate' ? '금액 행과 표 머리글·단위 발췌' :
          passage.fiscalNavigation ? '이 행을 발췌하고 원표 위치 확인' : '이 행을 발췌하고 표 위치 확인';
        block.append(button(label, () => useExcerpt(excerpt, tableLocation)));
      } else {
        const navigation = passage.matrixNavigation;
        if (browser && navigation) {
          const label = '‘' + navigation.rowLabel + '’ 행의 ' + navigation.year + '년 열 직접 대조';
          block.append(button(label, () => browser.openAt(navigation.rowParagraph, navigation.year)));
        }
        const label = passage.labourScope || passage.wageBasis?.periodHeading ? '기간 표지와 구절을 함께 발췌' :
          includeSpeaker ? '발언자 표지부터 이 문단까지 발췌' : '이 문단을 발췌문으로 사용';
        block.append(button(label, () => useExcerpt(excerpt)));
        if (passage.wrappedOpening && excerpt === passage && !separateContext && !lookup.gap && lookup.state === 'ordinary') {
          const together = citationRows([passage.wrappedOpening, passage]);
          const preview = node('details');
          preview.append(node('summary', '연도와 대상이 적힌 앞 문단 보기 (' + together.startParagraph + '~' + together.paragraph + '문단)'),
            node('blockquote', together.text, 'verbatim'), button('이 두 문단을 함께 발췌', () => useExcerpt(together)));
          block.append(preview);
        }
      }
      (passage.fiscalNavigation ? area : results).append(block);
    }
    if (results !== area) area.append(results);
    if (browser) area.append(browser.details);
  }
  byId('find-passages').addEventListener('click', findPassages);
  for (const id of ['document-text', 'document-query', 'search-context']) byId(id).addEventListener('input', () => {
    if (id === 'document-text') {
      offerPdfLocation(null);
      updateNextSearch();
    }
    if (id === 'document-query') clearSearchContext();
    byId('finder-results').replaceChildren();
    message('finder-status', '');
  });
  byId('source-form').addEventListener('input', event => {
    clearFieldCopy();
    dirty = true;
    const documentField = event.target.id.replace(/^source-/u, '');
    if (documentFields.includes(documentField)) typedDocumentFields.add(documentField);
    if (event.target.id === 'source-excerpt') offerPdfLocation(null);
    if (['source-excerpt','source-url','source-pdfPage'].includes(event.target.id) && sourcePdfHash) {
      sourcePdfHash = '';
      if (pdfProposal) offerPdfLocation(pdfProposal);
      const locator = byId('source-locator');
      if (suggestedLocator && locator.value === suggestedLocator) {
        const parts = suggestedLocator.split(' · ');
        if (/^PDF \d+(?:~\d+)?쪽$/u.test(parts.at(-1))) {
          parts.pop();
          suggestedLocator = locator.value = parts.join(' · ');
        }
      }
      if (event.target.id === 'source-excerpt' && draftPageLabel()) setLocationReview(true);
      message('source-status', '자료 입력이 바뀌어 PDF 판본 연결을 해제했습니다. 원문에서 발췌문과 쪽을 다시 대조하세요.');
    }
    if (event.target.id === 'source-locator') suggestedLocator = '';
    if (event.target.id === 'source-url' && byId('source-pdfPage').value) {
      byId('source-pdfPage').value = '';
      message('source-status', '문서 주소를 바꿨습니다. 새 주소에서 확인한 PDF 쪽번호를 입력하세요.');
    }
    if (!byId('source-location-review').hidden && ['source-url', 'source-version', 'source-pdfPage', 'source-locator', 'source-excerpt'].includes(event.target.id)) {
      setLocationReview(true);
    }
    sourceDraftEdited();
  });
  byId('return-source-draft').addEventListener('click', () => {
    byId('sources-panel').open = true;
    byId('source-' + (editingId ? 'excerpt' : 'title')).focus();
  });
  byId('row-filter').addEventListener('change', () => showQueue());
  byId('source-search').addEventListener('input', filterSources);
  byId('decision-form').addEventListener('input', event => {
    if (event.target.id === 'source-search') return;
    if (event.target.id !== 'acknowledged') byId('acknowledged').checked = false;
    if (['verdict','content-status'].includes(event.target.id)) updateGuidance();
    if (!['content-checked','acknowledged'].includes(event.target.id)) byId('content-checked').checked = false;
    if (!['correction-checked','acknowledged'].includes(event.target.id)) byId('correction-checked').checked = false;
    if (currentId) {
      const previousDraft = drafts.get(currentId);
      drafts.set(currentId, {...decisionDraft(), afterEdit: previousDraft?.afterEdit === true, ...(previousDraft?.sourceEdit ? {sourceEdit: true} : {}),
        ...speechRecovery(previousDraft, previousDraft?.speechRecovery && 'edited')});
      const prior = receipts.find(r => r.rowId === currentId);
      if (!!currentRow().draftPending !== !!workspace.draftChangesRecord(drafts.get(currentId), prior)) refresh(true);
    }
    dirty = true;
  });
  byId('decision-form').addEventListener('submit', event => {
    event.preventDefault();
    const row = currentRow();
    if (!row) return;
    try {
      const findNext = event.submitter === byId('save-find-next') && !byId('save-find-next').hidden;
      const receipt = engine.decide(row, decisionDraft(), sources);
      receipts = receipts.filter(r => r && r.rowId !== row.id).concat(receipt);
      drafts.delete(row.id);
      const savedIndex = result.rows.indexOf(row);
      const remaining = [...result.rows.slice(savedIndex + 1), ...result.rows.slice(0, savedIndex)].filter(isOpen);
      const pending = remaining.find(candidate => candidate.status === 'pending');
      const changed = workspace.draftChangesRecord(receipt, row.receipt || undefined);
      const next = pending || (changed ? remaining[0] : null);
      currentId = next?.id || row.id;
      dirty = true;
      refresh();
      message('review-status', (savedIndex + 1) + '번 문장에 ‘' + labels[receipt.status] + '’ 판단을 기록했습니다.');
      if (studyFrame && studyNonce) {
        studyReply('journal-study-used', {status: receipt.status, sourceIds: receipt.sourceIds, reason: receipt.reason});
      }
      if (findNext && pending && currentId === pending.id && byId('document-text').value.trim() && !editingId && !sourceDraftIsDirty()) {
        openSourceTools(true);
      } else {
        (currentId ? byId('row-heading') : byId('row-filter')).focus();
      }
    } catch (err) { message('review-status', err.message, true); }
  });
  function sourceFormData() {
    return Object.fromEntries(sourceFields.map(k => [k, byId('source-' + k).value]));
  }
  function currentWork() {
    const rowDrafts = [...drafts].map(([rowId, data]) => ({rowId, data: {...data, acknowledged: false, correctionChecked: false, contentChecked: false}}));
    return {
      format: schema, article: hasCommittedArticle ? article : '', sources, receipts, demo, articleAssessment, articleAssessmentDraft, articleDraft: currentArticleDraft(),
      rowFilter: byId('row-filter').value,
      ...(blindReview ? {blindReview} : {}),
      rowDrafts, currentId, sourceDraft: {id: editingId, prefillId, fields: sourceFormData(),
        ...(prefillId && typedDocumentFields.size && {typedDocumentFields:[...typedDocumentFields]}),
        ...(sourcePdfHash ? {pdfSha256:sourcePdfHash} : {}),
        ...(suggestedLocator ? {suggestedLocator} : {}),
        ...(!byId('source-location-review').hidden ? {locationReview: byId('source-location-checked').checked ? 'confirmed' : 'pending'} : {}),
        ...(sourceDraftIsDirty() ? {targetBinding: sourceForRow, panelOpen: byId('sources-panel').open} : {})}
    };
  }
  function exportWork() {
    if (!hasWork()) return message('file-status', '저장할 기사를 먼저 입력하세요.', true);
    try {
      const name = blindReview ? 'journal-work-' + blindReview.pairId + '-' + blindReview.slot + '.json' : 'journal-factcheck-work.json';
      download(JSON.stringify(currentWork(), null, 2), name, 'application/json');
      message('file-status', '작업 파일 내려받기를 요청했습니다. 닫기 전에 파일이 저장됐는지 확인하세요.');
    } catch (err) { message('file-status', '작업 파일을 만들 수 없습니다. ' + err.message, true); }
  }
  function exportReviewInput() {
    if (!result?.rows.length || !articleIsCommitted()) {
      return message('file-status', '현재 기사로 검토 목록을 만든 뒤 독립 평가용 파일을 저장하세요.', true);
    }
    try {
      const packet = workspace.independentInput(currentWork());
      download(JSON.stringify(packet, null, 2), 'journal-independent-review.json', 'application/json');
      message('file-status', '독립 평가용 파일 내려받기를 요청했습니다. 두 편집자는 이 파일을 각자 열고 평가한 뒤 작업 파일을 저장하세요.');
    } catch (err) { message('file-status', '독립 평가용 파일을 만들 수 없습니다. ' + err.message, true); }
  }
  function restoreWork(w) {
    workspace.validateWork(w);
    // Ask explicitly before applying any receipt from a file. A structurally valid record does not identify its author.
    if (!canReplace()) return;
    const hasReviewWork = w.receipts.length > 0 || w.rowDrafts.length > 0 || w.articleAssessment != null ||
      w.articleAssessmentDraft != null || (w.article.trim() && w.articleDraft !== w.article) || workspace.hasSourceDraft(w);
    const trust = !hasReviewWork || confirm('본인이나 신뢰하는 편집자가 저장한 작업을 이어갈까요? 확인을 누르면 작성 중인 기사·원자료와 판단 기록을 복원합니다. 독립적으로 검토하려면 취소를 누르세요. 확정한 기사와 등록된 원자료만 엽니다.');
    const text = w.article || w.articleDraft;
    let keep = trust ? w.receipts.filter(r => r && typeof r.rowId === 'string') : [];
    const checked = engine.prepare(text, w.sources, keep);
    const blindFile = Object.hasOwn(w, 'blindReview');
    const tag = w.article.trim() ? workspace.blindTag(w.blindReview) : null;
    // A returned blind file may carry extra metadata on evidence, decisions or drafts.
    // Restore only the fields understood by the editor, including for a malformed tag.
    const catalog = blindFile || !trust ? w.sources.map(workspace.sourceInput) : w.sources;
    // Recover attribution inputs as drafts. A superseded content verdict cannot be exported as a receipt.
    const attributionDrafts = checked.rows.filter(row => row.attributionDraft);
    if (blindFile) keep = checked.rows.map(row => row.receipt || row.priorDecision).filter(Boolean);
    else {
      const migrated = new Set(attributionDrafts.map(row => row.id));
      keep = keep.filter(receipt => !migrated.has(receipt.rowId));
    }
    resetWork(text, catalog, keep, w.demo || catalog.some(isMock), tag, !!w.article.trim());
    if (trust) {
      const validIds = new Set(result.rows.map(r => r.id));
      drafts = new Map(w.rowDrafts.filter(d => validIds.has(d.rowId)).map(({rowId, data}) => {
        const restored = blindFile ? {...draftFrom(data, data.afterEdit === true), sourceEdit: data.sourceEdit === true, ...speechRecovery(data)}
          : {...data, acknowledged: false, correctionChecked: false, contentChecked: false};
        return [rowId, restored];
      }));
      const previous = new Map(w.receipts.filter(Boolean).map(receipt => [receipt.rowId, receipt]));
      for (const row of attributionDrafts) {
        const draft = drafts.get(row.id);
        const old = previous.get(row.id);
        // Keep the editor's unfinished replacement. A cached copy of the obsolete content
        // decision still needs clearing, even when the editor changed just the attribution reason.
        const notice = {speechCatalogChanged:old.binding !== row.binding};
        if (draft && (draft.status !== 'attribution' || workspace.draftChangesRecord(
          {...draft, afterEdit:false, reason:old.reason, sourceIds:old.sourceIds}, old))) {
          drafts.set(row.id, {...draft, ...speechRecovery(notice,'edited')});
          continue;
        }
        const attribution = draft || row.attributionDraft;
        drafts.set(row.id, {...draftFrom({status:'attribution', reason:attribution.reason, sourceIds:attribution.sourceIds}, false), ...speechRecovery(notice,'attribution')});
      }
      currentId = validIds.has(w.currentId) ? w.currentId : null;
      const selected = currentRow();
      // Older work files saved the row but not the filter. A completed row
      // could only be selected in the full list unless an open draft hid its receipt.
      const legacyAll = w.rowFilter === undefined && selected && !isOpen(selected) &&
        !workspace.draftChangesRecord(drafts.get(selected.id), selected.receipt);
      byId('row-filter').value = w.rowFilter === 'all' || legacyAll ? 'all' : 'open';
      const prefill = sources.find(s => s.id === w.sourceDraft.prefillId);
      clearSourceForm(prefill);
      if (prefill && Array.isArray(w.sourceDraft.typedDocumentFields)) {
        for (const key of documentFields) if (w.sourceDraft.typedDocumentFields.includes(key)) typedDocumentFields.add(key);
      }
      const edit = sources.find(s => s.id === w.sourceDraft.id);
      if (edit) {
        editingId = edit.id;
        byId('source-cancel').hidden = false;
        byId('source-form-title').textContent = '원자료 수정';
        byId('source-save').textContent = '수정 적용';
      }
      for (const field of sourceFields) byId('source-' + field).value = w.sourceDraft.fields[field] || '';
      sourcePdfHash = w.sourceDraft.pdfSha256 || '';
      if (w.sourceDraft.suggestedLocator === byId('source-locator').value)
        suggestedLocator = byId('source-locator').value;
      if (['pending', 'confirmed'].includes(w.sourceDraft.locationReview))
        setLocationReview(true, w.sourceDraft.locationReview === 'confirmed');
      refresh();
      const target = currentRow();
      if (w.article === w.articleDraft && sourceDraftIsDirty()) {
        const sameTarget = target && target.id === w.currentId && target.articleBinding === w.sourceDraft.targetBinding && w.sourceDraft.id == null;
        if (sameTarget) targetSourceTo(target);
        else if (target?.id === w.currentId && w.sourceDraft.id == null &&
                 result.rows.some(row => row.articleBinding === w.sourceDraft.targetBinding)) {
          // Preserve a parked draft's original sentence without offering it on the selected one.
          sourceForRow = w.sourceDraft.targetBinding;
        }
        const catalogDraft = w.sourceDraft.targetBinding === null && (w.sourceDraft.id == null || edit);
        byId('sources-panel').open = w.sourceDraft.panelOpen === true && !!(sameTarget || catalogDraft);
      }
      setArticleDraft(w.articleDraft);
      showBlindNotice();
      if (!articleIsCommitted()) {
        byId('article-panel').open = true;
        byId('workspace').hidden = true;
      }
    }
    const reviewed = workspace.review(result, sources, trust ? w.articleAssessment : null,
      trust ? w.articleAssessmentDraft : null);
    articleAssessment = reviewed.assessment.saved;
    articleAssessmentDraft = reviewed.draft;
    const dropped = reviewed.dropped;
    // A sentence edit can temporarily hide its saved judgment. Restore only rubric
    // records validated against the underlying committed sentences; the active
    // report continues to exclude them until the corresponding edit is reverted.
    if (trust && dropped && drafts.size && (w.articleAssessment || w.articleAssessmentDraft)) {
      const committed = workspace.review(engine.report(article, sources, keep), sources,
        w.articleAssessment, w.articleAssessmentDraft);
      if (reviewed.assessment.stale && Object.keys(committed.assessment.saved?.ratings || {}).length) {
        articleAssessment = committed.assessment.saved;
      }
      articleAssessmentDraft ??= committed.draft;
    }
    renderArticleAssessment();
    dirty = false;
    if (trust && dropped) {
      message('file-status', '작업 파일을 열었습니다. 현재 원문·근거·판정과 대조되지 않는 기사 평가 또는 초안은 현재 결과에서 제외했습니다.');
      return;
    }
    const restoredCount = result.rows.filter(row => row.receipt).length;
    message('file-status', trust ? '작업 파일을 열었습니다. 확정한 기사와 등록된 원자료에 연결된 문장 판단은 ' + restoredCount + '건입니다.'
      : '기사와 원자료를 열었습니다. 각 문장을 새로 검토하세요.');
  }
  byId('save-review-input').addEventListener('click', exportReviewInput);
  byId('save-work').addEventListener('click', exportWork);
  byId('load-work').addEventListener('click', () => byId('import-file').click());
  byId('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const request = ++latestImport;
    try {
      const raw = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('선택한 파일을 읽을 수 없습니다.'));
        reader.readAsText(file);
      });
      if (request === latestImport) restoreWork(JSON.parse(raw));
    } catch (err) {
      if (request === latestImport) message('file-status', '파일을 열지 못했습니다. ' + err.message, true);
    }
  });
  function reportExcerpt(text, excerpt, includeArticle, scope = '구간 안') {
    if (includeArticle) return excerpt;
    const start = text.indexOf(excerpt);
    if (start < 0 || start !== text.lastIndexOf(excerpt)) return scope + ' 위치를 하나로 특정할 수 없음';
    const first = Array.from(text.slice(0, start)).length + 1;
    return scope + ' ' + first + '번째~' + (first + Array.from(excerpt).length - 1) + '번째 글자';
  }
  function articleRangesForShare() {
    // The engine emits non-overlapping occurrences in article order, including adjacent duplicates.
    let offset = 0, characters = 0;
    function countTo(end) {
      while (offset < end) {
        offset += article.codePointAt(offset) > 0xffff ? 2 : 1;
        characters++;
      }
      return characters;
    }
    return result.rows.map(row => row.positions.map(({start, end}) => (countTo(start) + 1) + '~' + countTo(end)).join(', '));
  }
  function rubricReportLines(includeArticle) {
    const {accuracy: a, bias: b, stale} = rubric.evaluate(result, sources, articleAssessment);
    const percent = value => value == null ? '산출 대기' : Number(value.toFixed(1)) + '%';
    const label = id => result.rows.find(row => row.id === id)?.text;
    const location = id => {
      const index = result.rows.findIndex(row => row.id === id);
      if (index < 0) return '';
      const row = result.rows[index];
      if (!includeArticle && row.positions.length > 1) return ' · 구간 ' + (index + 1) + ' (원문 ' + row.positions.length + '곳)';
      const starts = row.positions.map(p => p.start + 1);
      return ' · 구간 ' + (index + 1) + (starts.length > 1 ? ' (원문 시작 위치 ' + starts.join(', ') + ')' : '');
    };
    const lines = ['기사 평가 · ' + rubric.version, '사실 정확성',
      '판정한 구간 중 근거 일치율 ' + percent(a.accuracyPct) + ' (' + a.supported + '/' + a.adjudicated + ')',
      '검증 범위 ' + percent(a.coveragePct) + ' (' + a.reviewed + '/' + a.total + ')',
      '근거 지지 ' + a.supported + ' · 반박 ' + a.contradicted + ' · 인용 속 사실 주장 충돌 ' + a.quotedConflict + ' · 미결 ' + a.unresolved + ' · 의견 제외 ' + a.excluded,
      a.summary];
    if (!a.coreRowIds.length) lines.push('핵심 구절 미지정');
    for (const id of a.coreRowIds) {
      const row = a.rows.find(item => item.rowId === id);
      lines.push('핵심 구절 · ' + row.label + (includeArticle ? ' · ' + label(id) : location(id)));
    }
    lines.push('', '편향 · ' + b.summary, '근거로 평가 ' + b.assessed + '/4 · 해당 없음 ' + b.notApplicable + ' · 미평가 ' + b.unknown);
    const draft = rubricUI.restoreDraft(result, sources, articleAssessmentDraft);
    for (const item of b.items) {
      const r = item.rating;
      if (!r) { lines.push(item.title + ' · ' + (draft?.entries[item.id] ? '작성 중 · 미평가' : '미평가')); continue; }
      if (r.level === 'na') { lines.push(item.title + ' · 해당 없음 · ' + r.reason); continue; }
      const source = sources.find(s => s.id === r.sourceId);
      lines.push(item.title + ' · ' + r.level + '단계 · ' + rubric.severityLabels[r.level],
        '기사 구절' + location(r.rowId) + ' · ' + reportExcerpt(label(r.rowId), r.quote, includeArticle));
      if (r.compareQuote) {
        // Older ratings can bind their second excerpt to a unique position in the whole article.
        const compared = label(r.compareRowId);
        lines.push('비교 구절' + location(r.compareRowId) + ' · ' + reportExcerpt(compared ?? result.article, r.compareQuote, includeArticle, compared ? '구간 안' : '기사 원문'));
      }
      lines.push('원자료 · ' + sourceSummary(source), citationAddress(source), '자료 구절 · ' + r.sourceQuote, '판단 이유 · ' + r.reason);
      if (source.originUrl) lines.push('최초 원문 · ' + source.originUrl);
      if (r.compareSourceId) {
        const other = sources.find(s => s.id === r.compareSourceId);
        lines.push('둘째 구절의 원자료 · ' + sourceSummary(other), citationAddress(other), '둘째 자료 구절 · ' + r.compareSourceQuote);
        if (other.originUrl) lines.push('둘째 자료 최초 원문 · ' + other.originUrl);
      }
      if (r.impact) lines.push('독자가 다르게 받아들일 내용 · ' + r.impact);
      if (r.direction) lines.push('검토자가 기록한 영향 방향 · ' + r.direction);
    }
    if (stale) lines.push('현재 자료와 대조되지 않는 이전 평가는 제외했습니다.');
    lines.push('');
    return lines;
  }
  function exportReport(includeArticle) {
    const rawUrl = byId('share-article-url').value.trim();
    const shareHeader = [];
    if (!includeArticle) {
      shareHeader.push('공유본 · 기사 본문 생략. 편집자의 판단 이유·수정 문구와 원자료 발췌는 그대로 실었습니다.',
        '원문 위치는 입력한 기사 전체에서, 구간 안 위치는 해당 검토 구간에서 셉니다. 첫 글자를 1로 잡고 공백과 줄바꿈도 셉니다(유니코드 코드 포인트 기준).');
      if (rawUrl) {
        try {
          const url = new URL(rawUrl);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
          shareHeader.push('기사 원문 · ' + url.href);
        } catch (_) {
          byId('share-article-url').focus();
          return message('result-status', '계정 정보가 없는 HTTP 또는 HTTPS 기사 주소를 입력하세요.', true);
        }
      }
    }
    const sourceNote = sourceDraftNote();
    const lines = ['기사 팩트체크 검토 결과', demo ? '연습 기록 · 가상 기사 또는 모의 원자료 포함' : '검토자가 입력한 판단 기록',
      ...shareHeader, resultScope(), ...(sourceNote ? [sourceNote] : []), coverageLimit, byId('counts').textContent, statusCounts().join(' · '), '', ...rubricReportLines(includeArticle)];
    const ranges = includeArticle ? null : articleRangesForShare();
    for (const [i, row] of result.rows.entries()) {
      lines.push((i + 1) + '. ' + rowLabel(row) + (row.positions.length > 1 ? ' · 원문 ' + row.positions.length + '곳' : ''));
      if (includeArticle) lines.push(row.text);
      else lines.push('원문 글자 위치 · ' + ranges[i]);
      const r = row.receipt;
      if (!r && row.reviewNote) lines.push(row.reviewNote);
      if (r) {
        const excerpt = value => reportExcerpt(row.text, value, includeArticle);
        if (['mixed','partial'].includes(r.status)) lines.push('사실 구절 · ' + excerpt(r.factSpan));
        if (r.status === 'mixed') lines.push('평가 구절 · ' + excerpt(r.opinionSpan));
        if (r.status === 'partial') lines.push('남은 구절 · ' + r.remainingSpans.map(excerpt).join(' / '));
        if (r.status === 'attribution') {
          lines.push('발언 내용 · ' + contentLabels[r.contentStatus]);
          if (r.contentClaim) lines.push('내용을 대조한 인용 구간 · ' + excerpt(r.contentClaim));
          if (r.contentReason) lines.push('내용 판단 이유 · ' + r.contentReason);
        }
        if (r.correction) lines.push('근거와 대조한 수정 문구 · ' + r.correction);
        lines.push('판단 이유 · ' + r.reason, '기록 시각 · ' + r.recordedAt);
        for (const id of [...r.sourceIds, ...(r.contentSourceIds || [])]) {
          const source = sources.find(s => s.id === id);
          const prefix = r.status === 'attribution' ? (r.contentSourceIds?.includes(id) ? '내용 근거 · ' : '원발언 · ') : '근거 · ';
          lines.push(prefix + sourceSummary(source), citationAddress(source), includeArticle ? source.excerpt : '원자료 발췌 · ' + source.excerpt);
          if (source.originUrl) lines.push('최초 원문 · ' + source.originUrl);
        }
      }
      lines.push('');
    }
    if (includeArticle) lines.push('검토 대상 원문', article);
    try {
      download(lines.join('\n'), includeArticle ? 'journal-factcheck-result.txt' : 'journal-factcheck-share.txt', 'text/plain;charset=utf-8');
      message('result-status', includeArticle ? '검토 결과 내려받기를 요청했습니다.' : '기사 본문을 뺀 공유본 내려받기를 요청했습니다.');
    } catch (err) { message('result-status', err.message, true); }
  }
  byId('export-report').addEventListener('click', () => exportReport(true));
  byId('export-share-report').addEventListener('click', () => exportReport(false));
  if (studyFrame) {
    document.documentElement.classList.add('study-frame');
    function receiveTask(task) {
      if (!task || task.type !== 'journal-study-task' || typeof task.nonce !== 'string' || !task.nonce) return;
      if (studyKitMeta ? !studyKit || !studyPort || task.kitVersion !== studyKit : task.kitVersion != null) return;
      if (studyNonce === task.nonce) {
        studyReply('journal-study-loaded');
        return;
      }
      if (typeof task.article !== 'string' || !task.article.trim() || !Array.isArray(task.sources)) return;
      try {
        engine.prepare(task.article, task.sources, []);
        resetWork(task.article, task.sources, [], true);
        studyNonce = task.nonce;
        dirty = false;
        studyReply('journal-study-loaded');
      } catch (_) {
        studyReply('journal-study-error', {nonce:task.nonce});
      }
    }
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.origin !== expectedMessageOrigin) return;
      const request = event.data;
      if (request?.type === 'journal-study-identify' && typeof request.challenge === 'string' && request.challenge) {
        const ready = {type:'journal-study-ready', kitVersion:studyKit, challenge:request.challenge};
        studyPort?.close(); studyPort = null;
        if (!studyKit || !window.MessageChannel) return window.parent.postMessage(ready, parentOrigin);
        // The port belongs to this document. Navigation reuses the frame's WindowProxy.
        const channel = new MessageChannel();
        studyPort = channel.port1;
        const port = studyPort;
        port.onmessage = message => { if (studyPort === port) receiveTask(message.data); };
        window.parent.postMessage(ready, parentOrigin, [channel.port2]);
      } else if (!studyKitMeta) receiveTask(request);
      else if (request?.type === 'journal-study-task' && typeof request.nonce === 'string') {
        window.parent.postMessage({type:'journal-study-error', nonce:request.nonce}, parentOrigin);
      }
    });
    window.addEventListener('pagehide', () => {
      if (studyPort) {
        studyReply('journal-study-closing');
        studyPort.close(); studyPort = null;
      }
    });
    studyReply('journal-study-ready', {kitVersion:studyKit});
  }
  window.addEventListener('beforeunload', event => {
    if (dirty && !studyFrame) { event.preventDefault(); event.returnValue = ''; }
  });
})();
