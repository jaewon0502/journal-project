const {test} = require('node:test');
const assert = require('node:assert/strict');
const {compare, matchRevisionRows} = require('../docs/reader/article-compare-core.js');
const engine = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');

const sources = [{id: 'doc', title: '시험 회의록', url: 'https://example.invalid/minutes',
  version: '1판', locator: '표 1', excerpt: '시범 구역은 한 곳이다. 전국 시행 실적은 조사하지 않았다.'}];
const base = '급행 버스를 도입한다.\n표본은 한 곳이다.\n전국 실적은 아직 조사 중이다.\n이 결정은 무책임하다.';
const revisedBase = base.replace('이 결정은 무책임하다.', '시는 표본을 늘릴 계획이라고 밝혔다.');
function snapshot({article = base, states = [], levels = {}, core = [], sources: catalog = sources} = {}) {
  const first = engine.prepare(article, catalog);
  const receipts = first.rows.flatMap((row, index) => {
    const state = states[index];
    if (state == null) return [];
    const decision = typeof state === 'string' ? {status: state} : state;
    return [engine.decide(row, {
      reason: '구역과 수치를 확인했다.', sourceIds: decision.status === 'opinion' ? [] : ['doc'],
      acknowledged: true, ...decision
    }, catalog)];
  });
  const report = engine.report(article, catalog, receipts);
  const rows = report.rows;
  const ratings = {};
  for (const [dimension, level] of Object.entries(levels)) {
    ratings[dimension] = level === 'na' ? {level, reason: '이 기사에 비교할 두 주체가 없다.'} : {
      level, rowId: rows[0].id, quote: rows[0].text, compareRowId: rows[1].id, compareQuote: rows[1].text,
      sourceId: 'doc', sourceQuote: '시범 구역은 한 곳이다.', reason: '자료와 대조했다.',
      ...(dimension === 'standards' ? {compareSourceId: 'doc', compareSourceQuote: '전국 시행 실적은 조사하지 않았다.'} : {}),
      impact: '독자가 조사 대상을 다르게 이해한다.'
    };
  }
  const saved = rubric.save(report, catalog, {coreRowIds: core.map(i => rows[i].id), ratings});
  return {article, rows, sources:catalog, demo: true, sourceKey: rows[0].sourceKey, assessment: rubric.evaluate(report, catalog, saved)};
}
const ratio = (n, d) => ({numerator: n, denominator: d, pct: d ? 100 * n / d : null});

test('단독 인용문의 문구가 같아도 바뀐 논평 제목·끝 서명은 다시 대조한다', () => {
  const quote = '“이번 예산안은 무책임하다.”';
  function paired(before, after, target = quote) {
    const first = engine.prepare(before), second = engine.prepare(after);
    const original = first.rows.find(row => row.text === target);
    assert.ok(original);
    return matchRevisionRows(first, second).has(original.id);
  }
  const heading = ['야당 대변인의 서면 논평', '다음은 논평 전문이다.', quote, '논평 끝.'].join('\n');
  assert.equal(paired(heading, heading.replace('야당', '여당')), false);
  const signed = ['논평 전문', quote, '논평 끝.', '— 야당 대변인'].join('\n');
  assert.equal(paired(signed, signed.replace('야당','여당')), false);
  const prefix = '표지 초안.\n안내문.\n';
  const marker = prefix + '발언자 실명: 김지수 의원\n' + quote + '\n논평 끝.';
  assert.equal(paired(marker, marker.replace('초안', '정정')), true);
  assert.equal(paired(marker, marker.replace('김지수', '김지민')), false);
  const relative = marker.replace('발언자 실명: 김지수', '발언자: 해당');
  assert.equal(paired(relative, relative.replace('초안', '정정')), false);
  assert.equal(paired(heading, heading), true);
  const named = '야당 대변인은 “이번 예산안은 무책임하다”고 말했다.';
  const full = prefix + named + '\n논평 끝.';
  assert.equal(paired(full, full.replace('초안','정정'), named),true);
  for (const line of ['“청년수당 예산은 10억 원이다”라고 강조했다.', '"청년수당 예산은 10억 원이다"며 설명했다.',
    '「청년수당 예산은 10억 원이다」라면서 지적했다.']) {
    const statement = ['민주당 김지수 의원의 서면 답변', '다음은 답변 전문이다.', line, '답변 끝.'].join('\n');
    assert.equal(paired(statement, statement.replace('민주당 김지수', '국민의힘 김지민'), line), false);
    const signed = marker.replace(quote, line);
    assert.equal(paired(signed, signed.replace('초안', '정정'), line), true);
  }
  const namedAfter = '“청년수당 예산은 10억 원이다”라고 김지수 의원은 강조했다.';
  const selfContained = heading.replace(quote, namedAfter);
  assert.equal(paired(selfContained, selfContained.replace('야당','여당'), namedAfter), true);
});

