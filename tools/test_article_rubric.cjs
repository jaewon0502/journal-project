const {test} = require('node:test');
const assert = require('node:assert/strict');
const factcheck = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');
const workspace = require('../docs/reader/workspace-snapshot.js');

const sources = [
  {id: 'minute', url: 'https://council.example/agenda', locator: '의결표', version: '확정', excerpt: '시의회는 사업비 3억 원을 의결했다. 가 정당은 찬성했다. 이미 사업을 도입한 시행 범위는 시범 구역 한 곳이다.'},
  {id: 'speech', url: 'https://assembly.example/statement', locator: '발언 기록 2절', version: '확정', excerpt: '의원단은 시범 구역에만 적용된다고 말했다. 한 의원은 참담하다고 말했다.'}
];
const article = '시 전체에 시행한다.\n시범 구역에 사업을 도입했다.\n사업의 효과는 아직 조사 중이다.';
function decision(row, status, refs = ['minute'], extras = {}) {
  return factcheck.decide(row, {status, reason:'원자료에서 해당 기간과 대상을 대조했다.', sourceIds:refs, acknowledged:true, ...extras}, sources);
}
function state(text = article, decisions = []) {
  const first = factcheck.prepare(text, sources);
  return factcheck.report(text, sources, decisions.map((d,i) => decision(first.rows[i], ...d)));
}
function form(report, ratings = {}, core = []) {
  return rubric.save(report, sources, {coreRowIds:core, ratings});
}
function entry(row, level, more = {}) {
  return {level, rowId:row.id, quote:row.text, sourceId:'minute', sourceQuote:'시범 구역 한 곳',
    reason:'기사와 의결표의 적용 대상을 대조했다.', impact: level ? '한 구역의 일을 시 전체로 읽게 한다.' : '', ...more};
}

test('확정된 항목과 남은 항목을 다른 분모로 보여 주며 중심 주장의 반증을 맨 앞에 경고한다', () => {
  const r = state(article, [['contradicted', ['minute'], {correction:'시범 구역에서 시행한다.', correctionChecked:true}], ['fact']]);
  const saved = form(r, {}, [r.rows[0].id, r.rows[2].id]);
  const a = rubric.evaluate(r, sources, saved).accuracy;
  assert.deepEqual([a.supported,a.contradicted,a.unresolved,a.adjudicated,a.total],[1,1,1,2,3]);
  assert.equal(a.accuracyPct,50);
  assert.equal(a.coveragePct,200/3);
  assert.deepEqual(a.coreContradicted,[r.rows[0].id]);
  assert.deepEqual(a.coreUnresolved,[r.rows[2].id]);
  assert.match(a.summary,/^지정한 핵심 항목 1개가 원자료와 충돌/);
  assert.match(a.rows[0].scope,/시 전체/);
});

test('판정되지 않은 사실과 의견만 있는 기사에 정확도 0 또는 100을 붙이지 않는다', () => {
  const pending = rubric.evaluate(state(),sources);
  assert.equal(pending.accuracy.accuracyPct,null);
  assert.equal(pending.accuracy.coveragePct,0);
  assert.equal(pending.bias.unknown,4);
  assert.equal(pending.bias.maxLevel,null);
  const opinions = state('이 결정은 무책임하다.', [['opinion',[]]]);
  const a = rubric.evaluate(opinions,sources).accuracy;
  assert.equal(a.total,0); assert.equal(a.excluded,1); assert.equal(a.coveragePct,null); assert.equal(a.accuracyPct,null);
});

test('발언 주체와 내용의 사실 여부를 구분하고 보수·진보를 바꾸어도 판정 규칙은 같다', () => {
  for (const label of ['보수','진보']) {
    const text = label + ' 성향 의원단은 “시범 구역에만 적용된다”고 말했다.';
    const r = state(text,[['attribution',['speech']]]);
    const a = rubric.evaluate(r,sources).accuracy;
    assert.equal(a.unresolved,1); assert.equal(a.attributionOnlyCount,1); assert.equal(a.accuracyPct,null);
    const confirmed = state(text,[['attribution',['speech'],{
      contentStatus:'supported', contentChecked:true, contentReason:'다른 기록에서 발언의 사실 내용도 대조했다.', contentSourceIds:['minute']
    }]]);
    assert.equal(rubric.evaluate(confirmed,sources).accuracy.supported,1);
  }
  const opinion = state('의원은 “참담하다”고 말했다.',[['attribution',['speech'],{contentStatus:'opinion',
    contentChecked:true,contentReason:'발언의 내용은 의원의 평가다.'}]]);
  assert.match(rubric.evaluate(opinion,sources).accuracy.rows[0].label,/발언 사실 확인.*의견/);
});

