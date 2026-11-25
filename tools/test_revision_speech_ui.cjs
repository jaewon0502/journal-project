const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const series = require('../docs/reader/revision-series.js');
const retention = require('../docs/reader/retention-case.js');
const engine = require('../docs/reader/factcheck-engine.js');
const {speakerCase, quote} = require('./fixtures/revision-speaker-case.cjs');

const dir = path.join(__dirname, '../docs/reader');
const oldId = 'bb83d37d93c545df0a0211f68712957f2826a0d0ffef51043d78ffaf8a7353ad';
const hash = '#review=' + oldId + '&focus=speech-check';

function open(t, filename, fragment = '') {
  const dom = new JSDOM(fs.readFileSync(path.join(dir, filename), 'utf8'), {
    url:'file:///reader/' + filename + fragment, runScripts:'outside-only'
  });
  t.after(() => dom.window.close());
  const {window} = dom, {document} = window;
  window.TextEncoder = TextEncoder;
  Object.defineProperty(window, 'crypto', {value:webcrypto});
  for (const script of document.querySelectorAll('script[src]')) {
    window.eval(fs.readFileSync(path.join(dir, script.getAttribute('src')), 'utf8'));
  }
  function select(id, items) {
    const field = document.getElementById(id);
    const files = items.map(({name, data}) => ({name,text:async () => JSON.stringify(data)}));
    Object.defineProperty(field,'files',{configurable:true,value:files});
    field.dispatchEvent(new window.Event('change'));
  }
  return {window,document,select};
}

test('v8 공개 요약을 연 집계 화면에서 해당 기사의 발언자 재확인 화면으로 연결한다', async t => {
  const {joint,key} = await speakerCase();
  const old = series.makeLegacyMatchRecord(joint,key,8);
  const dashboard = open(t,'revision-series.html');
  dashboard.select('series-files', [{name:'이전 기사별 요약.json',data:old}]);
  const selector = 'a[href*="focus=speech-check"]';
  await t.waitFor(() => assert.ok(dashboard.document.querySelector(selector)));
  const link = dashboard.document.querySelector(selector);
  assert.match(link.pathname, /article-compare\.html$/);
  assert.equal(link.hash, hash);
  assert.equal(dashboard.document.querySelector('a[href*="focus=numeric-check"]'), null);
});

test('같은 v8 링크에서 여섯 작업 파일과 종전 진행자 파일 모두 화자 재검토 한 구절과 두 판본 전문을 연다', async t => {
  const {items,joint,key} = await speakerCase();
  const current = series.makeRecord(joint,key);
  const archive = await retention.create(current,items,[]);
  // Rebuild the released private v6 envelope using the independently recorded public v8 ID.
  archive.reviewId = oldId;
  archive.checksum = engine.digestValue([archive.format,6,oldId,archive.evidenceDigest,[],[]]);
  for (const input of [items, [{name:'v8 당시 진행자 파일.json',data:archive}]]) {
    const {window,document,select} = open(t,'article-compare.html',hash);
    select('blind-bundle-files',input);
    await t.waitFor(() => assert.ok(document.querySelector('[data-speech-check-count]')));
    assert.match(document.querySelector('[data-speech-check-count]').textContent,/원본 구절 1개$/);
    const row = document.querySelector('[data-retention-before="2"]');
    assert.equal(row.open,true);
    assert.equal(document.activeElement,row.querySelector('summary'));
    assert.ok(row.querySelector('summary').textContent.includes(quote));
    assert.equal(document.querySelector('[data-retention-before="6"]').open,false);
    const details = [...document.querySelectorAll('#output details')];
    for (const [side,speaker] of [['원본','김 의원의 서면 답변'],['수정본','박 기자의 서면 답변']]) {
      const full = details.find(item => item.firstElementChild.textContent.includes(side + ' 전문 보기'));
      assert.ok(full);
      full.firstElementChild.click();
      assert.ok(full.open);
      assert.ok(full.querySelector('blockquote').textContent.includes(speaker));
      assert.ok(full.querySelector('blockquote').textContent.includes(quote));
    }
    let downloaded;
    window.Blob = Blob;
    window.URL.createObjectURL = blob => { downloaded = blob; return 'blob:summary'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = () => {};
    const button = [...document.querySelectorAll('#output button')].find(b => b.textContent === '현재 기준의 기사별 평가 요약 저장');
    button.click();
    assert.deepEqual(JSON.parse(await downloaded.text()),current);
  }
});
