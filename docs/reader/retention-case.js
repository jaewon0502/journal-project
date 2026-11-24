/* Private coordinator file containing the six original inputs and subsequent passage comparisons. */
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const engine = useNode ? require('./factcheck-engine.js') : root.JournalFactcheck;
  const workspace = useNode ? require('./workspace-snapshot.js') : root.JournalWorkspaceSnapshot;
  const blind = useNode ? require('./blind-revision.js') : root.JournalBlindRevision;
  const series = useNode ? require('./revision-series.js') : root.JournalRevisionSeries;
  const agreement = useNode ? require('./revision-agreement.js') : root.JournalRevisionAgreement;
  const format = 'journal-retention-case';
  const keyFormat = 'journal-blind-revision-key-v1';
  const statuses = ['open', 'retained', 'changed', 'notFound'];
  const digest = engine.digestValue;

  function exactKeys(obj, keys) {
    return !!obj && typeof obj === 'object' && !Array.isArray(obj) &&
      Object.keys(obj).length === keys.length && keys.every(key => Object.hasOwn(obj, key));
  }

  function copyItems(items, fromArchive) {
    if (!Array.isArray(items) || items.length !== 6) throw new Error('대조 기록에는 작업 파일 네 개와 대응표 두 개가 필요합니다.');
    return Array.from(items, item => {
      if ((fromArchive && !exactKeys(item, ['name', 'data'])) || typeof item?.name !== 'string' ||
          ![keyFormat, workspace.schema].includes(item?.data?.format)) {
        throw new Error('대조 기록에 들어 있는 작업 파일과 대응표를 확인하세요.');
      }
      const name = item.name.split(/[\\/]/u).at(-1);
      if (!name.trim() || /[\x00-\x1f\x7f]/u.test(name)) throw new Error('대조 기록에 들어 있는 파일 이름을 확인하세요.');
      return {name, data:JSON.parse(JSON.stringify(item.data))};
    });
  }

  // Input order, file names and object-key order are incidental. Array order inside a work file is meaningful.
  function evidenceId(items) {
    const hashes = items.map(({data}) => {
      const canonical = JSON.stringify(data, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
      return digest(canonical);
    });
    return digest(hashes.sort());
  }

  function cleanNotes(notes) {
    if (!Array.isArray(notes)) throw new Error('구절별 대조 기록 목록을 확인하세요.');
    const seen = new Set();
    return Array.from(notes, note => {
      if (!exactKeys(note, ['before', 'after', 'status', 'reason'])) throw new Error('구절별 대조 기록의 입력 항목을 확인하세요.');
      const {before, after, status, reason} = note;
      if (!Number.isSafeInteger(before) || before < 0 || seen.has(before)) throw new Error('원본 구절 번호가 잘못되었거나 겹칩니다.');
      seen.add(before);
      if (!statuses.includes(status) || (after !== null && (!Number.isSafeInteger(after) || after < 0)) ||
          (status === 'notFound' && after !== null) || (['retained', 'changed'].includes(status) && after === null)) {
        throw new Error('대조 판단에 맞는 수정본 구절을 선택하세요.');
      }
      if (typeof reason !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(reason) ||
          (status !== 'open' && !/[\p{L}\p{N}]/u.test(reason))) {
        const error = new Error('원본과 수정본을 대조한 판단 이유를 적으세요.');
        error.before = before;
        throw error;
      }
      return {before, after, status, reason};
    });
  }

  function checkedNotes(record, notes) {
    const open = new Set(record.factMatches.filter(([, after]) => after === null ||
      record.facts.after[after].outcome !== 'supported').map(([before]) => before));
    const clean = cleanNotes(notes);
    for (const {before, after, status} of clean) {
      if (!open.has(before)) throw new Error('자동 대조로 확인되지 않은 원본 구절만 추가 판정할 수 있습니다.');
      if (after !== null && after >= record.facts.after.length) throw new Error('수정본에 있는 구절 번호를 선택하세요.');
      if (status === 'retained' && record.facts.after[after].outcome !== 'supported') {
        throw new Error('유지를 확인하려면 두 편집자가 구절 전체를 근거로 지지한 수정본 구절을 선택하세요.');
      }
    }
    return clean;
  }

  function validateNotes(record, notes) {
    series.reviewId(record, 3);
    return checkedNotes(record, notes);
  }

  function noteChecksum(version, reviewId, evidenceDigest, notes) {
    return digest([format, version, reviewId, evidenceDigest, notes.map(n => [n.before, n.after, n.status, n.reason])]);
  }

  async function create(record, items, notes) {
    const inputVersion = record?.version === 3 ? 3 : 4;
    const inputId = series.reviewId(record, inputVersion);
    const embedded = copyItems(items, false);
    const saved = checkedNotes(record, notes);
    const reviews = await blind.resolveBundle(embedded);
    if (reviews[0].key.demo !== record.demo) throw new Error('대조 기록의 연습·실제 기사 구분이 다릅니다.');
    const rebuilt = series.makeRecord(agreement.compare(...reviews), reviews[0].key);
    if (series.reviewId(rebuilt, inputVersion) !== inputId) throw new Error('작업 파일에서 다시 계산한 평가가 선택한 요약과 다릅니다.');
    // Even an older selected summary becomes a full v4 identity after its six files have been resolved.
    const reviewId = inputVersion === 4 ? inputId : series.reviewId(rebuilt, 4);
    const evidenceDigest = evidenceId(embedded);
    return {format, version:2, reviewId, evidenceDigest, items:embedded, notes:saved,
      checksum:noteChecksum(2, reviewId, evidenceDigest, saved)};
  }

  function read(data) {
    if (!exactKeys(data, ['format', 'version', 'reviewId', 'evidenceDigest', 'items', 'notes', 'checksum']) ||
        data.format !== format || ![1, 2].includes(data.version) ||
        ![data.reviewId, data.evidenceDigest, data.checksum].every(s => typeof s === 'string' && /^[0-9a-f]{64}$/u.test(s))) {
      throw new Error('진행자가 저장한 구절 대조 기록 파일을 선택하세요.');
    }
    const items = copyItems(data.items, true), notes = cleanNotes(data.notes);
    if (evidenceId(items) !== data.evidenceDigest) throw new Error('저장한 대조 기록의 작업 파일이나 대응표 내용이 달라졌습니다.');
    if (noteChecksum(data.version, data.reviewId, data.evidenceDigest, notes) !== data.checksum) throw new Error('저장한 대조 기록의 판단이나 식별값이 달라졌습니다.');
    return {items, notes, reviewId:data.reviewId};
  }

  // Pass the summary rebuilt by the normal blind assignment resolver when reopening.
  function verify(data, record) {
    const saved = read(data);
    if (series.reviewId(record, data.version === 1 ? 3 : 4) !== saved.reviewId) throw new Error('대조 기록과 다시 계산한 기사 요약이 일치하지 않습니다.');
    return checkedNotes(record, saved.notes);
  }

  function summarize(record, notes) {
    const saved = validateNotes(record, notes);
    const total = record.factMatches.length;
    const autoRetained = record.factMatches.filter(([, after]) => after !== null && record.facts.after[after].outcome === 'supported').length;
    const result = {autoRetained, manualRetained:0, changed:0, notFound:0, open:total - autoRetained, total};
    for (const {status} of saved) {
      if (status === 'open') continue;
      result[status === 'retained' ? 'manualRetained' : status]++;
      result.open--;
    }
    return result;
  }

  const api = Object.freeze({format, create, read, verify, validateNotes, summarize});
  if (useNode) module.exports = api;
  else root.JournalRetentionCase = api;
})(globalThis);
