const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const source = require('../experiments/labour-field-review/coordinator-key.json');
const spec = source.tasks.find(t => t.id === 'labour-rate');
const stamp = 'c'.repeat(64);

function entry(id, method, kind, kitVersion) {
  const manual = method === 'manual';
  const basis = {...spec, id:'private-task', caseId:'private-case', articleUrl:'https://example.org/private-article',
    prompt:'private-question'};
  return {basis, expected:basis.verdict, locationGrade:'yes', verdictGrade:'yes', reasonGrade:'yes',
    gradingTime:{id:String(id).padStart(32,'0'), ms:manual ? 5000 : 50000, status:'complete', partial:false},
    trial:{format:'journal-field-trial-v1', id:'private-answer-' + id, participant:'private-person-' + id,
      caseId:basis.caseId, articleUrl:basis.articleUrl, taskId:basis.id, prompt:basis.prompt,
      method, kind, ...(kitVersion ? {kitVersion} : {}), status:'completed', recovered:false, split:true,
      phaseMs:{search:manual ? 60000 : 40000, locate:0, decide:0}, found:'found',
      documentUrl:'https://example.org/private-source', locator:'private-locator',
      verdict:basis.verdict, reason:'private-reason <img src=x>'}};
}

function screen(t) {
  const read = name => fs.readFileSync(path.join(__dirname, '../docs/reader', name), 'utf8');
  const {window} = new JSDOM(read('field-summary.html'), {url:'https://example.org/field-summary.html', runScripts:'outside-only'});
  t.after(() => window.close());
  const doc = window.document, el = id => doc.getElementById(id);
  for (const script of doc.querySelectorAll('script[src]')) window.eval(read(script.getAttribute('src')));
  let file, name;
  window.URL.createObjectURL = value => { file = value; return 'blob:test'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { name = this.download; };
  return {el,
    async upload(id, value) {
      const input = el(id);
      Object.defineProperty(input, 'files', {configurable:true, value:[{text:async () => JSON.stringify(value)}]});
      await input.onchange({target:input});
    },
    showKind(kind) {
      el('kind').value = kind;
      el('kind').dispatchEvent(new window.Event('change'));
      el('toggle-results').click();
    },
    async download(area) {
      const button = [...el(area).querySelectorAll('button')].find(b => b.textContent.includes('시간 비교표 HTML 저장'));
      assert.ok(button, area);
      button.click();
      const html = await file.text();
      assert.doesNotMatch(html, /private-|example\.org|<img|cccccccccccc/);
      assert.match(file.type, /text\/html/);
      const result = new JSDOM(html);
      t.after(() => result.window.close());
      assert.equal(result.window.document.querySelectorAll('script,iframe,form,[src],[href]').length,0);
      return {text:result.window.document.body.textContent,name};
    }};
}

test('현장 시간표에 회신과 명부의 방식 구분·검증 분모를 담고 답안 원문은 제외한다', async t => {
  const p = screen(t);
  const rows = [entry(1,'manual','editor',stamp), entry(2,'journal','editor',stamp)];
  await p.upload('roster-file', {format:'journal-field-assignment-v1',
    assignments:rows.map(({trial:{participant,method,caseId,articleUrl,taskId,prompt}})=>({participant,method,caseId,articleUrl,taskId,prompt}))});
  await p.upload('imports', {format:'journal-field-grades-v1',entries:rows});
  assert.equal(p.el('comparisons').querySelectorAll('button').length,0);
  p.showKind('editor');
  const reported = await p.download('comparisons'), assigned = await p.download('allocation-comparisons');
  assert.match(reported.text,/현업 참여 기록.*회신에 기록된 방식/);
  assert.match(assigned.text,/사전 배정표에 지정한 방식/);
  for (const item of [reported,assigned]) {
    assert.match(item.text,/회수한 답안1건1건/);
    assert.match(item.text,/평균 완료 시간60초40초/);
    assert.match(item.text,/세 항목 성공 1건/);
    assert.match(item.text,/65\.0초/); assert.match(item.text,/90\.0초/);
    assert.match(item.name,/과제1-판본1\.html$/);
  }
});

test('연습과 미확인 판본을 명시하고 서로 다른 판본의 시간 차이를 단정하지 않는다', async t => {
  const p = screen(t);
  await p.upload('imports',{format:'journal-field-grades-v1',entries:[entry(1,'manual','practice'),entry(2,'journal','practice')]});
  p.showKind('practice');
  const sample = await p.download('comparisons');
  assert.match(sample.text,/연습 기록.*배포본 미확인/);
  assert.match(sample.text,/같은 판본에서 두 방식의 온전한 완료 시간이 확인되어야/);
  assert.doesNotMatch(sample.text,/33\.3%|38\.5%/);
  assert.match(sample.name,/연습-기록상/);
});

test('시간 일부가 빠져 완료 평균이 역전되고 채점 시계 없이 성공과 실패를 확인한 경우를 함께 공유한다', async t => {
  const p = screen(t);
  const rows = [entry(1,'manual','practice',stamp),entry(2,'journal','practice',stamp),entry(3,'journal','practice',stamp)];
  rows[2].trial.recovered = true;
  rows[2].trial.split = false;
  rows[2].trial.phaseMs.search = 180000;
  for (const item of rows) {
    delete item.gradingTime;
    if (item.trial.method === 'journal') item.reasonGrade = 'no';
  }
  await p.upload('imports',{format:'journal-field-grades-v1',entries:rows});
  p.showKind('practice');
  const {text} = await p.download('comparisons');
  assert.match(text,/온전히 남은 완료 답안의 평균 · 저널 .*33\.3%/);
  assert.match(text,/회수한 완료 답안 전체에서는 저널 방식이 평균 50초 이상 더 걸렸습니다/);
  assert.match(text,/모두 맞은 답안 \/ 완료 답안1\/1건0\/2건/);
  assert.match(text,/진행자 채점 시간 미측정/);
});
