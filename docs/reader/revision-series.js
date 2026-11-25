/* Local, anonymous records for pooling independently reviewed article revisions. */
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const agreement = useNode ? require('./revision-agreement.js') : root.JournalRevisionAgreement;
  const factReview = useNode ? require('./revision-facts.js') : root.JournalRevisionFacts;
  const rubric = useNode ? require('./article-rubric.js') : root.JournalArticleRubric;
  const engine = useNode ? require('./factcheck-engine.js') : root.JournalFactcheck;
  const format = 'journal-revision-series-record';
  const {summarizeScores} = agreement;
  const currentVersion = 8;
  const replayVersions = [5, 6, 7];
  const isDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);

  function exactKeys(value, keys) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
  }

  function edition(side) {
    return {articleSha256: side.articleSha256, sourcesSha256: side.sourcesSha256};
  }

  function editionRecord(joint, key, version) {
    const fields = agreement.recordFields(joint, key, version);
    return readRecord({format, version, demo: key.demo, before: edition(key.mapping.before),
      after: edition(key.mapping.after), ...fields});
  }
  function makeRecord(joint, key) {
    const record = editionRecord(joint, key, currentVersion);
    // Bind only historical projections that actually had additional links.
    // A digest lets an imported older summary be compared without releasing text or notes.
    const priorReviewIds = agreement.changedMatchVersions(joint, key).map(version =>
      [version, reviewId(editionRecord(joint, key, version))]);
    if (priorReviewIds.length) record.priorReviewIds = priorReviewIds;
    return record;
  }
  // Authenticate historical private files and links against the rule that produced them.
  function makeLegacyMatchRecord(joint, key, version = 5) {
    if (!replayVersions.includes(version)) throw new Error('이전 구절 대응 버전을 확인하세요.');
    return editionRecord(joint, key, version);
  }

  function readFactRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('판본마다 사실 검토 구간이 하나 이상 필요합니다.');
    return Array.from(rows, row => {
      if (!factReview.validRow(row)) throw new Error('사실 검토 구간의 판정과 충돌 표시를 확인하세요.');
      return {outcome: row.outcome, flag: row.flag};
    });
  }

  function readFactMatches(matches, facts) {
    const supported = facts.before.flatMap((row, index) => row.outcome === 'supported' ? [index] : []);
    if (!Array.isArray(matches) || matches.length !== supported.length) {
      throw new Error('원본에서 두 편집자가 구절 전체를 지지한 각 구간의 대응 기록이 필요합니다.');
    }
    const linked = new Set();
    return Array.from(matches, (pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== supported[index]) {
        throw new Error('대응 기록의 원본 구간 번호와 순서를 확인하세요.');
      }
      const revised = pair[1];
      if (revised !== null) {
        if (!Number.isInteger(revised) || revised < 0 || revised >= facts.after.length || linked.has(revised)) {
          throw new Error('대응 기록의 수정본 구간 번호가 범위를 벗어나거나 겹칩니다.');
        }
        linked.add(revised);
      }
      return [pair[0], revised];
    });
  }

  function readFactContext(context, facts, factMatches) {
    if (!exactKeys(context, ['beforeCore', 'afterCore', 'matches']) || !Array.isArray(context.matches)) {
      throw new Error('핵심 주장 표시와 원본·수정본 전체 구절 대응 기록을 확인하세요.');
    }
    function readCore(counts, length) {
      if (!Array.isArray(counts) || counts.length !== length || !Array.from(counts).every(count => [0, 1, 2].includes(count))) {
        throw new Error('각 구절을 핵심 주장으로 표시한 편집자 수는 0명에서 2명이어야 합니다.');
      }
      return counts.slice();
    }
    const beforeCore = readCore(context.beforeCore, facts.before.length);
    const afterCore = readCore(context.afterCore, facts.after.length);
    const revisedIndexes = new Set();
    let previous = -1;
    const matches = Array.from(context.matches, pair => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error('전체 구절 대응 기록의 번호 쌍을 확인하세요.');
      const [before, after] = pair;
      if (!Number.isInteger(before) || before <= previous || before >= beforeCore.length ||
          !Number.isInteger(after) || after < 0 || after >= afterCore.length || revisedIndexes.has(after)) {
        throw new Error('전체 구절 대응 번호의 순서, 범위와 중복을 확인하세요.');
      }
      previous = before;
      revisedIndexes.add(after);
      return [before, after];
    });
    const linked = new Map(matches);
    if (factMatches.some(([before, after]) => (linked.get(before) ?? null) !== after)) {
      throw new Error('공동 지지 구절의 대응과 전체 구절 대응 기록이 다릅니다.');
    }
    return {beforeCore, afterCore, matches};
  }

  function readRecord(record) {
    const version = record?.version;
    const keys = ['format', 'version', 'demo', 'before', 'after', 'dimensions'];
    if (version >= 2) keys.push('facts');
    if (version >= 3) keys.push('factMatches');
    if (version >= 4) keys.push('factContext');
    const hasPriorIds = version === currentVersion && Object.hasOwn(record, 'priorReviewIds');
    if (hasPriorIds) keys.push('priorReviewIds');
    if (![1, 2, 3, 4, 5, 6, 7, 8].includes(version) || !exactKeys(record, keys) || record.format !== format || typeof record.demo !== 'boolean') {
      throw new Error('기사별 공동 판정 기록의 형식과 버전을 확인하세요.');
    }
    for (const side of [record.before, record.after]) {
      if (!exactKeys(side, ['articleSha256', 'sourcesSha256']) || !isDigest(side.articleSha256) || !isDigest(side.sourcesSha256)) {
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
    const result = {format, version, demo: record.demo, before: edition(record.before), after: edition(record.after), dimensions};
    if (version >= 2) {
      if (!exactKeys(record.facts, ['before', 'after'])) throw new Error('원본과 수정본의 사실 검토 구간을 확인하세요.');
      result.facts = {before: readFactRows(record.facts.before), after: readFactRows(record.facts.after)};
    }
    if (version >= 3) result.factMatches = readFactMatches(record.factMatches, result.facts);
    if (version >= 4) result.factContext = readFactContext(record.factContext, result.facts, result.factMatches);
    if (hasPriorIds) {
      let previous = 0;
      if (!Array.isArray(record.priorReviewIds) || !record.priorReviewIds.length) throw new Error('이전 요약 식별값 배열을 확인하세요.');
      result.priorReviewIds = Array.from(record.priorReviewIds, pair => {
        if (!Array.isArray(pair) || pair.length !== 2 || !replayVersions.includes(pair[0]) || pair[0] <= previous || !isDigest(pair[1])) {
          throw new Error('이전 요약 버전과 식별값을 확인하세요.');
        }
        previous = pair[0];
        return [pair[0], pair[1]];
      });
    }
    return result;
  }

  // A file may name the two reviewers in either order, but each reviewer's four ratings must stay together.
  function ratingProfile(record) {
    const editors = ['first', 'second'].map(editor => JSON.stringify(
      record.dimensions.map(d => [d.id, d[editor].before, d[editor].after])));
    return JSON.stringify(editors.sort());
  }

  // Only the global editor order is interchangeable. Preserve the before/after
  // roles, each editor's complete rating profile, and fact observations in passage order.
  function reviewId(input, version = input?.version) {
    const record = readRecord(input);
    if (![2, 3, 4, 5, 6, 7, 8].includes(version) || version > record.version) throw new Error('구절별 검토 상태가 담긴 기사 요약으로 근거를 다시 여세요.');
    const fields = [format, version, record.demo, record.before, record.after, ratingProfile(record), record.facts];
    if (version >= 3) fields.push(record.factMatches);
    if (version >= 4) fields.push(record.factContext);
    if (version === currentVersion && record.priorReviewIds) fields.push(record.priorReviewIds);
    return engine.digestValue(fields);
  }

  function recordError(recordIndexes, message) {
    const positions = recordIndexes.map(index => (index + 1) + '번째').join('와 ');
    const error = new Error(positions + ' 기록 · ' + message);
    error.recordIndexes = recordIndexes;
    return error;
  }

  function summarize(records) {
    if (!Array.isArray(records)) throw new Error('기사별 공동 판정 기록을 목록으로 선택하세요.');
    const entries = [], byManuscript = new Map();
    let demo = null, duplicateCount = 0;
    const parsed = Array.from(records, (input, index) => {
      let record;
      try { record = readRecord(input); }
      catch (error) { throw recordError([index], error.message); }
      if (demo !== null && demo !== record.demo) throw recordError([0, index], '연습 기록과 실제 기사 기록은 따로 집계하세요.');
      demo = record.demo;
      return {index, record};
    });
    // Check each older duplicate against its canonical v8 export, even if v8 was selected last.
    parsed.sort((a, b) => Number(b.record.version === currentVersion) - Number(a.record.version === currentVersion));
    for (const {index, record} of parsed) {
      const {before, after} = record;
      const previous = byManuscript.get(before.articleSha256) ?? byManuscript.get(after.articleSha256);
      if (previous) {
        const prior = previous.record;
        if (prior.before.articleSha256 === before.articleSha256 && prior.after.articleSha256 === after.articleSha256 &&
            prior.before.sourcesSha256 === before.sourcesSha256 && prior.after.sourcesSha256 === after.sourcesSha256 &&
            ratingProfile(prior) === ratingProfile(record)) {
          if (prior.facts && record.facts && JSON.stringify(prior.facts) !== JSON.stringify(record.facts)) {
            throw recordError([previous.index, index], '같은 기사 판본의 사실 검토 판정이 다릅니다. 집계할 기록 하나만 선택하세요.');
          }
          const replay = prior.version === currentVersion && replayVersions.includes(record.version);
          if (replay) {
            const oldId = new Map(prior.priorReviewIds).get(record.version);
            const oldContext = record.factContext, currentContext = prior.factContext;
            const oldLinks = new Map(oldContext.matches);
            const compatible = !oldId || (oldLinks.size > currentContext.matches.length &&
              currentContext.matches.every(([from, to]) => oldLinks.get(from) === to) &&
              JSON.stringify(oldContext.beforeCore) === JSON.stringify(currentContext.beforeCore) &&
              JSON.stringify(oldContext.afterCore) === JSON.stringify(currentContext.afterCore));
            if (!compatible || reviewId(record) !== (oldId ?? reviewId(prior, record.version))) {
              throw recordError([previous.index, index], '같은 기사 판본이지만 이전 기준으로 재현한 구절 대응 및 핵심 주장 표시와 다릅니다.');
            }
          }
          if (record.version === currentVersion && JSON.stringify(prior.priorReviewIds) !== JSON.stringify(record.priorReviewIds)) {
            throw recordError([previous.index, index], '같은 기사 판본의 이전 요약 식별값이 다릅니다.');
          }
          if (!replay && prior.version >= 3 && record.version >= 3 && JSON.stringify(prior.factMatches) !== JSON.stringify(record.factMatches)) {
            throw recordError([previous.index, index], '같은 기사 판본의 원본·수정본 구절 대응이 다릅니다. 집계할 기록 하나만 선택하세요.');
          }
          if (!replay && prior.version >= 4 && record.version >= 4 && JSON.stringify(prior.factContext) !== JSON.stringify(record.factContext)) {
            throw recordError([previous.index, index], '같은 기사 판본의 핵심 주장 표시 또는 전체 구절 대응이 다릅니다. 집계할 기록 하나만 선택하세요.');
          }
          if (record.version > prior.version) {
            previous.index = index;
            previous.record = record;
          }
          previous.firstIndex = Math.min(index, previous.firstIndex);
          duplicateCount++;
          continue;
        }
        throw recordError([previous.index, index], '기사 판본이 겹치지만 수정 순서, 원자료 또는 판정이 다릅니다. 집계할 기록 하나만 선택하세요.');
      }
      const entry = {index, record, firstIndex:index};
      byManuscript.set(before.articleSha256, entry);
      byManuscript.set(after.articleSha256, entry);
      entries.push(entry);
    }
    entries.sort((a, b) => a.firstIndex - b.firstIndex);
    const unique = entries.map(entry => entry.record);
    const articles = unique.map(r => ({before: r.before, after: r.after, matchVersion: r.version,
      sourceChanged: r.before.sourcesSha256 !== r.after.sourcesSha256, ...summarizeScores(r.dimensions),
      facts: r.facts ? {before: factReview.summarize(r.facts.before), after: factReview.summarize(r.facts.after)} : null,
      coreContextReview: r.factContext ? factReview.coreContextReview(r.facts, r.factContext) : null,
      factTrace: r.factMatches ? factReview.summarizeFactMatches(r.factMatches, r.facts.after) : null,
      factAudit: r.factContext ? factReview.auditFacts(r.facts, r.factContext) : null}));
    const dimensions = rubric.dimensions.map(({id, title}, i) =>
      ({id, title, ...summarizeScores(unique.map(r => r.dimensions[i]))}));
    const unchanged = unique.filter(r => r.before.sourcesSha256 === r.after.sourcesSha256);
    const unchangedScores = summarizeScores(unchanged.flatMap(r => r.dimensions));
    const withFacts = unique.filter(r => r.facts);
    const improvedArticles = articles.filter(a => a.improved.numerator > 0);
    const currentMatchesPresent = articles.some(a => a.matchVersion === currentVersion);
    const priorArticles = improvedArticles.filter(a => a.matchVersion < currentVersion && a.factTrace);
    const matchedCohort = currentMatchesPresent ? improvedArticles.filter(a => a.matchVersion === currentVersion) : improvedArticles;
    const improvedAudits = matchedCohort.map(a => a.factAudit).filter(audit => audit !== null);
    const coreContexts = matchedCohort.map(a => a.coreContextReview).filter(Boolean);
    const facts = {articleCount: withFacts.length, missingArticles: articles.length - withFacts.length,
      before: factReview.summarize(withFacts.flatMap(r => r.facts.before)),
      after: factReview.summarize(withFacts.flatMap(r => r.facts.after)),
      improvedArticles: improvedArticles.length,
      matchBasis: currentMatchesPresent ? 'current' : 'historical',
      priorMatchArticles: priorArticles.length,
      priorAudit: currentMatchesPresent && priorArticles.length ? factReview.sumFactAudits(priorArticles.map(a => a.factAudit).filter(Boolean)) : null,
      retentionComparableArticles: matchedCohort.filter(a => a.factTrace?.total > 0).length,
      coreContext: {
        total: coreContexts.reduce((sum, review) => sum + review.total, 0),
        unmatched: coreContexts.reduce((sum, review) => sum + review.unmatched.length, 0)
      },
      audit: {improvedArticles: improvedAudits.length, missingImprovedArticles: improvedArticles.filter(a => !a.factAudit).length,
        ...factReview.sumFactAudits(improvedAudits)},
      improvedWithUnconfirmedRetention: matchedCohort.filter(a => a.factTrace && a.factTrace.retained < a.factTrace.total).length,
      improvedWithoutTrace: improvedArticles.filter(a => !a.factTrace).length,
      improvedWithFewerFactRows: improvedArticles.filter(a => a.facts && a.facts.after.coverage.denominator < a.facts.before.coverage.denominator).length,
      improvedWithRevisedFlags: improvedArticles.filter(a => a.facts && a.facts.after.flagged > 0).length,
      improvedWithOpenFacts: improvedArticles.filter(a => a.facts && ['pending', 'disputed', 'shared'].some(
        outcome => a.facts.after[outcome] > 0)).length,
      improvedMissingFacts: improvedArticles.filter(a => !a.facts).length};
    return {demo, articleCount: articles.length, duplicateCount,
      eligibleArticles: articles.filter(a => a.paired > 0).length,
      improvementEligibleArticles: articles.filter(a => a.improved.denominator > 0).length,
      worseningEligibleArticles: articles.filter(a => a.worsened.denominator > 0).length,
      changedSources: articles.length - unchanged.length, unchangedSources: unchanged.length,
      unchangedEvidenceImprovement: unchangedScores.improved, unchangedEvidenceSeverity: unchangedScores.severity,
      unchangedEvidenceRange: unchangedScores.improvementRange, unchangedEvidenceNet: unchangedScores.netSeverityChange,
      unchangedEvidencePaired: unchangedScores.paired,
      ...summarizeScores(unique.flatMap(r => r.dimensions)), dimensions, articles, facts};
  }

  const api = Object.freeze({makeRecord, makeLegacyMatchRecord, reviewId, summarize});
  if (useNode) module.exports = api;
  else root.JournalRevisionSeries = api;
})(globalThis);
