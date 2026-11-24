const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const blind = require('../docs/reader/blind-revision.js');

function work(article, excerpt = '확정액 10억 원') {
  return {
    format:workspace.schema, article, articleDraft:article, demo:false,
    sources:[{id:'내부-메모',title:'시의회 예산표',url:'https://office.example/budget',
      locator:'예산표 2쪽',version:'확정본',excerpt,privateMemo:'내부-메모'}],
    receipts:[],rowDrafts:[],currentId:'내부-메모',coordinatorNote:'내부-메모',
    sourceDraft:{id:null,fields:{...Object.fromEntries(workspace.sourceFields.map(k=>[k,''])),excerpt:'내부-메모'}}
  };
}
function manuscripts() {
  return [work('시의회는 10억 원을 확정했다.'),work('시의회는 12억 원을 확정했다.','확정액 12억 원')];
}
function saveDecision(w) {
  const {rows} = engine.prepare(w.article,w.sources);
  w.receipts.push(engine.decide(rows[0],{status:'fact',sourceIds:[w.sources[0].id],
    acknowledged:true,reason:'예산표 확정액을 대조했다.'},w.sources));
}
function browserProtocol(cryptoProvider) {
  const script = readFileSync(require.resolve('../docs/reader/blind-revision.js'),'utf8');
  const browser = {JournalWorkspaceSnapshot:workspace,crypto:cryptoProvider,TextEncoder};
  vm.runInNewContext(script,browser);
  return browser.JournalBlindRevision;
}

test('배정 난수의 두 결과 모두 A·B 순서로만 배포되고 진행자 대응표로 복원된다', async () => {
  const [before,after] = manuscripts();
  saveDecision(before);
  const pristine = structuredClone([before,after]);
  for (const assignment of [0,1]) {
    const protocol = browserProtocol({
      getRandomValues(array) { array.fill(0xab); array[array.length-1] = assignment; return array; },
      subtle:crypto.webcrypto.subtle
    });
    const {packets,key} = await protocol.prepare(before,after);
    assert.deepEqual(Object.keys(packets),['A','B']);
    assert.equal(key.format,'journal-blind-revision-key-v1');
    assert.equal(key.pairId,'ab'.repeat(16));
    assert.equal(key.mapping.before.slot,assignment === 0 ? 'A' : 'B');
    assert.equal(packets[key.mapping.before.slot].article,before.article);
    for (const slot of ['A','B']) {
      const packet = packets[slot];
      assert.equal(packet.sources[0].id,'source-1');
      assert.deepEqual(workspace.blindTag(packet.blindReview),{pairId:key.pairId,slot});
      assert.doesNotMatch(JSON.stringify(packet),/내부-메모|before|after|articleSha256|sourcesSha256|예산표 확정액을 대조했다/);
      assert.equal(workspace.read(packet).sourceDraftPending,false);
      assert.equal(workspace.read(packet).assessment.accuracy.adjudicated,0);
      saveDecision(packet);
    }
    for (const order of [['A','B'],['B','A']]) {
      const result = await protocol.resolve(JSON.parse(JSON.stringify(key)),...order.map(slot=>packets[slot]));
      assert.equal(result.before,packets[key.mapping.before.slot]);
      assert.equal(result.after,packets[key.mapping.after.slot]);
      assert.equal(result.sourceChanged,false);
      assert.equal(workspace.read(result.before).assessment.accuracy.supported,1);
    }
  }
  assert.deepEqual([before,after],pristine);
});

test('실제 난수로 생성한 배포의 대응표·A·B를 섞을 수 없다', async () => {
  const [before,after] = manuscripts();
  const [first,second] = await Promise.all([blind.prepare(before,after),blind.prepare(before,after)]);
  assert.notEqual(first.key.pairId,second.key.pairId);
  await assert.rejects(blind.resolve(first.key,first.packets.A,second.packets.B),/다른 묶음/);
  await assert.rejects(blind.resolve(first.key,first.packets.A,structuredClone(first.packets.A)),/두 번/);
  await assert.rejects(blind.resolve(first.key,before,first.packets.B),/배정 표시/);
  first.packets.A.blindReview.privateNote = '내부-메모';
  await assert.rejects(blind.resolve(first.key,first.packets.A,first.packets.B),/배정 표시/);
});

