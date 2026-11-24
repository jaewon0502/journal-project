// Locate raw values under explicit year headings. No interpretation of merged
// headers is implied by the single-year lookup. Diagnostics never register evidence or issue a verdict.
(function (root) {
  'use strict';

  const yearCell = /^((?:19|20)\d{2})(?:\s*년(?:도)?)?$/u;
  const numericCell = /^(?:[-—–…]|[+−△▲▼-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:%p?|퍼센트포인트|원|명|건|개|톤)?)$/iu;
  const boundary = /^(?:[\[<〈【]\s*(?:표|그림|단위)|(?:표|그림)\s*\d|(?:주(?:석)?\s*\d*|자료|출처|단위)\s*[:：])/u;
  const lineBreak = /\r\n|[\n\r\u2028\u2029]/u;

  function cellsOf(line) {
    if (!line.trim() || boundary.test(line.trim())) return null;
    let kind, cells;
    if (line.includes('\t')) {
      kind = 'tab';
      cells = line.split('\t');
    } else if (/^\s*\|.*\|\s*$/u.test(line)) {
      kind = 'pipe';
      cells = line.trim().slice(1, -1).split('|');
    } else {
      kind = 'layout';
      cells = line.trim().split(/ {2,}/u);
    }
    cells = cells.map(cell => cell.trim());
    while (cells[0] === '') cells.shift(); // Empty leading label cells in a header.
    return cells.length >= 2 && !boundary.test(cells[0]) ? {kind, cells} : null;
  }

  function yearHeader(row) {
    const years = row.cells.map(cell => yearCell.exec(cell)?.[1]);
    return years.every(Boolean) ? years : null;
  }

  function dataValues(row, accepts) {
    const first = row.cells.findIndex(accepts);
    // At least one non-numeric row label is required. Never silently shift a
    // missing internal cell, extra change column or numeric row label.
    if (first < 1 || row.cells.slice(0, first).some(cell => !/\p{L}/u.test(cell))) return null;
    const values = row.cells.slice(first);
    if (values.length < 2 || !values.every(accepts) ||
        values.every(cell => yearCell.test(cell))) return null;
    return values;
  }

  function requestedYears(query) {
    const text = query.normalize('NFKC');
    if (/\d{1,2}\s*월|[1-4]\s*분기|상반기|하반기/u.test(text)) return [];
    if (/(?:19|20)\d{2}\s*년?\s*(?:[~∼–—-]|부터|에서)\s*['’]?(?:\d{2}|\d{4})\s*년/u.test(text)) return [];
    const matches = [...text.matchAll(/(?<![\d,.])((?:19|20)\d{2})\s*년(?:도)?/gu)];
    return [...new Set(matches.map(match => match[1]))];
  }

  function locateTable(documentText, query, passage, accepts) {
    if (typeof documentText !== 'string' || typeof query !== 'string' || typeof passage?.text !== 'string' ||
        !Number.isInteger(passage.paragraph) || passage.paragraph < 2) return null;
    const wanted = requestedYears(query);
    if (!wanted.length) return null;
    const lines = documentText.split(lineBreak);
    let i = 0, paragraph = 0;
    for (; i < lines.length; i++) {
      if (lines[i].trim() && ++paragraph === passage.paragraph) break;
    }
    if (lines[i] !== passage.text || lines[i].includes('\f')) return null;
    const selected = cellsOf(lines[i]);
    const values = selected && dataValues(selected, accepts);
    if (!values) return null;

    // Work up from the selected row only. A break, note, caption, new column
    // shape or page boundary ends this table, even on the same printed page.
    while (--i >= 0) {
      const line = lines[i];
      if (line.includes('\f') && !/^\s*\f[^\f]*$/u.test(line)) return null;
      const row = cellsOf(line);
      if (!row || row.kind !== selected.kind) return null;
      paragraph--;
      const header = yearHeader(row);
      if (header) {
        const previous = i && !line.includes('\f') && cellsOf(lines[i - 1]);
        if (previous && yearHeader(previous)) return null; // Two stacked year levels.
        if (header.length !== values.length || wanted.some(year => !header.includes(year))) return null;
        return {lines, i, header, values, wanted, kind: row.kind, headerParagraph:paragraph,
          rowParagraph:passage.paragraph};
      }
      if (line.includes('\f') || dataValues(row, accepts)?.length !== values.length) return null;
    }
    return null;
  }

  function forRow(documentText, query, passage) {
    const table = locateTable(documentText, query, passage, cell => numericCell.test(cell));
    if (!table) return null;
    const {header, wanted, values, headerParagraph, rowParagraph} = table;
    const cells = header.flatMap((year, col) =>
      wanted.includes(year) ? [{year, column: col + 1, value: values[col]}] : []);
    return {headerParagraph, rowParagraph, cells,
      ambiguousYears: wanted.filter(year => header.indexOf(year) !== header.lastIndexOf(year))};
  }

  const levelCell = /^(\d+(?:\.\d+)?)(?:\(\s*([+−-]?\d+(?:\.\d+)?)\s*\))?$/u;
  const legend = /^\(?\s*단위\s*:\s*%\s*[/,]\s*(?:\(\s*\)|괄호(?:\s*안)?(?:은|는)?)\s*(?:직전\s*조사\s*대비\s*)?증감(?:폭)?(?:\s*\(\s*%p\s*\))?\s*\)?$/iu;

  function groupedLabels(table, groupLine, width) {
    const count = table.header.length / width;
    if (table.kind === 'layout') {
      // Printed group labels must sit over their own span of year columns.
      // A collapsed list of names alone cannot supply the missing colspans.
      const groups = cellsOf(groupLine);
      if (groups?.kind !== 'layout' || groups.cells.length !== count) return null;
      const headings = [...table.lines[table.i].matchAll(/(?:19|20)\d{2}/gu)]
        .map(m => m.index);
      let offset = 0;
      for (const [index, name] of groups.cells.entries()) {
        const start = groupLine.indexOf(name, offset);
        offset = start + name.length;
        const center = start + name.length / 2;
        if (center < headings[index * width] || center > headings[(index + 1) * width - 1] + 4) return null;
      }
      return groups.cells;
    }
    const pieces = table.kind === 'tab' ? groupLine.split('\t') :
      groupLine.trim().replace(/^\||\|$/gu, '').split('|');
    const columns = pieces.map(cell => cell.trim());
    if (columns.length === table.header.length + 1 && /^(?:|구분|항목)$/u.test(columns[0])) columns.shift();
    if (columns.length !== table.header.length) return null;
    const labels = [];
    for (let i = 0; i < columns.length; i += width) {
      const set = new Set(columns.slice(i, i + width).filter(Boolean));
      if (set.size !== 1) return null;
      labels.push([...set][0]);
    }
    return labels;
  }

  function decimal(text) {
    const places = text.split('.')[1]?.length || 0;
    return {value:Number(text.replace('−','-')), error:0.5 * 10 ** -places};
  }

  function changeNote(documentText, query, passage) {
    const table = locateTable(documentText, query, passage, cell => levelCell.test(cell));
    if (!table || table.lines[table.i].includes('\f')) return null;
    const {header, values, wanted, lines, headerParagraph, rowParagraph} = table;
    const width = header.indexOf(header[0], 1);
    if (width < 2 || header.length % width ||
        header.some((year, i) => year !== header[i % width] || (i % width && year <= header[i - 1]))) return null;

    let labelIndex = table.i - 1;
    const hasStub = /^(?:구\s*분|항\s*목)$/u.test(lines[labelIndex]?.trim());
    if (hasStub) labelIndex--;
    if (labelIndex < 1) return null;
    const labels = groupedLabels(table, lines[labelIndex], width);
    if (!labels || new Set(labels).size !== labels.length || labels.some(s => !/\p{L}/u.test(s))) return null;
    let unitIndex = labelIndex - 1;
    if (!lines[unitIndex].trim()) unitIndex--;
    if (unitIndex < 0 || lines.slice(unitIndex,table.i + 1).some(line => line.includes('\f'))) return null;
    const unitLine = lines[unitIndex].normalize('NFKC').trim();
    if (!legend.test(unitLine)) return null;

    const comparisons = [];
    const compact = value => value.normalize('NFKC').replace(/\s+/gu, '');
    const names = labels.map(compact);
    if (new Set(names).size !== labels.length || /제외|빼고/u.test(query)) return null;
    // Match the longest printed heading at a word start. "비수도권" must
    // not select "수도권", even if only the shorter heading exists in the table.
    const alternatives = [...names].sort((a, b) => b.length - a.length).map(name =>
      [...name].map(char => char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s*'));
    const headings = new RegExp('(?<![\\p{L}\\p{N}])(?:' + alternatives.join('|') + ')', 'gu');
    const mentioned = new Set([...query.normalize('NFKC').matchAll(headings)].map(m => compact(m[0])));
    for (let within = 1; within < width; within++) {
      if (!wanted.includes(header[within])) continue;
      const questionable = [];
      let consistentChanges = 0;
      for (let col = within; col < values.length; col += width) {
        const before = levelCell.exec(values[col - 1]), after = levelCell.exec(values[col]);
        if (!before || !after?.[2]) continue;
        const prev = decimal(before[1]), now = decimal(after[1]), delta = decimal(after[2]);
        if (prev.value > 100 || now.value > 100) return null;
        const tolerance = prev.error + now.error + delta.error + 1e-9;
        if (prev.value !== now.value) {
          if (Math.abs(now.value - prev.value - delta.value) <= tolerance &&
              Math.abs(delta.value) > tolerance) consistentChanges++;
          continue;
        }
        if (Math.abs(delta.value) <= tolerance ||
            !mentioned.has(names[Math.floor(col / width)])) continue;
        // Without a percentage-point label, also allow for a relative change
        // between underlying rounded rates; near zero it can be arbitrarily large.
        if (!/%p/iu.test(unitLine) && (prev.value <= prev.error ||
            Math.abs(delta.value) <= 100 * (prev.error + now.error) / (prev.value - prev.error) + delta.error + 1e-9)) continue;
        questionable.push({prior:{year:header[col - 1],column:col,value:values[col - 1]},
          current:{year:header[col],column:col + 1,value:values[col]}, printedChange:after[2]});
      }
      if (consistentChanges) comparisons.push(...questionable);
    }
    return comparisons.length ? {rowParagraph, headerParagraph,
      legendParagraph:headerParagraph - (hasStub ? 3 : 2), comparisons} : null;
  }

  const api = {forRow, changeNote};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidenceColumns = api;
})(globalThis);