test('혼합 문장에서는 사실 구절만 지지하고 부분 확인과 작성 중 판단은 미확인으로 둔다', () => {
  const factSpan='시의회가 3억 원을 의결한 것은';
  const mixed=state(factSpan+' 무책임한 결정이다.',[['mixed',['minute'],{factSpan,opinionSpan:'무책임한 결정이다.'}]]);
  const a=rubric.evaluate(mixed,sources).accuracy;
  assert.equal(a.supported,1);assert.equal(a.rows[0].scope,factSpan);
  const partial=state('가 정당은 찬성했고 나 정당은 반대했다.',[['partial',['minute'],{factSpan:'가 정당은 찬성했고'}]]);
  const p=rubric.evaluate(partial,sources).accuracy;
  assert.equal(p.partialCount,1);assert.equal(p.unresolved,1);assert.equal(p.supported,0);
  mixed.rows[0].draftPending=true;
  assert.equal(rubric.evaluate(mixed,sources).accuracy.accuracyPct,null);
});

test('정확한 구절·출처·이유 없이 0점도 인정하지 않고 양의 단계에는 영향과 실제 비교를 요구한다', () => {
  const r = state(), row = r.rows[0];
  for (const edit of [{quote:'없는 문구'}, {rowId:'missing'}, {sourceQuote:'미등록 원문'}, {sourceId:'none'}, {reason:' '}]) {
    assert.throws(() => form(r, {wording:entry(row,0,edit)}));
  }
  assert.throws(() => form(r,{omission:entry(row,1,{impact:''})}));
  assert.throws(() => form(r,{standards:entry(row,0)}));
  assert.throws(() => form(r,{framing:entry(row,1,{compareQuote:row.text})}));
  assert.throws(() => form(r,{standards:entry(row,3,{compareQuote:'기사에 없는 비교'})}));
  const saved=form(r,{framing:entry(row,2,{compareQuote:r.rows[1].text,direction:'사업 제안자에게 유리'})});
  const b=rubric.evaluate(r,sources,saved).bias;
  assert.equal(b.maxLevel,2); assert.equal(b.assessed,1); assert.equal(b.unknown,3);
  assert.equal(b.items.find(i=>i.id==='framing').rating.direction,'사업 제안자에게 유리');
});

test('관점 있는 기사와 미점검 차원을 절대적 무편향으로 분류하지 않는다', () => {
  const r=state(), exclusion={level:'na',reason:'비교할 수 있는 두 당사자가 등장하지 않는다.'};
  assert.throws(()=>form(r,{wording:exclusion}));
  assert.throws(()=>form(r,{omission:exclusion}));
  assert.throws(()=>form(r,{standards:{level:'na',reason:''}}));
  const b=rubric.evaluate(r,sources,form(r,{standards:exclusion,wording:entry(r.rows[0],0)})).bias;
  assert.equal(b.maxLevel,0);assert.equal(b.unknown,2);assert.equal(b.notApplicable,1);assert.match(b.summary,/대조한 1개 기준/);
  const onlyNA=rubric.evaluate(r,sources,form(r,{standards:exclusion})).bias;
  assert.equal(onlyNA.maxLevel,null);
});

test('기사·근거·판정 변화에 따른 재사용 범위를 지키고 손상된 평가를 결과에서 제외한다', () => {
  const initial=state(), coreId=initial.rows[0].id;
  const original=form(initial,{omission:entry(initial.rows[0],2)},[coreId]);
  const recorded=state(article,[['held']]);
  const revisedData=[sources[0],{...sources[1],version:'정정본'}];
  const refreshed=factcheck.report(article,revisedData,[]);
  for (const [r,refs] of [[recorded,sources],[refreshed,revisedData]]) {
    const value=rubric.evaluate(r,refs,original);
    assert.equal(value.stale,true);
    assert.equal(value.bias.maxLevel,null);
    assert.deepEqual(value.accuracy.coreRowIds,[coreId]);
    assert.deepEqual(value.saved.ratings,{});
  }
  const unrelated=factcheck.report(article+'\n후속 소식이다.',sources,[]);
  const changed=rubric.evaluate(unrelated,sources,original);
  assert.equal(changed.saved,null);assert.deepEqual(changed.accuracy.coreRowIds,[]);
  const damaged=structuredClone(original);damaged.ratings.omission.sourceQuote='없는 구절';
  assert.equal(rubric.evaluate(initial,sources,damaged).bias.assessed,0);
  const onlyCore=form(initial,{},[coreId]);
  assert.equal(rubric.evaluate(recorded,sources,onlyCore).stale,false);
  assert.deepEqual(rubric.evaluate(recorded,sources,onlyCore).accuracy.coreRowIds,[coreId]);
});

