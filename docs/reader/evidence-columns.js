// Locate raw values using explicit year and metric headings. Diagnostics never
// register evidence or issue a verdict.
(function (root) {
  'use strict';

  const yearCell = /^((?:19|20)\d{2})(?:\s*년(?:도)?)?$/u;
  const numericCell = /^(?:[-—–…]|[+−△▲▼-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*(?:(?:%|퍼센트)\s*(?:포인트|p)?|원|명|건|개|톤))?)$/iu;
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

  // A year down the first column and one explicitly named metric across the top.
  // Only read a complete, regular excerpt. A title, merged header or second
  // table may add a unit or population, so leave those excerpts for inspection.
  const annualHeader = /^(?:(?:발생|신고|등록|조사|관측|기준|회계)?\s*(?:연도|년도|년)|year)$/iu;
  const derivedMeasure = /전년|대비|증감|증가|감소|격차|차이|변화|변동|상승|하락|오르|오른|올라|올랐|내렸|내려|내린|떨어[지졌진]|늘[었어난]|줄[었어인]|높아[지졌진]|낮아[지졌진]|얼마나\s*늘|보다(?:는|도|\s|$)|배수|평균|누계|누적|제외|빼고|분자|분모|비교|환산|합산|추정|나누/u;
  const ratioMeasure = /%|퍼센트|비중|구성비|[률율]/u;
  const pointUnit = /(?:%|퍼센트)\s*(?:포인트|p)/iu;
  const stageQualifier = /최종|잠정|확정|예비(?!비)|중간|예상|전망|(?:\d+|일|이|삼)차(?:\s|전형|집계|발표|시험|심사)/u;
  const perUnit = /(?:[명인건대구세원회]|\d[만천백]?)\s*(?:당|마다)/u;
  const countAsked = /(?:몇|\d[\d,.]*)\s*(?:명|건|개|회)(?!당|마다)/u;
  // A total in the selected column cannot establish a subgroup count. Look
  // outside the printed heading, so a named subgroup column can still be used.
  function asksForSubset(text) {
    const outside = text.replace(/(?:통계(?:표)?|원표|표|자료|보고서|집계|기록|문서|기사|조사)에서/gu, ' ');
    const subset = /[가-힣]에서|(?:^|\s)중(?:에서|에|\s)|한정|해당하는|가운데|지역|거주|출신|수도권|전국/u;
    const demographic = /\d+\s*(?:세|살)|(?:10|20|30|40|50|60|70|80|90)대(?:\s|[의는가이]|$)|연령|성별|남성|여성|남자|여자|어린이|청소년|고령|노인|아동|외국인|내국인/u;
    const circumstance = /주간|야간|평일|휴일|주말|음주운전|무면허/u;
    return subset.test(outside) || demographic.test(outside) || circumstance.test(outside);
  }

  function inspectAnnualRow(documentText, query, passage) {
    if (typeof documentText !== 'string' || typeof query !== 'string' ||
        !Number.isInteger(passage?.paragraph) || passage.paragraph < 2 || typeof passage.text !== 'string') return null;
    const normalized = query.normalize('NFKC');
    if (documentText.includes('\f')) return null;
    const period = typeof module !== 'undefined' && module.exports ? require('./evidence-period.js') : root.JournalEvidencePeriod;
    // A printed change column still belongs to a dated row. Keep relative
    // dates and ranges intact and check the original wording before cueing a cell.
    const asked = period.requestedPeriod(normalized.replace(/증가|감소|증감|상승|하락|늘었|줄었/gu, ' '));
    if (!asked || asked.month || asked.day ||
        yearCell.exec(cellsOf(passage.text)?.cells[0])?.[1] !== asked.year) return null;

    const lines = documentText.split(lineBreak);
    const start = lines.findIndex(line => line.trim());
    if (start < 0) return null;
    const block = lines.slice(start);
    while (block.length && !block.at(-1).trim()) block.pop();
    if (block.length < 2 || block[passage.paragraph - 1] !== passage.text) return null;
    const header = cellsOf(block[0]);
    if (!header || !annualHeader.test(header.cells[0])) return null;
    const headings = header.cells.slice(1);
    const labels = headings.map(heading => heading.normalize('NFKC').replace(/\s+/gu, ''));
    if (labels.some(label => !/\p{L}/u.test(label) || yearCell.test(label)) ||
        new Set(labels).size !== labels.length) return null;

    const years = new Set();
    let selected;
    for (const [i, line] of block.entries()) {
      if (/^ *\t|^\s*\|\s*\|/u.test(line)) return null; // cellsOf permits a blank stub in other layouts.
      if (!i) continue;
      const row = cellsOf(line);
      if (!row || row.kind !== header.kind || row.cells.length !== header.cells.length ||
          !row.cells.slice(1).every(cell => numericCell.test(cell))) return null;
      const year = yearCell.exec(row.cells[0])?.[1];
      if (!year || years.has(year)) return null;
      years.add(year);
      if (i === passage.paragraph - 1 && year === asked.year) selected = row.cells;
    }
    if (!selected) return null;
    const cells = headings.map((heading, i) => ({heading, column:i + 2, value:selected[i + 1]}));
    const location = {headerParagraph:1, rowParagraph:passage.paragraph, year:asked.year};
    const cell = requestedMetric(normalized, labels, cells);
    return {...location, cells, metric:cell && {...location, ...cell}};
  }

  // Only an administrative action that modifies the object being counted is
  // eligible. A report that someone "확인한 결과" does not ask for an 확인 count.
  const countedAction = /^(?:제정|개정|폐지|지정|승인|허가|취소|발급|등록|접수|채택|공포|시행|인증|설립|신설|폐쇄)$/u;
  const qualifiedActor = /[\p{L}\p{N}]+(?:이|가|만|에서)\s+(?:(?:새로|다시|직접)\s+)?$/u;
  const countedObject = /^\s+(?!결과|자료|사실|내용)[\p{L}\p{N}]+(?:\([\p{L}\p{N}]+\))?(?:\s+수)?(?:은|는|이|가)\s*(?:(?:모두|총|약|정확히)\s*)?(?:몇|\d[\d,.]*)\s*(?:종|건|곳|개|명|회|장)/u;

  function requestedMetric(normalized, labels, cells) {
    const mentions = [];
    labels.forEach((label, col) => {
      // Only remove an explicit count unit or the final 수 in an agent noun
      // (사망자수 → 사망자). Keep qualifiers part of the printed metric.
      const base = label.replace(/\((?:명|건|개|회|(?:%|퍼센트)(?:포인트|p)?)\)$/iu, '');
      if (!/^[가-힣A-Za-z0-9]{2,60}$/u.test(base) || (derivedMeasure.test(base) && !pointUnit.test(label))) return;
      const count = /[자원]수$/u.test(base);
      const tokens = [...(count ? base.slice(0,-1) : base)].join('\\s*') + (count ? '(?:\\s*수)?' : '');
      const action = countedAction.test(base) ? '(한|된)|' : '';
      const term = new RegExp('(?<![\\p{L}\\p{N}])' + tokens +
        '(?:' + action + '(?:은|는|이|가|을|를|와|과|의|도|만)?)(?![\\p{L}\\p{N}])', 'giu');
      for (const match of normalized.matchAll(term))
        mentions.push({col:col + 1, start:match.index, end:match.index + match[0].length,
          counted:!match[1] || (countedObject.test(normalized.slice(match.index + match[0].length)) &&
            !qualifiedActor.test(normalized.slice(0, match.index)))});
    });
    // A qualified heading may contain another column's entire name. Two
    // independently mentioned columns cannot be reduced to one requested cell.
    const columns = new Set(mentions.filter(m => !mentions.some(n =>
      n.start <= m.start && n.end >= m.end && (n.start < m.start || n.end > m.end))).map(m => m.col));
    if (columns.size !== 1) return null;
    const [col] = columns, label = labels[col - 1];
    if (!mentions.some(m => m.col === col && m.counted)) return null;
    const remaining = mentions.filter(m => m.col === col).reduceRight((text, m) =>
      text.slice(0, m.start) + ' ' + text.slice(m.end), normalized);
    // A stage or a comparison must be part of the printed heading to license
    // that column. A final report may still contain several different counts.
    if (asksForSubset(remaining) || stageQualifier.test(remaining) || derivedMeasure.test(remaining)) return null;
    if (pointUnit.test(label) !== pointUnit.test(normalized)) return null;
    if (perUnit.test(label) !== perUnit.test(normalized) || ratioMeasure.test(label) !== ratioMeasure.test(normalized) ||
        (ratioMeasure.test(label) && countAsked.test(normalized))) return null;
    const cell = cells[col - 1];
    if (/%|퍼센트/u.test(cell.value) && (!ratioMeasure.test(label) || pointUnit.test(cell.value) !== pointUnit.test(label))) return null;
    return /\d/u.test(cell.value) ? cell : null;
  }

  function annualMetricCell(documentText, query, passage) {
    return inspectAnnualRow(documentText, query, passage)?.metric || null;
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

  const api = {forRow, inspectAnnualRow, annualMetricCell, changeNote};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidenceColumns = api;
})(globalThis);
