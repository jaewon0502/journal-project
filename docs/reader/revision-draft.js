// Only accept reports rebuilt by JournalFactcheck or JournalWorkspaceSnapshot.
// Saved JSON and unsaved form values are not validated review decisions.
(function (root) {
  'use strict';

  function proposals(report) {
    if (typeof report?.article !== 'string' || !Array.isArray(report.rows)) {
      throw Error('현재 기사에서 검토 결과를 다시 여세요.');
    }
    const items = [];
    for (const row of report.rows) {
      const r = row.receipt;
      if (row.draftPending || row.status !== 'contradicted' || r?.status !== row.status ||
          r.rowId !== row.id || !r.binding || r.binding !== row.binding ||
          !r.articleBinding || r.articleBinding !== row.articleBinding || typeof r.checksum !== 'string' ||
          !r.checksum || r.correctionChecked !== true || typeof r.correction !== 'string' ||
          !r.correction.trim() || r.correction.trim() === row.text.trim()) continue;
      for (const {start, end} of row.positions) {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
            end <= start || end > report.article.length || report.article.slice(start, end) !== row.text) {
          throw Error('정정할 구절의 위치가 현재 원문과 다릅니다.');
        }
        // The validated receipt covers both the current article and the cited evidence.
        items.push({rowId:row.id, start, end, original:row.text, replacement:r.correction, binding:r.checksum});
      }
    }
    return items.sort((a, b) => a.start - b.start);
  }

  function apply(report, selections) {
    if (!Array.isArray(selections) || !selections.length) throw Error('적용할 정정 문구를 한 곳 이상 선택하세요.');
    const current = new Map(proposals(report).map(item => [item.start, item]));
    const selected = [];
    for (const selection of selections) {
      const item = current.get(selection?.start);
      if (!item || Array.isArray(selection) || item.end !== selection.end || item.rowId !== selection.rowId ||
          item.binding !== selection.binding || item.original !== selection.original || item.replacement !== selection.replacement) {
        throw Error('원문이나 확인한 정정 문구가 바뀌었습니다. 현재 검토 결과에서 다시 선택하세요.');
      }
      selected.push(item);
    }
    const parts = [];
    let cursor = 0;
    for (const item of selected.sort((a, b) => a.start - b.start)) {
      if (item.start < cursor) throw Error('같은 위치나 겹치는 구절을 두 번 선택했습니다.');
      parts.push(report.article.slice(cursor, item.start), item.replacement);
      cursor = item.end;
    }
    parts.push(report.article.slice(cursor));
    return parts.join('');
  }

  const api = Object.freeze({proposals, apply});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalRevisionDraft = api;
})(globalThis);
