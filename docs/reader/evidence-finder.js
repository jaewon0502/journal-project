// Locate candidate passages in a local document. Word overlap gives no verdict.
(function (root) {
  'use strict';

  const stop = new Set('그리고 그러나 하지만 이에 대해 대한 이번 지난 관련 기자 기사 있다 있는 했다 밝혔다 따르면 하는 한다 것을 사실 발언 주장 말했다 대한 해당 이다 또한 the and said that this for'.split(' '));
  const particle = /(으로부터|에서는|으로는|에서|에게|부터|까지|보다|으로|에는|에도|와의|의|은|는|이|가|을|를|와|과|에|도)$/u;

  // Each distinct word yields one term: its key (the stem when it has two or more
  // letters) plus the forms it can match. Indexing the word as written as well as its
  // stem lets 전문가 match 전문가는 and 어린이가 match 어린이, while the word is still
  // scored once.
  function terms(text) {
    // Keep magnitude and unit on the number: 27억 and 27만 must not both become 27,
    // and 21%포인트, 21%p and 1,000 must match their other spellings.
    const words = text.normalize('NFKC').toLowerCase()
      .replace(/(\d),(?=\d{3}(?!\d))/gu, '$1').replace(/(?:%|퍼센트)\s*포인트/gu, '%p')
      .match(/[0-9]+(?:\.[0-9]+)?(?:%p?|퍼센트|[천만억조])?|[\p{L}]+/gu) || [];
    const unique = new Map();
    for (const word of words) {
      if (stop.has(word)) continue;
      const stem = word.replace(particle, '');
      const key = stem.length >= 2 ? stem : word;
      if ((key.length < 2 && !/^[0-9]/.test(key)) || stop.has(key) || unique.has(key)) continue;
      unique.set(key, new Set([key, word]));
    }
    return unique;
  }

  function find(documentText, query) {
    const wanted = [...terms(query)];
    if (!wanted.length) return [];
    const frequencies = new Map();
    const paragraphs = documentText.split(/\r\n|[\n\r\u2028\u2029]/u)
      .filter(line => line.trim()).map((text, index) => {
        const forms = new Set([...terms(text).values()].flatMap(set => [...set]));
        const matched = [], keys = [];
        for (const [key, variants] of wanted) {
          const hit = [...variants].find(form => forms.has(form));
          if (!hit) continue;
          matched.push(hit);
          keys.push(key);
          frequencies.set(key, (frequencies.get(key) || 0) + 1);
        }
        return {paragraph: index + 1, text, matched, keys};
      });
    const scored = paragraphs.filter(item => item.matched.length).map(item => {
      const score = item.keys.reduce((sum, key) =>
        sum + 1 + Math.log(paragraphs.length / frequencies.get(key)), 0);
      return {item, score};
    });
    scored.sort((a, b) => b.score - a.score || a.item.paragraph - b.item.paragraph);
    return scored.slice(0, 3).map(({item: {paragraph, text, matched}}) => ({paragraph, text, matched}));
  }

  const api = {find};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JournalEvidenceFinder = api;
})(globalThis);