test('같은 제목·리드도 기사 안의 두 위치가 다를 때만 대조한 구절로 인정한다', () => {
  const line = '시범 구역에 사업을 도입했다.';
  for (const gap of ['\n','\n\n']) {
    const r = state(line + gap + line);
    const first = r.rows[0], other = r.rows.at(-1);
    const comparison = entry(first,0,{compareRowId:other.id,compareQuote:line});
    const saved = form(r,{framing:comparison});
    assert.equal(rubric.evaluate(r,sources,saved).bias.items[1].rating.compareRowId,other.id);
    assert.throws(() => form(r,{framing:{...comparison,compareRowId:'missing'}}));
    assert.throws(() => form(r,{framing:{...comparison,compareRowId:''}}));
    if (r.rows.length > 1) assert.throws(() => form(r,{framing:{...comparison,compareRowId:first.id}}));
  }
  const single = state(line);
  assert.throws(() => form(single,{framing:entry(single.rows[0],0,{compareRowId:single.rows[0].id,compareQuote:line})}));
  // A saved old record with a globally unique comparison still opens.
  const r = state();
  const old = form(r,{framing:entry(r.rows[0],0,{compareQuote:r.rows[1].text})});
  delete old.ratings.framing.compareRowId;
  assert.equal(rubric.evaluate(r,sources,old).bias.assessed,1);
});

test('같은 판단을 다시 기록하거나 기록 전 문장에 입력해도 기사 평가는 무효가 되지 않는다', () => {
  const r = state(article, [['fact']]);
  const saved = form(r, {omission: entry(r.rows[0], 0)});
  assert.equal(rubric.evaluate(r, sources, saved).stale, false);
  r.rows[1].draftPending = true;                       // a row with no recorded decision
  assert.equal(rubric.evaluate(r, sources, saved).stale, false);
  const again = state(article, [['fact']]);            // identical decision, new timestamp and checksum
  assert.equal(rubric.evaluate(again, sources, saved).stale, false);
  const changed = state(article, [['held']]);
  assert.equal(rubric.evaluate(changed, sources, saved).stale, true);
  r.rows[0].draftPending = true;                       // a draft that hides the recorded decision
  assert.equal(rubric.evaluate(r, sources, saved).stale, true);
});

test('이전 형식으로 저장한 평가도 현재 판단과 같으면 그대로 집계한다', () => {
  const r = state(article, [['fact']]);
  const saved = form(r, {omission: entry(r.rows[0], 0)});
  const legacy = JSON.stringify([rubric.version, r.rows.map(row => [row.id, row.binding, row.status, row.receipt?.checksum ?? null, !!row.draftPending])]);
  const old = {...saved, binding: legacy};
  assert.equal(rubric.evaluate(r, sources, old).stale, false);
  assert.equal(rubric.evaluate(r, sources, old).bias.assessed, 1);
  assert.equal(rubric.evaluate(state(article, [['held']]), sources, old).stale, true);
});

test('같은 판본에서 한 항목의 근거가 손상돼도 독립적으로 확인되는 평가와 핵심 표시는 복원한다', () => {
  const r = state();
  const {id} = r.rows[0];
  const saved = form(r, {wording: entry(r.rows[0], 3), omission: entry(r.rows[1], 1)}, [id]);
  saved.ratings.omission.sourceQuote = '원자료 어디에도 없다.';
  saved.coreRowIds.push('존재하지 않는 구간');
  const file = {format: workspace.schema, article, articleDraft: article, demo: false, sources, receipts: [],
    rowDrafts: [], sourceDraft: {fields: Object.fromEntries(workspace.sourceFields.map(k => [k, '']))}, articleAssessment: saved};
  const restored = workspace.read(file);
  assert.equal(restored.stale, true);
  assert.deepEqual(restored.assessment.accuracy.coreRowIds, [id]);
  assert.equal(restored.assessment.bias.maxLevel, 3);
  assert.equal(restored.assessment.bias.assessed, 1);
  assert.deepEqual(Object.keys(restored.assessment.saved.ratings), ['wording']);
  const roundTrip = workspace.read({...file, articleAssessment: restored.assessment.saved});
  assert.equal(roundTrip.stale, false);
  assert.equal(roundTrip.assessment.bias.maxLevel, 3);
  assert.equal(workspace.read({...file, sources: [{...sources[0], version: '다음 판'}, sources[1]]}).assessment.bias.maxLevel, null);
});