test('수정 후 해당 없음이나 미평가인 기존 왜곡은 개선율 옆에 남긴다', () => {
  const left = snapshot({levels: {wording: 3, framing: 2, omission: 2, standards: 2}});
  const right = snapshot({article:revisedBase, levels: {wording: 0, standards: 'na'}});
  const compared = compare(left, right, 'revision');
  assert.deepEqual(compared.bias.improved, ratio(1, 1));
  assert.deepEqual(compared.bias.pendingImportant, compared.dimensions.slice(1).map(d => d.title));
});

test('원본 미평가 및 해당 없음에서 수정본 중요 왜곡으로 판정한 항목은 확인한 악화와 구별한다', () => {
  const before = snapshot({levels:{wording:1, framing:'na', standards:2}});
  const after = snapshot({article:revisedBase, levels:{wording:0, framing:3, omission:2, standards:2}});
  const {bias} = compare(before, after, 'revision');
  assert.deepEqual(bias.worsened, ratio(0,1));
  assert.deepEqual(bias.revisedImportantWithoutPrior, [
    {title:'제목·도입부와 본문', prior:'na'}, {title:'근거 선택과 맥락 누락', prior:null}
  ]);
  assert.deepEqual(compare(after, before, 'revision').bias.pendingImportant,
    bias.revisedImportantWithoutPrior.map(d => d.title));
});

test('중요한 왜곡의 개선·악화는 각각 비교 가능한 원본의 심각·경미 항목만 분모로 쓴다', () => {
  const original = snapshot({levels: {wording: 3, framing: 0, omission: 2, standards: 'na'}});
  const revision = snapshot({article:revisedBase, levels: {wording: 1, framing: 2, omission: 2, standards: 0}});
  const result = compare(original, revision, 'revision');
  assert.deepEqual(result.bias.improved, ratio(1, 2));
  assert.deepEqual(result.bias.worsened, ratio(1, 1));
  assert.equal(result.bias.paired, 3);
  assert.equal(result.bias.unpaired, 1);
  assert.equal(result.dimensions.find(item => item.id === 'standards').left, 'na');
  const reversed = compare(revision, original, 'revision');
  assert.deepEqual(reversed.bias.improved, ratio(1, 2));
  assert.deepEqual(reversed.bias.worsened, ratio(1, 1));
  assert.equal(result.dimensions.find(item => item.id === 'wording').leftRating.sourceId, 'doc');
});

test('미평가, 양측 해당 없음, 분모 없음은 0% 또는 일치로 바꾸지 않는다', () => {
  const original = snapshot({levels: {wording: 2, standards: 'na'}});
  const revision = snapshot({levels: {omission: 1, standards: 'na'}});
  for (const mode of ['revision', 'reviewers']) {
    const r = compare(original, revision, mode);
    assert.equal(r.bias.paired, 0);
    assert.equal(r.bias.unpaired, 4);
    assert.deepEqual(r.bias.agreement, ratio(0, 0));
    assert.deepEqual(r.bias.improved, ratio(0, 0));
    assert.deepEqual(r.bias.worsened, ratio(0, 0));
  }
  const zero = compare(snapshot({levels: {wording: 3}}), snapshot({article:revisedBase, levels: {wording: 2}}), 'revision');
  assert.deepEqual(zero.bias.improved, ratio(0, 1));
  assert.deepEqual(zero.bias.worsened, ratio(0, 0));
});

