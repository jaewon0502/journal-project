/* Private coordinator receipts are opened locally. Only cohort counts leave this function. */
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const series = useNode ? require('./revision-series.js') : root.JournalRevisionSeries;
  const retention = useNode ? require('./retention-case.js') : root.JournalRetentionCase;
  const blind = useNode ? require('./blind-revision.js') : root.JournalBlindRevision;
  const agreement = useNode ? require('./revision-agreement.js') : root.JournalRevisionAgreement;

  function fileError(index, message) {
    const error = new Error((index + 1) + '번째 진행자용 파일 · ' + message);
    error.archiveIndex = index;
    return error;
  }

  async function audit(records, archives = []) {
    if (!Array.isArray(archives)) throw new Error('진행자용 파일을 목록으로 선택하세요.');
    const report = series.summarize(records);
    const selected = new Set(records.filter(record => record.version === 8).map(record => series.reviewId(record)));
    const current = report.articles.filter(article => article.matchVersion === 8);
    const older = report.articles.filter(article => article.matchVersion < 8);
    const countErrors = articles => articles.reduce((total, article) => total + (article.facts?.before.contradicted ?? 0), 0);
    const total = countErrors(current);
    const eligibleArticles = current.filter(article => article.facts.before.contradicted > 0).length;
    const totals = {total, corrected:0, persists:0, absent:0, unresolved:0, pending:total};
    const result = {currentArticles:current.length, olderArticles:older.length, olderKnownOriginals:countErrors(older),
      olderWithoutFacts:older.filter(article => !article.facts).length, eligibleArticles, checkedArchives:0,
      duplicateArchives:0, missingArchiveArticles:eligibleArticles, missingArchiveOriginals:total, totals};
    const verified = new Map();
    for (const [index, file] of archives.entries()) {
      if (![6, 7].includes(file?.version) || file.format !== retention.format) {
        throw fileError(index, '현재 기준으로 저장한 진행자용 원본 대조 기록을 선택하세요.');
      }
      let archive;
      try {
        // Use the checked copy of the six inputs and notes throughout the async replay.
        archive = {...file, ...retention.read(file)};
      } catch {
        throw fileError(index, '보관된 작업 파일·대응표·판단 기록의 무결성을 확인할 수 없습니다.');
      }
      if (!selected.has(archive.reviewId)) {
        throw fileError(index, '선택한 현재 기준의 익명 기사 요약과 짝이 맞지 않습니다. 연습·실제 구분과 판본을 확인하세요.');
      }
      const prior = verified.get(archive.reviewId);
      if (prior) {
        if (prior.version !== archive.version || prior.evidenceDigest !== archive.evidenceDigest || prior.checksum !== archive.checksum) {
          throw fileError(index, '같은 기사에 원자료 또는 대조 기록이 다른 진행자용 파일이 있습니다. 집계할 파일 하나를 선택하세요.');
        }
        // The same verified payload may use another filename or input order.
        result.duplicateArchives++;
        continue;
      }
      let counts;
      try {
        const pair = await blind.resolveBundle(archive.items);
        const record = series.makeRecord(agreement.compare(...pair), pair[0].key);
        const notes = retention.verifyAll(archive, record);
        counts = retention.summarizeCorrections(record, notes.correctionNotes ?? []);
      } catch {
        throw fileError(index, '여섯 원자료에서 다시 계산한 기사 요약과 사후 대조 판단을 확인할 수 없습니다.');
      }
      verified.set(archive.reviewId, {version:archive.version, evidenceDigest:archive.evidenceDigest, checksum:archive.checksum});
      result.checkedArchives++;
      if (counts.total) result.missingArchiveArticles--;
      result.missingArchiveOriginals -= counts.total;
      for (const status of ['corrected', 'persists', 'absent', 'unresolved']) totals[status] += counts[status];
      totals.pending -= counts.total - counts.pending;
    }
    return result;
  }

  const api = Object.freeze({audit});
  if (useNode) module.exports = api;
  else root.JournalCorrectionSeriesAudit = api;
})(globalThis);
