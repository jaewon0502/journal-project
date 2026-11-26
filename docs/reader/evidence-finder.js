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

  // In prose, the same digits can count households, people or cases. Bind the
  // printed unit to its amount and preceding subject within the same clause.
  const digits = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
  const magnitude = '(?:[십백천]?[만억조]|[십백천])';
  const amount = new RegExp(String.raw`(?<![\d.+−△▲▼-])(?<!\d,)([+−-]?${digits}(?:[ \t]*${magnitude}[ \t]*${digits}){0,5})[ \t]*(?:(${magnitude})[ \t]*)?((?:%|퍼센트)[ \t]*(?:포인트|p)|퍼센트|%|가구|명|건|개|원|달러|유로|엔)`, 'giu');
  const scaleOrder = {'십':1, '백':2, '천':3, '만':4, '억':8, '조':12};
  const scaleRank = scale => scaleOrder[scale.at(-1)] + (scale.length === 2 ? scaleOrder[scale[0]] : 0);
  const currencies = new Set(['원','달러','유로','엔']);
  const amountEnding = /^(?:$|[^\p{L}\p{N}/]|으로|에서|까지|부터|였|입니다|입니까|이다|인가|이었|이고|이며|이라고|라는|[의은는을를이가로에와과도만다](?![\p{L}\p{N}]))/u;
  const amountModifiers = /^(?:모두|각각|합계|대략|정확히|가량|약|총)$/u;
  function proseAmounts(text) {
    const normalized = text.normalize('NFKC');
    const readings = [];
    let start = 0;
    for (const m of normalized.matchAll(amount)) {
      const prefix = normalized.slice(start, m.index);
      start = m.index + m[0].length;
      if (!amountEnding.test(normalized.slice(start)) || /\d\s*[십백천만억조]+\s*$/u.test(prefix)) continue;
      const unit = m[3].toLowerCase().replace(/\s+/gu,'').replace('퍼센트','%').replace('포인트','p');
      let scale = m[2];
      if (/[십백천만억조]/u.test(m[1])) {
        // A compound expression carries one currency, across successively smaller
        // scales. A compound has no single printed scale to favor over another.
        if (!currencies.has(unit) || m[1].length > 128) continue;
        const ranks = m[1].match(/[십백천만억조]+/gu).map(scaleRank);
        ranks.push(scale ? scaleRank(scale) : 0);
        if (ranks.some((value, i) => i && value >= ranks[i - 1])) continue;
        scale = null;
      }
      if (currencies.has(unit) &&
          (/[~∼–—±/−+-]\s*$|[\d십백천만억조](?:부터|에서)\s*$/u.test(prefix) ||
           (/^[+−-]/u.test(m[1]) && /\d[ \t]*$/u.test(prefix)) ||
           /^\s*(?:[~∼–—±/-]|부터|에서)\s*[+\d−-]/u.test(normalized.slice(start)))) continue;
      const clause = prefix.split(/[,;:。.!?\n\r|]/u).at(-1);
      const subject = [...terms(clause).keys()].filter(key => /^\p{L}+$/u.test(key) && !amountModifiers.test(key)).slice(-3);
      const years = [...clause.matchAll(/(?<!\d)((?:19|20)\d{2})\s*년/gu)].map(match => match[1]);
      readings.push({subject, unit, scale, years});
    }
    return readings;
  }

  function proseAmountMatch(row, requested, year) {
    if (!requested?.subject.length || row.table) return 0;
    let best = 0;
    for (const found of proseAmounts(row.text)) {
      if ((year && found.years.length && !found.years.includes(year)) ||
          found.unit !== requested.unit || found.subject.at(-1) !== requested.subject.at(-1) ||
          !requested.subject.every(word => found.subject.includes(word))) continue;
      best = Math.max(best, requested.scale !== null && found.scale === requested.scale ? 2 : 1);
    }
    return best;
  }

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
    for (const [lineIndex, line] of text.split(lineBreak).entries()) {
      if (line.includes('\f')) page++;
      if (line.trim()) rows.push({paragraph: rows.length + 1, text: line, page, lineIndex});
    }
    return rows;
  }

  const unitHeading = /^[([（［]?\s*단\s*위\s*[:：]/u;
  const tableCaption = /^(?:\[(?:표\s*\d+\]|[^\]]+\]$)|[〈<]표\s*\d+|\d+\.\s+.+\d{4})/u;
  const contentsEntry = /[·.…]{2,}\s*\d*$/u;
  const tabularValues = /(?:^|\s)\(?[△−+-]?\d[\d,.]*%?\)?\s+\(?[△−+-]?\d[\d,.]*%?\)?(?=\s|$)/u;

  // Some annual reports wrap one prose bullet directly after a headcount. The
  // indented percentage finishes that count; a rate follows in the same sentence.
  function wrappedRateOpening(query, row, prev) {
    if (!prev || row.table || prev.table || row.page !== prev.page || row.lineIndex !== prev.lineIndex + 1 ||
        /[\f\t|]/u.test(prev.text + row.text)) return null;
    const open = /^( *)□\s+((?:19|20)\d{2})년\s+(\d{1,3})\s*세\s*(이상|이하)\s*(.+)$/u.exec(prev.text);
    const headcount = /^(?:취업자|실업자|경제활동인구|인구)[는가]\s+\d[\d,만천백 ]*명(?:으로|로)\s+전년\s*대비\s+\d[\d,만천백 ]*명\s*$/u;
    const next = /^( +)\([+−-]?\d+(?:\.\d+)?%\)\s*(?:증가|감소)(?:하였|했)(?:고|으며),\s*(.+)$/u.exec(row.text);
    if (!open || !headcount.test(open[5]) || !next || next[1].length <= open[1].length) return null;
    const rate = /^(고용률|실업률|경제활동참가율)[은는]\s*\d+(?:\.\d+)?%로\s+전년\s*대비\s+[+−-]?\d+(?:\.\d+)?%p\s+(?:상승|하락)(?:하였음|했음|하였다|했다)?[.]?\s*$/iu.exec(next[2]);
    if (!rate) return null;

    const claim = /^(?:((?:19|20)\d{2})\s*년\s*(?:연간\s*)?)?(\d{1,3})\s*세\s*(이상|이하)\s*(?:인구(?:의)?\s*)?(고용률|실업률|경제활동참가율)[은는이가]?\s*(.*)$/u.exec(query.trim());
    if (!claim || (claim[1] && claim[1] !== open[2]) || claim[2] !== open[3] || claim[3] !== open[4] || claim[4] !== rate[1]) return null;
    // Extra populations or periods after the metric can also narrow a claim.
    const comparison = /^(?:로|퍼센트|포인트|퍼센트포인트|p|전년(?:보다|대비)?|지난해(?:보다|대비)?|대비|얼마(?:나|인가|였나)?|인가|(?:올랐|내렸|늘었|줄었|떨어졌|상승했|하락했|증가했|감소했|였|이었|입니|이)(?:다|나|습니다|습니까))$/iu;
    if ((claim[5].match(/\p{L}+/gu) || []).some(word => !comparison.test(word))) return null;
    return {paragraph:prev.paragraph, text:prev.text};
  }

  // A table unit line is an explicit boundary in layout-preserving PDF text.
  // Keep its source rows so column names can be inspected even far down a table.
  const dateHeader = /^(?:[가-힣 ]{0,12}(?:연도|년도|연월|년월|기간|일자|일시|기준일|날짜)|(?:발생|신고|등록|조사|관측)\s*년|시점|date|period)$/iu;

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
        const headerWords = terms(columns.slice(1).join(' '));
        table.metricTerms = new Set([...headerWords.values()].flatMap(forms => [...forms]));
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
    ['money', /[백천만억조]*(?:원|달러|유로|엔)/u], ['ratio', /(?:%p?|퍼센트(?:포인트)?)/iu]
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

  const intervalUnit = '(개월|시간|만원|억원|살|세|년|명|건|점|회|분|원|톤|kg|km|%)';
  const intervalNumber = '([+−-]?\\d+(?:\\.\\d+)?)';
  const groupRange = new RegExp(intervalNumber + '\\s*' + intervalUnit + '?\\s*(?:[~∼〜–—-]|부터)\\s*' +
    intervalNumber + '\\s*' + intervalUnit, 'giu');
  const groupLimit = new RegExp(intervalNumber + '\\s*' + intervalUnit + '\\s*(이상|이하|초과|미만)', 'giu');
  const wholeGroup = /(?:^|[\s|])(?:전체|총계|합계)(?:로|의|가|는|를|$|[\s|])/u;
  function numericGroups(text) {
    const value = text.normalize('NFKC').toLowerCase().replaceAll('살','세').replaceAll('−','-');
    const keys = [];
    for (const [,left, leftUnit, right, unit] of value.matchAll(groupRange)) {
      if ((!leftUnit || leftUnit === unit) && Number(left) <= Number(right))
        keys.push([unit, Number(left), Number(right)].join('|'));
    }
    for (const [,n,unit,bound] of value.matchAll(groupLimit)) keys.push([unit, bound, Number(n)].join('|'));
    return keys;
  }

  const gridNumber = /^(?:[+△−-]?\d[\d,.]*%?(?:\(\s*[+△−-]?\d[\d,.]*%?\))?|[-–—…])$/u;
  const changeNumber = /^\([+△−-]?\d[\d,.]*%?\)$/u;
  const yearColumn = /^(?:19|20)\d{2}년?$/u;
  const monthColumn = /^(?:0?[1-9]|1[0-2])(?:월?[~∼〜–-](?:0?[1-9]|1[0-2]))?월$/u;
  const changeBasis = /전년(?:도)?(?:동기|동월)?|전월|전분기|전기/u;
  const changeLabel = /^(?:전년(?:도)?(?:동기|동월)?|전월|전분기|전기)(?:대비|비)(?:증감률|변화율)?$|^(?:증감률|변화율|증가율|감소율)$/u;

  // A unit declaration, period columns and unsplit numeric rows establish the
  // scope of a named measure. A following change row belongs only to that
  // measure. Preserve all header tiers for inspection; never infer a cell from
  // an unevenly spaced or merged year heading.
  function measureGrid(rows) {
    const start = rows.findIndex(r => unitHeading.test(r.text.trim()));
    if (start < 0 || start > 1 || rows.length <= start + 2 ||
        rows.some(r => r.page !== rows[start].page)) return null;
    if (start && /[.!?。]|\d[\d,.]*\s*%/u.test(rows[0].text)) return null;
    const header = rows[start + 1];
    const years = header.text.trim().replace(/^(?:구\s*분|항목|시점|기간)\s*\|?\s*/u, '')
      .split(/[\s|]+/u).map(y => y.replace(/년$/u, ''));
    if (years.length < 2 || !years.every(y => yearColumn.test(y)) || new Set(years).size !== years.length) return null;
    const next = rows[start + 2].text.trim().split(/[\s|]+/u);
    const months = next.every(c => monthColumn.test(c)) ? next : [];
    const width = months.length || years.length;
    const headings = rows.slice(start, start + (months.length ? 3 : 2));
    const units = rows[start].text.trim().replace(unitHeading, '').replace(/[)）\]］]\s*$/u, '')
      .split(/[,，]/u).map(s => {
        const parts = s.split(/[/／]/u);
        return parts.length === 2 && parts.every(measureUnit) ? 'per-unit' : measureUnit(s);
      });
    const records = [];
    const notes = [];
    let parent;
    for (const row of rows.slice(headings.at(-1).paragraph)) {
      if (/^(?:주\s*\d*\s*[:)：)]|\d+\)\s)/u.test(row.text.trim())) { notes.push(row.text); continue; }
      const cells = row.text.trim().split(/[\s|]+/u), cut = cells.length - width;
      if (notes.length || cut < 1 || !cells.slice(cut).every(c => gridNumber.test(c) || changeNumber.test(c))) return null;
      const label = cells.slice(0, cut).join('').replace(/\d+\)$/u, '');
      const change = label.replace(/^\((.+)\)$/u, '$1');
      if (changeLabel.test(change)) {
        const rate = /[률율]$/u.test(change) || cells.slice(cut).every(c => changeNumber.test(c) || c.endsWith('%'));
        if (rate && parent) parent.changes.push({row, label: change});
      } else {
        parent = {row, label, changes:[]};
        records.push(parent);
      }
    }
    return records.length ? {records, years, months, units, notes, headings} : null;
  }

  function measureGridTarget(rows, query, namedMetrics) {
    const normalized = query.normalize('NFKC');
    const requested = [...normalized.matchAll(/((?:19|20)\d{2})년/gu)].map(m => m[1]);
    if (requested.length !== 1 || /\d\s*일|분기|상반기|하반기|계산|산출|환산|추정|분모|분자|단위|괄호|제외|빼고/u.test(normalized)) return {};
    const grid = measureGrid(rows);
    if (!grid) return {};
    const {records, years, months, units, notes, headings} = grid;
    if (!years.includes(requested[0])) return {};
    const month = [...normalized.matchAll(/(?<!\d)(\d{1,2})월/gu)].map(m => Number(m[1]));
    if (month.length !== (months.length ? 1 : 0) || (month.length &&
        !months.some(c => /^\d{1,2}월$/u.test(c) && parseInt(c, 10) === month[0]))) return {};

    const physical = (normalized.match(physicalUnitInQuery) || []).map(measureUnit);
    const currency = units.includes('money');
    const currencyClaim = /(?:몇|얼마|\d[\d,.]*)\s*[백천만억조\s]*(?:원|달러|유로|엔)(?=$|[\s?.,인였었로을를이가는은])/u.test(normalized);
    const requestedUnits = currencyClaim ? [...physical, 'money'] : physical;
    if (requestedUnits.length && units.every(Boolean) && requestedUnits.every(u => !units.includes(u))) {
      // Notes may supply an alternative unit or conversion. Leave those
      // passages searchable even when the numeric block has no such column.
      if (notes.some(line => unitPatterns.some(([family, re]) => requestedUnits.includes(family) && re.test(line)))) return {};
      return {unavailable: true};
    }
    if (currencyClaim && !currency) return {};
    const matches = records.filter(r => namedMetrics.some(term => r.label === term ||
      (currency && r.label === term.replace(/(?:금액|액)$/u, ''))));
    if (matches.length !== 1) return {};
    const [metric] = matches;
    const compact = normalized.replace(/\s+/gu, '');
    const basis = changeBasis.exec(compact)?.[0];
    if (basis || /증감률|변화율|증가율|감소율/u.test(compact)) {
      if (!units.includes('ratio') || !/%|퍼센트|[률율]/u.test(compact) ||
          /(?:%|퍼센트)(?:p|포인트)/iu.test(compact)) return {};
      const matching = metric.changes.filter(c => !basis || c.label.startsWith(basis));
      return matching.length === 1 ? {row: matching[0].row, headings: [...headings, metric.row]} : {};
    }
    if (metric.changes.length && /%|퍼센트|[률율]|비중/u.test(compact)) return {};
    return {row: metric.row, headings};
  }
  const gridTitle = /^(?:【.+】|\[.+\]|<.+>|〈.+〉)$/u;
  const explainsParentheses = text => /\(\s*\)\s*[:=]?\s*[가-힣A-Za-z]|괄호\s*(?:안|속|내).+[가-힣]/u.test(text.normalize('NFKC'));
  const percentGrid = text => /^[(\[]?단\s*위\s*[:：]\s*%p?\s*(?:[)\]]?\s*$|[/,]\s*\(\s*\))/iu.test(text.trim().normalize('NFKC'));

  // Repeated year headings describe groups of columns. Only a row label,
  // never one of its numeric cells, may identify a population interval.
  function groupedGridTarget(rows, query, namedMetrics) {
    const requestedGroups = numericGroups(query);
    // A single lookup row cannot settle a comparison between two groups.
    if (requestedGroups.length > 1) return {};
    const group = requestedGroups[0], total = wholeGroup.test(query);
    const legend = /괄호.{0,30}(?:뜻|의미|무엇|가리키|나타내)/u.test(query);
    const nonRate = /(?:몇|얼마의?)\s*(?:분|시간|일|원|달러)|(?:금액|가격|소요\s*시간).{0,8}얼마|\d[\d,.]*\s*(?:[천만백억조]*원|달러|분|시간)(?:이었|였|인가|이라|이\s*맞)/u.test(query) &&
      !/%|퍼센트|[율률]|비중|계산|환산/u.test(query);
    if ((!group && !total && !legend && !nonRate) || /제외|빼고/u.test(query)) return {};
    const queryYears = [...query.matchAll(/((?:19|20)\d{2})년/gu)].map(m=>m[1]);
    const topics = namedMetrics.filter(key => !key.endsWith('별') &&
      !/^(?:전체|총계|합계|이상|이하|초과|미만|괄호|무엇|숫자|의미)$/u.test(key));
    const matches = [];
    for (let i = 0; i < rows.length; i++) {
      const years = rows[i].text.trim().split(/[\s|]+/u);
      if (years.length < 2 || !years.every(v=>/^(?:19|20)\d{2}년?$/u.test(v))) continue;
      if (!queryYears.every(y=>years.some(v=>v.replace('년','')===y))) continue;
      const headings = [rows[i]];
      for (let k=i-1; k>=0 && rows[k].page===rows[i].page; k--) {
        const line = rows[k].text.trim();
        const title = (gridTitle.test(line) || tableCaption.test(line)) && !unitHeading.test(line);
        if (!title && !unitHeading.test(line) && line.replace(/\s+/gu,'') !== '구분' &&
            (splitColumns(line).length < 2 || /\d|[.!?。]$/u.test(line))) break;
        headings.unshift(rows[k]);
        if (title) break;
      }
      const labels = headings.slice(0,-1).filter(h=>!unitHeading.test(h.text.trim()))
        .map(h=>h.text.replace(/\([^()]*\)/gu, '').replace(/\s+/gu,''));
      if (!topics.some(term=>labels.some(label=>label.includes(term)))) continue;
      const data = [], notes = headings.filter(h=>explainsParentheses(h.text));
      let end = i;
      for (let k=i+1; k<rows.length && rows[k].page===rows[i].page; k++) {
        const line = rows[k].text.trim();
        // One glyph of a vertically printed side heading can occupy a separate line.
        if (/^[가-힣]$/u.test(line)) continue;
        if (/^(?:주\s*[):：]|※|단\s*위\s*[:：])/u.test(line) && explainsParentheses(line)) {
          notes.push(rows[k]); end=k; continue;
        }
        const cells = line.split(/[\s|]+/u), cut = cells.length-years.length;
        if (cut < 1 || !cells.slice(cut).every(c=>gridNumber.test(c))) break;
        const label=cells.slice(0,cut).join(' ');
        const rowGroups = numericGroups(label);
        data.push({row: rows[k], key: rowGroups.length === 1 ? rowGroups[0] : null,
          total: /^(?:전체|합계|총계|계)$/u.test(label)});
        end=k;
      }
      if (data.length < 2 || !data.some(r=>r.key)) continue;
      // A stand-alone rate table cannot directly provide an amount or duration.
      // In a longer document unrelated prose and other tables remain searchable.
      if (nonRate && headings.some(h=>percentGrid(h.text))) {
        if (headings[0] === rows[0] && end === rows.length - 1) return {unavailable: true};
        continue;
      }
      const targets = legend ? notes : data.filter(r=>group ? r.key===group : total && r.total).map(r=>r.row);
      if (targets.length === 1) matches.push({row:targets[0], headings});
    }
    return matches.length === 1 ? matches[0] : {};
  }

  // An industry table can locate the named subgroup even when the claim quotes
  // its parent's figures. Never infer a cell from the merged year headings.
  function industryTableTarget(rows, rawQuery) {
    const compact = text => text.normalize('NFKC').replace(/\s+/gu, '');
    const claim = compact(rawQuery);
    if (!claim.includes('업')) return {};
    const year = /^((?:19|20)\d{2})년/u.exec(claim);
    const body = claim.slice(year?.[0].length || 0);
    const matches = [];
    for (const [i, caption] of rows.entries()) {
      const title = /^\[표\d+\](?:업종|산업)별([가-힣]+)$/u.exec(compact(caption.text));
      if (!title || !body.includes(title[1])) continue;
      const headers = [];
      let units, years, fields, dimension;
      for (const header of rows.slice(i + 1, i + 5)) {
        if (header.page !== caption.page) break;
        const line = header.text.normalize('NFKC').trim();
        const unitLine = /^\(?단위:([^()]+)\)?$/u.exec(compact(line));
        const industry = /^(?:업\s*종|산\s*업)(?:\s+|$)/u.exec(line);
        const cells = line.slice(industry?.[0].length || 0).trim().split(/\s+/u);
        if (industry) dimension = true;
        if (unitLine && !units) units = new Set(unitLine[1].split(','));
        else if (!years && cells.every(c => yearColumn.test(c))) years = cells.map(c => c.replace(/년$/u, ''));
        else if (!fields && cells.every(c => /^[가-힣]+$/u.test(c)) && cells.some(f => title[1].endsWith(f))) fields = cells;
        else if (!industry || cells[0]) break;
        headers.push(header);
        if (units && years && fields && dimension) break;
      }
      if (!units || !years || !fields || !dimension || new Set(years).size !== years.length ||
          (year && !years.includes(year[1]))) continue;
      const cut = body.indexOf(title[1]);
      const scope = body.slice(0, cut).replace(/(?:부문|분야)?(?:의|에서)?$/u, '');
      if (!scope.endsWith('업')) continue;
      const rest = body.slice(cut + title[1].length).replace(/^[은는이가]/u, '');
      // Only a plain amount or annual change qualifies. Additional periods,
      // regions, denominators and unsupported units leave a lexical search.
      const change = /전년|1년전|증가|감소|줄었|늘었/u.test(rest);
      if (rest.includes('%') && !change && !/[율률비]$|비중$/u.test(title[1])) continue;
      if (change && (!fields.some(f => /^(?:증감률|증가율|감소율)$/u.test(f)) ||
          (year && year[1] !== years.at(-1)))) continue;
      let badUnit = false;
      const tail = rest.replace(/(?:1년전|전년)(?:보다|대비)?/gu, '')
        .replace(/[-+]?\d[\d,]*(?:\.\d+)?[십백천만억조]?(%p?|톤|kg|g|원|명|개|건|달러)?/giu, (_, unit) => {
          if (unit && !units.has(unit)) badUnit = true;
          return '';
        }).replace(/(?:증가|감소)(?:한|했다|했나|했는가)?|늘었다|줄었다|(?:으로|로)?(?:집계됐다|나타났다)|이었다|였다|얼마(?:인가|였나)?|인가/gu, '');
      if (badUnit || /[^().,?？。]/u.test(tail)) continue;

      for (let j = i + 1 + headers.length; j < rows.length && rows[j].page === caption.page; j++) {
        const row = rows[j];
        // A detached interpunct occurs in some PDF category labels.
        if (/^[․·]$/u.test(row.text.trim())) continue;
        const cells = row.text.trim().split(/\s+/u);
        const firstValue = cells.findIndex(c => gridNumber.test(c));
        if (firstValue < 1 || cells.length - firstValue !== fields.length ||
            !cells.slice(firstValue).every(c => gridNumber.test(c))) break;
        const label = compact(cells.slice(0, firstValue).join(' ')).replace(/\(\d+\)$/u, '');
        if (label === scope) matches.push({row, headings:[caption, ...headers]});
      }
    }
    return matches.length === 1 ? matches[0] : {};
  }

  // A detached publisher/audience tag is not a search term for an independent
  // factual subject. Keep it when the wording could ask about the outlet itself.
  function independentSubject(body) {
    if (body.startsWith('[') || !/(?:^|\s)[\p{L}\d]+\s+[\p{L}\d]+[은는이가](?=\s|[?,.])/u.test(body)) return false;
    const publication = /신문|언론|매체|기사|보도|사설|표제|제목|제호|이름|지면|기자|필자|편집|독자|구독|발행|발간|창간|매출|영업이익|순이익/u;
    const attribution = /인용|발언|논평|주장|발표|반박|게재|밝[히힌혔]|전했|말했|말한|썼|(?:찬성|반대|지지|선호|응답|평가|비판|지적|강조|설명)(?:했|한|하나|하는)/u;
    return !/["'“”‘’「」『』]/u.test(body) && !publication.test(body) && !attribution.test(body);
  }

  function passageQuery(raw) {
    const tag = /^\s*\[(?:(?:발행처|매체)\s*[:：]\s*)?(?:보수|중도|진보)\s*성향\s*(?:신문|매체|일간지|주간지|독자용)\][ \t]+/u;
    const body = raw.replace(tag, '');
    return body !== raw && independentSubject(body) ? body : raw;
  }

  function find(documentText, rawQuery, {includeContext = false, matrixCell = null, matrixNavigation = null,
      fiscalTargets = null, industryContext = '', passageFilter = null, requireAnyTerm = null} = {}) {
    const periods = typeof module !== 'undefined' && module.exports ? require('./evidence-period.js') : root.JournalEvidencePeriod;
    const query = passageQuery(rawQuery);
    const wanted = [...terms(query)];
    if (!wanted.length) return [];
    const rows = sourceRows(documentText);
    markTables(rows);
    const asked = periods?.requestedPeriod(query);
    const quantities = proseAmounts(query);
    const quantity = quantities.length === 1 ? quantities[0] : null;
    const dateParts = new Set(asked ? [Number(asked.year), asked.month, asked.day].filter(Number.isFinite) : []);
    const asksUnits = /(?:어떤|무슨|어느)\s*단위|단위(?:가|는|를)?\s*(?:각각\s*)?(?:무엇|뭐|알려)/u.test(query);
    const asksRatio = /분모|분자|산식|계산식/u.test(query);
    const namedMetrics = wanted.map(([key]) => key).filter(key => /[\p{L}]{2}/u.test(key) &&
      !/^(?:기준|단위|자료|연도|기간|항목|구분)$/u.test(key));
    let target;
    if (!matrixCell) {
      target = annualTarget(annualExcerpt(rows), query, asked, asksUnits, namedMetrics);
      if (!target.row && !target.unavailable) target = groupedGridTarget(rows, query, namedMetrics);
      if (!target.row && !target.unavailable) target = measureGridTarget(rows, query, namedMetrics);
      if (!target.row && !target.unavailable && (!industryContext || industryContext.trim() === query.trim()))
        target = industryTableTarget(rows, query);
      if (target.unavailable) return [];
    }
    // A printed row and header can guide inspection even when the query adds
    // a condition the table does not resolve. Only matrixCell supplies a value.
    const matrixRow = matrixCell || matrixNavigation;
    if (matrixRow)
      target = {row: rows[matrixRow.rowParagraph - 1], headings: rows.slice(0, matrixRow.headerParagraph)};
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
      if (passageFilter && !passageFilter(row.text)) continue;
      if (requireAnyTerm && !row.keys.some(key => requireAnyTerm.has(key))) continue;
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
      const fiscalTarget = fiscalTargets?.get(row.paragraph);
      if (fiscalTargets?.size && !fiscalTarget && !matchesTarget) continue;
      if (!row.keys.length && !matchesTarget && !fiscalTarget) continue;
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
      scored.push({row, score, matchesTarget, fiscalRank:fiscalTarget?.rank || 0,
        amountMatch:proseAmountMatch(fiscalTarget || row, quantity, asked?.year)});
    }
    // A cited value can be the very error under investigation. A named metric
    // in its requested date row is a stronger locator than that number elsewhere.
    scored.sort((a, b) => b.matchesTarget - a.matchesTarget || b.fiscalRank - a.fiscalRank || b.amountMatch - a.amountMatch ||
      b.score - a.score || a.row.paragraph - b.row.paragraph);
    return scored.slice(0, 3).map(({row}) => {
      const {paragraph, text, matched} = row;
      const hit = {paragraph, text, matched};
      const fiscalTarget = fiscalTargets?.get(paragraph);
      if (fiscalTarget) {
        if (fiscalTarget.stage) hit.fiscalStage = fiscalTarget.stage;
        const scoped = terms(fiscalTarget.text);
        hit.matched = matched.filter(key => !/^\d/u.test(key) || scoped.has(key));
      }
      if (matrixCell?.rowParagraph === paragraph) hit.matrixCell = matrixCell;
      else if (matrixNavigation?.rowParagraph === paragraph) hit.matrixNavigation = matrixNavigation;
      if (includeContext) {
        const opening = wrappedRateOpening(query, row, rows[paragraph - 2]);
        if (opening) hit.wrappedOpening = opening;
        const adjacent = rows.slice(Math.max(0, paragraph - 3), paragraph + 2);
        const headings = row === target.row && target.headings ? target.headings : row.table?.headings || [];
        const context = new Set([...headings, ...adjacent]);
        hit.context = [...context].filter(other => other !== row && other.page === row.page)
          .sort((a, b) => a.paragraph - b.paragraph)
          .map(({paragraph, text}) => ({paragraph, text}));
      }
      return hit;
    });
  }

  const phraseStop = new Set('a an the and or as at by for from in into of on to with about that this these those it its their there is are was were be been being has have had do does did will would could can may might should he her his she they them my our who which when where how why according said says reported'.split(' '));

  function phraseWithoutPublisherTag(articleQuery, phrase) {
    const articleBody = passageQuery(articleQuery);
    if (!independentSubject(articleBody)) return phrase;
    const korean = passageQuery(phrase);
    if (korean !== phrase) return korean;
    // A bare translated tag is metadata only when the article carries a
    // detachable tag as well. Never erase a party, speaker or outlet name.
    const tag = /^\[(?:(publisher|outlet|source|audience)\s*[:：]\s*)?(?:conservative|centrist|liberal|progressive|(?:left|right)[- ]leaning)\s+(?:newspaper|news outlet|outlet|daily|weekly|audience)\][ \t]+/iu.exec(phrase);
    if (!tag || (!tag[1] && articleBody === articleQuery)) return phrase;
    const body = phrase.slice(tag[0].length);
    if (!/^[A-Za-z\d]/u.test(body) || /[[\]"'“”‘’]/u.test(body)) return phrase;
    const outletOrStatement = /\b(?:newspapers?|editors?|editorials?|headlines?|subscribers?|circulation|readership|publications?|outlets?|journalists?|revenue|profits?|according|quotes?|quoted|claim(?:s|ed)?|say(?:s)?|said|reports?|reported|wrote|writes?|den(?:y|ies|ied)|endors(?:e|es|ed)|support(?:s|ed)?|oppos(?:e|es|ed))\b/iu;
    return outletOrStatement.test(body) ? phrase : body;
  }

  // Keep the article search intact. A phrase supplied by the reader only opens
  // more places to inspect; a word match does not settle a claim or a quotation.
  function withSourcePhrase(documentText, articleQuery, sourcePhrase, lookup) {
    const phrase = sourcePhrase.trim();
    if (!phrase || phrase === articleQuery.trim()) return lookup;
    const plainFields = ['paragraph', 'text', 'matched', 'context'];
    if (lookup.state !== 'ordinary' || lookup.gap || lookup.notice || lookup.yearMatrix ||
        lookup.transcript || lookup.fiscalTable || lookup.householdScope || lookup.wageBasis || lookup.labourScope ||
        lookup.passages.some(p => Object.keys(p).some(key => !plainFields.includes(key)))) {
      return {...lookup, phraseSearch:'structured'};
    }
    const body = phraseWithoutPublisherTag(articleQuery, phrase);
    const labelOmitted = body !== phrase ? {phraseLabelOmitted:true} : {};
    const words = [...terms(body).keys()].filter(word => !phraseStop.has(word));
    const topics = new Set(words.filter(word => /\p{L}/u.test(word) && !/^[-\d]/u.test(word) && !/^(?:not|no|never)$/u.test(word)));
    if (!topics.size) return {...lookup, ...labelOmitted, phraseSearch:'no-match'};
    // A year or a common connecting word alone cannot add a second candidate.
    const hits = find(documentText, words.join(' '), {includeContext:true, requireAnyTerm:topics});
    if (!hits.length) return {...lookup, ...labelOmitted, phraseSearch:'no-match'};
    const original = new Map(lookup.passages.map(p => [p.paragraph, p]));
    const extra = new Map(hits.map(p => [p.paragraph, p]));
    const selected = new Map();
    for (let i = 0; i < Math.max(hits.length, lookup.passages.length); i++) {
      for (const p of [hits[i], lookup.passages[i]]) {
        if (!p || selected.has(p.paragraph)) continue;
        const a = original.get(p.paragraph), b = extra.get(p.paragraph);
        // Preserve the quoted line and surrounding source text even when a hint
        // includes an inaccurate translation or names the opposite side.
        const hit = a || {paragraph:b.paragraph, text:b.text, matched:b.matched, context:b.context};
        const matched = a && b ? [...new Set([...a.matched, ...b.matched])] : hit.matched;
        selected.set(p.paragraph, {...hit, matched, phraseMatch:a ? (b ? 'both' : 'article') : 'phrase'});
      }
    }
    return {...lookup, ...labelOmitted, passages:[...selected.values()], phraseSearch:'matched'};
  }

  const api = {find, tableAmbiguities, passageQuery, sourceRows, withSourcePhrase};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidenceFinder = api;
})(globalThis);