test('동일 본문의 재평가는 편향 수정 지표의 분모와 분자에 넣지 않고 개별 단계와 일치도를 보존한다', () => {
  const left = snapshot({levels:{wording:2, framing:0, omission:3}});
  const right = snapshot({levels:{wording:0, framing:3, standards:2}});
  for (const mode of ['revision', 'reviewers']) {
    const {dimensions, bias} = compare(left, right, mode);
    assert.equal(bias.hasRevision, false);
    assert.deepEqual(bias.improved, ratio(0,0));
    assert.deepEqual(bias.worsened, ratio(0,0));
    assert.deepEqual(bias.pendingImportant, []);
    assert.deepEqual(bias.revisedImportantWithoutPrior, []);
    assert.deepEqual(bias.agreement, ratio(0,2));
    assert.deepEqual(dimensions.slice(0,2).map(d => [d.left,d.right]), [[2,0],[0,3]]);
  }
});

test('같은 판본의 독립 판정은 편향 단계와 사실 구간별로 계산하고 미결·의견·핵심 표시를 드러낸다', () => {
  const a = snapshot({states: ['fact', 'fact', null, 'opinion'], levels: {wording: 0, omission: 3}, core: [0]});
  const b = snapshot({states: ['fact', 'contradicted', null, 'opinion'], levels: {wording: 0, omission: 1}, core: [1]});
  const r = compare(a, b, 'reviewers');
  assert.deepEqual(r.bias.agreement, ratio(1, 2));
  assert.equal(r.bias.largeDifferences, 1);
  assert.deepEqual(r.facts.agreement, ratio(1, 2));
  assert.equal(r.facts.total, 4);
  assert.deepEqual([r.facts.unresolved, r.facts.excluded, r.facts.bothExcluded], [1, 1, 1]);
  assert.deepEqual(r.facts.disagreements.map(f => f.text), ['표본은 한 곳이다.']);
  assert.deepEqual(r.facts.coreDifferences.map(f => [f.coreLeft, f.coreRight]), [[true, false], [false, true]]);
  assert.equal(r.facts.rows[2].sameJudgment, null);
  assert.equal(r.facts.rows[3].sameJudgment, null);
  assert.equal(r.facts.evidenceCompared, 2);
  assert.equal(r.facts.evidenceDifferences.length, 0);
  const blank = compare(snapshot(), snapshot(), 'reviewers');
  assert.deepEqual(blank.facts.agreement, ratio(0, 0));
  assert.equal(blank.facts.disagreements.length, 0);
  assert.equal(compare(a, snapshot(), 'reviewers').facts.evidenceCompared, 0);
});

test('같은 구간에서 지지한 범위가 달라지면 일치로 집계하지 않는다', () => {
  const article = '시청은 시범 운영을 마쳤고, 사업은 기대 이상이다.';
  const a = snapshot({article, states: ['fact']});
  const b = snapshot({article, states: [{status: 'mixed', factSpan: '시청은 시범 운영을 마쳤고', opinionSpan: '사업은 기대 이상이다.'}]});
  const r = compare(a, b, 'reviewers');
  assert.deepEqual(r.facts.agreement, ratio(0, 1));
  assert.equal(r.facts.disagreements[0].rightScope, '시청은 시범 운영을 마쳤고');
});

test('판본·원자료가 다르면 독립 채점을 합치지 않고 예시와 실제는 양쪽 모드에서 분리한다', () => {
  const a = snapshot(), b = snapshot({article: base + '\n새 내용이다.'});
  assert.throws(() => compare(a, b, 'reviewers'), /같은 판본/);
  const otherSource = {...a, sourceKey: '다른 자료 묶음'};
  assert.throws(() => compare(a, otherSource, 'reviewers'), /같은 자료/);
  assert.equal(compare(a, otherSource, 'revision').sourceChanged, true);
  for (const mode of ['revision', 'reviewers']) {
    assert.throws(() => compare(a, {...a, demo: false}, mode), /연습 기록/);
  }
  assert.throws(() => compare(a, a, 'invalid'), /비교를 선택/);
});

