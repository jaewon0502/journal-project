'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {JSDOM} = require('jsdom');
const {articles} = require('./queries.json');
const urls = {...articles,
  iucn:'https://www.iucn.org/news/species/201609/four-out-six-great-apes-one-step-away-extinction-%E2%80%93-iucn-red-list'
};
const sha = input => createHash('sha256').update(input).digest('hex');
const clean = input => input.replace(/\s+/gu, ' ').trim();
function editions(folder) {
  const result = {};
  for (const id of Object.keys(urls)) {
    const dom = new JSDOM(fs.readFileSync(path.join(folder, id + '.html')));
    const doc = dom.window.document;
    if (id === 'wildlife') {
      result[id] = Array.from(doc.querySelector('.main_text .text_area').childNodes)
        .filter(node => node.nodeType === 3).map(node => clean(node.textContent)).filter(text => text && text !== '(연합뉴스)');
    } else {
      result[id] = Array.from(doc.querySelectorAll('article .field--name-field-lead > p, article .field--name-field-body > p, article .field--name-field-body > h2, article .field--name-field-body > h3'),
        element => {
          const copy = element.cloneNode(true);
          copy.querySelectorAll('br').forEach(node => node.replaceWith('\u2029'));
          return copy.textContent.split('\u2029').map(clean).filter(Boolean);
        }).flat();
    }
    dom.window.close();
  }
  return result;
}
module.exports = {editions, urls, sha};
