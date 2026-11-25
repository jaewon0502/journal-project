const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const study = require('../docs/reader/editor-study-core.js');
const a='a'.repeat(64), b='b'.repeat(64);
const copies = value => Array(4).fill(value);
function invitation(ordinal, version) {
  const id='E'+String(ordinal).padStart(16,'0');
  return {ordinal,id,code:version?'J2-'+ordinal+'-'+id+'-'+version:'J1-'+ordinal+'-'+id};
}
function record(invite, versions, changes={}) {
  let r=study.createRecord(invite.id,invite.ordinal,'editor',true);
  for (const [index,v] of versions.entries()) {
    const t=study.plan(r.ordinal)[index];
    r=study.addTrial(r,{journalUsed:t.method==='journal',sourceIds:[],reason:'합성 회차의 판본 대조',
      verdict:t.method==='manual'&&t.variant==='A'?'supported':'insufficient',elapsedMs:t.method==='manual'?60000:30000,
      ...(v===undefined?{}:{kitVersion:v})});
  }
  return {...r,...changes};
}
function four(first,version) {
  return Array.from({length:4},(_,i)=>invitation(first+i,version));
}

test('코드의 기재를 유일한 예정 판본으로 읽고 구형 초대·대소문자 입력을 둘 다 처리한다',()=>{
  const j1=invitation(1), j2=invitation(2,a);
  assert.deepEqual(study.parseInvite(' '+j1.code.toLowerCase()+' '),{...j1,kitVersion:null});
  assert.deepEqual(study.parseInvite(j2.code.toUpperCase()),{...j2,kitVersion:a});
  for (const code of [undefined,null,j2.code.replace('J2','J1'),j1.code.replace('J1','J2'),j2.code+'f',
    j2.code.slice(0,-1),j2.code.replace('J2-2','J2-02'),j2.code.replace('J2-2','J2-1000000000')])
    assert.equal(study.parseInvite(code),null);
  const spoof={...j1,kitVersion:b,assignedKitVersion:b};
  const r=study.analyzeAssignedEditions([record(j1,copies(b))],[spoof]);
  assert.equal(r.blocks[0].planned,0);
  assert.deepEqual(r.editions,[]);
  for(const row of [{...j2,id:j1.id},{...j2,ordinal:7},{...j2,code:j2.code.toLowerCase()}])
    assert.throws(()=>study.analyzeAssignedEditions([],[row]),/초대 코드/);
  assert.throws(()=>study.analyzeAssignedEditions([],[j1,invitation(1,a)]),/서로 다른 배정/);
});

test('제출한 판본이 모두 같아도 J2 명부와 다른 16회는 사용 판본에만 포함하고 배정 일치 분석을 보류한다',()=>{
  const roster=four(1,a), rows=roster.map(i=>record(i,copies(b)));
  assert.equal(study.analyzeEditions(rows).editions[0].analysis.time.reductionPct,50);
  const {blocks:[wrong],editions}=study.analyzeAssignedEditions(rows,roster);
  assert.deepEqual([wrong.state,wrong.issued,wrong.planned,wrong.mismatched,wrong.unknown,wrong.missing],['mismatch',4,4,16,0,0]);
  assert.deepEqual(wrong.members[2].different.map(t=>t.position),[1,2,3,4]);
  assert.deepEqual(editions,[]);
  // One observed edition in all records, but only two participants were assigned that edition.
  const split=[...roster.slice(0,2),...four(1,b).slice(2)];
  const varied=study.analyzeAssignedEditions(rows,split).blocks[0];
  assert.deepEqual([varied.state,varied.mismatched],['differentAssignments',8]);
});

