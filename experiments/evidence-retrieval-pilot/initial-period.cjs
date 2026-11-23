// Describe explicit dates in a query and the first cell of a candidate row.
// This is display-only: it cannot change retrieval order, quotations or verdicts.
(function (root) {
  'use strict';

  const years = /(?<!\d)(?:19|20)\d{2}(?!\d)/gu;
  const comparison = /대비|비교|전년|전월|전분기|지난해|지난달|전년도|직전|작년|올해|내년|증가|감소|증감|상승|하락|늘었|줄었|부터|까지|사이|분기|반기|[~∼～–—]|(?<!\d)\d{1,2}\s*-\s*\d{1,2}\s*월|\d\s*-\s*(?:'|’)?\d{2,4}년/u;
  const month = '(0?[1-9]|1[0-2])';
  const koreanMonth = new RegExp('^년\\s*' + month + '\\s*월', 'u');
  const numericMonth = new RegExp('^[./-]\\s*' + month + '(?![\\d,.]\\d)(?!\\d)', 'u');

  function periodAtYear(text, allowBare) {
    const year = /^(?:19|20)\d{2}(?!\d)/u.exec(text)?.[0];
    if (!year) return null;
    const tail = text.slice(4);
    const m = koreanMonth.exec(tail) || numericMonth.exec(tail);
    const suffix = m?.[0] || /^(?:년(?:도)?|회계연도)/u.exec(tail)?.[0] || '';
    if (!suffix && !allowBare) return null;
    return {year, month: m ? Number(m[1]) : null, explicit: Boolean(suffix), tail: tail.slice(suffix.length)};
  }

  function requestedPeriod(query) {
    const text = query.normalize('NFKC');
    const mentions = [...text.matchAll(years)];
    if (mentions.length !== 1 || comparison.test(text) || (text.match(/\d+\s*월/gu) || []).length > 1) return null;
    return periodAtYear(text.slice(mentions[0].index), false);
  }

  function firstPeriod(line) {
    const text = line.normalize('NFKC').trim().replace(/^\|\s*/u, '');
    const p = periodAtYear(text, true);
    if (!p || !/^\.?[\s|]+/u.test(p.tail)) return null;
    // A year at the start of ordinary prose or a range does not identify a data row.
    const cells = p.tail.replace(/^\./u, '').trim();
    if (!/\d/u.test(cells) || /[.!?。]$/u.test(cells) || /(?:분기|반기|\d+\s*월|부터|까지)/u.test(cells)) return null;
    if ([...cells.matchAll(years)].length || !/(?:^|[\s|])[+△−-]?\d[\d,.]*%?(?:$|[\s|])/u.test(cells)) return null;
    return p;
  }

  function different(query, hit) {
    const asked = requestedPeriod(query);
    if (!asked) return null;
    const source = firstPeriod(hit.text);
    if (!source || (asked.year === source.year && (!asked.month || !source.month || asked.month === source.month))) return null;
    const context = hit.context || [];
    // If years are column labels, their relationship to the leading cell is unresolved.
    if (context.some(row => {
      const text = row.text.normalize('NFKC').trim();
      return /(?:19|20)\d{2}년?(?:\s*\|\s*|\s+)(?:19|20)\d{2}(?:년|\s|\||$)/u.test(text);
    })) return null;
    // A bare 4-digit cell can also be an amount or a count. Require a year header
    // or a neighbouring data row with another plausible adjacent year.
    if (!source.explicit && context.some(row =>
      /^\s*\|?\s*(?:금액|가격|수량|인구|인원|번호|코드|단가|소득|거리)(?:\s|\(|\||$)/u.test(row.text))) return null;
    if (!source.explicit && !context.some(row => {
      if (/^\s*\|?\s*(?:연도|연월|년도|기준연도|기준년월)(?:\s|\||$)/u.test(row.text)) return true;
      const other = firstPeriod(row.text);
      return Math.abs(row.paragraph - hit.paragraph) <= 2 && other && Math.abs(Number(other.year) - Number(source.year)) === 1;
    })) return null;
    const label = p => p.year + '년' + (p.month ? ' ' + p.month + '월' : '');
    return {requested: label(asked), source: label(source)};
  }

  const api = {different};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidencePeriod = api;
})(globalThis);
