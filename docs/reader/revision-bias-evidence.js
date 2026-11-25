/* Compare the locations editors cited, independently of their scores or reasons. */
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const workspace = useNode ? require('./workspace-snapshot.js') : root.JournalWorkspaceSnapshot;
  const engine = useNode ? require('./factcheck-engine.js') : root.JournalFactcheck;

  function allRequired(statuses) {
    if (statuses.includes('different')) return 'different';
    return statuses.includes('unresolved') ? 'unresolved' : 'aligned';
  }

  // The second order is an alternative assignment, never a mixture of its pairs.
  function eitherOrder(direct, reversed) {
    if ([direct, reversed].includes('aligned')) return 'aligned';
    return [direct, reversed].includes('unresolved') ? 'unresolved' : 'different';
  }

  function uniqueSpan(text, quote, offset = 0) {
    if (typeof quote !== 'string' || !quote.trim()) return null;
    const start = text.indexOf(quote);
    if (start < 0 || start !== text.lastIndexOf(quote)) return null;
    return {start:offset + start, end:offset + start + quote.length};
  }

  // Compare absolute offsets only after establishing their shared coordinate system.
  function overlap(text, a, b) {
    if (!a || !b) return 'unresolved';
    const start = Math.max(a.start, b.start), end = Math.min(a.end, b.end);
    if (start >= end) return 'different';
    if ((a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end)) return 'aligned';
    // A partial overlap consisting of punctuation or a word ending is inconclusive.
    const token = /[\p{L}\p{M}\p{N}]+/gu;
    for (const match of text.slice(start, end).matchAll(token)) {
      const from = start + match.index, to = from + match[0].length;
      if ((from === 0 || !/[\p{L}\p{M}\p{N}]/u.test(text[from - 1])) &&
          (to === text.length || !/[\p{L}\p{M}\p{N}]/u.test(text[to]))) return 'aligned';
    }
    return 'unresolved';
  }

  function articleSpan(view, rating, second) {
    const rowId = second ? rating.compareRowId : rating.rowId;
    const quote = second ? rating.compareQuote : rating.quote;
    // Older framing/standards records could identify a second quote by its sole occurrence.
    if (second && !rowId) return uniqueSpan(view.article, quote);
    const row = view.rows.find(item => item.id === rowId);
    if (row?.positions.length !== 1) return null;
    return uniqueSpan(row.text, quote, row.positions[0].start);
  }

  function citation(view, rating, second) {
    const id = second ? rating.compareSourceId : rating.sourceId;
    const quote = second ? rating.compareSourceQuote : rating.sourceQuote;
    const source = view.sources.find(item => item.id === id);
    return source ? {source, span:uniqueSpan(source.excerpt, quote)} : null;
  }

  function sourceStatus(a, b, catalog) {
    if (!a?.span || !b?.span) return 'unresolved';
    const first = a.source, second = b.source;
    if (workspace.sourceIdentity(first) === workspace.sourceIdentity(second)) return overlap(first.excerpt, a.span, b.span);
    const sameFile = !!first.pdfSha256 && first.pdfSha256 === second.pdfSha256;
    if (first.pdfSha256 && second.pdfSha256 && !sameFile) return 'different';
    if (!engine.sameSourceDocument(catalog, first, second)) return 'different';
    const firstTarget = engine.sourceTarget(first), secondTarget = engine.sourceTarget(second);
    const firstPage = first.pdfPage || firstTarget?.page, secondPage = second.pdfPage || secondTarget?.page;
    const samePdfAddress = firstTarget?.page && secondTarget?.page && first.version === second.version &&
      firstTarget.href.split('#')[0] === secondTarget.href.split('#')[0];
    if ((sameFile || samePdfAddress) && firstPage && secondPage) {
      if (String(firstPage) !== String(secondPage)) return 'different';
      if (sameFile && first.locator === second.locator && first.excerpt === second.excerpt) {
        return overlap(first.excerpt, a.span, b.span);
      }
    }
    // A related document, matching page label, or similar excerpt alone does not
    // locate the two selections in one registered clip.
    return 'unresolved';
  }

  function numeric(rating) {
    return Number.isInteger(rating?.level) && rating.level >= 0 && rating.level <= 3;
  }

  function compareRatings(left, right, leftView, rightView, dimension, withArticle) {
    if (!numeric(left) || !numeric(right) || !leftView || !rightView ||
        (withArticle && leftView.article !== rightView.article)) return {category:'unresolved'};
    const standards = dimension === 'standards';
    const paired = standards || (withArticle && dimension === 'framing');
    const catalog = [...leftView.sources, ...rightView.sources];
    const leftSources = [citation(leftView, left, false)], rightSources = [citation(rightView, right, false)];
    if (standards) {
      leftSources.push(citation(leftView, left, true));
      rightSources.push(citation(rightView, right, true));
    }
    const leftSpans = [], rightSpans = [];
    if (withArticle) {
      for (const second of paired ? [false, true] : [false]) {
        leftSpans.push(articleSpan(leftView, left, second));
        rightSpans.push(articleSpan(rightView, right, second));
      }
    }
    function order(reversed) {
      const statuses = leftSources.map((source, i) => sourceStatus(source,
        rightSources[reversed && standards ? 1 - i : i], catalog));
      for (const [i, span] of leftSpans.entries()) {
        statuses.push(overlap(leftView.article, span, rightSpans[reversed ? 1 - i : i]));
      }
      return allRequired(statuses);
    }
    const direct = order(false);
    return {category:paired && direct !== 'aligned' ? eitherOrder(direct, order(true)) : direct};
  }

  function compare(left, right, leftView, rightView, dimension) {
    return compareRatings(left, right, leftView, rightView, dimension, true);
  }
  function compareSources(left, right, leftView, rightView, dimension) {
    return compareRatings(left, right, leftView, rightView, dimension, false);
  }
  const api = Object.freeze({compare, compareSources});
  if (useNode) module.exports = api;
  else root.JournalRevisionBiasEvidence = api;
})(globalThis);
