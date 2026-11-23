// Locate candidate passages in a local document. Word overlap gives no verdict.
(function (root) {
  'use strict';

  const stop = new Set('그리고 그러나 하지만 이에 대해 대한 이번 지난 관련 기자 기사 있다 있는 했다 밝혔다 따르면 하는 한다 것을 사실 발언 주장 말했다 대한 해당 이다 또한 the and said that this for'.split(' '));
  const particle = /(으로부터|에서는|으로는|에서|에게|부터|까지|보다|으로|에는|에도|와의|의|은|는|이|가|을|를|와|과|에|도)$/u;

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
      unique.set(key, new Set([key, word]));
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
      if (!table) continue;
      if (!table.started && /(?:19|20)\d{2}년?(?:\s+(?:19|20)\d{2}년?)+/u.test(text)
          && !/\d[.,]\d/u.test(text) && table.headings.length < 8) {
        table.headings.push(row);
      } else if (tabularValues.test(text) || /\p{L}.*?(?:\t| {2,})[△−+-]?\d[\d,.]*%?$/u.test(text)) {
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

  function find(documentText, query, {includeContext = false} = {}) {
    const wanted = [...terms(query)];
    if (!wanted.length) return [];
    const rows = sourceRows(documentText);
    markTables(rows);
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
      if (!row.keys.length) continue;
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
      if (contentsEntry.test(row.text.trim())) score *= 0.5;
      scored.push({row, score});
    }
    scored.sort((a, b) => b.score - a.score || a.row.paragraph - b.row.paragraph);
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
