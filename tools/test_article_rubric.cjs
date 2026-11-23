const {test} = require('node:test');
const assert = require('node:assert/strict');
const factcheck = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');

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
