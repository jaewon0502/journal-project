const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {englishSpeakerContexts} = require('../docs/reader/evidence-transcript.js');
const {search} = require('../docs/reader/evidence-search.js');

const statement = 'We will retain the entire archive.';
const meeting = ['Moderator: Welcome.', 'THE CHAIR: Thank you.', 'I will address the amendments.',
  'We finished the first review.', statement, 'Q: When?', 'THE MAYOR: We are still checking.'];
const body = meeting.join('\n');

test('이미 찾은 문단의 원문과 앞선 명시적 영문 표지를 그대로 열고 순위를 유지한다', () => {
  const hits = search(body, 'retain entire archive').passages;
  const original = structuredClone(hits);
  const context = englishSpeakerContexts(body,hits);
  assert.deepEqual(hits,original);
  assert.equal(hits[0].paragraph,5);
  assert.deepEqual(context.get(5), {label:'THE CHAIR',startParagraph:2,paragraph:5,text:meeting.slice(1,5).join('\n')});
  const names = ['Speaker: Jane Rivers','I plan to publish.', 'Speaker: Alex Lake', statement];
  assert.equal(englishSpeakerContexts(names.join('\r\n'),[{paragraph:4}]).get(4).label,'Alex Lake');
  assert.equal(englishSpeakerContexts(body,[{paragraph:2}]).size,0);
  assert.equal(englishSpeakerContexts(body,[{paragraph:5,text:'different source edition'}]).size,0);
});

test('의장 인계·새 화자·쪽·무대 지시·끊긴 줄·기사 서술·먼 표지는 이전 발언자와 연결하지 않는다', () => {
  const interrupted = ['I now give the floor to the governor.', 'I now recognize the deputy.', 'You may proceed.',
    'Question: Could you clarify?', 'Unknown spokesperson: Clarify your answer.', 'Ms. Rivers answered the question.',
    'Jane Rivers said the proposal was final.', 'He said we should keep all of it.', 'The Chair then returned to the dais.',
    'Page 12', 'New Agenda', '[Recess]', '(Applause)', '', '\f', 'My statement. Senator Grey: The record is wrong.',
    'I spoke on the first page.\fThe session continued.','Budget\t20', 'I was [inaudible] yesterday.','MISTER GREY. We must leave.','Yes. [Applause] We resume.'];
  for (const boundary of interrupted) {
    const text = ['Moderator: Thank you.', 'THE CHAIR: Welcome.', boundary,statement];
    const n = text.filter(line=>line.trim()).length;
    assert.equal(englishSpeakerContexts(text.join('\n'),[{paragraph:n}]).size,0,boundary);
  }
  for (const lines of [
    ['The mayor spoke on Tuesday.',statement], ['THE CHAIR: Welcome.',statement],
    ['Moderator: Welcome.','President announced today: Lower costs.',statement],
    ['Moderator: Welcome.','THE CHAIR: Welcome.',...Array(6).fill('We continued the discussion.'),statement]
  ]) assert.equal(englishSpeakerContexts(lines.join('\n'),[{paragraph:lines.length}]).size,0);
  const switchSpeaker = ['THE CHAIR: Welcome.', 'THE MAYOR: A different position.', statement];
  assert.equal(englishSpeakerContexts(switchSpeaker.join('\n'),[{paragraph:3}]).get(3).label,'THE MAYOR');
});

test('화자 미리보기를 펼친 뒤 직접 선택해야 표지와 구절이 초안으로 들어간다', t => {
  const folder = path.join(__dirname,'../docs/reader');
  const {window:w} = new JSDOM(readFileSync(path.join(folder,'factcheck.html'),'utf8'),{url:'https://local.invalid/factcheck.html',runScripts:'outside-only'});
  t.after(()=>w.close());w.TextEncoder=TextEncoder;
  const el = id=>w.document.getElementById(id);
  for(const s of w.document.querySelectorAll('script[src]')) w.eval(readFileSync(path.join(folder,s.getAttribute('src')),'utf8'));
  const set = (id,v)=>{el(id).value=v;el(id).dispatchEvent(new w.Event('input',{bubbles:true}))};
  set('article','위원회는 원래 기록을 보존하기로 했다.');el('article-form').requestSubmit();el('go-find').click();
  set('document-text',body);set('source-phrase','retain entire archive');el('find-passages').click();
  const first=el('finder-results').querySelector('.source');
  assert.equal(first.querySelector('blockquote').textContent,statement);
  const preview=[...first.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent.includes('원문의 화자 표지'));
  assert.match(preview.querySelector('summary').textContent,/THE CHAIR \(2~5문단\)/);
  preview.querySelector('summary').click();
  assert.equal(el('source-excerpt').value,'');
  assert.equal(preview.querySelector('blockquote').textContent,meeting.slice(1,5).join('\n'));
  preview.querySelector('button').click();
  assert.equal(el('source-excerpt').value,meeting.slice(1,5).join('\n'));
  assert.match(el('source-status').textContent,/2~5번째 문단/);
  assert.equal(el('verdict').value,'');assert.equal(el('acknowledged').checked,false);
});