test('옛 명부·일부 배정·미회신·부분 제출·판본 미확인을 구별하고 명부 밖 응답은 같은 순번이라도 제외한다',()=>{
  const roster=[...four(1),...four(5,a).slice(0,2),...four(9,a),...four(13,a),...four(17,a)];
  const mostly= four(13,a).map(inv=>record(inv,inv.ordinal===14?[a,null,undefined,a]:copies(a)));
  const stopped=record(roster[4],[b],{withdrawn:true});
  const foreign=record(roster[6],copies(a),{participantId:'E1111111111111111'});
  const outsider=record(invitation(80,a),copies(a));
  const rows=[...four(1).map(i=>record(i,copies(a))),stopped,foreign,outsider,...mostly,...four(17,a).map(i=>record(i,copies(a)))];
  const report=study.analyzeAssignedEditions(rows,roster);
  assert.deepEqual(report.blocks.map(row=>row.state),['unspecified','partlyAssigned','incomplete','unknown','verified']);
  const [old,partial,empty,unknown,valid]=report.blocks;
  assert.deepEqual([old.planned,old.submitted,old.unknown],[0,16,0]);
  assert.deepEqual([partial.planned,partial.submitted,partial.mismatched,partial.missing],[2,1,1,7]);
  assert.equal(partial.members[0].withdrawn,true);
  assert.deepEqual([empty.issued,empty.submitted,empty.missing],[4,0,16]);
  assert.ok(empty.members.every(m=>!m.returned));
  assert.deepEqual(unknown.members[1].unstamped,[2,3]);
  assert.deepEqual([valid.kitVersion,valid.submitted,valid.missing],[a,16,0]);
  const [{analysis,blockNumbers}]=report.editions;
  assert.deepEqual(blockNumbers,[5]);
  assert.deepEqual([analysis.trialCount,analysis.time.reductionPct,analysis.bias.reductionPp],[16,50,100]);
});

test('진행자 화면에서 다른 판본 회차·배정만 발급한 묶음·구형 코드와 두 종류의 분석을 별도 확인한다', async t=>{
  const dir=path.join(__dirname,'../docs/reader');
  const read=n=>fs.readFileSync(path.join(dir,n),'utf8');
  const {window:w}=new JSDOM(read('editor-study.html'),{url:'https://local.example/editor-study.html',runScripts:'outside-only'});
  t.after(()=>w.close());
  for(const script of w.document.querySelectorAll('script[src]'))w.eval(read(script.getAttribute('src')));
  const el=id=>w.document.getElementById(id);
  const rows=four(1,a), roster=[...rows,...four(5,a),...four(9,a),...four(13)];
  const records=[...rows.map(i=>record(i,copies(b))),...four(9,a).map(i=>record(i,copies(a))),...four(13).map(i=>record(i,copies(a)))];
  const input=el('import-files');
  Object.defineProperty(input,'files',{value:[{text:async()=>JSON.stringify({type:'journal-editor-study-collection-v1',records,invitations:roster})}]});
  await input.onchange({target:input});
  assert.match(el('import-status').textContent,/파일을 확인했습니다/);
  assert.equal(el('assigned-editions').hidden,false);
  const info=el('assigned-edition-summary').textContent;
  assert.match(info,/명부 4묶음 중 배정 일치 완료 1묶음/);
  assert.match(info,/예정 판본 미지정 4명 · 사용 판본 불일치 16회.*미제출 16회/);
  assert.match(el('data-notice').textContent,/다른 판본으로 제출한 과제 16건/);
  assert.equal(el('data-notice').querySelector('a').hash, '#assigned-editions');
  assert.match(el('assigned-edition-results').textContent,/배정 묶음 3번 · 판정 4명 16건/);
  assert.doesNotMatch(el('assigned-edition-results').textContent,/배정 묶음 4번|bbbbbbbbbbbb/);
  assert.match(el('edition-tables').textContent,/배정 묶음 3, 4번 · 판정 8명 32건/);
  const members=el('assigned-edition-blocks').textContent;
  assert.match(members,/배정 묶음 1번 · 사용 판본이 배정과 다름/);
  assert.match(members,/1, 2, 3, 4회 다른 판본 · b{64}/);
  assert.match(members,/배정 묶음 2번 · 미제출 회차 있음/);
  assert.match(members,/회신 없음/);
  assert.match(members,/배정 묶음 4번 · 예정 판본 미지정/);
  assert.ok(!members.includes(roster[0].id));
  el('demo-view').click();
  assert.equal(el('assigned-editions').hidden,true);
  assert.equal(el('assigned-edition-blocks').textContent,'');
});
