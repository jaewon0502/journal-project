// Locate candidate passages in a local document. Word overlap gives no verdict.
(function (root) {
  'use strict';

  const stop = new Set('그리고 그러나 하지만 이에 대해 대한 이번 지난 관련 기자 기사 있다 있는 했다 밝혔다 따르면 하는 한다 것을 사실 발언 주장 말했다 대한 해당 이다 또한 the and said that this for'.split(' '));
  const particle = /(으로부터|에서는|으로는|에서|에게|부터|까지|보다|으로|에는|에도|와의|의|은|는|이|가|을|를|와|과|에|도|로)$/u;
  const statisticalLabels = new Map([['남성', '남자'], ['여성', '여자']]);

  // Each distinct word yields one term: its key (the stem when it has two or more
  // letters) plus the forms it can match. Indexing the word as written as well as its
  // stem lets 전문가 match 전문가는 and 어린이가 match 어린이, while the word is still
  // scored once.
  function terms(text) {
    // Keep magnitude and unit on the number: 27억 and 27만 must not both become 27,
    // and 21%포인트, 21%p and 1,000 must match their other spellings.
    const words = text.normalize('NFKC').toLowerCase()
      .replace(/(\d),(?=\d{3}(?!\d))/gu, '$1').replace(/(?:%|퍼센트)\s*포인트/gu, '%p')
      .replace(/(\d)\s*(?:퍼센트|%)/gu, '$1%').replace(/−/gu, '-')
      .match(/(?:(?<![\d.])-)?[0-9]+(?:\.[0-9]+)?(?:%p?|[천만억조])?|[\p{L}]+/gu) || [];
    const unique = new Map();
    for (const word of words) {
      if (stop.has(word)) continue;
      const stem = word.replace(particle, '');
      const key = stem.length >= 2 ? stem : word;
      if ((key.length < 2 && !/^[0-9]/.test(key)) || stop.has(key) || unique.has(key)) continue;
      const forms = new Set([key, word]);
      if (statisticalLabels.has(key)) forms.add(statisticalLabels.get(key));
      if (/^[가-힣]{2,}(자수|인수|건수)$/u.test(key)) forms.add(key.slice(0, -1));
      unique.set(key, forms);
    }
    return unique;
  }

  const lineBreak = /\r\n|[\n\r\u2028\u2029]/u;

  function tableAmbiguities(documentText, query) {
    const references = /(?<![\p{L}\d])(?:통계)?표\s*(\d+)(?!\d|[.\-]\d|\s*(?:개|건|장|명)(?=$|[\s.,의이가를도씩는에]))/gu;
    const wanted = new Map([...query.normalize('NFKC').matchAll(references)].map(m => [m[1], new Map()]));
    if (!wanted.size) return [];
    const paragraphs = documentText.split(lineBreak).map(line => line.normalize('NFKC').trim()).filter(Boolean);
    let statistics = false;
    for (const [i, line] of paragraphs.entries()) {
      if (/^(?:[□◇]\s*)?통\s*계\s*표$/u.test(line)) { statistics = true; continue; }
      if (/^(?:[□◇]\s*)?부\s*록(?:\s|$)/u.test(line)) statistics = false;
      // Contents rows and their page leaders are not physical table headings.
      if (/[·.…]{2,}\s*\d*$/u.test(line)) continue;
      const caption = /^(?:\[표\s*(\d+)\]|<표\s*(\d+)>)\s+(.+)$/u.exec(line);
      const list = !caption && statistics && /^(\d+)\.\s+(.+)$/u.exec(line);
      if (!caption && !list) continue;
      const number = caption ? caption[1] || caption[2] : list[1];
      if (!wanted.has(number)) continue;
      const title = (caption ? caption[3] : list[2]).trim();
      if (!/[\p{L}]/u.test(title) || /^[·.…]{2}/u.test(title) || /[.!?。]$/u.test(title)) continue;
      if (list) {
        // A bare "12." is a table locator only within a statistics section and
        // next to units or a row of numeric data. Another numbered item ends the lookahead.
        let tabular = false;
        for (const next of paragraphs.slice(i + 1, i + 6)) {
          if (/^(?:\d+\.\s|\[표|<표|부\s*록)/u.test(next)) break;
          if (/^\(?\s*단\s*위\s*[:：]/u.test(next) || /(?:^|\s)[+-]?\d[\d,.]*\s+[+-]?\d[\d,.]*(?=\s|$)/u.test(next)) { tabular = true; break; }
        }
        if (!tabular) continue;
      }
      const key = title.replace(/\s+/gu, '').toLowerCase();
      const headings = wanted.get(number);
      if (!headings.has(key)) headings.set(key, {title, paragraph: i + 1, kind: caption ? 'caption' : 'statistics'});
    }
    return [...wanted].filter(([, headings]) => headings.size > 1)
      .map(([number, headings]) => ({number, headings: [...headings.values()]}));
  }

  function sourceRows(text) {
    const rows = [];
    let page = 0;
    for (const line of text.split(lineBreak)) {
      if (line.includes('\f')) page++;
      if (line.trim()) rows.push({paragraph: rows.length + 1, text: line, page});
    }
    return rows;
  }

  const unitHeading = /^[([（［]?\s*단\s*위\s*[:：]/u;
  const tableCaption = /^(?:\[(?:표\s*\d+\]|[^\]]+\]$)|[〈<]표\s*\d+|\d+\.\s+.+\d{4})/u;
  const contentsEntry = /[·.…]{2,}\s*\d*$/u;
  const tabularValues = /(?:^|\s)\(?[△−+-]?\d[\d,.]*%?\)?\s+\(?[△−+-]?\d[\d,.]*%?\)?(?=\s|$)/u;

  // A table unit line is an explicit boundary in layout-preserving PDF text.
  // Keep its source rows so column names can be inspected even far down a table.
  const dateHeader = /^(?:[가-힣 ]{0,12}(?:연도|년도|연월|년월|기간|일자|일시|기준일|날짜)|시점|date|period)$/iu;

  const splitColumns = text => text.trim().replace(/^\|\s*|\s*\|$/gu, '')
    .split(/\s*\|\s*|\t+| {2,}/u).map(cell => cell.trim());

  function markTables(rows) {
    let table = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], text = row.text.trim(), prev = rows[i - 1];
      if (row.page !== prev?.page || /^(?:주\s*\d*|자료|출처)\s*[:：]/u.test(text)) table = null;
      if (!unitHeading.test(text) && tableCaption.test(text) && !contentsEntry.test(text)) {
        table = {headings: [row], started: false};
        continue;
      }
      if (unitHeading.test(text)) {
        const headings = prev?.page === row.page && tableCaption.test(prev.text.trim()) ? [prev, row] : [row];
        table = {headings, started: false};
        // Mixed-unit tables require a human to associate numbers with columns.
        const unit = /^[([（［]?\s*단\s*위\s*[:：]\s*([천만억조])\s*원\s*[)\]）］]?$/u.exec(text);
        table.moneyScale = unit?.[1];
        continue;
      }
      // HTML tables copied as text often have named columns but no caption or
      // unit line. The first column determines which date selects a record.
      const columns = splitColumns(text);
      if (columns.length > 1 && dateHeader.test(columns[0]) && columns.slice(1).some(cell => /\p{L}/u.test(cell))) {
        if (!table || table.started) table = {headings: [], started: false};
        table.headings.push(row);
        row.columnNames = columns;
        table.metricTerms = new Set(terms(columns.slice(1).join(' ')).keys());
        continue;
      }
      if (!table) continue;
      if (!table.started && /(?:19|20)\d{2}년?(?:\s+(?:19|20)\d{2}년?)+/u.test(text)
          && !/\d[.,]\d/u.test(text) && table.headings.length < 8) {
        table.headings.push(row);
      } else if ((table.metricTerms && /^(?:\|\s*)?(?:(?:19|20)\d{2}|['’‘]\d{2})/u.test(text) &&
          /(?:\t|\|| {2,})\s*[+△−-]?\d/u.test(text)) || tabularValues.test(text) || /\p{L}.*?(?:\t| {2,})[△−+-]?\d[\d,.]*%?$/u.test(text)) {
        table.started = true;
        row.table = table;
      } else if (!table.started && table.headings.length < 8 && text.length < 110 && !/[다요]\.$/u.test(text)) {
        table.headings.push(row);
      } else if (table.started && /^[(]?\s*[△−+-]?[\d,.]+\s*[)]?$/u.test(text)) {
        row.table = table; // A wrapped cell, common with merged year labels.
      } else {
        table = null;
      }
    }
  }

  const cellNumber = /^(?:[+△−-]?\(?\d[\d,]*(?:\.\d+)?\)?%?|[-–—…])$/u;
  const aggregateName = /(?:평균|중앙값|중앙치|합계|총계|누계|소계)/u;
  const physicalUnits = [
    ['area', /(?:헥타르|제곱(?:킬로|센티)?미터|평방(?:킬로)?미터|ha|(?:km|cm|m)[²2])/iu],
    ['length', /(?:킬로미터|센티미터|밀리미터|미터|km|mm|cm|m)/iu],
    ['mass', /(?:킬로그램|그램|톤|kg|mg|g)/iu]
  ];
  const unitPatterns = [...physicalUnits,
    ['people', /(?:[천만백]?명|인원)/u], ['count', /(?:[천만백]?건|[천만백]?개)/u],
    ['money', /(?:[천만백억조]*원|달러)/u], ['ratio', /(?:%p?|퍼센트(?:포인트)?)/iu]
  ];
  const physicalUnitInQuery = new RegExp('(?<![가-힣A-Za-z])(?:' + physicalUnits.map(([, re]) => re.source).join('|') +
    ')(?=$|[\\s?.,]|[인였었로을를이가는은])', 'giu');
  const unitInHeader = /[（(]([^()（）]{1,16})[)）]/gu;
  const unitAliases = unitPatterns.map(([family, re]) => [family, new RegExp('^(?:' + re.source + ')$', re.flags)]);
  function measureUnit(unit) {
    const text = unit.normalize('NFKC').replace(/\s+/gu, '');
    return unitAliases.find(([, re]) => re.test(text))?.[0];
  }

  // Only a complete rectangular, uniquely year-keyed excerpt qualifies for a
  // positional lookup. Do not transfer its column labels into unrelated prose
  // or guess a table when multiple tables, wrapping or duplicate keys exist.
  function annualExcerpt(rows) {
    const headers = rows.filter(r => r.columnNames);
    if (headers.length !== 1) return null;
    const header = headers[0], names = header.columnNames.slice(1);
    if (rows.some(r => r.page !== header.page)) return null;
    const before = rows.slice(0, header.paragraph - 1);
    if (before.some(r => !/^(?:<.+>|〈.+〉|\[.+\])$/u.test(r.text.trim()) && !unitHeading.test(r.text.trim()))) return null;
    const years = new Map(), aggregates = [];
    let units = names.map(name => [...name.matchAll(unitInHeader)].map(m => measureUnit(m[1])).find(Boolean));
    let unitRow = units.some(Boolean) ? header : null;
    for (const row of rows.slice(header.paragraph)) {
      const cells = splitColumns(row.text);
      if (!years.size && !unitRow) {
        const labels = cells.length === names.length + 1 && /^(?:단위|구분)$/u.test(cells[0]) ? cells.slice(1) : cells;
        const aligned = labels.map(unit => measureUnit(unit.replace(/^[（(]|[)）]$/gu, '')));
        if (aligned.length === names.length && aligned.every(Boolean)) { units = aligned; unitRow = row; continue; }
      }
      if (cells.length !== names.length + 1 || !cells.slice(1).every(value => cellNumber.test(value))) return null;
      const year = /^((?:19|20)\d{2})년?$/u.exec(cells[0])?.[1];
      if (year) {
        if (years.has(year)) return null;
        years.set(year, row);
      } else {
        const kind = aggregateName.exec(cells[0])?.[0];
        if (!kind) return null;
        aggregates.push({row, kind, label: cells[0].replace(/\s+/gu, '')});
      }
    }
    return years.size >= 2 ? {header, names, years, aggregates, units, unitRow} : null;
  }

  function annualTarget(chart, query, asked, asksUnits, namedMetrics) {
    if (!chart) return {};
    const labels = chart.names.map(name => name.replace(unitInHeader, '').replace(/\s+/gu, ''));
    const relevant = labels.map(label => namedMetrics.some(key => label.includes(key) || key.includes(label)));
    const anyMetric = relevant.some(Boolean);
    if (asksUnits) {
      const justUnits = /^(?:(?:이|위|해당|각|두|각각의|쓰인|사용된|표|통계|지표|항목|열)(?:에서|에는|의|에|별)?\s*)*단위/u.test(query.trim());
      const covered = chart.units.every((unit, index) => unit || (anyMetric && !relevant[index]));
      return covered && (anyMetric || justUnits) ? {row: chart.unitRow} : {};
    }
    if (!anyMetric) return {};
    // A length, weight or area cannot be read from counts just because the
    // same year and a topic word occur. Check only an explicitly named unit.
    if (chart.units.every(Boolean)) {
      const explicit = query.normalize('NFKC').match(physicalUnitInQuery) || [];
      const dims = explicit.map(measureUnit);
      if (dims.length && dims.every(unit => unit && !chart.units.includes(unit)) &&
          !/계산|구한|환산|곱|나누|산출|추정/u.test(query)) return {unavailable: true};
    }
    const kind = aggregateName.exec(query)?.[0];
    if (kind) {
      // A date range can describe only part of a table's unqualified total.
      if (/(?:19|20)\d{2}/u.test(query)) return {};
      const span = /(?<!\d)(\d{1,3})\s*(?:개\s*)?년(?:간|치)?/u.exec(query)?.[1];
      const candidates = chart.aggregates.filter(g => g.kind === kind &&
        (!span || new RegExp('(?:^|\\D)' + span + '(?:개)?년', 'u').test(g.label)));
      if (!asked && candidates.length === 1) return {row: candidates[0].row};
      return {};
    }
    return {row: !asked?.month && chart.years.get(asked?.year)};
  }

  function find(documentText, query, {includeContext = false} = {}) {
    const periods = typeof module !== 'undefined' && module.exports ? require('./evidence-period.js') : root.JournalEvidencePeriod;
    const wanted = [...terms(query)];
    if (!wanted.length) return [];
    const rows = sourceRows(documentText);
    markTables(rows);
    const asked = periods?.requestedPeriod(query);
    const dateParts = new Set(asked ? [Number(asked.year), asked.month, asked.day].filter(Number.isFinite) : []);
    const asksUnits = /(?:어떤|무슨|어느)\s*단위|단위(?:가|는|를)?\s*(?:각각\s*)?(?:무엇|뭐|알려)/u.test(query);
    const asksRatio = /분모|분자|산식|계산식/u.test(query);
    const namedMetrics = wanted.map(([key]) => key).filter(key => /[\p{L}]{2}/u.test(key) &&
      !/^(?:기준|단위|자료|연도|기간|항목|구분)$/u.test(key));
    const target = annualTarget(annualExcerpt(rows), query, asked, asksUnits, namedMetrics);
    if (target.unavailable) return [];
    const frequencies = new Map();
    for (const row of rows) {
      const forms = new Set([...terms(row.text).values()].flatMap(set => [...set]));
      // The same numeric value can be written with its scale in a sentence and
      // without a suffix in a table that declares one monetary unit for all cells.
      if (row.table?.moneyScale) {
        const rowYear = /^\s*((?:19|20)\d{2})(?:년)?\s/u.exec(row.text)?.[1];
        for (const form of [...forms]) {
          if (form !== rowYear && /^-?\d+(?:\.\d+)?$/u.test(form)) forms.add(form + row.table.moneyScale);
        }
      }
      row.matched = [];
      row.keys = [];
      for (const [key, variants] of wanted) {
        const hit = [...variants].find(form => forms.has(form));
        if (!hit) continue;
        row.matched.push(hit);
        row.keys.push(key);
        frequencies.set(key, (frequencies.get(key) || 0) + 1);
      }
    }
    const weight = key => 1 + Math.log(rows.length / frequencies.get(key));
    const scored = [];
    for (const row of rows) {
      const metricMatched = row.table?.metricTerms && [...row.table.metricTerms].some(field =>
        namedMetrics.some(key => key === field || (field.length >= 2 && key.endsWith(field))));
      const dateAndMetric = Boolean(asked && metricMatched && periods.matchesTablePeriod(asked, row.text));
      const previous = rows[row.paragraph - 2];
      const unitRow = asksUnits && (unitHeading.test(row.text.trim()) || /[(（]\s*(?:[%㎏㎡㎥]|[백천만억조]?(?:건|명|원|톤|개|가구|시간|일|km|kg|mm))\s*[)）]/iu.test(row.text)) &&
        previous?.page === row.page && previous.keys.some(k => namedMetrics.includes(k)) &&
        !/\d[\d,.]*\s*[%원명건]/u.test(row.text);
      const formulaRow = asksRatio && /[=＝].*[÷/／]/u.test(row.text) && row.keys.some(k => namedMetrics.includes(k));
      const groupRow = row.table && [...statisticalLabels].some(([term, label]) =>
        (namedMetrics.includes(term) || namedMetrics.includes(label)) &&
        row.text.split(/\t+| {2,}|\s*\|\s*/u).slice(0, 2).some(cell => [term, label].includes(cell.trim()))) &&
        row.table.headings.some(h => h.keys.some(k => namedMetrics.includes(k)));
      const matchesTarget = row === target.row ? 2 : Number(dateAndMetric || unitRow || formulaRow || groupRow || false);
      if (!row.keys.length && !matchesTarget) continue;
      const direct = row.keys.reduce((sum, key) => sum + weight(key), 0);
      let score = direct;
      if (row.table) {
        const context = new Set(row.table.headings.flatMap(heading => heading.keys));
        // Merged years often print on an adjacent row. This provides a ranking
        // cue only; the exact source lines are always displayed separately.
        for (const index of [row.paragraph - 2, row.paragraph]) {
          const other = rows[index];
          if (other?.table === row.table) {
            for (const key of other.keys) if (/^(?:19|20)\d{2}$/u.test(key)) context.add(key);
          }
        }
        for (const key of row.keys) context.delete(key);
        const nearby = [...context].reduce((sum, key) => sum + weight(key), 0);
        score += nearby * 0.5;
      }
      if (row.table?.metricTerms && asked && !metricMatched && namedMetrics.length && row.keys.length &&
          row.keys.every(key => /^\d+$/u.test(key) && dateParts.has(Number(key)))) {
        // Year, month and day identify one date. On the wrong metric's table
        // these are not three independent reasons to prefer it over topical text.
        score = Math.max(...row.keys.map(weight));
      }
      if (contentsEntry.test(row.text.trim())) score *= 0.5;
      scored.push({row, score, matchesTarget});
    }
    // A cited value can be the very error under investigation. A named metric
    // in its requested date row is a stronger locator than that number elsewhere.
    scored.sort((a, b) => b.matchesTarget - a.matchesTarget || b.score - a.score || a.row.paragraph - b.row.paragraph);
    return scored.slice(0, 3).map(({row}) => {
      const {paragraph, text, matched} = row;
      const hit = {paragraph, text, matched};
      if (includeContext) {
        const adjacent = rows.slice(Math.max(0, paragraph - 3), paragraph + 2);
        const context = new Set([...(row.table?.headings || []), ...adjacent]);
        hit.context = [...context].filter(other => other !== row && other.page === row.page)
          .sort((a, b) => a.paragraph - b.paragraph)
          .map(({paragraph, text}) => ({paragraph, text}));
      }
      return hit;
    });
  }

  const api = {find, tableAmbiguities};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidenceFinder = api;
})(globalThis);
