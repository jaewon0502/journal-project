// Describe explicit dates in a query and the first cell of a candidate row.
// Periods are navigation cues. All dates refer to the printed local calendar.
(function (root) {
  'use strict';

  const years = /(?<!\d)(?:19|20)\d{2}(?!\d)/gu;
  const comparison = /대비|비교|전년|전월|전분기|지난해|지난달|전년도|직전|작년|올해|내년|증가|감소|증감|상승|하락|늘었|줄었|부터|까지|사이|분기|반기|[~∼～–—]|(?<!\d)\d{1,2}\s*-\s*\d{1,2}\s*월|\d\s*-\s*(?:'|’)?\d{2,4}년/u;
  const month = '(0?[1-9]|1[0-2])';
  const koreanMonth = new RegExp('^년\\s*' + month + '\\s*월', 'u');
  const numericMonth = new RegExp('^[./-]\\s*' + month + '(?![\\d,.]\\d)(?!\\d)', 'u');

  // Read the calendar date as printed. Converting a timestamp to local time can
  // move a month-end or year-end observation into the next reporting period.
  function calendarPeriod(year, monthDigits, dayDigits, rest) {
    const month = Number(monthDigits), day = Number(dayDigits);
    if (monthDigits.length > 2 || dayDigits.length > 2 || month < 1 || month > 12 ||
        day < 1 || day > new Date(Date.UTC(Number(year), month, 0)).getUTCDate()) return null;
    const startsTime = /^(?:[Tt]|[ \t]+[+−-]?\d+:)/u.test(rest);
    if (startsTime) {
      const clock = /^(?:[Tt]|[ \t]+)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?(?![\d:.+Z-])/iu.exec(rest);
      if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3]) > 59 ||
          Number(clock[4]) > 14 || Number(clock[5]) > 59 || (Number(clock[4]) === 14 && Number(clock[5]) !== 0)) return null;
      rest = rest.slice(clock[0].length);
    }
    if (/^(?:[TtZz:/+−-]|\.\d|[A-Za-z0-9])/u.test(rest)) return null;
    return {year, month, day, explicit: true, tail: rest};
  }

  function periodAtYear(text, allowBare) {
    const year = /^(?:19|20)\d{2}(?!\d)/u.exec(text)?.[0];
    if (!year) return null;
    const tail = text.slice(4);
    const koreanDate = /^년\s*(\d+)\s*월\s*(\d+)\s*일/u.exec(tail);
    if (koreanDate) return calendarPeriod(year, koreanDate[1], koreanDate[2], tail.slice(koreanDate[0].length));
    // One optional space accepts Korean dotted dates. Two spaces or a tab after
    // a trailing dot can mark the next numeric table cell in a year-month row.
    if (/^[./-] ?\d+[./-] ?\d/u.test(tail)) {
      const date = /^([./-]) ?(\d+)\1 ?(\d+)/u.exec(tail);
      if (!date) return null;
      return calendarPeriod(year, date[2], date[3], tail.slice(date[0].length));
    }
    const m = koreanMonth.exec(tail) || numericMonth.exec(tail);
    if (!m && /^년\s*\d+\s*월/u.test(tail)) return null;
    const suffix = m?.[0] || /^(?:년(?:도)?|회계연도)/u.exec(tail)?.[0] || '';
    if (!suffix && !allowBare) return null;
    return {year, month: m ? Number(m[1]) : null, explicit: Boolean(suffix), tail: tail.slice(suffix.length)};
  }

  function requestedPeriod(query) {
    const text = query.normalize('NFKC');
    const mentions = [...text.matchAll(years)];
    if (mentions.length !== 1 || comparison.test(text) || (text.match(/\d+\s*월/gu) || []).length > 1) return null;
    const period = periodAtYear(text.slice(mentions[0].index), false);
    // One written month can govern multiple observation days (e.g. "6일과 9일").
    if (period && (/\d+\s*일/u.test(period.tail) || (text.match(/\d+\s*일/gu) || []).length > 1)) return null;
    return period;
  }

  // Some Korean tables mark both years with apostrophes. Keep those printed
  // dates in the notice; compare all plausible centuries before reporting a gap.
  function rangeDate(text) {
    const korean = /^((?:19|20)\d{2}|['’‘]\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/u.exec(text);
    const numeric = /^((?:19|20)\d{2}|['’‘]\d{2})([-./]) ?(\d{1,2})\2 ?(\d{1,2})\.?(?![\d.])/u.exec(text);
    if (!korean && !numeric) return null;
    const [label, year] = korean || numeric;
    return {
      label, year: year.replace(/^['’‘]/u, ''),
      month: Number(korean ? korean[2] : numeric[3]), day: Number(korean ? korean[3] : numeric[4])
    };
  }

  function rangeRelation(asked, line) {
    const text = line.normalize('NFKC').trim().replace(/^\|\s*/u, '');
    const start = rangeDate(text);
    if (!start) return undefined;
    const separator = /^(?:\s*[~∼–—]\s*|\s+-\s+)/u.exec(text.slice(start.label.length));
    if (!separator) return undefined;
    const rest = text.slice(start.label.length + separator[0].length);
    const end = rangeDate(rest);
    if (!end) return null;
    const cells = rest.slice(end.label.length);
    if (!/^[\s|,]+[+△−-]?\d[\d,.]*(?:%|원|명|건)?(?=$|[\s|,])/u.test(cells) ||
        /[~∼–—]|[.!?。]$/u.test(cells.trim())) return null;

    const anchor = [start.year, end.year].find(year => year.length === 4) || asked.year;
    const century = Math.floor(Number(anchor) / 100) * 100;
    const choices = year => year.length === 4 ? [Number(year)] :
      [century - 100, century, century + 100].map(base => base + Number(year));
    const month = asked.month || 1;
    const requestedStart = Date.UTC(Number(asked.year), month - 1, asked.day || 1);
    const requestedEnd = asked.day ? requestedStart : Date.UTC(Number(asked.year), asked.month || 12, 0);
    const abbreviated = start.year.length === 2 || end.year.length === 2;
    let valid = false;
    for (const startYear of choices(start.year)) {
      for (const endYear of choices(end.year)) {
        if (endYear < startYear || (abbreviated && endYear > startYear + 1)) continue;
        // If even leap-day validity depends on the unknown century, abstain.
        if (!calendarPeriod(String(startYear), String(start.month), String(start.day), '') ||
            !calendarPeriod(String(endYear), String(end.month), String(end.day), '')) return null;
        const first = Date.UTC(startYear, start.month - 1, start.day);
        const last = Date.UTC(endYear, end.month - 1, end.day);
        if (last < first) continue;
        valid = true;
        if (first <= requestedEnd && requestedStart <= last) return {overlaps: true};
      }
    }
    if (!valid) return null;
    const day = asked.day ? ' ' + asked.day + '일' : '';
    return {overlaps: false, notice: {requested: label(asked) + day, source: start.label + ' ~ ' + end.label}};
  }

  function label(p) {
    return p.year + '년' + (p.month ? ' ' + p.month + '월' : '');
  }

  function firstPeriod(line) {
    const text = line.normalize('NFKC').trim().replace(/^\|\s*/u, '')
      .replace(/^((?:19|20)\d{2})[ \t]+(?=\d{1,2}월(?:\s|\d{1,2}일|$))/u, '$1년 ');
    const p = periodAtYear(text, true);
    if (!p || !/^\.?[\s|,]+/u.test(p.tail) || (!p.explicit && p.tail.startsWith(','))) return null;
    // A year at the start of ordinary prose or a range does not identify a data row.
    const cells = p.tail.replace(/^\.?[\s|,]+/u, '').trim();
    if (!/\d/u.test(cells) || /[.!?。]$/u.test(cells) || comparison.test(cells) || /\d+\s*월/u.test(cells)) return null;
    if ([...cells.matchAll(years)].length || !/(?:^|[\s|])[+△−-]?\d[\d,.]*%?(?:$|[\s|])/u.test(cells)) return null;
    return p;
  }

  function different(query, hit) {
    const asked = requestedPeriod(query);
    if (!asked) return null;
    const context = hit.context || [];
    // If years are column labels, their relationship to the leading cell is unresolved.
    if (context.some(row => {
      const text = row.text.normalize('NFKC').trim();
      return /(?:19|20)\d{2}년?(?:\s*\|\s*|\s+)(?:19|20)\d{2}(?:년|\s|\||$)/u.test(text);
    })) return null;
    if (/[~∼～–—]|\s-\s/u.test(hit.text)) {
      const relation = rangeRelation(asked, hit.text);
      if (relation !== undefined) return relation?.notice || null; // The first date alone cannot establish a mismatch.
    }
    const source = firstPeriod(hit.text);
    if (source && asked.year === source.year && asked.month === source.month &&
        asked.day && source.day && asked.day !== source.day) {
      return {requested: label(asked) + ' ' + asked.day + '일', source: label(source) + ' ' + source.day + '일'};
    }
    if (!source || (asked.year === source.year && (!asked.month || !source.month || asked.month === source.month))) return null;
    // A bare 4-digit cell can also be an amount or a count. Require a year header
    // or a neighbouring data row with another plausible adjacent year.
    if (!source.explicit && context.some(row =>
      /^\s*\|?\s*(?:금액|가격|수량|인구|인원|번호|코드|단가|소득|거리)(?:\s|\(|\||$)/u.test(row.text))) return null;
    if (!source.explicit && !context.some(row => {
      if (/^\s*\|?\s*(?:연도|연월|년도|기준연도|기준년월)(?:\s|\||$)/u.test(row.text)) return true;
      const other = firstPeriod(row.text);
      return Math.abs(row.paragraph - hit.paragraph) <= 2 && other && Math.abs(Number(other.year) - Number(source.year)) === 1;
    })) return null;
    return {requested: label(asked), source: label(source)};
  }

  // The caller has established that the leading table column is a date or
  // application period. Other dates in the same row never identify this record.
  function matchesTablePeriod(asked, text) {
    if (/[~∼～–—]|\s-\s/u.test(text)) {
      const range = rangeRelation(asked, text);
      if (range !== undefined) return range?.overlaps === true;
    }
    const cell = firstPeriod(text);
    return Boolean(cell && asked.year === cell.year && (!asked.month || asked.month === cell.month) &&
      (!asked.day || asked.day === cell.day));
  }

  function dateCell(text) {
    const period = periodAtYear(text.normalize('NFKC').trim(), false);
    return period?.day && /^\.?$/u.test(period.tail) ? period : null;
  }

  const api = {different, requestedPeriod, matchesTablePeriod, dateCell};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidencePeriod = api;
})(globalThis);
