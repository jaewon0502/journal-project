(() => {
  'use strict';
  const engine = window.JournalFactcheck;
  const byId = id => document.getElementById(id);
  const labels = {
    partial: '일부 확인 · 나머지 보류', pending: '미검토', fact: '사실 확인', attribution: '발언 귀속 확인',
    opinion: '의견·가치판단', mixed: '사실과 평가 분리', held: '판단 보류', contradicted: '원자료와 충돌'
  };
  const coverageLimit = '기사에서 빠진 관점과 취재 대상 선정은 별도 검토가 필요합니다. 정당·인물을 바꿔도 같은 기준을 적용하고, 제목·통계의 기간과 분모·전재 기사의 최초 출처를 확인하세요.';
  const contentLabels = {unverified: '내용 미확인', opinion: '의견·전망', supported: '별도 원자료로 사실 확인'};
  const guidance = {
    partial: '확인한 사실 구절을 표시하고, 남은 주장을 판단하려면 어떤 자료가 필요한지 적으세요.',
    fact: '문장에 담긴 주체, 수치, 시점, 조건과 비교 기준을 모두 확인하세요.',
    attribution: '누가 무엇을 언제 말했는지 확인합니다. 인용 속 의혹이나 전망의 사실 여부는 별도 검토가 필요합니다.',
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
  const schema = 'journal-local-factcheck-v1';
  let article = '', sources = [], receipts = [], demo = false, result = null;
  let currentId = null, editingId = null, dirty = false;
  let drafts = new Map();
  let articleAssessment = null, articleAssessmentDraft = null;
  const rubric = window.JournalArticleRubric, rubricUI = window.JournalArticleRubricUI;
  const studyFrame = window !== window.parent && new URLSearchParams(location.search).get('study') === '1';
  let studyNonce = null;
  // Local file pages have opaque origins. Only the actual parent frame receives replies.
  const localFile = location.protocol === 'file:';
  const expectedMessageOrigin = localFile ? 'null' : location.origin;
  const parentOrigin = localFile ? '*' : location.origin;
  function studyReply(type, fields = {}) {
    window.parent.postMessage({type, nonce: studyNonce, ...fields}, parentOrigin);
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
    if (result.attributedCount) summary.push('발언 내용 중 미확인 ' + result.contentUnverifiedCount + '개 · 의견/전망 ' + result.contentOpinionCount + '개 · 별도 근거 확인 ' + result.contentSupportedCount + '개');
    return summary;
  }
  function isMock(source) {
    return [source.url, source.originUrl].filter(Boolean).some(value => {
      try { return /(?:^|\.)invalid$/i.test(new URL(value).hostname.replace(/\.$/, '')); } catch { return false; }
    });
  }
  function sourceSummary(s) {
    return [s.title || s.id, s.version, s.locator].join(' · ');
  }
  function sourceLink(source) {
    if (isMock(source)) return node('small', '화면에 제공된 모의 원자료');
    const a = node('a', '원자료 열기 ↗');
    a.href = source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  function sourceDetails(source) {
    const section = node('div', undefined, 'source');
    section.append(node('p', sourceSummary(source), 'meta'), sourceLink(source), node('blockquote', source.excerpt));
    if (source.originUrl) section.append(node('p', '최초 원문 · ' + source.originUrl, 'meta'));
    return section;
  }
  function showSources() {
    const catalog = byId('source-list');
    catalog.replaceChildren();
    byId('source-count').textContent = '· ' + sources.length + '개';
    for (const source of sources) {
      const part = node('details', undefined, 'source');
      part.append(node('summary', source.title || source.id), sourceDetails(source));
      part.append(button('자료 수정', () => {
        if (sourceDraftIsDirty() && !confirm('입력 중인 자료를 비우고 이 자료를 수정할까요?')) return;
        editingId = source.id;
        for (const field of sourceFields) byId('source-' + field).value = source[field] || '';
        byId('source-form-title').textContent = '원자료 수정';
        byId('source-save').textContent = '수정 적용';
        byId('source-cancel').hidden = false;
        byId('source-title').focus();
      }));
      catalog.append(part);
    }
  }
  const sourceFields = ['title', 'url', 'locator', 'excerpt', 'version', 'originUrl'];
  let sourceBaseline = {};
  function sourceDraftIsDirty() {
    const original = sources.find(source => source.id === editingId) || sourceBaseline;
    return sourceFields.some(field => byId('source-' + field).value !== (original[field] || ''));
  }
  function clearSourceForm(reuse = {}) {
    editingId = null;
    sourceBaseline = {title: reuse.title || '', url: reuse.url || '', version: reuse.version || '', originUrl: reuse.originUrl || ''};
    byId('source-form').reset();
    for (const [field, value] of Object.entries(sourceBaseline)) byId('source-' + field).value = value;
    byId('source-form-title').textContent = '원자료 추가';
    byId('source-save').textContent = '자료 추가';
    byId('source-cancel').hidden = true;
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
    byId('content-sources-part').hidden = content !== 'supported';
    byId('content-ack').textContent = content === 'opinion' ? '발언에 추가로 확인해야 할 사실 주장이 없는 의견·전망임을 확인했습니다.' : '원발언과 독립된 원자료를 직접 대조해 발언 안의 사실 주장을 확인했습니다.';
    byId('mixed-parts').hidden = !['partial', 'mixed'].includes(status);
    byId('opinion-part').hidden = status !== 'mixed';
    byId('verdict-help').textContent = guidance[status] || '정치적 표현을 만났다면 사실 주장, 발언의 귀속, 글쓴이의 평가를 구분하세요.';
    byId('ack-text').textContent = attestations[status] || '문장의 범위와 판단 이유를 확인했습니다.';
  }
  function showSourceChoices(row, selectedIds) {
    const area = byId('row-sources');
    area.replaceChildren();
    if (!sources.length) area.append(node('p', '연결할 원자료를 먼저 추가하세요.', 'hint'));
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
      label.append(check, node('span', source.title || source.id));
      if (suggested.has(source.id)) label.append(node('span', '대조 후보', 'badge'));
      const details = node('details');
      details.open = source.id === row.sourceIds[0];
      details.append(node('summary', source.locator), sourceDetails(source));
      if (matches.has(source.id)) details.append(node('small', matches.get(source.id)));
      part.append(label, details);
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
  function showCase() {
    const row = currentRow();
    byId('case').hidden = !row;
    if (!row) return;
    const index = result.rows.indexOf(row);
    byId('row-heading').textContent = '문장 ' + (index + 1) + ' · ' + rowLabel(row) + (row.positions.length > 1 ? ' · 연속 반복 ' + row.positions.length + '곳' : '');
    byId('row-text').textContent = row.text;
    byId('row-context').textContent = row.context || row.text;
    byId('document-query').value = row.text;
    byId('finder-results').replaceChildren();
    message('finder-status', '');
    byId('row-hints').replaceChildren(...row.hints.map(hint => node('li', hint)));
    byId('prior-note').textContent = row.reviewNote || (row.receipt ? '같은 원문과 원자료로 기록한 기존 판단입니다. 변경하려면 새로 확인해 기록하세요.' : '');
    const savedDraft = drafts.get(row.id);
    const values = savedDraft || row.receipt || row.priorDecision || {};
    if (row.priorDecision && !row.receipt) byId('prior-note').textContent = '이전 판단을 초안으로 불러왔습니다. 원문과 인용한 자료는 같지만 자료 목록이 달라졌습니다. 추가 근거나 반증을 확인한 뒤 다시 기록하세요.';
    if (savedDraft?.afterEdit) byId('prior-note').textContent = savedDraft.sourceEdit
      ? '인용한 원자료를 수정해 이전 판단을 초안으로 옮겼습니다. 수정한 자료를 다시 대조한 뒤 기록하세요.'
      : '원문 수정 전의 판단을 초안으로 옮겼습니다. 이 구간과 주변 문맥은 같으며, 현재 기사를 대조한 뒤 다시 기록해야 합니다.';
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
      details.append(node('summary', '근거 위치와 발췌 보기'), sourceDetails(s));
      item.append(label, details);
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
  function showQueue(focus = false, keepForm = false) {
    const previousId = currentId;
    const list = byId('row-list');
    list.replaceChildren();
    const visible = result.rows.filter(row => byId('row-filter').value === 'all' || isOpen(row));
    if (!visible.some(row => row.id === currentId)) currentId = visible[0]?.id || null;
    for (const row of visible) {
      const index = result.rows.indexOf(row);
      const item = node('li');
      const pick = button('', () => {
        currentId = row.id;
        showQueue(true);
      });
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
      byId('prior-note').textContent = row.reviewNote;
    }
    if (focus && currentId) byId('row-heading').focus();
  }
  function resultScope() {
    return result.complete ? '입력한 문장마다 검토 범위를 기록했습니다. 사실로 확인한 내용은 아래에 구절과 근거를 표시합니다.'
      : '미검토·부분 확인·보류·원자료와 충돌 중 추가로 확인할 문장이 남아 있습니다. 해당 문장은 추가 취재 또는 수정이 필요합니다.';
  }
  function showReport() {
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
          if (r.contentReason) part.append(node('p', r.contentReason, 'hint'));
        }
        if (r.correction) part.append(node('p', '근거와 대조한 수정 문구 · ' + r.correction));
        part.append(node('p', r.reason, 'hint'), node('small', '기록 시각 · ' + r.recordedAt));
        for (const id of [...r.sourceIds, ...(r.contentSourceIds || [])]) {
          const s = sources.find(source => source.id === id);
          const detail = node('details');
          const prefix = r.status === 'attribution' ? (r.contentSourceIds?.includes(id) ? '내용 근거 · ' : '원발언 · ') : '';
          detail.append(node('summary', prefix + sourceSummary(s)), sourceDetails(s));
          part.append(detail);
        }
      }
      rows.append(part);
    }
  }
  function decisionKey(d = {}) {
    const content = [d.status || '', d.reason || '', [...(d.sourceIds || [])].sort()];
    if (['partial','mixed'].includes(d.status)) content.push(d.factSpan || '');
    if (d.status === 'mixed') content.push(d.opinionSpan || '');
    if (d.status === 'contradicted') content.push(d.correction || '');
    if (d.status === 'attribution') content.push(d.contentStatus || 'unverified', d.contentReason || '', [...(d.contentSourceIds || [])].sort());
    return JSON.stringify(content);
  }
  function draftChangesRecord(id, previous) {
    const draft = drafts.get(id);
    return !!draft && (draft.afterEdit || decisionKey(draft) !== decisionKey(previous));
  }
  function refresh(keepForm = false) {
    const priorRecords = new Map(receipts.map(r => [r.rowId, r]));
    const active = receipts.filter(r => !draftChangesRecord(r.rowId, r));
    result = engine.report(article, sources, active);
    demo = demo || sources.some(isMock);
    for (const row of result.rows) {
      row.draftPending = draftChangesRecord(row.id, priorRecords.get(row.id));
      if (row.draftPending) row.reviewNote = '판단을 작성하고 있습니다. 기록하기 전까지 확인한 결과에서 제외합니다.';
    }
    byId('workspace').hidden = false;
    byId('demo-notice').hidden = !demo;
    byId('new-work').hidden = false;
    const occurrences = result.rows.reduce((n, row) => n + row.positions.length, 0);
    byId('counts').textContent = '원문 ' + occurrences + '곳 · 검토 항목 ' + result.rows.length + '개 · 추가 확인 ' + result.pendingCount + '개';
    if (!keepForm) showSources();
    showQueue(false, keepForm);
    showReport();
    renderArticleAssessment();
  }
  function renderArticleAssessment() {
    if (studyFrame) return;
    rubricUI.render(byId('article-rubric'), result, sources, articleAssessment, value => {
      articleAssessment = value; dirty = true;
    }, articleAssessmentDraft, value => {
      articleAssessmentDraft = value; dirty = true;
    });
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
    if (find) {
      byId('finder').open = true;
      byId('document-query').value = currentRow()?.text || '';
    }
    byId(find ? 'document-text' : 'source-title').focus();
  }
  function resetWork(text, initialSources, initialReceipts, sample) {
    // Clear transient text and decisions when opening a different workspace.
    articleAssessment = null;
    articleAssessmentDraft = null;
    article = text;
    sources = initialSources;
    receipts = initialReceipts;
    demo = sample;
    drafts = new Map();
    currentId = null;
    clearSourceForm();
    byId('article').value = text;
    byId('document-text').value = '';
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
  function draftFrom(d) {
    return {
      status: d.status || '', reason: d.reason || '', sourceIds: [...(d.sourceIds || [])],
      factSpan: d.factSpan || '', opinionSpan: d.opinionSpan || '', correction: d.correction || '',
      contentStatus: d.contentStatus || 'unverified', contentSourceIds: [...(d.contentSourceIds || [])],
      contentReason: d.contentReason || '', acknowledged: false, correctionChecked: false, contentChecked: false,
      afterEdit: true
    };
  }

  byId('article-form').addEventListener('submit', event => {
    event.preventDefault();
    const text = byId('article').value;
    if (!text.trim()) return message('article-status', '검토할 기사를 붙여 넣으세요.', true);
    try {
      let recoveryMessage = '';
      if (article !== text && result) {
        const {recovered, unmapped} = carryDrafts(engine.prepare(text, sources).rows);
        if (unmapped && !confirm('검토한 구간 또는 주변 문맥이 달라져 이전 입력 ' + unmapped + '개를 새 기사에 옮길 수 없습니다. 계속할까요? 취소하면 기존 기사를 유지하므로 작업 파일을 먼저 저장할 수 있습니다.')) {
          byId('article').value = article;
          byId('workspace').hidden = false;
          message('article-status', '기존 기사와 판단을 유지했습니다. 이전 작업을 보관하려면 작업 파일을 내려받으세요.');
          return;
        }
        drafts = recovered;
        receipts = [];
        currentId = null;
        if (recovered.size || unmapped) recoveryMessage = '이전 입력 ' + recovered.size + '개를 확인 전 초안으로 옮겼습니다. 문맥이 달라 옮기지 않은 입력은 ' + unmapped + '개입니다.';
      }
      article = text;
      dirty = true;
      refresh();
      byId('article-panel').open = false;
      message('review-status', recoveryMessage);
      byId('row-heading').focus();
    } catch (err) { message('article-status', err.message, true); }
  });
  byId('article').addEventListener('input', () => {
    dirty = true;
    byId('workspace').hidden = byId('article').value !== article || !article;
    message('article-status', byId('workspace').hidden && article ? '변경한 원문을 검토하려면 검토 목록을 다시 만드세요.' : '');
  });
  byId('new-work').addEventListener('click', () => {
    if (canReplace()) { dirty = false; location.reload(); }
  });
  byId('load-demo').addEventListener('click', () => {
    if (!canReplace()) return;
    resetWork(mockArticle, mockSources.map(s => ({...s})), [], true);
    dirty = true;
    byId('row-heading').focus();
  });
  byId('source-cancel').addEventListener('click', () => clearSourceForm());
  byId('source-form').addEventListener('submit', event => {
    event.preventDefault();
    const source = Object.fromEntries(sourceFields.map(field => [field, byId('source-' + field).value.trim()]));
    let n = sources.length + 1;
    while (sources.some(s => s.id === 'source-' + n)) n++;
    source.id = editingId || 'source-' + n;
    const next = editingId ? sources.map(s => s.id === editingId ? source : s) : [...sources, source];
    try {
      // Editing a cited source invalidates the receipts that cite it. Keep the reviewer's
      // input as an unconfirmed draft instead of blanking the sentence.
      const kept = new Set(engine.prepare(article, next, receipts).rows.filter(r => r.receipt || r.priorDecision).map(r => r.id));
      const moved = engine.report(article, sources, receipts).rows.filter(r => (r.receipt || r.priorDecision) && !kept.has(r.id));
      sources = next;
      for (const row of moved) drafts.set(row.id, {...draftFrom(drafts.get(row.id) || row.receipt || row.priorDecision), sourceEdit: true});
      receipts = receipts.filter(r => !moved.some(row => row.id === r.rowId));
      for (const draft of drafts.values()) { draft.acknowledged = false; draft.correctionChecked = false; draft.contentChecked = false; }
      dirty = true;
      clearSourceForm(source);
      refresh();
      message('source-status', moved.length ? '원자료를 저장했습니다. 이 자료를 인용한 판단 ' + moved.length + '개를 다시 확인할 초안으로 옮겼습니다.'
        : '원자료를 저장했습니다. 문장 검토에서 연결할 수 있습니다.');
    } catch (err) { message('source-status', err.message, true); }
  });
  byId('go-add-source').addEventListener('click', () => openSourceTools(false));
  byId('go-find').addEventListener('click', () => openSourceTools(true));
  byId('find-passages').addEventListener('click', () => {
    const text = byId('document-text').value;
    const query = byId('document-query').value.trim();
    const area = byId('finder-results');
    area.replaceChildren();
    if (!text.trim() || !query) return message('finder-status', '원자료 본문과 찾을 표현을 입력하세요.', true);
    const passages = window.JournalEvidenceFinder.find(text, query);
    message('finder-status', passages.length ? '겹치는 표현이 있는 문단 ' + passages.length + '개' : '해당 표현을 찾지 못했습니다. 다른 표현이나 원문의 표와 주석을 확인하세요.');
    for (const passage of passages) {
      const block = node('div', undefined, 'source');
      block.append(node('strong', '붙여넣은 본문 ' + passage.paragraph + '문단'), node('blockquote', passage.text));
      block.append(button('이 문단을 발췌문으로 사용', () => {
        if (byId('source-excerpt').value && !confirm('입력한 발췌문을 선택한 문단으로 바꿀까요? 기존 위치가 이 구간과 일치하는지도 확인하세요.')) return;
        byId('source-excerpt').value = passage.text;
        message('source-status', '붙여넣은 글의 ' + passage.paragraph + '번째 문단을 옮겼습니다. 원본의 쪽·표·절 등 다시 찾을 수 있는 위치를 확인해 입력하세요.');
        dirty = true;
        byId('source-locator').focus();
      }));
      area.append(block);
    }
  });
  for (const id of ['document-text', 'document-query']) byId(id).addEventListener('input', () => {
    byId('finder-results').replaceChildren();
    message('finder-status', '');
  });
  byId('source-form').addEventListener('input', () => { dirty = true; });
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
      drafts.set(currentId, {...decisionDraft(), afterEdit: previousDraft?.afterEdit === true, ...(previousDraft?.sourceEdit ? {sourceEdit: true} : {})});
      const prior = receipts.find(r => r.rowId === currentId);
      if (!!currentRow().draftPending !== !!draftChangesRecord(currentId, prior)) refresh(true);
    }
    dirty = true;
  });
  byId('decision-form').addEventListener('submit', event => {
    event.preventDefault();
    const row = currentRow();
    if (!row) return;
    try {
      const receipt = engine.decide(row, decisionDraft(), sources);
      receipts = receipts.filter(r => r && r.rowId !== row.id).concat(receipt);
      drafts.delete(row.id);
      const later = result.rows.slice(result.rows.indexOf(row) + 1);
      const earlier = result.rows.slice(0, result.rows.indexOf(row));
      currentId = [...later,...earlier].find(r => r.needsReview && r.status === 'pending')?.id || row.id;
      dirty = true;
      refresh();
      message('review-status', labels[receipt.status] + ' 판단을 기록했습니다.');
      if (studyFrame && studyNonce) {
        studyReply('journal-study-used', {status: receipt.status, sourceIds: receipt.sourceIds, reason: receipt.reason});
      }
      (currentId ? byId('row-heading') : byId('row-filter')).focus();
    } catch (err) { message('review-status', err.message, true); }
  });
  function sourceFormData() {
    return Object.fromEntries(sourceFields.map(k => [k, byId('source-' + k).value]));
  }
  function exportWork() {
    if (!hasWork()) return message('file-status', '저장할 기사를 먼저 입력하세요.', true);
    const rowDrafts = [...drafts].map(([rowId, data]) => ({rowId, data: {...data, acknowledged: false, correctionChecked: false, contentChecked: false}}));
    const workspace = {
      format: schema, article, sources, receipts, demo, articleAssessment, articleAssessmentDraft, articleDraft: byId('article').value,
      rowDrafts, currentId, sourceDraft: {id: editingId, fields: sourceFormData()}
    };
    try {
      download(JSON.stringify(workspace, null, 2), 'journal-factcheck-work.json', 'application/json');
      message('file-status', '작업 파일 내려받기를 요청했습니다. 닫기 전에 파일이 저장됐는지 확인하세요.');
    } catch (err) { message('file-status', '작업 파일을 만들 수 없습니다. ' + err.message, true); }
  }
  function validDraft(d) {
    return d && typeof d.status === 'string' && (d.status === '' || Object.hasOwn(labels, d.status)) &&
      typeof d.reason === 'string' && Array.isArray(d.sourceIds) && d.sourceIds.every(id => typeof id === 'string') &&
      typeof d.factSpan === 'string' && typeof d.opinionSpan === 'string' &&
      (d.contentStatus == null || Object.hasOwn(contentLabels, d.contentStatus)) &&
      (d.contentSourceIds == null || (Array.isArray(d.contentSourceIds) && d.contentSourceIds.every(id => typeof id === 'string'))) &&
      ['contentReason','correction'].every(key => d[key] == null || typeof d[key] === 'string');
  }
  function restoreWork(w) {
    if (!w || w.format !== schema || typeof w.article !== 'string' || typeof w.articleDraft !== 'string' ||
        typeof w.demo !== 'boolean' || !Array.isArray(w.sources) || !Array.isArray(w.receipts) ||
        !Array.isArray(w.rowDrafts) || !w.rowDrafts.every(d => d && typeof d.rowId === 'string' && validDraft(d.data)) ||
        !w.sourceDraft || !w.sourceDraft.fields || !sourceFields.every(k => typeof w.sourceDraft.fields[k] === 'string' || (k === 'originUrl' && w.sourceDraft.fields[k] == null))) {
      throw new Error('이 화면에서 저장한 형식의 작업 파일이 필요합니다.');
    }
    if (!(w.article.trim() || w.articleDraft.trim())) throw new Error('작업 파일에 기사 본문이 없습니다.');
    // Ask explicitly before applying any receipt from a file. A structurally valid record does not identify its author.
    if (!canReplace()) return;
    const hasJudgments = w.receipts.length > 0 || w.articleAssessment != null || w.articleAssessmentDraft != null;
    const trust = !hasJudgments || confirm('이 파일의 이전 판단을 본인 또는 신뢰하는 검토자가 기록했습니까? 확인을 누르면 이전 판단을 복원합니다. 취소를 누르면 기사와 원자료만 열어 새로 검토합니다.');
    const keep = trust ? w.receipts.filter(r => r && typeof r.rowId === 'string') : [];
    engine.prepare(w.article || w.articleDraft, w.sources, keep);
    resetWork(w.article || w.articleDraft, w.sources, keep, w.demo || w.sources.some(isMock));
    if (trust) {
      const validIds = new Set(result.rows.map(r => r.id));
      drafts = new Map(w.rowDrafts.filter(d => validIds.has(d.rowId)).map(d => [d.rowId, {...d.data, acknowledged: false, correctionChecked: false, contentChecked: false}]));
      currentId = validIds.has(w.currentId) ? w.currentId : null;
      const edit = sources.find(s => s.id === w.sourceDraft.id);
      if (edit) {
        editingId = edit.id;
        byId('source-cancel').hidden = false;
        byId('source-form-title').textContent = '원자료 수정';
        byId('source-save').textContent = '수정 적용';
      }
      for (const field of sourceFields) byId('source-' + field).value = w.sourceDraft.fields[field] || '';
      refresh();
      byId('article').value = w.articleDraft;
      if (w.articleDraft !== article) {
        byId('article-panel').open = true;
        byId('workspace').hidden = true;
      }
    }
    const previous = rubric.evaluate(result, sources, trust ? w.articleAssessment : null);
    articleAssessmentDraft = trust ? rubricUI.restoreDraft(result, sources, w.articleAssessmentDraft) : null;
    const dropped = previous.stale || (trust && w.articleAssessmentDraft != null && !articleAssessmentDraft);
    articleAssessment = previous.saved;
    if (articleAssessment && articleAssessmentDraft) {
      // An open edit cannot count as a recorded judgment, even in an inconsistent import.
      for (const id of Object.keys(articleAssessmentDraft.entries)) delete articleAssessment.ratings[id];
    }
    renderArticleAssessment();
    dirty = false;
    if (trust && dropped) {
      message('file-status', '작업 파일을 열었습니다. 현재 원문·근거·판정과 대조되지 않는 기사 평가 또는 초안은 현재 결과에서 제외했습니다.');
      return;
    }
    message('file-status', trust ? '작업 파일을 열었습니다. 원문과 자료 범위가 일치하는 판단을 복원했습니다.' : '기사와 원자료를 열었습니다. 각 문장을 새로 검토하세요.');
  }
  byId('save-work').addEventListener('click', exportWork);
  byId('load-work').addEventListener('click', () => byId('import-file').click());
  byId('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const raw = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('선택한 파일을 읽을 수 없습니다.'));
        reader.readAsText(file);
      });
      restoreWork(JSON.parse(raw));
    } catch (err) { message('file-status', '파일을 열지 못했습니다. ' + err.message, true); }
  });
  function rubricReportLines() {
    const {accuracy: a, bias: b, stale} = rubric.evaluate(result, sources, articleAssessment);
    const percent = value => value == null ? '산출 대기' : Number(value.toFixed(1)) + '%';
    const label = id => result.rows.find(row => row.id === id)?.text;
    const location = id => {
      const index = result.rows.findIndex(row => row.id === id);
      if (index < 0) return '';
      const row = result.rows[index];
      const starts = row.positions.map(p => p.start + 1);
      return ' · 구간 ' + (index + 1) + (starts.length > 1 ? ' (원문 시작 위치 ' + starts.join(', ') + ')' : '');
    };
    const lines = ['기사 평가 · ' + rubric.version, '사실 정확성',
      '판정한 구간 중 근거 일치율 ' + percent(a.accuracyPct) + ' (' + a.supported + '/' + a.adjudicated + ')',
      '검증 범위 ' + percent(a.coveragePct) + ' (' + a.adjudicated + '/' + a.total + ')',
      '근거 지지 ' + a.supported + ' · 반박 ' + a.contradicted + ' · 미결 ' + a.unresolved + ' · 분모 제외 ' + a.excluded,
      a.summary];
    if (!a.coreRowIds.length) lines.push('핵심 구절 미지정');
    for (const id of a.coreRowIds) {
      const row = a.rows.find(item => item.rowId === id);
      lines.push('핵심 구절 · ' + row.label + ' · ' + label(id));
    }
    lines.push('', '편향 · ' + b.summary, '근거로 평가 ' + b.assessed + '/4 · 해당 없음 ' + b.notApplicable + ' · 미평가 ' + b.unknown);
    const draft = rubricUI.restoreDraft(result, sources, articleAssessmentDraft);
    for (const item of b.items) {
      const r = item.rating;
      if (!r) { lines.push(item.title + ' · ' + (draft?.entries[item.id] ? '작성 중 · 미평가' : '미평가')); continue; }
      if (r.level === 'na') { lines.push(item.title + ' · 해당 없음 · ' + r.reason); continue; }
      const source = sources.find(s => s.id === r.sourceId);
      lines.push(item.title + ' · ' + r.level + '단계 · ' + rubric.severityLabels[r.level],
        '기사 구절' + location(r.rowId) + ' · ' + r.quote);
      if (r.compareQuote) lines.push('비교 구절' + location(r.compareRowId) + ' · ' + r.compareQuote);
      lines.push('원자료 · ' + sourceSummary(source), source.url, '자료 구절 · ' + r.sourceQuote, '판단 이유 · ' + r.reason);
      if (source.originUrl) lines.push('최초 원문 · ' + source.originUrl);
      if (r.impact) lines.push('독자가 다르게 받아들일 내용 · ' + r.impact);
      if (r.direction) lines.push('검토자가 기록한 영향 방향 · ' + r.direction);
    }
    if (stale) lines.push('현재 자료와 대조되지 않는 이전 평가는 제외했습니다.');
    lines.push('');
    return lines;
  }
  byId('export-report').addEventListener('click', () => {
    const lines = ['기사 팩트체크 검토 결과', demo ? '연습 기록 · 가상 기사 또는 모의 원자료 포함' : '검토자가 입력한 판단 기록',
      resultScope(), coverageLimit, byId('counts').textContent, statusCounts().join(' · '), '', ...rubricReportLines()];
    for (const [i, row] of result.rows.entries()) {
      lines.push((i + 1) + '. ' + rowLabel(row) + (row.positions.length > 1 ? ' · 원문 ' + row.positions.length + '곳' : ''), row.text);
      const r = row.receipt;
      if (!r && row.reviewNote) lines.push(row.reviewNote);
      if (r) {
        if (['mixed','partial'].includes(r.status)) lines.push('사실 구절 · ' + r.factSpan);
        if (r.status === 'mixed') lines.push('평가 구절 · ' + r.opinionSpan);
        if (r.status === 'partial') lines.push('남은 구절 · ' + r.remainingSpans.join(' / '));
        if (r.status === 'attribution') {
          lines.push('발언 내용 · ' + contentLabels[r.contentStatus]);
          if (r.contentReason) lines.push('내용 판단 이유 · ' + r.contentReason);
        }
        if (r.correction) lines.push('근거와 대조한 수정 문구 · ' + r.correction);
        lines.push('판단 이유 · ' + r.reason, '기록 시각 · ' + r.recordedAt);
        for (const id of [...r.sourceIds, ...(r.contentSourceIds || [])]) {
          const source = sources.find(s => s.id === id);
          const prefix = r.status === 'attribution' ? (r.contentSourceIds?.includes(id) ? '내용 근거 · ' : '원발언 · ') : '근거 · ';
          lines.push(prefix + sourceSummary(source), source.url, source.excerpt);
          if (source.originUrl) lines.push('최초 원문 · ' + source.originUrl);
        }
      }
      lines.push('');
    }
    lines.push('검토 대상 원문', article);
    try {
      download(lines.join('\n'), 'journal-factcheck-result.txt', 'text/plain;charset=utf-8');
      message('result-status', '검토 결과 내려받기를 요청했습니다.');
    } catch (err) { message('result-status', err.message, true); }
  });
  if (studyFrame) {
    document.documentElement.classList.add('study-frame');
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.origin !== expectedMessageOrigin) return;
      const task = event.data;
      if (!task || task.type !== 'journal-study-task' || typeof task.nonce !== 'string' || !task.nonce) return;
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
        window.parent.postMessage({type: 'journal-study-error', nonce: task.nonce}, parentOrigin);
      }
    });
    studyReply('journal-study-ready');
  }
  window.addEventListener('beforeunload', event => {
    if (dirty && !studyFrame) { event.preventDefault(); event.returnValue = ''; }
  });
})();
