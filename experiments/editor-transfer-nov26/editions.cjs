// Extract only dated editorial bodies. Input HTML and full text remain outside Git.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {JSDOM} = require('jsdom');
const {articles} = require('./queries.json');
const urls = {...articles,
  apple: 'https://www.apple.com/newsroom/2024/10/apples-new-mac-mini-is-more-mighty-more-mini-and-built-for-apple-intelligence/',
  whr: 'https://www.worldhappiness.report/news/world-happiness-report-2024-most-comprehensive-picture-yet-of-happiness-across-generations/'
};
const sha = input => createHash('sha256').update(input).digest('hex');
const clean = text => text.replace(/\s+/gu, ' ').trim();
function textOf(element) {
  const copy = element.cloneNode(true);
  copy.querySelectorAll('sup').forEach(marker => marker.remove());
  return clean(copy.textContent);
}
function editions(folder) {
  const data = {};
  for (const name of Object.keys(urls)) {
    const dom = new JSDOM(fs.readFileSync(path.join(folder, name + '.html')));
    const doc = dom.window.document;
    if (name === 'happiness') {
      const content = doc.querySelector('.viewer article');
      data[name] = Array.from(content.childNodes).filter(n => n.nodeType === 3)
        .map(n => clean(n.textContent)).filter(t => t && !t.startsWith('◎'));
    } else {
      const selector = {
        mac: '#content-20241030075928 > p',
        apple: 'main .component-content > .pagebody-copy, main .component-content > .pagebody-header, main .image-caption',
        whr: 'section.post-body > :not(ul), section.post-body > ul > li'
      }[name];
      const items = Array.from(doc.querySelectorAll(selector), textOf).filter(Boolean);
      data[name] = name === 'apple' ? [...new Set(items)] : items;
    }
    assert(data[name].length, 'Missing article body: ' + name);
    dom.window.close();
  }
  return data;
}
module.exports = {editions, urls, sha};
