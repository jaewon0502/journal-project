'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

const baseline = '2e0e028e7552aa2f3f3e209783d5d436738aba5c';
const root = path.resolve(__dirname,'../..');
const article = ['위원회는 정관 공개를 보류했다.', '위원회는 다음 회의 일정을 발표했다.'];
const source = ['Agenda for the autumn meetings.', 'The committee withheld the charter pending review.',
  'The council confirmed that the next meeting was postponed.', 'The charter review was discussed in spring.'];
const phrase = 'withheld charter';

async function runFlow(browser, directory, width, method) {
  const context = await browser.newContext({viewport:{width,height:840},offline:true});
  try {
    const page = await context.newPage();
    const errors = [], remoteRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith('file:')) remoteRequests.push(request.url()); });
    await page.goto(pathToFileURL(path.join(directory,'docs/reader/factcheck.html')).href);
    const el = id => page.locator('#' + id);
    await el('article').fill(article.join('\n'));
    await page.locator('#article-form button[type=submit]').click();
    await el('go-find').click();
    await el('document-text').fill(source.join('\n'));
    await page.evaluate(() => {
      window.actions = {clicks:0, textEntries:0};
      document.addEventListener('click', event => { if (event.target.closest('input,button')) window.actions.clicks++; });
      document.addEventListener('input', event => {
        if (['document-query','source-phrase'].includes(event.target.id)) window.actions.textEntries++;
      });
    });
    const counts = () => page.evaluate(() => ({...window.actions}));
    const enter = async () => {
      const input = el(method === 'separate' ? 'source-phrase' : 'document-query');
      await input.click();
      await input.fill(method === 'append' ? article[0] + ' ' + phrase : phrase);
      await el('find-passages').click();
    };
    const verifyResult = async () => {
      const first = await page.locator('#finder-results .source blockquote').first().textContent();
      assert.equal(first,source[1]);
      assert.equal(await el('verdict').inputValue(),'');
      assert.equal(await el('source-excerpt').inputValue(),'');
    };
    await enter();
    await verifyResult();
    const initial = await counts();
    await page.locator('#row-list button').nth(1).click();
    await page.locator('#row-list button').nth(0).click();
    await el('go-find').click();
    if (method !== 'separate') await enter();
    await verifyResult();
    const total = await counts();
    assert.deepEqual(errors,[]);
    assert.deepEqual(remoteRequests,[]);
    return {width, method, initial, revisit:{clicks:total.clicks-initial.clicks, textEntries:total.textEntries-initial.textEntries},
      firstSourceParagraph:2};
  } finally { await context.close(); }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'journal-phrase-clicks-'));
  let browser;
  try {
    const archive = path.join(temp, 'baseline.tar');
    execFileSync('git',['archive','-o',archive,baseline,'docs/reader'],{cwd:root});
    execFileSync('tar',['-xf',archive,'-C',temp]);
    browser = await chromium.launch({channel:'chrome',headless:true});
    const results = [];
    for (const width of [390,1280]) {
      for (const method of ['replace','append','separate']) {
        results.push(await runFlow(browser, method === 'separate' ? root : temp, width, method));
      }
    }
    const serialized = JSON.stringify({baseline,results},null,2) + '\n';
    if (process.argv[2] === '--check')
      assert.equal(serialized, fs.readFileSync(path.join(__dirname,'clicks.json'),'utf8'));
    else process.stdout.write(serialized);
  } finally {
    try { if (browser) await browser.close(); }
    finally { fs.rmSync(temp,{recursive:true,force:true}); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
