'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const urls = {...require('./queries.json').articles,
  un24:'https://digitallibrary.un.org/record/4045076/files/S_PV.9609-EN.pdf',
  un11:'https://documents.un.org/doc/undoc/gen/n11/585/55/pdf/n1158555.pdf',
  veto:'https://ydsftksff8.execute-api.us-east-1.amazonaws.com/dev/render_meeting_veto/sc_veto_list/EN'
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clean = text => text.replace(/\s+/gu, ' ').trim();
function checkedPDF(folder, name, expected) {
  const filename = path.join(folder, name + '.pdf');
  assert.equal(sha(fs.readFileSync(filename)), expected, 'Official PDF edition changed: ' + name);
  return filename;
}
function meeting(file) {
  const xml = execFileSync('pdftotext', ['-enc','UTF-8','-bbox-layout',file,'-'], {encoding:'utf8', maxBuffer:8*1024*1024});
  const dom = new JSDOM(xml.replaceAll('\b', ''), {contentType:'text/html'});
  const blocks = [];
  for (const page of [...dom.window.document.querySelectorAll('page')].slice(1)) {
    const textBlocks = [...page.querySelectorAll('block')].filter(block =>
      Number(block.getAttribute('ymin')) > 70 && Number(block.getAttribute('ymax')) < 710);
    // Read the two printed columns top-to-bottom (left column first).
    textBlocks.sort((a,b) => Number(Number(a.getAttribute('xmin')) > 300) - Number(Number(b.getAttribute('xmin')) > 300) ||
      Number(a.getAttribute('ymin')) - Number(b.getAttribute('ymin')));
    for (const block of textBlocks) {
      const lines = [...block.querySelectorAll('line')].map(line =>
        [...line.querySelectorAll('word')].map(word => word.textContent).join(' '));
      blocks.push(clean(lines.join(' ')));
    }
  }
  dom.window.close();
  return blocks.filter(Boolean);
}
function history(file, tableFile) {
  const text = execFileSync('pdftotext', ['-enc','UTF-8','-raw',file,'-'], {encoding:'utf8'});
  const paragraphs = [];
  for (const line of text.split(/\n|\f/u)) {
    if (/^(?:S\/2011\/705|(?:\d+ )?11-58555(?: \d+)?)$/u.test(line.trim())) continue;
    const start = /^(\d+)\.\s+(.+)$/u.exec(line);
    if (start) {
      assert.equal(Number(start[1]), paragraphs.length + 1);
      paragraphs.push([start[2]]);
    } else if (paragraphs.length && line.trim()) paragraphs.at(-1).push(line);
  }
  assert.equal(paragraphs.length, 23);
  const dom = new JSDOM(fs.readFileSync(tableFile, 'utf8'));
  const votes = [...dom.window.document.querySelectorAll('tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(cell => {
      const copy = cell.cloneNode(true);
      copy.querySelectorAll('br').forEach(br => br.replaceWith(' / '));
      return clean(copy.textContent);
    })).filter(cells => / 2011$/u.test(cells[0] || ''));
  assert.equal(votes.length, 2, 'Complete 2011 veto register changed');
  dom.window.close();
  return [...paragraphs.map(lines => clean(lines.join(' '))), ...votes.map(row => row.join(' | '))];
}
function editions(folder) {
  const dom = new JSDOM(fs.readFileSync(path.join(folder, 'mbc.html'), 'utf8'));
  const article = dom.window.document.querySelector('.news_txt');
  const mbc = [];
  for (const node of article.childNodes) {
    if (node.tagName === 'B' && node.textContent.includes('제보')) break;
    if (node.nodeType !== 3) continue;
    const text = clean(node.textContent);
    if (!text || text.startsWith('◀') || text.startsWith('영상취재')) continue;
    mbc.push(text);
  }
  dom.window.close();
  return {mbc, un24:meeting(checkedPDF(folder,'un24','3d137fc64a3d7a048ed95322aed1c13af5a32e0335e2b084e28d9cb628e081aa')),
    history:history(checkedPDF(folder,'un11','2f1401da4f934992ece24ad033424b1586fbcb01fe173d0ff58a0ddf6d394fc5'),path.join(folder,'veto.html'))};
}
module.exports = {urls, editions, sha};
