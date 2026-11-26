// Optional real-browser replay. Keep the local NASA HTML, selected quote and exports outside Git.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {JSDOM} = require('jsdom');
const {chromium} = require('playwright');
const {load} = require('../editor-holdout-20261126/pages.cjs');

async function run() {
  const [rawDir, baselineDir, currentDir] = process.argv.slice(2);
  if (!rawDir || !baselineDir || !currentDir) throw Error('Usage: node browser.cjs <holdout-html-folder> <old-reader-folder> <current-reader-folder>');
  const nasaFile = path.join(rawDir, 'nasa.html'), raw = fs.readFileSync(nasaFile,'utf8');
  const document = new JSDOM('', {runScripts:'outside-only'});
  document.window.eval(fs.readFileSync(path.join(currentDir,'web-document.js'),'utf8'));
  const {text,web} = document.window.JournalWebDocument.parse(raw);
  document.window.close();
  const quote = load(rawDir).sources.nasa[2];
  const article = 'By June 13 all four Voyager 1 instruments were returning usable science data.';
  const version = '게시 2024-06-13T19:48:23-04:00 · 수정 2024-06-14T09:38:09-04:00';
  assert.equal(web.published,'2024-06-13T19:48:23-04:00');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'journal-local-nasa-'));
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    for (const width of [390,1280]) for (const method of ['manual','file']) {
      const context = await browser.newContext({viewport:{width,height:850},offline:true});
      const p = await context.newPage(), requests = [], errors = [];
      p.on('request',r=>{if(/^https?:/.test(r.url())) requests.push(r.url())});
      p.on('pageerror',e=>errors.push(e.message));
      p.on('dialog',d=>d.accept());
      await p.goto(pathToFileURL(path.resolve(method === 'file' ? currentDir : baselineDir,'factcheck.html')).href);
      await p.locator('#article').fill(article);
      await p.locator('#article-form button[type=submit]').click();
      await p.locator('#go-find').click();
      if (method === 'manual') await p.locator('#document-text').fill(text);
      else {
        await p.locator('#document-file').setInputFiles(path.resolve(nasaFile));
        await p.waitForFunction(()=>document.querySelector('#document-file-status').textContent.includes('게시 2024-06-13'));
      }
      await p.locator('#find-passages').click();
      const card = p.locator('#finder-results .source').filter({has:p.locator('blockquote').filter({hasText:'May 19'})}).first();
      await card.getByRole('button',{name:'이 문단을 발췌문으로 사용',exact:true}).click();
      assert.equal(await p.locator('#source-excerpt').inputValue(),quote);
      assert.equal(await p.locator('#source-title').inputValue(),'');
      assert.equal(await p.locator('#source-version').inputValue(),'');
      const entry = await p.evaluateHandle(()=>{
        const stats = {manualEntries:0, confirmationClicks:0};
        document.addEventListener('input',e=>{
          if(e.isTrusted && ['source-title','source-url','source-version'].includes(e.target.id)) stats.manualEntries++;
        });
        document.addEventListener('click',e=>{
          if(e.target.closest('#web-source-options button')) stats.confirmationClicks++;
        });
        return stats;
      });
      if (method === 'manual') {
        await p.locator('#source-title').fill(web.title);
        await p.locator('#source-url').fill(web.url);
        await p.locator('#source-version').fill(version);
      } else await p.getByRole('button',{name:'확인한 웹문서 정보 입력'}).click();
      const {manualEntries,confirmationClicks} = await entry.jsonValue();
      assert.deepEqual([manualEntries,confirmationClicks], method === 'file' ? [0,1] : [3,0]);
      await p.locator('#source-locator').fill('NASA mission update · operations paragraph');
      await p.locator('#source-save').click();
      await p.locator('#file-panel summary').click();
      for (const [id,label] of [['save-work','editor'],['save-review-input','reviewer']]) {
        const file = path.join(folder,[method,width,label].join('-') + '.json');
        const download = p.waitForEvent('download');
        await p.locator('#' + id).click();
        await (await download).saveAs(file);
        const stored = JSON.parse(fs.readFileSync(file));
        assert.equal(stored.sources.length,1);
        assert.equal(stored.sources[0].url,web.url);
        assert.equal(stored.sources[0].version,version);
        assert.equal(stored.sources[0].excerpt,quote);
        assert.equal(stored.receipts.length,0);
        assert(!JSON.stringify(stored).includes(load(rawDir).sources.nasa[5]));
      }
      const overflow = await p.evaluate(()=>document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow,false);
      assert.deepEqual([errors,requests],[[],[]]);
      console.log(JSON.stringify({width,method,manualEntries,confirmationClicks,workExports:2,externalRequests:0}));
      await context.close();
    }
  } finally {await browser.close();fs.rmSync(folder,{recursive:true,force:true});}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