test('동일한 기사에서는 반복된 구절의 실제 위치를 구분한다', () => {
  const article = '표본은 한 곳이다.\n\n표본은 한 곳이다.';
  const a = snapshot({article, states: ['contradicted', null]});
  const b = snapshot({article, states: ['contradicted', 'contradicted']});
  const r = compare(a, b, 'revision').conflicts;
  assert.deepEqual(r.persisting.map(item => item.rowId), [a.rows[0].id]);
  assert.deepEqual(r.newlyObserved.map(item => item.rowId), [a.rows[1].id]);
  assert.equal(r.unmatched.length, 0);
  const grouped = snapshot({article: '표본은 한 곳이다.\n표본은 한 곳이다.', states: ['fact']});
  assert.equal(grouped.rows[0].positions.length, 2);
  assert.equal(compare(grouped, grouped, 'reviewers').facts.total, 1);
});

test('수정본 충돌은 양쪽에서 유일한 문구와 문맥까지 일치할 때만 원본과 연결한다', () => {
  const a = snapshot({article: '도입부다.\n지역이다.\n조사가 끝났다.\n원표다.\n마무리다.',
    states: [null, null, 'fact']});
  const b = snapshot({article: '다른 도입부다.\n지역이다.\n조사가 끝났다.\n원표다.\n새 마무리다.',
    states: ['contradicted', null, 'contradicted']});
  const result = compare(a, b, 'revision');
  assert.deepEqual(result.conflicts.newlyObserved.map(i => [i.text, i.previous]), [['조사가 끝났다.', 'supported']]);
  assert.deepEqual(result.conflicts.unmatched.map(i => [i.text, i.previous]), [['다른 도입부다.', null]]);
  assert.notEqual(a.rows[2].id, b.rows[2].id);
  const repeated = '도입부다.\n지역이다.\n조사가 끝났다.\n원표다.\n지역이다.\n조사가 끝났다.\n원표다.\n마무리다.';
  const ambiguous = compare(snapshot({article: repeated}), snapshot({article: '새 글이다.\n' + repeated,
    states: [null, null, null, 'contradicted']}), 'revision').conflicts;
  assert.equal(ambiguous.newlyObserved.length, 0);
  assert.equal(ambiguous.unmatched.length, 1);
  const repeatedRows = '앞 문장이다.\n같은 값이다.\n같은 값이다.\n뒤 문장이다.';
  const old = snapshot({article:repeatedRows, states:[null, 'contradicted']});
  const added = snapshot({article:repeatedRows + '\n보도 시점이다.', states:[null, 'contradicted']});
  assert.equal(old.rows[1].positions.length, 2);
  assert.equal(compare(old, old, 'revision').conflicts.persisting.length, 1);
  assert.equal(compare(old, added, 'revision').conflicts.unmatched.length, 1);
});

test('두 판본에 인용 속 충돌이 한 건씩 있어도 이전 인용의 후속 판정과 새로 내용까지 확인한 발언을 구분한다', () => {
  const first = '의원은 “예산은 20억 원이었다”고 말했다.';
  const second = '시장도 “예산은 30억 원이었다”고 답했다.';
  const article = first + '\n' + second;
  const catalog = [sources[0], {id:'budget', title:'예산표', url:'https://budget.example/table', version:'확정본', locator:'표 1', excerpt:'사업 예산은 10억 원이었다.'}];
  const speech = {status:'attribution', sourceIds:['doc']};
  const conflict = {...speech, contentStatus:'contradicted', contentChecked:true, contentReason:'의결액 원표에서 해당 금액을 대조했다.', contentSourceIds:['budget']};
  const pack = (states, text = article) => snapshot({article:text, states, sources:catalog});
  const before = pack([conflict, speech]), after = pack([speech, conflict]);
  const compared = compare(before, after, 'revision');
  assert.deepEqual([compared.accuracy.left.quotedConflict, compared.accuracy.right.quotedConflict], [1,1]);
  assert.deepEqual([compared.accuracy.left.contradicted, compared.accuracy.right.contradicted], [0,0]);
  assert.equal(compared.originalQuotedConflicts[0].text, first);
  assert.equal(compared.originalQuotedConflicts[0].revised.label, '발언 사실 확인 · 담긴 주장 미확인');
  assert.equal(compared.quotedConflicts.newlyObserved[0].text, second);
  assert.equal(compared.quotedConflicts.newlyObserved[0].priorDecision.label, '발언 사실 확인 · 담긴 주장 미확인');
  assert.equal(compared.quotedConflicts.newlyObserved[0].revised.scope, '예산은 30억 원이었다');
  assert.equal(compare(before, before, 'revision').quotedConflicts.persisting[0].text, first);
  const rewritten = compare(before, pack([conflict], '의장은 “예산은 40억 원이었다”고 답했다.'), 'revision');
  assert.equal(rewritten.quotedConflicts.unmatched.length, 1);
  assert.equal(rewritten.originalQuotedConflicts[0].revised, null);
  const narrative = pack(['contradicted', speech]);
  assert.equal(compare(narrative, before, 'revision').quotedConflicts.scopeChanged[0].previous, 'contradicted');
  assert.equal(compare(before, narrative, 'revision').conflicts.scopeChanged[0].previous, 'quotedConflict');
  assert.equal(compare(before, narrative, 'revision').conflicts.persisting.length, 0);
});

