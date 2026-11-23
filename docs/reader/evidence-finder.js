// Locate candidate passages in a local document. Word overlap gives no verdict.
(function (root) {
  'use strict';

  const stop = new Set('그리고 그러나 하지만 이에 대해 대한 이번 지난 관련 기자 기사 있다 있는 했다 밝혔다 따르면 하는 한다 것을 사실 발언 주장 말했다 대한 해당 이다 또한 the and said that this for'.split(' '));
  const particle = /(으로부터|에서는|으로는|에서|에게|부터|까지|보다|으로|에는|에도|와의|의|은|는|이|가|을|를|와|과|에|도)$/u;

  function terms(text) {
    const words = text.normalize('NFKC').toLowerCase().match(/[0-9]+(?:[.,][0-9]+)*(?:%p?|퍼센트)?|[\p{L}]+/gu) || [];
    const unique = new Set();
    for (const word of words) {
      if (stop.has(word)) continue;
      const stem = word.replace(particle, '');
      const token = stem.length >= 2 ? stem : word;
      if ((token.length >= 2 || /^[0-9]/.test(token)) && !stop.has(token)) unique.add(token);
    }
    return unique;
  }

  function find(documentText, query) {
    const wanted = terms(query);
    if (!wanted.size) return [];
    const frequencies = new Map();
    const paragraphs = documentText.split(/\r\n|[\n\r\u2028\u2029]/u)
      .filter(line => line.trim()).map((text, index) => {
        const matched = [...terms(text)].filter(word => wanted.has(word));
        for (const word of matched) frequencies.set(word, (frequencies.get(word) || 0) + 1);
        return {paragraph: index + 1, text, matched};
      });
    const scored = paragraphs.filter(item => item.matched.length).map(item => {
      const score = item.matched.reduce((sum, word) =>
        sum + 1 + Math.log(paragraphs.length / frequencies.get(word)), 0);
      return {item, score};
    });
    scored.sort((a, b) => b.score - a.score || a.item.paragraph - b.item.paragraph);
    return scored.slice(0, 3).map(({item}) => item);
  }

  const api = {find};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidenceFinder = api;
})(globalThis);
