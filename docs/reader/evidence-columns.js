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
  // Dates expressed as holidays or seasons may restrict an otherwise annual
  // question. Require a complete time expression, so 돌봄 and 연말정산 stay intact.
  const partOfYear = /(?<![\p{L}\p{N}])(?:설(?:날|\s*(?:연휴|명절|당일))|추석(?:\s*연휴)?|한가위|명절|연휴|공휴일|휴일|평일|주말|(?:봄|여름|가을|겨울)(?:철|휴가철)?|연초|연말|(?:19|20)\d{2}년(?:도)?\s*(?:초반|중반|후반|초|말))(?=(?:에는|에도|동안|기간|당일|에|의|은|는|을|를|만|간|께|쯤)?(?:$|[^\p{L}\p{N}]))/u;
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
          !row.cells.slice(1).every(cell => matrixValue.test(cell.normalize('NFKC')) || /^[-—–…]$/u.test(cell))) return null;
      const year = yearCell.exec(row.cells[0])?.[1];
      if (!year || years.has(year)) return null;
      years.add(year);
      if (i === passage.paragraph - 1 && year === asked.year) selected = row.cells;
    }
    if (!selected) return null;
    const cells = headings.map((heading, i) => ({heading, column:i + 2, value:selected[i + 1]}));
    const location = {headerParagraph:1, rowParagraph:passage.paragraph, year:asked.year};
    const selection = requestedMetric(normalized, labels, cells, location);
    return {...location, cells, ...(selection || {metric:null})};
  }

  // Only an administrative action that modifies the object being counted is
  // eligible. A report that someone "확인한 결과" does not ask for an 확인 count.
  const countedAction = /^(?:제정|개정|폐지|지정|승인|허가|취소|발급|등록|접수|채택|공포|시행|인증|설립|신설|폐쇄)$/u;

  // The text around a matched heading must describe a lookup of that column.
  // Unknown nouns on either side may narrow the population or ask for a different entity.
  const annualYear = /(?<![\p{L}\p{N}])(?:19|20)\d{2}년(?:도)?(?:에는|에도|의|에|은|는)?(?:\s+(?:기준(?:으로(?:는)?)?|한\s*해(?:\s*동안)?))?(?=$|[^\p{L}\p{N}])/gu;
  const lookupFrame = /^(?:(?:이|위|아래|공식)\s+)?(?:통계(?:표)?|원표|자료|기사|보고서)(?:에는|에서(?:는)?|에\s*따르면|에선)\s*/u;
  const reportFrame = /^(?:앞서\s+)?(?:신고|접수|기록|보고)한\s+[\d,]+(?:건|명)을\s+(?:확인|검토|대조)한\s+결과\s*/u;

  // An unqualified death or injury count appears in fire and workplace reports too.
  // Carry the road-traffic topic only on a coherent table with a named event count
  // or the road authority's complete injury-severity schema.
  const roadInjuries = ['사망자수', '중상자수', '경상자수', '부상신고자수'];
  function roadAccidentTable(labels) {
    const fields = labels.map(h => h.replace(unitSuffix, ''));
    const event = /^(?:교통사고(?:발생)?건수|사고건수)$/u;
    if (!fields.every(h => event.test(h) || roadInjuries.includes(h) || h === '부상자수')) return false;
    const events = fields.filter(h => event.test(h));
    return events.length === 1 && (events[0].startsWith('교통사고') || roadInjuries.every(h => fields.includes(h)));
  }

  function directAnnualLookup(query, mention, labels) {
    // The year may appear before or after the metric. Preserve every other qualifier.
    let before = query.slice(0, mention.start).replace(annualYear, ' ').replace(sourceFrame, ' ').trim();
    before = before.replace(lookupFrame, '').replace(reportFrame, '').trim();
    if (before.startsWith('교통사고') && roadAccidentTable(labels))
      before = before.replace(/^교통사고(?:\s*통계(?:표)?에서(?:는)?|로(?:\s+인한)?|의)?(?=\s|$)/u, '').trim();
    if (mention.action) before = before.replace(/^(?:새로|다시|직접)$/u, '');
    if (before) return false;

    let after = query.slice(mention.end).replace(annualYear, ' ').trim();
    if (mention.action) {
      // A bare action heading does not identify a different named object.
      // A stock column such as 보유시설수 supplies the object used in '지정한 시설'.
      const object = /^([\p{L}\p{N}]+(?:\([\p{L}\p{N}]+\))?)(?:\s*수)?(?:은|는|이|가)\s*/u.exec(after);
      if (!object) return false;
      const name = /^(?:한국산업표준(?:\(KS\))?|KS)$/u.test(object[1]) ? '표준' : object[1];
      if (!labels.some(h => h.replace(unitSuffix, '').replace(/^(?:보유|유효|전체|총)/u, '').replace(/수$/u, '') === name))
        return false;
      after = after.slice(object[0].length);
    }
    after = after.replace(/^(?:모두|총|약|정확히)\s*/u, '').replace(/[?!.。]+$/u, '').trim();
    // A later, separately reported figure does not qualify this completed question.
    after = after.replace(/\?\s*별도\s+자료(?:는|에는)\s+[\d,.]+(?:건|명|개)(?:이었다|였다|이다)$/u, '');
    const amount = askedValue.exec(after);
    const ending = (amount ? after.slice(amount[0].length) : after).trim();
    const request = /^(?:인지\s*)?(?:확인|조회)해\s*(?:줘|주세요|주십시오)$/u;
    const reported = /^(?:에\s*달했다|으?로\s*(?:나타났다|(?:집계|기록|확인)(?:됐|되었)(?:다|습니다)))$/u;
    return directEnding.test(ending) || request.test(ending) || Boolean(amount && (claimEnding.test(ending) || reported.test(ending) ||
      /^(?:이?라고|이?라)\s*(?:썼는데|했는데),?\s*실제로는\s*몇\s*(?:종|건|곳|개|명|회|장)(?:이었|였)나(?:요)?$/u.test(ending)));
  }

  function requestedMetric(normalized, labels, cells, location) {
    const mentions = [];
    labels.forEach((label, col) => {
      // Only remove a recognized printed unit or the final 수 in an agent noun
      // (사망자수 → 사망자). Keep qualifiers part of the printed metric.
      const base = label.replace(unitSuffix, '');
      if (!/^[가-힣A-Za-z0-9]{2,60}$/u.test(base) || (derivedMeasure.test(base) && !pointUnit.test(label))) return;
      const count = /[자원]수$/u.test(base);
      const tokens = [...(count ? base.slice(0,-1) : base)].join('\\s*') + (count ? '(?:\\s*수)?' : '');
      const action = countedAction.test(base) ? '(한|된)|' : '';
      const term = new RegExp('(?<![\\p{L}\\p{N}])' + tokens +
        '(?:' + action + '(?:은|는|이|가|을|를|와|과|의|도|만)?)(?![\\p{L}\\p{N}])', 'giu');
      for (const match of normalized.matchAll(term))
        mentions.push({col:col + 1, start:match.index, end:match.index + match[0].length,
          action:Boolean(match[1])});
    });
    // A qualified heading may contain another column's entire name. Two
    // independently mentioned columns cannot be reduced to one requested cell.
    const columns = new Set(mentions.filter(m => !mentions.some(n =>
      n.start <= m.start && n.end >= m.end && (n.start < m.start || n.end > m.end))).map(m => m.col));
    if (columns.size !== 1) return null;
    const [col] = columns, label = labels[col - 1];
    const chosen = mentions.filter(m => m.col === col);
    const remaining = chosen.reduceRight((text, m) =>
      text.slice(0, m.start) + ' ' + text.slice(m.end), normalized);
    // A stage or a comparison must be part of the printed heading to license
    // that column. A final report may still contain several different counts.
    if (partOfYear.test(remaining)) return {metric:null, scopeIssue:'period'};
    const cell = cells[col - 1];
    const printed = matrixValue.exec(cell.value.normalize('NFKC'));
    const units = [unitSuffix.exec(label)?.[1], printed?.[1]];
    for (const mention of mentions.filter(m => m.col === col)) {
      const amount = directAmountUnit.exec(normalized.slice(mention.end));
      if (amount) units.push(amount[1]);
    }
    if (new Set(units.filter(Boolean).map(normalizedMatrixUnit)).size > 1)
      return {metric:null, scopeIssue:'unit'};
    if (stageQualifier.test(remaining) || derivedMeasure.test(remaining)) return null;
    if (pointUnit.test(label) !== pointUnit.test(normalized)) return null;
    if (perUnit.test(label) !== perUnit.test(normalized) || ratioMeasure.test(label) !== ratioMeasure.test(normalized) ||
        (ratioMeasure.test(label) && countAsked.test(normalized))) return null;
    if (/%|퍼센트/u.test(cell.value) && (!ratioMeasure.test(label) || pointUnit.test(cell.value) !== pointUnit.test(label))) return null;
    if (!chosen.some(m => directAnnualLookup(normalized, m, labels))) return {metric:null, scopeIssue:'population'};
    return printed ? {metric:{...location, ...cell}} : null;
  }

  function annualMetricCell(documentText, query, passage) {
    return inspectAnnualRow(documentText, query, passage)?.metric || null;
  }

  // A complete matrix with a named stub and distinct years printed across it.
  // Keep a scale as part of its unit: the raw cell is never converted.
  const matrixUnit = '(?:(?:%|퍼센트)\\s*(?:포인트|p)?|(?:[십백천만억조]+\\s*)?(?:가구|시간|개월|킬로그램|킬로미터|톤|kg|km|원|달러|유로|엔|건|명|개|회|대|종|곳|장|권|점|일|분))';
  const matrixNumber = '[+△▲▼−-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  const matrixValue = new RegExp('^' + matrixNumber + '\\s*(' + matrixUnit + ')?$', 'iu');
  // Read the amount immediately predicated of the named metric. Counts in a
  // date, sample description or another sentence do not specify its unit.
  const directAmountUnit = new RegExp('^\\s*(?:(?:모두|총|약|정확히)\\s*)?(?:몇|얼마(?:나)?|' + matrixNumber +
    ')\\s*(' + matrixUnit + ')(?=$|[\\s?!.。,:]|[은는이가을를](?=\\s)|입니|이었|였|이[다며고라면]|인[가데지]|일까|으로|로)', 'iu');
  const unitSuffix = new RegExp('\\(\\s*(' + matrixUnit + ')\\s*\\)$', 'iu');
  const unitLine = new RegExp('^단\\s*위\\s*:\\s*(' + matrixUnit + ')$', 'iu');
  const askedValue = new RegExp('^(?:몇|얼마(?:나)?|' + matrixNumber + ')\\s*(' + matrixUnit + ')?', 'iu');
  const sourceFrame = /(?<![\p{L}\p{N}])(?:(?:이|위|아래)\s+)?(?:통계표|원표|표|원자료|자료)(?:에서(?:는)?|에\s*따르면|의|상(?:으로)?)(?![\p{L}\p{N}])/gu;
  const valueSubject = /^(?:(?:행|항목)(?:에서|의|은|는)?\s*)?(?:(?:수치|값)(?:은|는|이|가|을|를)?\s*)?/u;
  const countNames = new Map([['건수','건'], ['인원','명'], ['인원수','명'], ['가구수','가구'], ['횟수','회']]);
  const countSubject = /^(건\s*수|인원(?:\s*수)?|가구\s*수|횟수)(?:는|은|이|가|을|를)?(?=\s|[?!.。]|$)/u;
  const directEnding = /^(?:인가(?:요)?|입니까|입니다|이다|(?:이었|였)(?:나(?:요)?|는가|습니까|다|어)|이?야|인지|(?:로|으로)?\s*(?:집계|기록)(?:됐나|되었나)|(?:어떻게\s*)?(?:되나(?:요)?|됩니까)|알려\s*(?:줘|주세요))?$/u;
  const claimEnding = /^(?:이?라는|이?었다는|였다는)\s*(?:주장|내용|말)(?:이|은)?\s*(?:(?:원자료|통계|표)(?:와|과)\s*)?(?:맞(?:나(?:요)?|는가)|일치하(?:나(?:요)?|는가)|사실인가(?:요)?)$/u;

  function normalizedMatrixUnit(unit) {
    return unit?.toLowerCase().replace(/\s+/gu, '').replace('퍼센트','%').replace('포인트','p')
      .replace('킬로그램','kg').replace('킬로미터','km');
  }

  function matrixNamePattern(label) {
    return [...label.replace(/\s+/gu, '')].map(c => c.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s*');
  }

  function matrixQuestion(text, label, unit) {
    // Require all qualifications to be accounted for by the dated row itself.
    // An unprinted district, program, comparison or denominator can be any noun.
    const name = matrixNamePattern(label);
    const mention = new RegExp('(?<![\\p{L}\\p{N}])' + name + '(?:\\s*\\(\\s*(' + matrixUnit + ')\\s*\\))?' +
      '(?:에서는|에서|에는|의|은|는|이|가|을|를)?(?![\\p{L}\\p{N}])', 'iu');
    const named = mention.exec(text);
    if (!named || (named[1] && normalizedMatrixUnit(named[1]) !== unit)) return false;
    let rest = text.replace(mention, ' ').replace(sourceFrame, ' ').trim()
      .replace(valueSubject, '').replace(/[?!.。]+$/u, '').trim();
    const count = countSubject.exec(rest);
    if (count) {
      if (countNames.get(count[1].replace(/\s+/gu, '')) !== unit) return false;
      rest = rest.slice(count[0].length).trim();
    }
    const ask = askedValue.exec(rest);
    if (ask) {
      if (ask[1] && normalizedMatrixUnit(ask[1]) !== unit) return false;
      rest = rest.slice(ask[0].length).trim();
    }
    return directEnding.test(rest) || Boolean(ask && claimEnding.test(rest));
  }

  function matrixLegend(text) {
    const first = text.normalize('NFKC').trim();
    return unitLine.exec(/^\(.*\)$/u.test(first) ? first.slice(1,-1).trim() : first)?.[1];
  }

  function matrixCaption(line) {
    const text = line.normalize('NFKC').trim();
    if (/[\t|]/u.test(text)) return false;
    const number = /^(?:표\s*\d+(?:[.-]\d+)*(?:\s*[.:]\s*|\s+)|\[\s*표\s*\d+(?:[.-]\d+)*\s*\]|<\s*표\s*\d+(?:[.-]\d+)*\s*>)/u.exec(text);
    if (!number) return false;
    const title = text.slice(number[0].length).trim();
    const reference = /(?<![\p{L}\p{N}])표\s*\d|^[\]>]|^(?:을|를|은|는|에|에서|의|와|과)(?:\s|$)|^(?:참고|참조)$/u;
    const sentence = /(?:[.?!。]|한다|된다|있다|없다|습니다|입니다|하세요)$/u;
    return (title.match(/\p{L}/gu) || []).length >= 2 && !boundary.test(title) && !matrixLegend(title) &&
      !yearCell.test(title) && !reference.test(title) && !sentence.test(title);
  }

  function matrixLine(line) {
    if (!line) return null;
    // The legacy grouped layout trims blank stubs. Here column 1 must really
    // contain a label, even when a blank TSV cell contains Unicode whitespace.
    const tab = line.indexOf('\t');
    if ((tab >= 0 && !line.slice(0, tab).trim()) || /^\s*\|\s*\|/u.test(line)) return null;
    return cellsOf(line);
  }

  function parseYearMatrix(documentText) {
    if (typeof documentText !== 'string' || documentText.includes('\f')) return null;
    const lines = documentText.split(lineBreak);
    const start = lines.findIndex(line => line.trim());
    if (start < 0) return null;
    const block = lines.slice(start);
    while (block.length && !block.at(-1).trim()) block.pop();
    const caption = matrixCaption(block[0]) ? {paragraph:1, text:block[0]} : null;
    const afterCaption = caption ? 1 : 0;
    const unit = block[afterCaption];
    const legend = unit && matrixLegend(unit) ? {paragraph:afterCaption + 1, text:unit} : null;
    const index = afterCaption + (legend ? 1 : 0);
    const header = matrixLine(block[index]);
    if (!header || header.cells.length < 3 || !/[가-힣]/u.test(header.cells[0]) || yearCell.test(header.cells[0])) return null;
    const years = header.cells.slice(1).map(cell => yearCell.exec(cell)?.[1]);
    if (years.some(year => !year) || new Set(years).size !== years.length) return null;
    const labels = new Set();
    const rows = [];
    for (let i = index + 1; i < block.length; i++) {
      const row = matrixLine(block[i]);
      if (!row || row.kind !== header.kind || row.cells.length !== header.cells.length) return null;
      if (i === index + 1 && row.kind === 'pipe' && row.cells.every(cell => /^:?-{3,}:?$/u.test(cell))) continue;
      const [rowLabel, ...values] = row.cells;
      const printed = rowLabel.normalize('NFKC');
      const label = printed.replace(unitSuffix, '').trim();
      const key = label.replace(/\s+/gu, '').toLowerCase();
      if (!/\p{L}/u.test(label) || yearCell.test(label) || labels.has(key) || values.every(cell => yearCell.test(cell))) return null;
      labels.add(key);
      if (values.some(value => !matrixValue.test(value.normalize('NFKC')) && !/^(?:[-—–…]|)$/u.test(value))) return null;
      rows.push({paragraph:i + 1, label:rowLabel, values, text:block[i]});
    }
    return rows.length ? {headerParagraph:index + 1, headers:header.cells, years, rows, caption, legend} : null;
  }

  function matrixYear(matrix, query) {
    if (!Array.isArray(matrix?.years) || !Array.isArray(matrix.headers) || !Array.isArray(matrix.rows) || typeof query !== 'string') return null;
    const period = typeof module !== 'undefined' && module.exports ? require('./evidence-period.js') : root.JournalEvidencePeriod;
    const asked = period?.requestedPeriod(query);
    return asked && !asked.month && !asked.day && matrix.years.includes(asked.year) ? asked.year : null;
  }

  function findYearMatrixCell(source, query) {
    const matrix = typeof source === 'string' ? parseYearMatrix(source) : source;
    const year = matrixYear(matrix, query);
    // A table title can restrict all rows to a period, population or change.
    // Keep it alongside the manually browsable grid until its scope is known.
    if (!year || matrix.caption) return null;
    // A named stub can change the meaning of every level in the grid (e.g.
    // change since last year). Its digits are still available in the raw grid.
    const stub = matrix.headers[0].normalize('NFKC');
    if (!/^(?:구분|항목|지표|분류|범주)$/u.test(stub.replace(unitSuffix, '').replace(/\s+/gu, ''))) return null;
    const col = matrix.years.indexOf(year);
    const question = query.normalize('NFKC').replace(/(?<!\d)(?:19|20)\d{2}년(?:도)?(?:에는|에도|의|에|은|는)?/u, ' ');
    const compact = question.replace(/\s+/gu, '');
    const legendUnit = matrix.legend && matrixLegend(matrix.legend.text);
    const headerUnit = unitSuffix.exec(stub)?.[1];
    let match = null;
    for (const row of matrix.rows) {
      const printed = row.label.normalize('NFKC'), label = printed.replace(unitSuffix, '').trim();
      const key = label.replace(/\s+/gu, '');
      if (!compact.includes(key)) continue;
      const value = matrixValue.exec(row.values[col].normalize('NFKC'));
      if (!value) continue;
      const units = new Set([legendUnit, headerUnit, unitSuffix.exec(printed)?.[1], value[1]]
        .filter(Boolean).map(normalizedMatrixUnit));
      // 건수 and 횟수 name their counting unit. Other measures, particularly
      // rates and money amounts, need an explicit printed unit for a unit query.
      const printedCount = /(?:건수|인원수?|가구수|횟수)$/u.exec(key)?.[0];
      if (printedCount) {
        const countUnit = countNames.get(printedCount);
        if ([...units].some(unit => unit.replace(/^[십백천만억조]+/u, '') !== countUnit)) continue;
        if (!units.size) units.add(countUnit);
      }
      if (units.size > 1 || !matrixQuestion(question, label, [...units][0])) continue;
      if (match) return null;
      match = {headerParagraph:matrix.headerParagraph, rowParagraph:row.paragraph, rowLabel:row.label, year,
        heading:matrix.headers[col + 1], column:col + 2, value:row.values[col]};
    }
    return match;
  }

  function findYearMatrixRow(matrix, query) {
    const year = matrixYear(matrix, query);
    if (!year) return null;
    const text = query.normalize('NFKC');
    if (/\d+\s*(?:월|일)|지난주|이듬해|보다(?:는|도|\s|$)|늘[었어난]|줄[었어인]|높아[지졌진]|낮아[지졌진]|올랐|내렸/u.test(text)) return null;
    const compact = text.replace(/\s+/gu, '');
    const mentions = [];
    for (const row of matrix.rows) {
      const name = row.label.normalize('NFKC').replace(unitSuffix, '').replace(/\s+/gu, '');
      if (!compact.includes(name) || (name.match(/[\p{L}\p{N}]/gu) || []).length < 2) continue;
      const term = new RegExp('(?<![\\p{L}\\p{N}])' + matrixNamePattern(name) +
        '(?=(?:에서는|에서|으로는|으로|로|에는|에도|에|의|은|는|이|가|을|를|와|과|도|만)?(?![\\p{L}\\p{N}]))', 'gu');
      for (const m of text.matchAll(term)) mentions.push({start:m.index, end:m.index + m[0].length, row});
    }
    // A shorter name inside a longer printed name is not a second request.
    // A separately mentioned shorter name or a partial overlap is ambiguous.
    mentions.sort((a,b) => a.start - b.start || b.end - a.end);
    const rows = new Set();
    let end = -1;
    for (const m of mentions) {
      if (m.end <= end) continue;
      rows.add(m.row);
      end = m.end;
    }
    if (rows.size !== 1) return null;
    const [row] = rows;
    return {headerParagraph:matrix.headerParagraph, rowParagraph:row.paragraph, rowLabel:row.label, year};
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

  const api = {forRow, inspectAnnualRow, annualMetricCell, parseYearMatrix, findYearMatrixCell, findYearMatrixRow, changeNote};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidenceColumns = api;
})(globalThis);