test('원본 핵심 주장을 삭제하거나 다시 쓰면 편향 점수가 낮아져도 그 구절의 보존 여부를 별도로 남긴다', () => {
  const original = snapshot({article: '시 전체 예산은 절반으로 줄었다.\n의회는 회의를 열었다.\n원표는 내일 공개한다.',
    levels: {wording: 3}, core: [0]});
  for (const article of ['의회는 회의를 열었다.\n원표는 내일 공개한다.',
    '시범 사업 예산만 절반으로 줄었다.\n의회는 회의를 열었다.\n원표는 내일 공개한다.']) {
    const r = compare(original, snapshot({article, levels: {wording: 0}}), 'revision');
    assert.deepEqual(r.bias.improved, ratio(1, 1));
    assert.deepEqual(r.untracedCore, [{rowId: original.rows[0].id, text: '시 전체 예산은 절반으로 줄었다.'}]);
  }
  assert.deepEqual(compare(original, original, 'revision').untracedCore, []);
  const article = '첫 문장이다.\n앞 문맥이다.\n핵심 구절이다.\n뒤 문맥이다.';
  const before = snapshot({article, core: [2]});
  assert.deepEqual(compare(before, snapshot({article: '새로운 도입이다.\n' + article}), 'revision').untracedCore, []);
});

test('각자 다른 절을 부분 확인하거나 보류한 경우에는 미결 판단의 범위 차이로 드러난다', () => {
  const article = '시범 노선은 승인됐고, 전 노선은 검토 중이다.';
  const partial = snapshot({article, states: [{status: 'partial', factSpan: '시범 노선은 승인됐고'}]});
  const otherPart = snapshot({article, states: [{status: 'partial', factSpan: '전 노선은 검토 중이다.'}]});
  const held = snapshot({article, states: ['held']});
  for (const other of [otherPart, held]) {
    const r = compare(partial, other, 'reviewers');
    assert.deepEqual(r.facts.agreement, ratio(0, 0));
    assert.equal(r.facts.disagreements.length, 1);
    assert.equal(r.facts.disagreements[0].openScopeDifference, true);
  }
  assert.equal(compare(partial, snapshot({article}), 'reviewers').facts.disagreements.length, 0);
});

test('앞의 대상을 가리키는 구절은 선행 문맥을 비교하고 독립적인 구절은 도입부가 바뀌어도 추적한다', () => {
  function article(intro, claim, tail = '붙임은 한 쪽이다.') {
    return [intro, '확정 자료가 공개됐다.', claim, '기간은 한 해다.', tail].join('\n');
  }
  for (const [claim, referencesEarlier] of [
    ['이 사업의 예산이 늘었다.', true], ['그 회계의 지출이 줄었다.', true], ['감사원은 같은 사업의 지출을 확인했다.', true],
    ['그는 3일 회의에 출석했다.', true], ['2024년 특별회계 지출은 78.6조 원이었다.', false],
    ['지급액은 정부안과 같은 30억 원이었다.', false]
  ]) {
    const original = snapshot({article:article('원래 기사 도입이다.', claim), states:[null,null,'fact']});
    const compareClaim = revised => compare(original, snapshot({article:revised, states:[null,null,'fact']}), 'revision').originalSupported[0];
    assert.equal(compareClaim(article('달라진 다른 도입이다.', claim)).revisedFullySupported, !referencesEarlier, claim);
    assert.equal(compareClaim(article('원래 기사 도입이다.', claim, '붙임이 두 쪽으로 바뀌었다.')).revisedFullySupported, true, claim);
  }
});

