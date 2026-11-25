'use strict';
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const {search} = require('../../docs/reader/evidence-search.js');
const gold = require('./transfer-gold.json');

function replay(bytes) {
  const textSha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(textSha256, gold.textSha256, '동결한 전체 PDF의 -layout 추출문을 사용하세요.');
  const pages = bytes.toString('utf8').split('\f').map(page => page.split(/\r?\n/u));
  const line = (page, n) => pages[page - 1][n - 1].trim();
  const compact = s => s.replace(/\s+/gu, '');
  assert.match(line(2,46), /통계표에 수록된 자료는 반올림/u);
  assert.equal(compact(line(30,1)), '2024년연간고용동향');
  assert.equal(compact(line(32,3)), '가.취업자및고용률');
  assert.match(compact(line(32,6)), /^□2024년15세이상취업자는/u);
  const years = line(32,19).split(/\s+/u);
  assert.deepEqual(years, ['’20년','’21년','’22년','’23년','’24년']);
  function row32(n, label, numeric) {
    const match = label.exec(line(32,n));
    assert.ok(match, 'PDF 32쪽 ' + n + '행의 대상·단위를 확인하세요.');
    const cells = match[1].trim().split(/\s+/u);
    assert.equal(cells.length, years.length);
    assert.ok(cells.every(value => numeric.test(value)));
    return cells.map(value => Number(value.replaceAll(',', '')));
  }
  const integer = /^\d{1,3}(?:,\d{3})*$/u;
  const employed32 = row32(22, /^취\s*업\s*자\(천명\)\s+(.+)$/u, integer);
  const rate32 = row32(38, /^15세이상\s+고용률\(%\)\s+(.+)$/u, /^\d{1,3}\.\d$/u);
  const changes = /^\(전년대비증감,%p\)((?:\([+-]?\d+\.\d\))+)$/.exec(compact(line(32,41)));
  assert.ok(changes, '15세 이상 비율 바로 아래의 공표 증감 단위를 확인하세요.');
  const pointChanges = [...changes[1].matchAll(/\(([+-]?\d+\.\d)\)/gu)].map(cell => Number(cell[1]));
  assert.equal(pointChanges.length, years.length);
  const headers = pages[41].slice(0,7).map(compact);
  assert.deepEqual(headers, ['1.전체경제활동인구총괄','(단위:천명)','15세이상인구경제활동고용률','1)',
    '실업률2)','경제활동인구비경제참가율','취업자실업자활동인구(%)(%)(%)']);
  assert.equal(compact(line(42,55)), '주:1)취업자/15세이상인구×100');
  assert.deepEqual(pages[41].slice(7,12).map(s => s.trim().split(/\s+/u)[0]), ['2020','2021','2022','2023','2024']);

  function annual(year, n) {
    const cells = line(42,n).split(/\s+/u);
    assert.equal(cells.length, 9);
    assert.equal(Number(cells[0]), year);
    assert.ok(cells.slice(1,6).every(cell => integer.test(cell)));
    assert.ok(cells.slice(6).every(cell => /^\d{1,3}\.\d$/u.test(cell)));
    // The frozen header identifies population (1), employed (3), and the
    // employment rate (7). Cross-check both series against p.32 for this year.
    const population = Number(cells[1].replaceAll(',',''));
    const employed = Number(cells[3].replaceAll(',',''));
    const displayed = Number(cells[7]), yearColumn = years.indexOf('’' + String(year).slice(-2) + '년');
    assert.equal(employed, employed32[yearColumn]); assert.equal(displayed, rate32[yearColumn]);
    assert.ok(population > employed && employed > 0);
    const rate = 100 * employed / population;
    assert.equal(Number(rate.toFixed(1)), displayed);
    return {year, pdf42Line:n, populationThousands:population, employedThousands:employed, displayedPct:displayed,
      rateFromCountsPct:rate, minRate:100 * (employed - 0.5) / (population + 0.5),
      maxRate:100 * (employed + 0.5) / (population - 0.5)};
  }
  const before = annual(2023,11), after = annual(2024,12);
  // The editor must resolve both source locations from this full layout.
  const text = bytes.toString('utf8');
  const question = '2024년 연간 15세 이상 고용률은 2023년보다 상대 0.1% 증가했다.';
  const {passages} = search(text,question);
  assert.equal(passages.length,1);
  assert.equal(passages[0].text.trim(),line(32,38));
  const supporting = passages[0].annualCounts;
  for (let year = 2021; year <= 2024; year++) {
    const q = year + '년 연간 15세 이상 고용률은 ' + (year - 1) + '년보다 상대 0.1% 증가했다.';
    const prior = annual(year - 1, 8 + year - 1 - 2020), current = annual(year, 8 + year - 2020);
    assert.deepEqual(search(text, q).passages[0]?.annualCounts?.counts,
      [prior, current].map(v => ({year:v.year, employed:v.employedThousands, population:v.populationThousands})));
  }
  assert.deepEqual(supporting?.counts,[before,after].map(value => ({
    year:value.year, employed:value.employedThousands, population:value.populationThousands
  })));
  assert.deepEqual(supporting.rows.map(row => row.text.trim()),[1,2,3,4,5,6,7,11,12,55].map(n => line(42,n)));
  const journalSourceText = text.slice(0,-1).split('\f').join('\n\f\n');
  assert.deepEqual(search(journalSourceText,question,{pdfSha256:gold.pdfSha256}).passages[0].annualCounts.counts,supporting.counts);
  assert.equal(search(journalSourceText,question,{pdfSha256:'0'.repeat(64)}).passages[0].annualCounts,undefined);
  for (const q of [question.replace('15세 이상','15~64세'),question.replace('연간','12월'),
    question.replace('연간','연간 여성'),question.replace('2023년','2022년'),question.replace('고용률','실업률')]) {
    assert.ok(search(text,q).passages.every(hit => !hit.annualCounts),q);
  }
  assert.ok(search(text,question,{articleContext:'서울 여성 조사'}).passages.every(hit => !hit.annualCounts));

  const originalPage = pages[41].join('\n'), note = line(42,55);
  const changedPages = [
    originalPage.replace(note,'주: 3) 취업자/15세이상인구×100\n   1) 취업자/생산가능인구×100'),
    '2025년 3월 고용동향\n서울특별시\n소급 개정 통계표(잠정)\n\f' + originalPage.replace('45,570','45,610'),
    originalPage.replace(note,note + '\n   3) 이 표의 2024년 연간 값은 잠정치이며 본문은 확정치임.')
  ];
  for (const changed of changedPages) {
    const altered = text.replace(originalPage,() => changed);
    assert.notEqual(altered,text);
    const [candidate] = search(altered,question,{pdfSha256:gold.pdfSha256}).passages;
    assert.equal(candidate.annualRate.current.value,'62.7');
    assert.equal(candidate.annualCounts,undefined);
  }
  const relative = (oldValue, newValue) => 100 * (newValue - oldValue) / oldValue;
  function interval(min, max) {
    return {lowerPct:Math.floor(min * 1e6) / 1e6, upperPct:Math.ceil(max * 1e6) / 1e6,
      exceedsPointOne:min > 0.1 ? true : max <= 0.1 ? false : null};
  }
  // Midpoints of adjacent displayed tenths coincide exactly in integer
  // twentieths of a percentage point. Avoid a spurious nonzero lower bound.
  const oldTwentieths = Math.round(before.displayedPct * 10) * 2;
  const newTwentieths = Math.round(after.displayedPct * 10) * 2;
  const fromRates = interval(relative(oldTwentieths + 1, newTwentieths - 1), relative(oldTwentieths - 1, newTwentieths + 1));
  const fromCounts = interval(relative(before.maxRate, after.minRate), relative(before.minRate, after.maxRate));
  const conclusion = bounds => bounds.exceedsPointOne === null ? '상대 증가율이 0.1%를 넘는지 확정할 수 없습니다' :
    bounds.exceedsPointOne ? '상대 증가율 하한도 0.1%를 넘습니다' : '상대 증가율 상한이 0.1% 이하입니다';
  return {sourceUrl:gold.sourceUrl, pdfSha256FromManifest:gold.pdfSha256, verifiedLayoutSha256:textSha256,
    scope:'2023·2024년 연간 15세 이상 인구의 고용률. 15~64세 및 분기·월별 행은 제외.',
    evidence:'PDF 2쪽 46–47행 반올림 안내, 30쪽 연간 표제, 32쪽 19·22·38·41행 연도·취업자·15세 이상 고용률·공표 증감, 42쪽 1–7행 표 머리글, 11–12행 연간 인원, 55행 분모 각주. 행 번호는 각 쪽 layout 원문 기준.',
    assumption:'PDF의 반올림 안내에 따라 정수 천명은 각 셀 ±0.5천 명, 소수 한 자리 비율은 ±0.05%p로 가정. 닫힌 구간을 사용하며 경계는 소수점 여섯 자리에서 바깥쪽으로 표시. 이 범위에는 표본오차가 포함되지 않음.',
    observations:[before,after].map(({minRate,maxRate,...observed}) => observed),
    published2024ChangePp:pointChanges[years.indexOf('’24년')],
    relativeFromRateDisplays:{estimatePct:relative(before.displayedPct,after.displayedPct),...fromRates},
    relativeFromCountDisplays:{estimatePct:relative(before.rateFromCountsPct,after.rateFromCountsPct),...fromCounts},
    interpretation:'32쪽의 두 표시 비율만으로는 ' + conclusion(fromRates) + '. 42쪽의 같은 대상·기간의 천명 단위 인원을 위 가정으로 대조하면 ' +
      conclusion(fromCounts) + '. 이 범위는 공표 인원으로 재계산한 값입니다. 원표에 공표한 변화량의 단위는 퍼센트포인트입니다.'};
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error('사용법: node experiments/labour-field-review/replay-rate-counts.cjs 고용동향-layout.txt');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(replay(readFileSync(process.argv[2])), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
