/* The input report is the current JournalFactcheck.report output. Only that engine
   restores and validates claim receipts. Never pass rows reconstructed from file labels. */
(function (root) {
  'use strict';

  const engine = typeof module === 'object' && module.exports ? require('./factcheck-engine.js') : root.JournalFactcheck;
  const version = 'journal-article-rubric-v1';
  const severityLabels = ['뚜렷한 문제를 찾지 못함', '국소적 강조', '중요한 왜곡', '핵심 결론 왜곡'];
  const dimensions = [
    {
      id: 'wording', title: '표현과 발언 귀속', allowNA: false,
      question: '기사의 서술과 인용을 구분했는가? 원발언의 강도와 확실성을 그대로 전했는가?',
      levels: [
        '대조한 구간에서 발언 주체와 주장·의혹·확정 사실을 구분하고, 정당한 비판이나 옹호의 강도를 보존했다.',
        '일부 수식어가 원자료보다 한쪽 평가를 강조한다. 행위자와 사실관계는 식별할 수 있다.',
        '본문의 중요한 주장에 단정이나 비난을 더하거나 인용의 주체를 흐려 책임·확실성을 다르게 읽게 한다.',
        '기사의 중심 주장에 의혹을 확정 사실로 옮기거나 핵심 발언의 주체·취지를 뒤집었다.'
      ]
    },
    {
      id: 'framing', title: '제목·도입부와 본문', allowNA: true,
      question: '제목이나 첫 문장만 읽었을 때와 본문을 끝까지 읽었을 때 같은 결론을 얻게 되는가?',
      levels: [
        '제목·도입과 본문이 같은 대상, 기간, 사건 단계와 확실성을 전달한다.',
        '특정 측면을 더 강조하지만 읽는 위치에 따라 주장의 적용 범위나 결론이 달라지지 않는다.',
        '중요한 조건이나 반증을 뒤로 보내 제목·도입이 본문보다 넓은 범위나 강한 결론을 제시한다.',
        '제목·도입이 본문에서 반박되거나 유보된 핵심 주장을 확정된 결론으로 내세운다.'
      ]
    },
    {
      id: 'omission', title: '근거 선택과 맥락 누락', allowNA: false,
      question: '원자료의 기간·분모·예외나 신뢰할 만한 반증 중 빠진 것이 독자의 판단을 바꾸는가?',
      levels: [
        '대조한 원자료에서 핵심 판단을 바꿀 조건이나 반증이 기사에 반영돼 있다.',
        '관련 배경 일부가 빠져 강조점이 달라졌지만 원자료의 핵심 관계와 결론은 유지된다.',
        '관련 기간·분모·예외·반증 가운데 중요한 부분을 빼거나 다른 표본으로 넓혀 사안의 크기나 책임을 바꿔 보이게 한다.',
        '결론을 뒤집는 직접 자료를 제외하거나 반대 의미의 구절만 골라 중심 주장을 성립시켰다.'
      ]
    },
    {
      id: 'standards', title: '당사자에게 적용한 검증 기준', allowNA: true,
      question: '비교할 만한 두 주장이나 행위를 증거 수준에 맞춰 같은 기준으로 다뤘는가?',
      levels: [
        '비교할 수 있는 주장에는 같은 검증 기준을 썼다. 보도 비중이나 판단의 차이는 원자료의 증거력 차이로 설명된다.',
        '비슷한 주장에 수식·비중을 다르게 주거나 근거가 약한 주장을 나란히 강조했지만 각각의 증거 수준은 드러난다.',
        '유사한 근거에 다른 입증 문턱을 적용하거나, 확인되지 않은 주장과 검증된 사실을 같은 무게로 제시해 중요한 차이를 흐렸다.',
        '동등한 증거에 정반대 기준을 적용하거나 이미 반증된 주장을 대등한 쟁점으로 내세워 중심 결론이나 책임 귀속이 달라졌다.'
      ]
    }
  ];

  // A row binding already covers the complete article and the versioned source
  // catalogue. Bind to the content of each decision, not to its timestamp or checksum:
  // re-recording the same judgment, or typing on a row that was never recorded, changes
  // no verdict. A draft only counts while it hides a recorded decision.
  function bind(report) {
    return JSON.stringify([version, report.rows.map(row => {
      const record = row.receipt ?? row.draftRecord;
      const {recordedAt, checksum, ...judgment} = record ?? {};
      return [row.id, row.binding, row.status, record ? judgment : null, !!(row.draftPending && record)];
    })]);
  }

  // Work files written before the content binding used receipt checksums. Such a binding
  // still identifies the same decisions when it matches the current report exactly.
  function legacyBind(report) {
    return JSON.stringify([version, report.rows.map(row => [
      row.id, row.binding, row.status, row.receipt?.checksum ?? null, !!row.draftPending
    ])]);
  }
  function matches(binding, report) {
    return binding === bind(report) || (!report.rows.some(row => row.draftRecord) && binding === legacyBind(report));
  }

  function bindCore(report) {
    return JSON.stringify([version, report.rows.map(row => [row.id, row.articleBinding])]);
  }

  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const string = value => typeof value === 'string' ? value.trim() : '';

  function secondAnchor(report, row, quote, comparison, compareRowId) {
    if (!comparison) return false;
    const offset = row.text.indexOf(quote);
    const disjoint = (first, other) => other + comparison.length <= first || other >= first + quote.length;
    if (compareRowId) {
      const otherRow = report.rows.find(item => item.id === compareRowId);
      if (!otherRow || !otherRow.text.includes(comparison)) return false;
      // Adjacent repeated units can share a row ID. Their original article
      // occurrences are distinct; two copies of one physical span are not.
      const first = row.positions[0].start + offset;
      const left = otherRow.positions[0].start + otherRow.text.indexOf(comparison);
      const right = otherRow.positions.at(-1).start + otherRow.text.lastIndexOf(comparison);
      return disjoint(first, left) || disjoint(first, right);
    }
    // Before the comparison row was stored, a unique global excerpt identified it.
    const other = report.article.indexOf(comparison);
    if (other < 0 || other !== report.article.lastIndexOf(comparison)) return false;
    return row.positions.every(position => disjoint(position.start + offset, other));
  }

  const passageText = value => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '');

  function sameSourceLocation(sources, a, b) {
    if (a.id === b.id) return true;
    if (!engine.sameSourceDocument(sources, a, b)) return false;
    const page = s => s.pdfPage || engine.sourceTarget(s)?.page || '';
    const firstPage = page(a), secondPage = page(b);
    if (firstPage && secondPage && String(firstPage) !== String(secondPage)) return false;
    return passageText(a.locator) === passageText(b.locator);
  }

  function comparisonEvidence(rating, sources, source, sourceQuote, quote, compareQuote) {
    const firstClaim = passageText(quote), secondClaim = passageText(compareQuote);
    if (!firstClaim || !secondClaim || firstClaim === secondClaim) {
      throw new Error('기사에서 비교할 주체나 주장이 각각 드러나는 두 구절을 옮기세요.');
    }
    const other = sources.find(s => s.id === rating.compareSourceId);
    const otherQuote = string(rating.compareSourceQuote);
    if (!other || !otherQuote || !other.excerpt.includes(otherQuote)) {
      throw new Error('둘째 기사 구절의 근거가 있는 원자료와 해당 발췌문 속 구절을 입력하세요.');
    }
    const left = passageText(sourceQuote), right = passageText(otherQuote);
    if (!left || !right) throw new Error('각 주장의 근거를 확인할 수 있는 자료 구절을 옮기세요.');
    if (sameSourceLocation(sources, source, other)) {
      // The same document may cover both parties. A copied or overlapping passage at
      // one location does not supply two citations, even through another catalogue ID.
      const texts = [source.excerpt, other.excerpt].map(passageText);
      const common = texts.filter(t => t.includes(left) && t.includes(right));
      if (left.includes(right) || right.includes(left) || (common.length && !common.some(t =>
        t.indexOf(left) + left.length <= t.lastIndexOf(right) || t.indexOf(right) + right.length <= t.lastIndexOf(left)))) {
        throw new Error('같은 자료 위치에서는 두 주장의 근거가 각각 드러나는 겹치지 않는 구절을 옮기세요.');
      }
    }
    return {compareSourceId: other.id, compareSourceQuote: otherQuote};
  }

  function ratingFor(dimension, rating, report, sources, legacyDraft = false) {
    const reason = string(rating?.reason);
    if (!object(rating) || !reason) throw new Error(dimension.title + '의 판정 이유를 적으세요.');
    if (rating.level === 'na' && dimension.allowNA) return {level: 'na', reason};
    const level = rating.level;
    if (!Number.isInteger(level) || level < 0 || level > 3) throw new Error(dimension.title + '의 적용 가능한 단계를 선택하세요.');
    const row = report.rows.find(item => item.id === rating.rowId);
    const quote = string(rating.quote);
    if (!row || !quote || !row.text.includes(quote)) throw new Error(dimension.title + '의 기사 구절을 선택한 항목에서 그대로 옮기세요.');
    const source = sources.find(item => item.id === rating.sourceId);
    const sourceQuote = string(rating.sourceQuote);
    if (!source || !sourceQuote || !source.excerpt.includes(sourceQuote)) throw new Error(dimension.title + '에서 대조한 원자료와 발췌문 속 실제 구절을 입력하세요.');
    const impact = level > 0 ? string(rating.impact) : '';
    if (level > 0 && !impact) throw new Error(dimension.title + ' 때문에 독자의 어떤 판단이 어떻게 달라지는지 적으세요.');
    const needsComparison = ['framing', 'standards'].includes(dimension.id);
    const compareQuote = needsComparison ? string(rating.compareQuote) : '';
    const compareRowId = needsComparison ? rating.compareRowId ?? '' : '';
    if (needsComparison && (typeof compareRowId !== 'string' || !secondAnchor(report, row, quote, compareQuote, compareRowId))) {
      throw new Error(dimension.title + '에서 비교한 다른 기사 구절을 위치가 분명하고 첫 구절과 겹치지 않게 옮기세요.');
    }
    const secondSource = dimension.id === 'standards' && !legacyDraft
      ? comparisonEvidence(rating, sources, source, sourceQuote, quote, compareQuote) : {};
    return {level, rowId: row.id, quote, sourceId: source.id, sourceQuote, reason, impact, compareQuote, compareRowId, ...secondSource,
      direction: level > 0 ? string(rating.direction) : ''};
  }

  function save(report, sources, input) {
    if (!report.rows.length) throw new Error('먼저 기사 본문으로 검토 항목을 만드세요.');
    if (!object(input) || !Array.isArray(input.coreRowIds) || !object(input.ratings)) throw new Error('기사 평가 입력 형식을 확인하세요.');
    const ids = new Set(report.rows.map(row => row.id));
    if (input.coreRowIds.some(id => !ids.has(id)) || new Set(input.coreRowIds).size !== input.coreRowIds.length) {
      throw new Error('현재 기사에서 제목 또는 핵심 결론에 해당하는 항목을 선택하세요.');
    }
    if (Object.keys(input.ratings).some(id => !dimensions.some(d => d.id === id))) throw new Error('알 수 없는 편향 기준이 있습니다.');
    const ratings = {};
    for (const dimension of dimensions) {
      if (Object.hasOwn(input.ratings, dimension.id)) ratings[dimension.id] = ratingFor(dimension, input.ratings[dimension.id], report, sources);
    }
    return {version, binding: bind(report), coreBinding: bindCore(report), coreRowIds: [...input.coreRowIds], ratings};
  }

  function classify(row) {
    const r = row.receipt;
    const result = (category, label, scope) => ({rowId: row.id, category, label, scope});
    if (row.draftPending || !r || r.rowId !== row.id || r.binding !== row.binding || row.status !== r.status) {
      return result('unresolved', row.draftPending ? '판단 작성 중' : '미확인', row.text);
    }
    switch (r.status) {
      case 'fact': return result('supported', '원자료 지지', row.text);
      case 'contradicted': return result('contradicted', '원문이 근거와 충돌', row.text);
      case 'opinion': return result('excluded', '의견·평가', row.text);
      case 'mixed': return result('supported', '사실 구절만 지지', r.factSpan);
      case 'partial': return result('unresolved', '부분 확인 · 나머지 미확인', r.factSpan);
      case 'attribution':
        if (r.contentStatus === 'contradicted') return result('quotedConflict', '발언 귀속 확인 · 인용 속 사실 주장 충돌', r.contentClaim);
        if (r.contentStatus === 'supported') return result('supported', '발언과 내용의 근거 확인', row.text);
        if (r.contentStatus === 'opinion') return result('supported', '발언 사실 확인 · 내용은 의견이나 전망', row.text);
        return result('unresolved', '발언 사실 확인 · 담긴 주장 미확인', row.text);
      default: return result('unresolved', '원자료 판단 보류', row.text);
    }
  }

  function accuracyFor(report, coreRows) {
    const rows = report.rows.map(classify);
    const count = key => rows.filter(row => row.category === key).length;
    const supported = count('supported'), contradicted = count('contradicted'), unresolved = count('unresolved');
    const quotedConflict = count('quotedConflict');
    const adjudicated = supported + contradicted, reviewed = adjudicated + quotedConflict, total = reviewed + unresolved;
    const core = new Set(coreRows);
    const selected = key => rows.filter(row => core.has(row.rowId) && row.category === key).map(row => row.rowId);
    const coreContradicted = selected('contradicted'), coreUnresolved = selected('unresolved'), coreExcluded = selected('excluded');
    const coreQuotedConflict = selected('quotedConflict');
    const limited = report.rows.filter((row, index) => rows[index].category === 'supported'
      && (row.status === 'mixed' || (row.status === 'attribution' && row.receipt.contentStatus === 'opinion')));
    const coreLimited = limited.filter(row => core.has(row.id)).map(row => row.id);
    const summary = [];
    if (coreContradicted.length) summary.push('지정한 핵심 항목 ' + coreContradicted.length + '개가 원자료와 충돌합니다.');
    if (coreQuotedConflict.length) summary.push('지정한 핵심 항목 중 ' + coreQuotedConflict.length + '개에서 발언 귀속을 확인했고, 인용 속 사실 주장은 독립 원자료와 충돌했습니다.');
    if (coreUnresolved.length) summary.push('지정한 핵심 항목 ' + coreUnresolved.length + '개는 판단이 남아 있습니다.');
    if (coreExcluded.length) summary.push('지정한 핵심 항목 ' + coreExcluded.length + '개는 의견·평가로 두 비율의 분모에서 제외했습니다.');
    if (coreLimited.length) summary.push('지정한 핵심 항목 ' + coreLimited.length + '개는 사실 구절 또는 발언 사실만 근거로 확인했습니다.');
    if (!total) summary.push('지금 집계할 사실 확인 항목이 없습니다.');
    else if (!adjudicated) summary.push('기사 서술에 대해 지지·충돌 판정을 마친 항목이 없어 근거 지지율을 계산할 수 없습니다.');
    else if (unresolved) summary.push('미확인 ' + unresolved + '개가 남아 있습니다. 지지율은 판정을 마친 ' + adjudicated + '개에만 적용됩니다.');
    else summary.push('판정을 마친 ' + adjudicated + '개 중 원자료가 지지한 항목은 ' + supported + '개입니다.');
    if (limited.length) {
      const mixed = limited.filter(row => row.status === 'mixed').length;
      const scopeCounts = ['구간 전체의 사실 확인 ' + (supported - limited.length) + '개'];
      if (mixed) scopeCounts.push('사실과 평가가 섞여 사실 구절만 확인 ' + mixed + '개');
      if (limited.length > mixed) scopeCounts.push('의견·전망을 인용해 발언 사실만 확인 ' + (limited.length - mixed) + '개');
      summary.push('근거가 지지한 ' + supported + '개 구간의 확인 범위는 ' + scopeCounts.join(', ') + '입니다.');
    }
    if (quotedConflict) summary.push('인용 속 사실 주장 충돌 ' + quotedConflict + '건은 근거 지지율의 분모에서 제외하고 판정 완료율에 포함했습니다.');
    if (total && !core.size) summary.push('제목·핵심 결론으로 지정한 항목은 없습니다.');
    return {supported, contradicted, quotedConflict, unresolved, excluded: count('excluded'), adjudicated, reviewed, total,
      accuracyPct: adjudicated ? 100 * supported / adjudicated : null,
      coveragePct: total ? 100 * reviewed / total : null,
      partialCount: report.rows.filter(r => !r.draftPending && r.receipt?.status === 'partial').length,
      attributionOnlyCount: report.rows.filter(r => !r.draftPending && r.receipt?.contentStatus === 'unverified').length,
      coreRowIds: [...coreRows], coreContradicted, coreQuotedConflict, coreUnresolved, coreExcluded, coreLimited, rows, summary: summary.join(' ')};
  }

  function biasFor(ratings) {
    const items = dimensions.map(d => ({id: d.id, title: d.title, rating: ratings[d.id] ?? null}));
    const levels = items.filter(i => Number.isInteger(i.rating?.level)).map(i => i.rating.level);
    const notApplicable = items.filter(i => i.rating?.level === 'na').length;
    const unknown = items.length - levels.length - notApplicable;
    const maxLevel = levels.length ? Math.max(...levels) : null;
    let summary;
    if (maxLevel === null) summary = '근거를 대조해 단계가 정해진 기준이 없습니다.';
    else if (maxLevel === 0) summary = '대조한 ' + levels.length + '개 기준에서 뚜렷한 치우침을 찾지 못했습니다.';
    else summary = '대조한 기준에서 확인된 가장 큰 영향은 ' + maxLevel + '단계(' + severityLabels[maxLevel] + ')입니다.';
    if (unknown) summary += ' 자료 또는 판단이 부족한 기준은 ' + unknown + '개입니다.';
    if (notApplicable) summary += ' 적용 대상에서 제외한 기준은 ' + notApplicable + '개입니다.';
    return {assessed: levels.length, notApplicable, unknown, maxLevel, summary, items};
  }

  function evaluate(report, sources, stored = null) {
    let saved = null, stale = stored != null;
    if (stored && report.rows.length && stored.version === version && stored.coreBinding === bindCore(report)) {
      // Core selections bind to the article alone. An obsolete ID or a damaged
      // citation in one dimension does not invalidate the other selections.
      const knownIds = new Set(report.rows.map(row => row.id));
      const core = Array.isArray(stored.coreRowIds) ? [...new Set(stored.coreRowIds.filter(id => knownIds.has(id)))] : [];
      saved = save(report, sources, {coreRowIds: core, ratings: {}});
      stale = !Array.isArray(stored.coreRowIds) || core.length !== stored.coreRowIds.length || !object(stored.ratings);
      if (object(stored.ratings) && Object.keys(stored.ratings).length) {
        if (matches(stored.binding, report)) {
          for (const [id, raw] of Object.entries(stored.ratings)) {
            const dimension = dimensions.find(d => d.id === id);
            if (!dimension) { stale = true; continue; }
            try { saved.ratings[id] = ratingFor(dimension, raw, report, sources); }
            catch (_) { stale = true; }
          }
        } else stale = true;
      }
    }
    return {accuracy: accuracyFor(report, saved?.coreRowIds ?? []), bias: biasFor(saved?.ratings ?? {}), saved, stale};
  }

  const fields = ['level', 'rowId', 'quote', 'sourceId', 'sourceQuote', 'compareRowId', 'compareQuote', 'compareSourceId', 'compareSourceQuote', 'reason', 'impact', 'direction'];
  function copyFields(raw) {
    return Object.fromEntries(fields.map(key => [key, raw[key] == null ? '' : String(raw[key])]));
  }
  function legacyStandardsDraft(report, sources, rating) {
    if (!Number.isInteger(rating?.level) || 'compareSourceId' in rating || 'compareSourceQuote' in rating) return null;
    try {
      return copyFields(ratingFor(dimensions.find(d => d.id === 'standards'), rating, report, sources, true));
    } catch (_) { return null; }
  }
  function restoreDraft(report, sources, raw, saved = null) {
    const valid = raw && matches(raw.binding, report);
    const entries = {};
    for (const dim of dimensions) {
      const d = object(raw?.entries) && raw.entries[dim.id];
      if (!d || typeof d !== 'object' || fields.some(k => d[k] != null && typeof d[k] !== 'string')) continue;
      if (!valid && !(dim.id === 'standards' && !d.previous && typeof d.addedSourceBinding === 'string'
          && matches(d.addedSourceBinding, report))) continue;
      const clean = copyFields(d);
      if (!['', '0', '1', '2', '3', ...(dim.allowNA ? ['na'] : [])].includes(clean.level)) continue;
      if (clean.rowId && !report.rows.some(row => row.id === clean.rowId)) continue;
      if (clean.sourceId && !sources.some(s => s.id === clean.sourceId)) continue;
      if (clean.compareSourceId && !sources.some(s => s.id === clean.compareSourceId)) continue;
      if (clean.compareRowId && !report.rows.some(row => row.id === clean.compareRowId)) continue;
      if (d.previous) {
        try {
          const checked = save(report, sources, {coreRowIds: [], ratings: {[dim.id]: d.previous}});
          clean.previous = checked.ratings[dim.id];
        } catch (_) {
          if (dim.id === 'standards') clean.legacyPrevious = legacyStandardsDraft(report, sources, d.previous);
        }
      }
      if (dim.id === 'standards' && d.legacyPrevious && !clean.previous) {
        const prior = {...d.legacyPrevious, level: Number(d.legacyPrevious.level)};
        delete prior.compareSourceId; delete prior.compareSourceQuote;
        clean.legacyPrevious = legacyStandardsDraft(report, sources, prior);
      }
      entries[dim.id] = clean;
    }
    if (saved?.version === version && saved.coreBinding === bindCore(report) && matches(saved.binding, report)) {
      const legacy = legacyStandardsDraft(report, sources, saved.ratings?.standards);
      if (legacy) {
        if (!entries.standards) entries.standards = {...legacy, legacyPrevious: legacy};
        else if (!entries.standards.previous) entries.standards.legacyPrevious ??= legacy;
      }
    }
    if (!Object.keys(entries).length) return null;
    return {binding: bind(report), activeId: Object.hasOwn(entries, raw?.activeId) ? raw.activeId : '', entries};
  }

  const api = Object.freeze({version, severityLabels, dimensions, bind, matches, save, evaluate, draftFields: fields, copyFields, restoreDraft});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalArticleRubric = api;
})(globalThis);
