const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {JSDOM} = require('jsdom');
const model = require('../docs/reader/retention-case.js');
const script = readFileSync(require.resolve('../docs/reader/core-context-notes-ui.js'), 'utf8');
const sample = require('../experiments/core-quote-revision/series-summary.json');

function screen(t, notes = []) {
  const dom = new JSDOM('<details class="core-context"><summary>원본 핵심 구절</summary></details>', {runScripts:'outside-only'});
  const w = dom.window, doc = w.document;
  t.after(() => w.close());
  w.JournalRetentionCase = model;
  w.eval(script);
  const record = structuredClone(sample);
  record.factContext.beforeCore[1] = 2;
  const rows = ['시의회 의결', '독자의 의견', '사업 결정', '여당 의원은 “바람직하다”고 말했다.'].map((text,i) => ({id:'unit-' + i, text}));
  const group = doc.querySelector('.core-context');
  for (const index of [1,3]) {
    const item = doc.createElement('details');
    item.dataset.coreContextBefore = String(index);
    item.innerHTML = '<summary>원본 구절</summary>';
    group.append(item);
  }
  const preview = (snapshot, label, quote, id) => {
    assert.ok(snapshot.rows.some(r => r.id === id && r.text === quote));
    const node = doc.createElement('blockquote');
    node.textContent = label + ' · ' + quote;
    return node;
  };
  const form = w.JournalCoreContextNotesUI.mount({container:group, record, editors:[{snapshots:[null,{rows}]}], notes, ratingPassage:preview});
  const card = before => group.querySelector('[data-core-context-before="' + before + '"]');
  const field = (before,key) => card(before).querySelector('[data-core-context-' + key + ']');
  function edit(before, key, value) {
    const input = field(before,key);
    input.value = value;
    input.dispatchEvent(new w.Event(key === 'state' ? 'change' : 'input'));
  }
  return {form, doc, card, field, edit, group, summary:group.querySelector('[data-core-context-summary]')};
}

test('발언자·취지 변화에 연결한 구절과 이유를 보관하고 확인된 다음 구절부터 이어간다', t => {
  const p = screen(t);
  assert.match(p.summary.textContent,/대조 완료 0\/2개/);
  assert.equal(p.group.querySelectorAll('datalist').length,1);
  assert.equal(p.group.querySelectorAll('datalist option').length,4);
  assert.equal(p.field(1,'target').getAttribute('list'),p.field(3,'target').getAttribute('list'));
  p.edit(1,'state','changed');
  p.edit(1,'target','４');
  p.edit(1,'reason','야당 의원의 반대 발언이 여당 의원의 찬성 발언으로 바뀌었다.');
  assert.match(p.field(1,'preview').textContent,/수정본 기사.*여당 의원.*바람직/);
  const exported = p.form.collect();
  assert.deepEqual(exported,[{before:1, after:3, status:'changed', reason:'야당 의원의 반대 발언이 여당 의원의 찬성 발언으로 바뀌었다.'}]);
  p.form.saved(exported);
  assert.match(p.summary.textContent,/대조 완료 1\/2개.*달라짐 1개.*남은 구절 1개/);
  const restored = screen(t,exported);
  restored.form.focusNext();
  assert.equal(restored.doc.activeElement,restored.card(3).querySelector('summary'));
  assert.equal(restored.card(3).open,true);
  assert.equal(restored.field(1,'target').value,'4');
  restored.edit(3,'state','absent');
  restored.edit(3,'reason','수정본 전체에서 야당 의원의 발언을 찾지 못했다.');
  assert.equal(restored.field(3,'target').disabled,true);
  restored.form.saved(restored.form.collect());
  restored.form.focusNext();
  assert.equal(restored.doc.activeElement,restored.summary);
  assert.match(restored.summary.textContent,/대조 완료 2\/2개.*찾지 못함 1개/);
});

test('의견 구절의 취지 유지는 기록할 수 있고, 비어 있는 대상·이유는 해당 입력에서 보완한다', t => {
  const p = screen(t);
  p.edit(3,'state','retained');
  p.edit(3,'target','5');
  assert.throws(()=>p.form.collect(),/수정본 구절/);
  assert.equal(p.field(3,'target'),p.doc.activeElement);
  p.edit(3,'target','4');
  assert.throws(()=>p.form.collect(),/이유/);
  assert.equal(p.field(3,'reason'),p.doc.activeElement);
  assert.match(p.field(3,'preview').textContent,/여당 의원/);
  p.edit(3,'reason','같은 사람이 같은 취지의 뜻을 밝혔는지 직접 확인했다.');
  assert.equal(p.form.collect()[0].status,'retained');
  p.edit(3,'state','absent');
  assert.equal(p.field(3,'target').value,'');
  assert.equal(p.field(3,'preview').textContent,'');
  p.field(3,'clear').click();
  assert.deepEqual(p.form.collect(),[]);
  p.edit(1,'reason','회의록 확인 중');
  assert.throws(()=>p.form.collect(),/판단을 선택/);
  assert.equal(p.doc.activeElement,p.field(1,'state'));
  p.edit(1,'state','pending');
  assert.deepEqual(p.form.collect(),[{before:1, after:null, status:'pending', reason:'회의록 확인 중'}]);
});

test('파일 저장 중 새로 쓴 판단과 선택한 구절을 보존하고 미완료로 남긴다', t => {
  const p = screen(t);
  p.edit(1,'state','absent');
  p.edit(1,'reason','수정본에 원래 발언이 없다.');
  const initially = p.form.collect();
  p.edit(1,'state','changed');
  p.edit(1,'target','2');
  p.edit(1,'reason','공청회 발언이 기자의 평가로 바뀌었다.');
  p.form.saved(initially);
  assert.match(p.card(1).querySelector('summary').textContent,/달라짐.*저장 전/);
  assert.equal(p.field(1,'target').value,'2');
  assert.equal(p.form.collect()[0].status,'changed');
  assert.match(p.summary.textContent,/찾지 못함 1개/);
  p.form.focusNext();
  assert.equal(p.doc.activeElement,p.card(1).querySelector('summary'));
});
