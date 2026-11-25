// Locate comparable annual changes in layout-preserving text. A hit is a source
// row with labelled years, never a verdict about the article or its publication date.
(function (root) {
  'use strict';

  const trendWords = /(?:증가|감소|상승|하락)\s*(?:폭|분)|증감|반토막|절반|연속.{0,16}(?:둔화|가속)/u;
  const changeLabel = /(?:전년\s*대비\s*)?(?:증감(?:액|분)?|증가분|감소분|순증(?:가)?)/u;
  const scales = {'': 1, 백: 100, 천: 1000, 만: 10000, 백만: 1000000, 천만: 10000000, 억: 100000000, 조: 1000000000000};
  const countUnit = /(천만|백만|조|억|만|천|백)?\s*(명|가구|건|원|톤|대)(?=[\s),/·:：]|$)/u;
  const dateWord = /올해|금년|작년|지난해|내년|지난달|이달/u;
  const subannual = /분기|반기|누계|월별|월간|\d+\s*월/u;
  const neutral = /^(?:올해|금년|작년|지난해|내년|해당|전년도?|연간|연도|대비|비교|증감|증가|감소|상승|하락|반토막|절반|연속|수준|규모|가량|최대|최소|전체|총계|합계|폭|폭이|수|분|년|명|명대|천|만|억|조|원|건|가구|톤|대|등)$/u;
  const predicate = /^(?:그쳤|그친|났다|났습|됐다|됐습|떨어|줄었|줄어|줄던|늘었|늘어|낮아|둔화|가속|커졌|높아|기록했|나타났|부지|감소했|증가했|감소하|증가하)/u;
  // Keep the year for coverage checks, separate from the name of the count series.
  const historicalStart = /((?:19|20)\d{2})\s*년\s*(?:\([\d.,\s천백만억조명건원가구톤대]+\)\s*)?(?:이후|이래)\s*(?:(\d+)\s*년\s*만(?:의|에)\s*)?(?:최대|최소|최고|최저)/gu;

  function subject(text) {
    const names = text.normalize('NFKC')
      .replace(historicalStart, ' ')
      .replace(/(?<![가-힣A-Za-z])이후(?=\s+(?:19|20)\d{2}\s*년)/gu, ' ')
      .replace(/((?:19|20)\d{2})년(?:에는|에도|에|은|는)/gu, '$1년 ')
      .replace(/(\d\s*(?:천만|백만|천|백|만|억|조)?\s*(?:명|건|원|가구|톤|대))(?:가량|\s+넘게)(?=[\s,.!?]|$)/gu, '$1')
      .replace(/전년도?(?:와|과)\s*(?:비교하면|비교해|견주면)(?=[\s,.!?]|$)/gu, ' ')
      .replace(/(?:축소|확대)(?:한|된)\s*데\s*이어(?=[\s,.!?]|$)/gu, ' ')
      .replace(/(증가|감소|상승|하락)\s*(폭|분)/gu, ' $1 $2 ');
    const words = (names.match(/[가-힣A-Za-z]+/gu) || [])
      .map(w => w.replace(/(?:으로는|으로|에서|보다|은|는|을|를|이|가|에|로)$/u, ''));
    return [...new Set(words.filter(w => w.length > 1 && !neutral.test(w) && !predicate.test(w)))];
  }

  function countAmounts(text) {
    const amounts = [];
    // Read number-scale components once, including mixed forms such as 3만 5천 명.
    const component = /(\d[\d,]*(?:\.\d+)?)\s*(천만|백만|조|억|만|천|백)?\s*(명|가구|건|원|톤|대)?(대)?/gu;
    let sum = 0, until = -1, year;
    for (const m of text.matchAll(component)) {
      if (m.index !== until) {
        sum = 0;
        const preceding = text.slice(Math.max(0, m.index - 16), m.index);
        year = Number(/((?:19|20)\d{2})년(?:에는|에|은|는)?\s*$/u.exec(preceding)?.[1]) || null;
      }
      const number = m[1].replaceAll(',', '');
      const scale = scales[m[2] || ''];
      sum += Number(number) * scale;
      until = m[2] && !m[3] ? m.index + m[0].length : -1;
      if (m[3]) {
        const step = scale * 10 ** -(number.split('.')[1]?.length || 0);
        amounts.push({unit: m[3], year, low: sum, high: m[4] ? sum + step : sum});
      }
    }
    return amounts;
  }

  function yearHeader(text, pageYear) {
    const fields = text.normalize('NFKC').replace(/^\s*(?:구분|연도|항목)\s*/u, '').split(/[\s|]+/u).filter(Boolean);
    if (fields.length < 2) return null;
    const years = [];
    for (const field of fields) {
      const match = /^(?:((?:19|20)\d{2})|['‘’](\d{2}))년?$/u.exec(field);
      if (!match) return null;
      let year = Number(match[1] || match[2]);
      if (match[2]) {
        if (!pageYear) return null;
        year += Math.floor(pageYear / 100) * 100;
        if (year > pageYear + 50) year -= 100;
        if (year < pageYear - 50) year += 100;
      }
      if (years.length && years.at(-1) >= year) return null;
      years.push(year);
    }
    return years;
  }

  function dataRow(text, count) {
    const fields = text.trim().split(/\s+/u);
    const cells = fields.slice(-count);
    if (fields.length <= count || cells.length !== count) return null;
    const values = [];
    for (const cell of cells) {
      // Some annual reports print all differences in parentheses; a literal minus sign still matters.
      const match = /^\(?([+△−-]?\d[\d,]*(?:\.\d+)?)\)?$/u.exec(cell);
      if (!match) return null;
      values.push(Number(match[1].replaceAll(',', '').replace(/[△−]/u, '-')));
    }
    const label = fields.slice(0, -count).join(' ');
    if (/\d\s*$/u.test(label) || /[。!?]/u.test(label)) return null;
    return {label, values};
  }

  function labelName(label) {
    // Keep qualifiers such as 방문객(외국인). Only measurement labels and
    // change notation may be removed from parentheses.
    return label.replace(/\(([^)]*)\)/gu, (_, group) =>
        group.split(/[,·/]/u).map(part => part.replace(changeLabel, '').trim())
          .filter(part => part && !/^(?:천만|백만|조|억|만|천|백)?\s*(?:명|가구|건|원|톤|대)$/u.test(part)).join(''))
      .replace(changeLabel, '').replace(/(?:전년\s*대비|[^가-힣A-Za-z0-9])/gu, '')
      .replace(/^(?:전체|합계|총계)/u, '');
  }

  function oneTableUnit(unitLine) {
    if (!unitLine || !/^[（(]?단\s*위\s*[:：]\s*(?:천만|백만|조|억|만|천|백)?\s*(?:명|가구|건|원|톤|대)\s*[)）]?$/u.test(unitLine.text.trim())) return null;
    return countUnit.exec(unitLine.text);
  }

  function annualRows(text) {
    const series = [];
    let paragraph = 0, pageYear, period = '', header, previous, unitLine, caption;
    for (const raw of text.split(/\r\n|[\r\n\u2028\u2029]/u)) {
      if (raw.includes('\f')) { pageYear = null; period = ''; header = previous = unitLine = caption = null; }
      if (!raw.trim()) continue;
      const row = {paragraph: ++paragraph, text: raw};
      const line = raw.trim().normalize('NFKC');
      const years = yearHeader(line, pageYear);
      if (years) {
        header = {row, years, period, unitLine, caption};
        previous = null;
        continue;
      }
      const data = header && dataRow(line, header.years.length);
      if (data) {
        if (changeLabel.test(data.label) && !/(?:율|률|%|퍼센트)/u.test(data.label)) {
          const name = labelName(data.label);
          const inherited = !name && previous;
          const unit = countUnit.exec(data.label) || (inherited && countUnit.exec(previous.label)) ||
            oneTableUnit(header.unitLine);
          const identity = name || (inherited && labelName(previous.label));
          if (identity && unit && !subannual.test(header.period)) {
            series.push({row, header, identity, values: data.values, unit: unit[2], scale: scales[unit[1] || ''],
              context: [header.caption, header.unitLine, header.row, inherited && previous.row].filter(Boolean)});
          }
        }
        previous = {...data, row};
        continue;
      }
      header = previous = null;
      if (/^[（(]?단\s*위\s*[:：]/u.test(line)) { unitLine = row; continue; }
      unitLine = null;
      caption = /^[<〈【[]/u.test(line) ? row : null;
      if (!/^[□○●-]/u.test(line) && !/[.!?。]$/u.test(line) && line.length < 100) {
        const year = /(?:19|20)\d{2}년/u.exec(line)?.[0];
        if (year) pageYear = Number(year.slice(0, 4));
        if (subannual.test(line) || /연간|연도별|연도\s?추이/u.test(line)) period = line;
      }
    }
    return series;
  }

  const ageRate = /(\d{1,3}\s*(?:세\s*(?:이상|이하)|[~∼–-]\s*\d{1,3}\s*세))\s*(고용률|실업률|경제활동참가율)/u;
  const normalizeRate = text => text.normalize('NFKC').replace(/∼|–/gu, '~');
  const compact = text => text.replace(/\s+/gu, '').replace(/(?<=\d)-(?=\d)/gu, '~');

  function rateQuestion(question, articleContext) {
    const query = normalizeRate(question);
    const relative = /상대\s*(?:변화율|증가율|감소율)/u;
    const relativeRate = relative.test(query), points = /(?:%|퍼센트)\s*(?:포인트|p)/iu.test(query);
    if (relativeRate === points) return null;
    const requestedUnit = relativeRate ? '%' : '%p';
    const age = ageRate.exec(query);
    if (!age || (age.index && /[가-힣\d]/u.test(query[age.index - 1]))) return null;
    const units = [...query.matchAll(/(?:%|퍼센트)(?:\s*(포인트|p))?/giu)];
    if (!relativeRate && units.some(m => !m[1] && !/^\s*(?:로|였)/u.test(query.slice(m.index + m[0].length)))) return null;
    // Only a year in the surrounding article can supply a missing time anchor.
    // An added location, denominator or subgroup calls for manual matching.
    const context = normalizeRate(articleContext).trim();
    if (context && context !== query.trim() && !/^(?:19|20)\d{2}년(?:\s*연간)?$/u.test(context)) return null;
    const unqualified = query.replace(age[0], '').replace(relative, '').replace(/(?:19|20)\d{2}\s*년/gu, '')
      .replace(/(?:\d+(?:\.\d+)?\s*)?(?:%|퍼센트)\s*(?:포인트|p)?/giu, '')
      .replace(/(?:증가|상승|감소|하락)(?:했(?:습니다|습니까|나요|는지|다는|다|나)|한)?|(?:올랐|내렸)(?:습니다|습니까|나요|는지|다|나)|떨어졌(?:습니다|다|나)|바뀌었(?:습니다|다|나)|전년(?:도)?|연간|대비|보다|비해|얼마나|얼마|였나요|였나|차이는|몇|은|는|이|가|로|에|와|과|의|인가요|인가/gu, '');
    if (!/^[\s.,?!·]*$/u.test(unqualified)) return null;
    const years = [...new Set([...query.matchAll(/((?:19|20)\d{2})\s*년/gu)].map(m => +m[1]))];
    if (context && context !== query.trim()) {
      const anchor = +context.slice(0, 4);
      if (years.length && !years.includes(anchor)) return null;
      if (!years.length) years.push(anchor);
    }
    if (years.length === 1 && /전년(?:도)?\s*(?:보다|대비|에\s*비해)/u.test(query)) {
      return {current:years[0], previous:years[0] - 1, population:compact(age[1]), measure:age[2], requestedUnit};
    }
    const baselines = [...query.matchAll(/((?:19|20)\d{2})\s*년\s*(?:보다|대비|에\s*비해)/gu)];
    if (years.length !== 2 || baselines.length !== 1) return null;
    const previous = Number(baselines[0][1]);
    if (!years.includes(previous + 1)) return null;
    return {current:previous + 1, previous, population:compact(age[1]), measure:age[2], requestedUnit};
  }

  function comparableRates(text, ask) {
    let paragraph = 0, annualYear = null, sectionYear = null, header = null, waitingRate = null, newPage = true;
    const hits = [];
    let matchingRows = 0;
    const title = /^(?:[<〈]\s*)?((?:19|20)\d{2})\s*년\s*연간\s*(?:고용동향|고용통계|고용률|실업률|경제활동참가율|통계)(?:\s*\(요약\))?\s*[>〉]?$/u;
    const continuation = /^(?:[가-하]|\d+)\.\s*(?:취업자\s*(?:동향|및\s*고용률)|실업자\s*(?:동향|및\s*실업률)|경제활동참가율)$/u;
    const caption = /^(?:[<〈]\s*(?:고용률|실업률|경제활동참가율)(?:\s*추이)?\s*[>〉]|[（(]?단\s*위\s*[:：]\s*[%pP,\s]+[)）]?)$/u;
    const level = /^(\d{1,3}\s*(?:세\s*(?:이상|이하)|[~∼–-]\s*\d{1,3}\s*세))\s*(고용률|실업률|경제활동참가율)\s*\(\s*%\s*\)\s+(.+)$/u;
    const change = /^\(\s*전년\s*대비\s*증감\s*,\s*%\s*p\s*\)\s+(.+)$/iu;
    for (const raw of text.split(/\r\n|[\n\r\u2028\u2029]/u)) {
      if (raw.includes('\f')) { header = waitingRate = null; newPage = true; }
      if (!raw.trim()) continue;
      const row = {paragraph:++paragraph, text:raw}, line = normalizeRate(raw.trim());
      const heading = title.exec(line);
      if (newPage) {
        if (!heading && !continuation.test(line)) sectionYear = null;
        annualYear = sectionYear;
      }
      newPage = false;
      if (heading) { sectionYear = annualYear = +heading[1]; header = waitingRate = null; continue; }
      if (!annualYear) continue;
      const years = yearHeader(line, annualYear);
      if (years) {
        const previous = years.indexOf(ask.previous), current = years.indexOf(ask.current);
        header = previous >= 0 && current === previous + 1 && years.at(-1) <= annualYear ? {row, years, previous, current} : null;
        waitingRate = null;
        continue;
      }
      if (!header) {
        // A different, unrecognised section or table must establish its own scope.
        if (!continuation.test(line) && !caption.test(line) && !/^[□○●※-]/u.test(line) && !/(?:하였음|했음|되었음|됨|였음|[.!?。])$/u.test(line)) annualYear = null;
        continue;
      }
      const delta = change.exec(line);
      if (delta && waitingRate) {
        const numbers = delta[1].replace(/\(\s*([+−△-]?\d+(?:\.\d+)?)\s*\)/gu, '$1').split(/\s+/u);
        if (numbers.length === header.years.length && numbers.every(v => /^[+−△-]?\d+(?:\.\d+)?$/u.test(v))) {
          const at = header.current;
          hits.push({...waitingRate.row, matched:[ask.population, ask.measure], context:[header.row, row], years:header.years,
            annualRate:{population:ask.population, measure:ask.measure, requestedUnit:ask.requestedUnit, headerParagraph:header.row.paragraph, changeParagraph:row.paragraph,
              previous:{year:ask.previous, value:waitingRate.values[header.previous]},
              current:{year:ask.current, value:waitingRate.values[at]}, change:{year:ask.current, value:numbers[at], unit:'%p'}}});
        }
      }
      waitingRate = null;
      const rate = level.exec(line);
      if (rate && compact(rate[1]) === ask.population && rate[2] === ask.measure) {
        matchingRows++;
        const values = rate[3].split(/\s+/u);
        if (values.length === header.years.length && values.every(v => /^\d+(?:\.\d+)?$/u.test(v) && +v <= 100)) waitingRate = {row, values};
      }
      // The employment table also prints a count series before its rate series.
      // Unrelated rows and new captions cannot carry this header forward.
      if (!rate && !delta &&
          !/^(?:취\s*업\s*자|실\s*업\s*자|경제활동인구)\s*\(\s*천명\s*\)\s+[+−△\d,.-][\s+−△\d,.-]*$/u.test(line) &&
          !/^\(전년\s*대비\s*증감,\s*(?:천|만)?명\)\s+[\s\d,().+−△-]+$/u.test(line)) {
        header = null;
        if (!caption.test(line) && !continuation.test(line)) annualYear = null;
      }
    }
    // The same scope may occur in multiple sections. Do not choose between differing series.
    return matchingRows === 1 && hits.length === 1 ? hits : [];
  }

  function statedYears(text) {
    // Korean ranges often print 년 only after the second endpoint.
    const years = /((?:19|20)\d{2})(?=\s*년|\s*(?:[~～∼–—-]|부터|에서)\s*(?:19|20)\d{2}\s*년)/gu;
    return [...text.matchAll(years)].map(match => Number(match[1]));
  }

  function titleFitsMetric(title, metric) {
    // A row labelled simply '이용자' can sit in a table whose caption supplies
    // a city or a population. Keep unknown title words for ordinary source review.
    const words = title.replace(/(?:19|20)\d{2}\s*년/gu, '').match(/[가-힣A-Za-z0-9]+/gu) || [];
    const general = /^(?:연간|연도별|연도|서비스|이용|요약|지표|자료|통계|추이|현황|동향|고용동향|고용률|실업률|경제활동참가율|구분|표|전체|총계|합계)$/u;
    return words.every(word => general.test(word) || metric.includes(word));
  }

  function find(documentText, query, {articleContext = ''} = {}) {
    const combined = [query, articleContext].filter(Boolean).join(' ');
    const base = {hits: [], usedArticleContext: Boolean(articleContext.trim()), needsPublicationDate: dateWord.test(combined)};
    const rate = rateQuestion(query, articleContext);
    if (rate) {
      const hits = comparableRates(documentText, rate);
      if (hits.length) return {...base, state:'candidates', hits};
    }
    if (!trendWords.test(query) || subannual.test(combined)) return {...base, state:'ordinary'};
    const ratio = /%|퍼센트|증가율|감소율/u;
    if (ratio.test(query)) return {...base, state:'ordinary'};
    if (ratio.test(articleContext)) return countAmounts(query).length
      ? {...base, state:'needs-context', reason:'comparison-unit'} : {...base, state:'ordinary'};
    // A numeric age restriction cannot be discarded by the Korean word tokenizer.
    // Leave scoped subgroup searches to the ordinary finder until parsed exactly.
    if (/\d+\s*(?:세|대)(?=\s|[가-힣]|$)/u.test(combined)) return {...base, state: 'ordinary'};
    const metric = subject(combined).join('');
    if (!metric) return {...base, state: 'needs-context', reason: 'missing-subject'};
    const amounts = countAmounts(combined);
    const years = statedYears(combined);
    const history = [...query.matchAll(historicalStart)];
    const datedRecords = [];
    for (const match of history) {
      if (!match[2]) continue;
      const recordYear = Number(match[1]) + Number(match[2]);
      const preceding = query.slice(0, match.index);
      const datedClause = /((?:19|20)\d{2})\s*년(?:에는|에도|에|은|는)\s*[^년.!?;\n]*$/u.exec(preceding);
      if (datedClause && Number(datedClause[1]) !== recordYear)
        return {...base, state:'needs-context', reason:'record-period'};
      datedRecords.push(recordYear);
    }
    const spans = [...combined.matchAll(/(\d+)\s*년\s*만(?:의|에)\s*(?:최대|최소|최고|최저)/gu)]
      .map(match => Number(match[1]));
    const consecutive = /(\d+)\s*년\s*연속/u.exec(combined);
    const minYears = consecutive ? Number(consecutive[1]) + 1 : /두\s*해\s*연속/u.test(combined) ? 3 : 2;
    const compatible = annualRows(documentText).filter(item => item.identity === metric &&
      titleFitsMetric(item.header.period, metric) && titleFitsMetric(item.header.caption?.text || '', metric) &&
      item.header.years.length >= minYears &&
      item.header.years.every((y, i, all) => i === 0 || y - all[i - 1] === 1) &&
      amounts.every(a => a.unit === item.unit));
    let candidates = compatible.filter(({header}) => [...years, ...datedRecords].every(year => header.years.includes(year)) &&
      spans.every(span => header.years.at(-1) - header.years[0] >= span));
    let partial = false;
    if (!candidates.length) {
      const startYears = new Set(history.map(m => Number(m[1])));
      const comparisonYears = [...new Set(statedYears(query.replace(historicalStart, ' ') + ' ' + articleContext))];
      if (startYears.size && comparisonYears.length >= 2) {
        candidates = compatible.filter(({header}) => [...comparisonYears, ...datedRecords].every(y => header.years.includes(y)) &&
          [...startYears].every(y => y < header.years[0]));
        partial = candidates.length > 0;
      }
    }
    if (!candidates.length) return {...base, state: 'needs-context', reason: 'no-series'};
    // Do not suppress an otherwise exact subject-year row for disagreeing with
    // the article's figures. Numeric overlap only orders eligible source rows.
    const order = item => amounts.filter(a => item.values.some((v, index) => {
      if (a.year && item.header.years[index] !== a.year) return false;
      const value = Math.abs(v) * item.scale;
      return a.low === a.high ? value === a.low : value >= a.low && value < a.high;
    })).length;
    candidates.sort((a, b) => order(b) - order(a) || a.row.paragraph - b.row.paragraph);
    const hits = candidates.slice(0, 3).map(item => ({...item.row, matched: [item.identity],
      context: item.context, years: item.header.years,
      ...(partial && {yearCoverage:{missingYears:[...new Set(years.filter(y => !item.header.years.includes(y)))]}})}));
    return {...base, state: partial ? 'partial-series' : 'candidates', hits};
  }

  const api = {find};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidenceTrend = api;
})(globalThis);
