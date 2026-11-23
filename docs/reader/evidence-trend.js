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

  function subject(text) {
    const words = (text.normalize('NFKC').replace(/(증가|감소|상승|하락)\s*(폭|분)/gu, ' $1 $2 ').match(/[가-힣A-Za-z]+/gu) || [])
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

  function find(documentText, query, {articleContext = ''} = {}) {
    const combined = [query, articleContext].filter(Boolean).join(' ');
    const base = {hits: [], usedArticleContext: Boolean(articleContext.trim()), needsPublicationDate: dateWord.test(combined)};
    if (!trendWords.test(query) || subannual.test(combined) || /%|퍼센트|증가율|감소율/u.test(query))
      return {...base, state: 'ordinary'};
    // A numeric age restriction cannot be discarded by the Korean word tokenizer.
    // Leave scoped subgroup searches to the ordinary finder until parsed exactly.
    if (/\d+\s*(?:세|대)(?=\s|[가-힣]|$)/u.test(combined)) return {...base, state: 'ordinary'};
    const metric = subject(combined).join('');
    if (!metric) return {...base, state: 'needs-context', reason: 'missing-subject'};
    const amounts = countAmounts(combined);
    const years = [...combined.matchAll(/((?:19|20)\d{2})년/gu)].map(m => Number(m[1]));
    const consecutive = /(\d+)\s*년\s*연속/u.exec(combined);
    const minYears = consecutive ? Number(consecutive[1]) + 1 : /두\s*해\s*연속/u.test(combined) ? 3 : 2;
    const candidates = annualRows(documentText).filter(item => item.identity === metric &&
      item.header.years.length >= minYears &&
      item.header.years.every((y, i, all) => i === 0 || y - all[i - 1] === 1) && years.every(year => item.header.years.includes(year)) &&
      amounts.every(a => a.unit === item.unit));
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
      context: item.context, years: item.header.years}));
    return {...base, state: 'candidates', hits};
  }

  const api = {find};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidenceTrend = api;
})(globalThis);
