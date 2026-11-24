// Both the editor and file comparison replay the same committed decisions and in-progress edits.
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const engine = useNode ? require('./factcheck-engine.js') : root.JournalFactcheck;
  const rubric = useNode ? require('./article-rubric.js') : root.JournalArticleRubric;
  const statuses = ['partial','pending','fact','attribution','opinion','mixed','held','contradicted'];
  const contentStatuses = ['unverified','opinion','supported','contradicted'];
  const schema = 'journal-local-factcheck-v1';
  const sourceFields = ['title', 'url', 'locator', 'excerpt', 'version', 'originUrl', 'pdfPage'];
  function isMock(source) {
    return [source.url, source.originUrl].filter(Boolean).some(value => {
      try { return /(?:^|\.)invalid$/i.test(new URL(value).hostname.replace(/\.$/, '')); } catch { return false; }
    });
  }
  function sourceDefaults(source = {}) {
    let url = source.url || '';
    if (url && engine.sourceTarget(source)?.page) {
      const document = new URL(url);
      document.hash = '';
      url = document.href;
    }
    return {title: source.title || '', url, version: source.version || '', originUrl: source.originUrl || ''};
  }
  function decisionKey(d = {}) {
    const content = [d.status || '', d.reason || '', [...(d.sourceIds || [])].sort()];
    if (['partial','mixed'].includes(d.status)) content.push(d.factSpan || '');
    if (d.status === 'mixed') content.push(d.opinionSpan || '');
    if (d.status === 'contradicted') content.push(d.correction || '');
    if (d.status === 'attribution') content.push(d.contentStatus || 'unverified', d.contentReason || '', [...(d.contentSourceIds || [])].sort());
    return JSON.stringify(content);
  }
  function draftChangesRecord(draft, previous) {
    return !!draft && (draft.afterEdit || decisionKey(draft) !== decisionKey(previous));
  }
  function validDraft(d) {
    return d && typeof d.status === 'string' && (d.status === '' || statuses.includes(d.status)) &&
      typeof d.reason === 'string' && Array.isArray(d.sourceIds) && d.sourceIds.every(id => typeof id === 'string') &&
      typeof d.factSpan === 'string' && typeof d.opinionSpan === 'string' &&
      (d.contentStatus == null || contentStatuses.includes(d.contentStatus)) &&
      (d.contentSourceIds == null || (Array.isArray(d.contentSourceIds) && d.contentSourceIds.every(id => typeof id === 'string'))) &&
      ['contentReason','correction'].every(key => d[key] == null || typeof d[key] === 'string');
  }
  function validateWork(w) {
    if (!w || w.format !== schema || typeof w.article !== 'string' || typeof w.articleDraft !== 'string' ||
        typeof w.demo !== 'boolean' || !Array.isArray(w.sources) || !Array.isArray(w.receipts) ||
        !Array.isArray(w.rowDrafts) || !w.rowDrafts.every(d => d && typeof d.rowId === 'string' && validDraft(d.data)) ||
        !w.sourceDraft || !w.sourceDraft.fields || !sourceFields.every(k => typeof w.sourceDraft.fields[k] === 'string' || (['originUrl','pdfPage'].includes(k) && w.sourceDraft.fields[k] == null))) {
      throw new Error('이 화면에서 저장한 형식의 작업 파일이 필요합니다.');
    }
    if (!(w.article.trim() || w.articleDraft.trim())) throw new Error('작업 파일에 기사 본문이 없습니다.');
  }

  function activeReport(article, sources, receipts, drafts) {
    let report = engine.report(article, sources, receipts);
    const pending = new Map();
    for (const row of report.rows) {
      if (draftChangesRecord(drafts.get(row.id), row.receipt ?? undefined)) pending.set(row.id, row.receipt);
    }
    // Only a receipt validated against this article and catalogue can become the
    // prior judgment for an edit. Keep the engine's counts based on visible decisions.
    if ([...pending.values()].some(Boolean)) {
      report = engine.report(article, sources, receipts.filter(r => r && !pending.has(r.rowId)));
    }
    for (const row of report.rows) {
      row.draftPending = pending.has(row.id);
      if (row.draftPending) {
        row.draftRecord = pending.get(row.id);
        row.reviewNote = '판단을 작성하고 있습니다. 기록하기 전까지 확인한 결과에서 제외합니다.';
      }
    }
    return report;
  }

  function review(report, sources, saved, rawDraft) {
    let assessment = rubric.evaluate(report, sources, saved);
    const draft = rubric.restoreDraft(report, sources, rawDraft);
    const dropped = assessment.stale || (rawDraft != null && !draft);
    if (assessment.saved && draft) {
      // A workspace can contain an open edit as well as an older rating for the same dimension.
      const filtered = {...assessment.saved.ratings};
      for (const id of Object.keys(draft.entries)) delete filtered[id];
      assessment = rubric.evaluate(report, sources, {...assessment.saved, ratings: filtered});
    }
    return {assessment, draft, dropped};
  }

  function read(w) {
    validateWork(w);
    if (!w.article.trim() || w.articleDraft !== w.article) {
      throw new Error('기사를 수정 중인 작업 파일입니다. 팩트체크 화면에서 기사 입력을 확정하고 다시 저장하세요.');
    }
    const drafts = new Map(w.rowDrafts.map(entry => [entry.rowId, entry.data]));
    const receipts = w.receipts.filter(r => r && typeof r.rowId === 'string');
    const report = activeReport(w.article, w.sources, receipts, drafts);
    if (!report.rows.length) throw new Error('비교할 기사 구간이 없습니다.');
    const checked = review(report, w.sources, w.articleAssessment, w.articleAssessmentDraft);
    // Independently entered copies of the same source have different UI IDs and often different display names.
    const sourceKey = JSON.stringify(w.sources.map(s => {
      const target = engine.sourceTarget(s);
      const url = new URL(s.url);
      if (target?.page) url.hash = '';
      return JSON.stringify([target?.page ? url.href : s.url, s.originUrl || '', s.version,
        s.locator, s.excerpt, target?.page || s.pdfPage || '']);
    }).sort());
    const editing = w.sources.find(s => s.id === w.sourceDraft.id);
    const prefill = w.sources.find(s => s.id === w.sourceDraft.prefillId);
    const baseline = editing || sourceDefaults(prefill);
    const sourceDraftPending = sourceFields.some(k => (w.sourceDraft.fields[k] || '') !== (baseline[k] || ''));
    return {article: report.article, rows: report.rows, sources: w.sources, sourceKey,
      demo: w.demo || w.sources.some(isMock), assessment: checked.assessment, stale: checked.dropped, sourceDraftPending};
  }

  const api = Object.freeze({schema, sourceFields, sourceDefaults, isMock, validateWork, activeReport, draftChangesRecord, review, read});
  if (useNode) module.exports = api;
  else root.JournalWorkspaceSnapshot = api;
})(globalThis);