test('배포·회수 시 미확정 원문, 연습 혼합, 변형 원문, 깨진 대응표를 구별한다', async () => {
  const [before,after] = manuscripts();
  await assert.rejects(blind.prepare(before,structuredClone(before)),/원문이 같습니다/);
  await assert.rejects(blind.prepare(before,{...after,articleDraft:'작성 중'}),/기사 입력을 확정/);
  const mock = structuredClone(after);
  mock.sources[0].originUrl = 'https://fixture.invalid/source';
  await assert.rejects(blind.prepare(before,mock),/연습 기록끼리/);
  const {packets:{A,B},key} = await blind.prepare(before,after);
  for (const corrupt of [null,{}, A, {...key,pairId:'invalid'}, {...key,demo:'false'},
    {...key,mapping:{before:key.mapping.before,after:key.mapping.before}},
    {...key,mapping:{...key.mapping,after:{...key.mapping.after,articleSha256:'0'}}}]) {
    await assert.rejects(blind.resolve(corrupt,A,B),/대응표 파일/);
  }
  await assert.rejects(blind.resolve(key,{...A,demo:true},B),/연습·실제/);
  await assert.rejects(blind.resolve(key,{...A,format:'different'},B),/형식/);
  await assert.rejects(blind.resolve(key,{...A,articleDraft:A.article+' '},B),/기사 입력을 확정/);
  const changed = A.article+' ';
  await assert.rejects(blind.resolve(key,{...A,article:changed,articleDraft:changed},B),/기사 원문과 다릅니다/);
  await assert.rejects(blind.resolve(key,{...A,blindReview:B.blindReview},{...B,blindReview:A.blindReview}),/기사 원문과 다릅니다/);
});

test('원자료 변경은 배포 당시 판본별 자료 묶음을 기준으로 표시한다', async () => {
  const [before,after] = manuscripts();
  before.sources.push({...before.sources[0],id:'different',excerpt:'다른 예산 항목'});
  const {packets,key} = await blind.prepare(before,after);
  const original = packets[key.mapping.before.slot];
  original.sources.reverse();
  original.sources[0].id = 'reviewer-1';
  original.sources[0].title = '내 자료명';
  original.sources.push({...original.sources[0],id:'duplicate-reference'});
  original.sourceDraft.fields.excerpt = '작성 중';
  assert.equal((await blind.resolve(key,packets.A,packets.B)).sourceChanged,false);
  for (const sources of [
    [...original.sources,{...original.sources[0],id:'another',version:'다음 판본'}],
    original.sources.map(s=>({...s,excerpt:s.excerpt+' 보충'})), []
  ]) {
    const revisedEvidence = {...original,sources};
    const other = packets[key.mapping.after.slot];
    const result = await blind.resolve(key,other,revisedEvidence);
    assert.equal(result.sourceChanged,true);
    assert.equal(result.before,revisedEvidence);
  }
});

test('UTF-16 문자열과 끝 공백까지 구분하며 Web Crypto가 없는 브라우저에 설명을 돌려준다', async () => {
  const before = work('예산을 확정했다.\ud800');
  const after = work('예산을 확정했다.\ud801');
  const {packets,key} = await blind.prepare(before,after);
  assert.notEqual(key.mapping.before.articleSha256,key.mapping.after.articleSha256);
  assert.equal((await blind.resolve(key,packets.B,packets.A)).before.article,before.article);
  await assert.rejects(browserProtocol(undefined).prepare(before,after),/Web Crypto/);
});
