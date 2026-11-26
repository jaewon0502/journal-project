// Replay the same six independently selected pages without redistributing their HTML.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {JSDOM} = require('jsdom');
const {execFileSync} = require('node:child_process');
const {initialExtractorSha256} = require('./protocol.json');
const [folder, edition = 'current', saved] = process.argv.slice(2);
if (!folder || !['initial', 'revised', 'current', 'fresh', 'current-fresh'].includes(edition)) throw Error('Usage: node replay.cjs <html-folder> initial|revised|current|fresh|current-fresh [recorded-output.json]');
const reference = require(edition.endsWith('fresh') ? './fresh-reference.json' : './reference.json');
const {references} = reference;
const helper = 'docs/reader/web-document.js';
const root = path.join(__dirname, '../..');
const commits = {initial:'f0acde65f5a15464a0f71ba8421f2d1f948497aa', revised:'2e9e16dce3e419bfe691cdb9fb0bbe877d732f88', fresh:'2e9e16dce3e419bfe691cdb9fb0bbe877d732f88'};
const source = commits[edition] ? execFileSync('git',['show', commits[edition] + ':' + helper], {cwd:root}) : fs.readFileSync(path.join(root,helper));
const sha = input => createHash('sha256').update(input).digest('hex');
if (edition === 'initial') assert.equal(sha(source), initialExtractorSha256);
if (edition === 'fresh') assert.equal(sha(source), reference.extractorSha256);
const window = new JSDOM('', {runScripts:'outside-only'}).window;
window.eval(source.toString());
const pages = references.map(({page,selector,marker,date}) => {
  const raw = fs.readFileSync(path.join(folder,page + '.html'),'utf8');
  const visible = new JSDOM(raw);
  try {
    assert([...visible.window.document.querySelectorAll(selector)].some(el => el.textContent.replace(/\s+/gu, ' ').trim().includes(marker)),
      page + ': original publisher-visible reference unavailable');
  } finally {visible.window.close();}
  let web;
  try { web = window.JournalWebDocument.parse(raw).web; }
  catch (error) { return {page,reference:date,parsed:false,reason:error.message}; }
  return {page,reference:date,parsed:true,proposed:web.published || null,modified:web.modified || null,
    matched:web.published ? web.published.slice(0,10) === date : null};
});
window.close();
const result = {extractorSha256:sha(source), total:pages.length, parsed:pages.filter(p => p.parsed).length,
  correct:pages.filter(p => p.matched === true).length, wrong:pages.filter(p => p.matched === false).length,
  abstained:pages.filter(p => p.matched == null).length, pages};
if (saved) {
  assert.deepEqual(result, JSON.parse(fs.readFileSync(saved)), 'Live edition or extractor differs from the recorded test');
  console.log(pages.length + ' publisher references and importer outcomes match the recorded run.');
} else console.log(JSON.stringify(result,null,2));
