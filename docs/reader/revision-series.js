/* A local, score-only record for pooling independently reviewed article revisions. */
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const agreement = useNode ? require('./revision-agreement.js') : root.JournalRevisionAgreement;
  const rubric = useNode ? require('./article-rubric.js') : root.JournalArticleRubric;
  const format = 'journal-revision-series-record', version = 1;
  const {summarizeScores} = agreement;

  function exactKeys(value, keys) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
  }

  function edition(side) {
    return {articleSha256: side.articleSha256, sourcesSha256: side.sourcesSha256};
  }

  function makeRecord(joint, key) {
    const dimensions = agreement.comparedScores(joint, key);
    return readRecord({format, version, demo: key.demo, before: edition(key.mapping.before), after: edition(key.mapping.after), dimensions});
  }

  function readRecord(record) {
    if (!exactKeys(record, ['format', 'version', 'demo', 'before', 'after', 'dimensions']) ||
        record.format !== format || record.version !== version || typeof record.demo !== 'boolean') {
      throw new Error('기사별 공동 판정 기록의 형식과 버전을 확인하세요.');
    }
    const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
    for (const side of [record.before, record.after]) {
      if (!exactKeys(side, ['articleSha256', 'sourcesSha256']) || !digest(side.articleSha256) || !digest(side.sourcesSha256)) {
        throw new Error('기사 또는 원자료의 SHA-256 식별값이 잘못되었습니다.');
      }
    }
    if (record.before.articleSha256 === record.after.articleSha256) throw new Error('원본과 수정본의 기사 식별값이 같습니다.');
    if (!Array.isArray(record.dimensions) || record.dimensions.length !== rubric.dimensions.length) {
      throw new Error('편향 평가 기준 네 개가 모두 필요합니다.');
    }
    // Walk the rubric in canonical order. A missing, unknown, or duplicate ID cannot supply all four.
    const dimensions = rubric.dimensions.map(({id, title, allowNA}) => {
      const dimension = record.dimensions.find(d => d?.id === id);
      if (!exactKeys(dimension, ['id', 'first', 'second'])) throw new Error(title + ' 기준의 입력 항목을 확인하세요.');
      function readPair(pair) {
        const valid = score => score === null || (allowNA && score === 'na') ||
          (Number.isInteger(score) && score >= 0 && score <= 3);
        if (!exactKeys(pair, ['before', 'after']) || !valid(pair.before) || !valid(pair.after)) {
          throw new Error(title + ' 기준의 편집자 점수와 수정 전후 구분을 확인하세요.');
        }
        return {before: pair.before, after: pair.after};
      }
      return {id, first: readPair(dimension.first), second: readPair(dimension.second)};
    });
    return {format, version, demo: record.demo, before: edition(record.before), after: edition(record.after), dimensions};
  }

  // A file may name the two reviewers in either order, but each reviewer's four ratings must stay together.
  function ratingProfile(record) {
    const editors = ['first', 'second'].map(editor => JSON.stringify(record.dimensions.map(d => d[editor])));
    return JSON.stringify(editors.sort());
  }

  function recordError(recordIndexes, message) {
    const positions = recordIndexes.map(index => (index + 1) + '번째').join('와 ');
    const error = new Error(positions + ' 기록 · ' + message);
    error.recordIndexes = recordIndexes;
    return error;
  }

  function summarize(records) {
    if (!Array.isArray(records)) throw new Error('기사별 공동 판정 기록을 목록으로 선택하세요.');
    const unique = [], byManuscript = new Map();
    let demo = null, duplicateCount = 0;
    for (const [index, input] of records.entries()) {
      let record;
      try { record = readRecord(input); }
      catch (error) { throw recordError([index], error.message); }
      if (demo !== null && demo !== record.demo) throw recordError([0, index], '연습 기록과 실제 기사 기록은 따로 집계하세요.');
      demo = record.demo;
      const {before, after} = record;
      const previous = byManuscript.get(before.articleSha256) ?? byManuscript.get(after.articleSha256);
      if (previous) {
        const prior = previous.record;
        if (prior.before.articleSha256 === before.articleSha256 && prior.after.articleSha256 === after.articleSha256 &&
            prior.before.sourcesSha256 === before.sourcesSha256 && prior.after.sourcesSha256 === after.sourcesSha256 &&
            ratingProfile(prior) === ratingProfile(record)) {
          duplicateCount++;
          continue;
        }
        throw recordError([previous.index, index], '기사 판본이 겹치지만 수정 순서, 원자료 또는 판정이 다릅니다. 집계할 기록 하나만 선택하세요.');
      }
      byManuscript.set(before.articleSha256, {index, record});
      byManuscript.set(after.articleSha256, {index, record});
      unique.push(record);
    }
    const articles = unique.map(r => ({before: r.before, after: r.after,
      sourceChanged: r.before.sourcesSha256 !== r.after.sourcesSha256, ...summarizeScores(r.dimensions)}));
    const dimensions = rubric.dimensions.map(({id, title}, i) =>
      ({id, title, ...summarizeScores(unique.map(r => r.dimensions[i]))}));
    const unchanged = unique.filter(r => r.before.sourcesSha256 === r.after.sourcesSha256);
    return {demo, articleCount: articles.length, duplicateCount,
      eligibleArticles: articles.filter(a => a.paired > 0).length,
      improvementEligibleArticles: articles.filter(a => a.improved.denominator > 0).length,
      worseningEligibleArticles: articles.filter(a => a.worsened.denominator > 0).length,
      changedSources: articles.length - unchanged.length, unchangedSources: unchanged.length,
      unchangedEvidenceImprovement: summarizeScores(unchanged.flatMap(r => r.dimensions)).improved,
      ...summarizeScores(unique.flatMap(r => r.dimensions)), dimensions, articles};
  }

  const api = Object.freeze({makeRecord, summarize});
  if (useNode) module.exports = api;
  else root.JournalRevisionSeries = api;
})(globalThis);