test('근거 지지율이 100%여도 분모에서 빠지거나 일부 범위만 지지된 핵심 구절을 요약한다', () => {
  const fact = '시의회가 3억 원을 의결한 것은';
  const article = ['이 결정은 무책임하다.', fact + ' 무책임한 결정이다.', '의원은 “참담하다”고 말했다.', '회의가 열렸다.'].join('\n');
  const report = state(article, [['opinion', []], ['mixed', ['minute'], {factSpan: fact, opinionSpan: '무책임한 결정이다.'}],
    ['attribution', ['speech'], {contentStatus: 'opinion', contentChecked: true, contentReason: '의원의 평가다.'}], ['fact']]);
  const result = rubric.evaluate(report, sources, form(report, {}, report.rows.map(r => r.id))).accuracy;
  assert.equal(result.accuracyPct, 100);
  assert.equal(result.coveragePct, 100);
  assert.deepEqual(result.coreExcluded, [report.rows[0].id]);
  assert.deepEqual(result.coreLimited, [report.rows[1].id, report.rows[2].id]);
  assert.match(result.summary, /핵심 항목 1개는 의견.*분모/);
  assert.match(result.summary, /핵심 항목 2개는 사실 구절 또는 발언 사실만/);
});

test('정확히 인용한 발언의 내용 충돌은 기사 지지율에서 따로 떼고 완료율에는 포함한다', () => {
  const quote = '사업비는 30억 원이었다';
  const statement = '의원은 “' + quote + '”고 말했다.';
  const dual = ['attribution', ['speech'], {contentStatus:'contradicted', contentChecked:true,
    contentReason:'당시 확정 의결표에는 같은 사업비가 3억 원으로 기록됐다.', contentSourceIds:['minute']}];
  for (const debunked of [false, true]) {
    const article = debunked ? statement + '\n의결표의 사업비는 3억 원이다.' : statement;
    const report = state(article, debunked ? [dual, ['fact']] : [dual]);
    const a = rubric.evaluate(report, sources, form(report, {}, [report.rows[0].id])).accuracy;
    assert.deepEqual(a.coreQuotedConflict, [report.rows[0].id]);
    assert.deepEqual(a.coreContradicted, []);
    assert.deepEqual([a.contradicted, a.unresolved, a.quotedConflict, a.coveragePct], [0, 0, 1, 100]);
    assert.deepEqual([a.supported, a.adjudicated, a.accuracyPct], debunked ? [1, 1, 100] : [0, 0, null]);
    assert.deepEqual([a.reviewed, a.total], debunked ? [2, 2] : [1, 1]);
    assert.equal(a.rows[0].scope, quote);
  }
});

test('충돌 판정을 다시 작성하는 동안에는 미확인 시절 편향 평가가 되살아나지 않는다', () => {
  const unreviewed = state(), id = unreviewed.rows[0].id;
  const earlier = form(unreviewed, {wording: entry(unreviewed.rows[0], 0)});
  const conflict = decision(unreviewed.rows[0], 'contradicted');
  const draft = {...conflict, reason: '표의 기간을 다시 적는다.'};
  const live = (receipts, edits) => workspace.activeReport(article, sources, receipts, new Map(edits));
  const editing = live([conflict], [[id, draft]]);
  assert.equal(editing.confirmedCount, 0);
  assert.equal(editing.contradictedCount, 0);
  assert.equal(editing.rows[0].receipt, null);
  assert.equal(rubric.evaluate(editing, sources, earlier).bias.assessed, 0);
  assert.equal(rubric.restoreDraft(editing, sources, {binding: earlier.binding, activeId: 'wording', entries: {wording: {level: '0'}}}), null);
  const underReview = form(editing, {wording: entry(editing.rows[0], 1)});
  assert.equal(rubric.evaluate(editing, sources, underReview).bias.assessed, 1);
  const other = decision(unreviewed.rows[0], 'fact');
  assert.equal(rubric.evaluate(live([other], [[id, draft]]), sources, underReview).bias.assessed, 0);
  const duplicate = live([other, conflict], [[id, other]]);
  assert.equal(duplicate.confirmedCount, 0);
  assert.equal(duplicate.rows[0].receipt, null);
  assert.equal(duplicate.rows[0].draftRecord, null);
  const ambiguousLegacy = {...earlier, binding: JSON.stringify([rubric.version, editing.rows.map(row => [
    row.id, row.binding, row.status, row.receipt?.checksum ?? null, !!row.draftPending
  ])])};
  assert.equal(rubric.evaluate(editing, sources, ambiguousLegacy).bias.assessed, 0);
  assert.equal(rubric.evaluate(live([], [[id, draft]]), sources, earlier).bias.assessed, 1);
  const recorded = live([conflict], []);
  const confirmed = form(recorded, {wording: entry(recorded.rows[0], 2)});
  assert.equal(rubric.evaluate(editing, sources, confirmed).bias.assessed, 0);
  assert.equal(rubric.evaluate(live([conflict], []), sources, confirmed).bias.maxLevel, 2);
});