test('수정 전 충돌 구절은 다른 사실로 대체해 판정 수가 같아도 추적 대상에 남는다', () => {
  const left = snapshot({article: '이 지역에서 세 건이 발생했다.\n회의를 열었다.', states: ['contradicted', 'fact']});
  const right = snapshot({article: '지난해 회의를 세 번 열었다.\n회의를 열었다.', states: ['fact', 'fact']});
  const r = compare(left, right, 'revision');
  assert.equal(r.accuracy.left.adjudicated, r.accuracy.right.adjudicated);
  assert.equal(r.accuracy.right.accuracyPct, 100);
  assert.equal(r.untracedCore.length, 0);
  assert.deepEqual(r.originalConflicts, [{rowId: left.rows[0].id, text: left.rows[0].text, original:left.assessment.accuracy.rows[0], revised: null}]);
});

test('평가자가 핵심으로 고르지 않은 지지 구절도 두 판본의 실제 문구와 확인 범위를 대조한다', () => {
  const mixedText = '시청은 시범 운영을 마쳤고, 사업은 기대 이상이다.';
  const lines = ['첫 보도다.', mixedText, '조사 결과다.', '회의는 어제 열렸다.', '사업비는 10억 원이다.'];
  const left = snapshot({article:lines.join('\n'), states:['fact', 'fact', null, 'fact', 'fact']});
  const mixed = {status:'mixed', factSpan:'시청은 시범 운영을 마쳤고', opinionSpan:'사업은 기대 이상이다.'};
  const revisedLines = [...lines.slice(0, -1), '접수처는 두 곳이다.'];
  const right = snapshot({article:revisedLines.join('\n'), states:['fact', mixed, null, 'fact', 'fact']});
  const result = compare(left, right, 'revision');
  assert.equal(result.accuracy.left.supported, result.accuracy.right.supported);
  assert.equal(result.untracedCore.length, 0);
  assert.deepEqual(result.originalSupported.map(e => [e.text, e.revised?.label ?? null, e.revisedFullySupported]), [
    [lines[0], '원자료 지지', true], [mixedText, '사실 구절만 지지', false],
    [lines[3], null, false], [lines[4], null, false]
  ]);
  assert.deepEqual(result.originalSupported[1].original, left.assessment.accuracy.rows[1]);
  assert.equal(result.originalSupported[1].revised.scope, mixed.factSpan);
  assert.ok(!compare(right, left, 'revision').originalSupported.some(e => e.text === mixedText));
  assert.equal(compare(left, snapshot({article:lines.slice(0, -1).join('\n')}), 'revision')
    .originalSupported.at(-1).revised, null);
});

test('반복 구절은 위치가 모호하면 연결하지 않고 인용 속 발언의 의견과 검증된 사실을 구별한다', () => {
  const repeat = '이 회의는 비공개였다.';
  const article = ['도입이다.', repeat, repeat, '취재 기록이다.'].join('\n');
  const first = snapshot({article, states:[null, 'fact']});
  assert.equal(compare(first, first, 'revision').originalSupported[0].revisedFullySupported, true);
  const second = snapshot({article:article + '\n기록을 덧붙인다.', states:[null, 'fact']});
  assert.equal(compare(first, second, 'revision').originalSupported[0].revised, null);
  const quote = '위원장은 “참석자는 50명”이라고 말했다.';
  const catalog = [...sources, {id:'roster', title:'명부', url:'https://example.invalid/roster', version:'확정본', locator:'1쪽', excerpt:'50명'}];
  const speech = {status:'attribution', sourceIds:['doc']};
  const full = snapshot({article:quote, sources:catalog, states:[{...speech, contentStatus:'supported',
    contentChecked:true, contentSourceIds:['roster'], contentReason:'명부와 대조했다.'}]});
  const opinion = snapshot({article:'위원장은 “이 결정은 부당하다”고 말했다.', sources:catalog,
    states:[{...speech, contentStatus:'opinion', contentChecked:true, contentReason:'정책에 대한 발언자의 평가다.'}]});
  assert.equal(compare(full, full, 'revision').originalSupported[0].revisedFullySupported, true);
  assert.deepEqual(compare(opinion, full, 'revision').originalSupported, []);
});

test('원본 충돌의 후속 판정을 미결·의견·부분 범위까지 현재 구간의 실제 판정에서 읽는다', () => {
  const article = '시청은 시범 운영을 마쳤고, 사업은 기대 이상이다.';
  const left = snapshot({article, states: ['contradicted']});
  for (const next of [null, 'held', 'opinion', 'fact', 'contradicted',
    {status: 'mixed', factSpan: '시청은 시범 운영을 마쳤고', opinionSpan: '사업은 기대 이상이다.'}]) {
    const right = snapshot({article, states: [next]});
    const [entry] = compare(left, right, 'revision').originalConflicts;
    assert.deepEqual(entry.revised, right.assessment.accuracy.rows[0]);
  }
  assert.deepEqual(compare(snapshot(), left, 'revision').originalConflicts, []);
});

test('새로 등장한 정정 문구가 수정본 한 구간과 정확히 일치할 때만 대조 후보를 보여 준다', () => {
  const sourceText = '사업비는 20억 원이다.', correction = '사업비는 10억 원이다.';
  const conflict = {status: 'contradicted', correction, correctionChecked: true};
  const source = snapshot({article: sourceText, states: [conflict]});
  const revision = snapshot({article: correction});
  const [row] = compare(source, revision, 'revision').originalConflicts;
  assert.equal(row.revised, null);
  assert.equal(row.candidate.text, correction);
  assert.equal(row.candidate.label, '미확인');
  // Even if offsets happen to match, a nearby old value, repeated replacement or existing quote is ambiguous.
  for (const article of [sourceText + '\n' + correction, correction + '\n' + correction, correction + '\n\n' + correction,
    '그는 “' + correction + '”라고 말했다.']) {
    const [entry] = compare(source, snapshot({article}), 'revision').originalConflicts;
    assert.equal(entry.candidate, undefined);
  }
  const beforeWithCorrection = snapshot({article: sourceText + '\n' + correction, states: [conflict]});
  assert.equal(compare(beforeWithCorrection, revision, 'revision').originalConflicts[0].candidate, undefined);
  const twoProposals = snapshot({article: sourceText + '\n다른 예산은 15억 원이다.', states: [conflict, conflict]});
  assert.ok(compare(twoProposals, revision, 'revision').originalConflicts.every(entry => !entry.candidate));
});

test('같은 자료를 서로 다른 용도로 쓴 경우와 한쪽만 더 고른 근거를 구분한다', () => {
  const catalog = [sources[0], {id:'budget', title:'예산 기록', url:'https://example.org/budget', version:'확정본',
    locator:'표 5', excerpt:'예산은 19억 원으로 의결됐다.'}];
  const article = '의원은 “예산은 20억 원이었다”고 말했다.\n표본은 한 곳이다.';
  const quote = (speech, budget) => ({status:'attribution', sourceIds:[speech], contentStatus:'contradicted',
    contentChecked:true, contentSourceIds:[budget], contentReason:'의결액을 대조했다.'});
  const left = snapshot({article, sources:catalog, states:[quote('doc', 'budget'), 'fact']});
  const right = snapshot({article, sources:catalog, states:[quote('budget', 'doc'), {status:'fact', sourceIds:['doc','budget']}]});
  const {facts} = compare(left, right, 'reviewers');
  assert.deepEqual(facts.agreement, ratio(2, 2));
  assert.deepEqual(facts.evidenceDifferences.map(row => row.differentSources), [
    [{role:'speech', left:['doc'], right:['budget']}, {role:'content', left:['budget'], right:['doc']}],
    [{role:'source', left:[], right:['budget']}]
  ]);
});
