// Navigate quoted claims to explicitly attributed turns in Korean minutes.
(function (root) {
  'use strict';
  const role = '[가-힣]{0,12}(?:위원장|위원|의원|장관|차관|국장|시장|도지사|군수|구청장|교육감|총리|청장|처장|실장|과장|본부장|단장|원장|정책관|담당관|감사관|대변인)';
  const name = '[가-힣]{2,4}';
  const identity = '(?:(' + name + ')\\s+(' + role + ')|(' + role + ')\\s+(' + name + '))';
  const marker = /^\s*[◯○]/u;
  const header = new RegExp('^\\s*[◯○]\\s*' + identity + '(?=\\s|[:：]|$)\\s*[:：]?\\s*', 'u');
  const unmarkedSpeaker = new RegExp('^\\s*' + identity + '\\s*[:：]', 'u');
  const subject = new RegExp('^' + identity + '(?:은|는|이|가|께서는|께서)(?=\\s|$)', 'u');
  const framing = /^((?:[가-힣A-Za-z0-9·]+\s+){0,3}[가-힣A-Za-z0-9·]+)에\s*(?:대해|관해|대하여|관하여)$/u;
  const endsInRole = new RegExp(role + '$', 'u');
  const questionEnding = /(?:[?？]|습니까|인가요|건가요|겁니까)\s*$/u;
  const deniedTopic = /^([가-힣]{2,14})(?:은|는|이|가)\s*(?:아니|아닙|아닌|아닐|맞습|없습)/u;
  const reports = /^(?:이?라고|고|라며|라면서)\s*(?:말했|말하였|밝혔|강조했|주장했|답했|설명했|전했|덧붙였|발언했|해명했)[다으며고][.。!?\s]*$/u;
  const quote = /^(.*?)(?:“([^“”‘’"']+)”|‘([^“”‘’"']+)’|"([^“”‘’"']+)"|'([^“”‘’"']+)')(.*)$/u;
  const interruption = /^(?:\s*[(（\[●◎◇▶■□]|\s*[가-힣]{2,20}\s*[:：]|\s*(?:(?:다음|새)\s*안건|의사일정|안건\s*[:：]|제\s*\d+\s*(?:항|호\s*안건)|\d+[.)]\s|정회|속개|산회|개의|휴회|표결\s*결과|출석\s*(?:위원|의원)|부록|첨부|별첨))/u;
  const response = /^(?:아닙니다|아니[요오]|그렇습니다|그렇지\s*않|그(?:런|러한)\s*(?:뜻|취지|의미)|그\s*(?:말씀|부분|점|질문|문제)|(?:네|예)[,.!\s]|맞습니다|사실이\s*아닙니다)/u;
  function compact(text) {
    // Spaces and sentence punctuation can vary across PDF lines; digits, decimals and signs cannot.
    const normalized = text.normalize('NFKC').replace(/−/gu, '-')
      .replace(/(?<![\d,])(\d{1,3}(?:,\d{3})+)(?![\d,])/gu, amount => amount.replaceAll(',', ''));
    const tokens = normalized.match(/(?:[+±-]\s*)?\d+(?:\.\d+)?|[\p{L}%]+|[~∼–—…±+△▲▽▼/:<>≤≥-]/gu) || [];
    return tokens.map(token => /\d/u.test(token) ? '[' + token.replace(/\s/gu, '') + ']' : token).join('');
  }
  const words = text => (text.normalize('NFKC').match(/[가-힣A-Za-z0-9%]+/gu) || [])
    .map(w => w.replace(/(?:으로|에서|에게|에는|까지|부터|하고|은|는|이|가|을|를|에|의)$/u, ''))
    .filter(w => w.length >= 2 && !/^(?:전면|전체|모두|정말|사실|이번|당시|지금|우선|계속|적극|매우|해야|한다|있다|없다|것이다)$/u.test(w));

  function attribution(query) {
    const parts = quote.exec(query.normalize('NFKC').trim());
    if (!parts || !reports.test(parts[6].trim())) return null;
    const who = subject.exec(parts[1].trim());
    if (!who) return null;
    const rest = parts[1].trim().slice(who[0].length).trim();
    const framingTopic = rest && framing.exec(rest)?.[1];
    if (rest && !framingTopic) return null;
    const topicWords = framingTopic ? framingTopic.split(/\s+/u) : [];
    if (topicWords.some(token => endsInRole.test(token) || /(?:은|는|께서|다는|라는)$/u.test(token)) ||
        topicWords.slice(0,-1).some(token => /[이가]$/u.test(token))) return null;
    const phrase = parts.slice(2,6).find(Boolean).trim();
    if (phrase.replace(/[^\p{L}\p{N}%]+/gu, '').length < 4) return null;
    return {name:who[1] || who[4], role:who[2] || who[3], phrase, framing:framingTopic ? words(framingTopic) : []};
  }

  function turns(lines) {
    const result = [];
    let paragraph = 0, current = null, previous = null;
    for (const [index, text] of lines.entries()) {
      if (text.includes('\f')) { current = null; previous = null; }
      if (!text.trim()) continue;
      const row = {paragraph:++paragraph, text};
      // A form feed inside one extracted line leaves two pages in the same row.
      if (text.trimStart().includes('\f')) continue;
      const match = header.exec(text);
      // A physical line containing two turns cannot be safely copied as a single speaker's excerpt.
      if (/[◯○]/u.test(text.slice(match ? match[0].length : 0))) {
        current = null;
        previous = null;
        continue;
      }
      if (match) {
        current = {name:match[1] || match[4], role:match[2] || match[3],
          label:match[0].trim().replace(/[:：]$/u, '').replace(marker, '').trim(),
          header:row, start:index, previous, rows:[]};
        result.push(current);
        previous = current;
        const body = text.slice(match[0].length).trim();
        if (body) current.rows.push({row, body, index});
      } else if (unmarkedSpeaker.test(text) || interruption.test(text) || /\t|\|/u.test(text)) {
        current = null;
        previous = null;
      } else if (current) {
        current.rows.push({row, body:text.trim(), index});
      }
    }
    return result;
  }

  function endOfQuote(rows, phrase) {
    const pieces = rows.map(line => compact(line.body));
    const start = pieces.join('').indexOf(phrase);
    if (start < 0) return null;
    const end = start + phrase.length;
    let position = 0;
    for (const [index, piece] of pieces.entries()) {
      position += piece.length;
      if (position >= end) return rows[index];
    }
    return null;
  }

  function lookup(source, query) {
    const target = attribution(query);
    if (!target) return null;
    const lines = source.split(/\r\n|[\r\n\u2028\u2029]/u);
    const conversation = turns(lines);
    if (!conversation.length && !lines.some(line => header.test(line))) return null;
    const phrase = compact(target.phrase);
    const topic = [...new Set(words(target.phrase))];
    function relevant(body) {
      if (compact(body).includes(phrase)) return true;
      const present = new Set(words(body));
      return topic.length >= 2 && present.has(topic[0]) && topic.slice(1).some(w => present.has(w));
    }
    // Only an address or attribution outside the quoted words connects another turn
    // to this speaker. A bare job title can identify the addressee only when unique.
    const shortRole = new RegExp('^' + target.role + '(?:님|께서|께서는|은|는|이|가|[,，:：])', 'u');
    const fullLabel = new RegExp('(?:^|[^가-힣])(?:' + target.name + '\\s*' + target.role + '|' + target.role +
      '\\s*' + target.name + ')(?=님|께|은|는|이|가|[,，:：\\s]|$)', 'u');
    const uniqueRole = !conversation.some(t => t.role === target.role && t.name !== target.name);
    const namedAddressee = new RegExp(role + '(?:님|께서|,|，)', 'u');
    const exactPassages = [], relatedPassages = [];
    for (const turn of conversation) {
      if (turn.name !== target.name || turn.role !== target.role) continue;
      const prior = turn.previous;
      const previousLine = prior && prior.name !== turn.name ? prior.rows.at(-1) : null;
      const question = previousLine && questionEnding.test(previousLine.body) ? previousLine : null;
      const reply = turn.rows[0];
      if (!reply) continue;
      if (target.framing.length) {
        const statedTopics = new Set(words([question?.body, ...turn.rows.map(line => line.body)].filter(Boolean).join(' ')));
        if (!target.framing.every(word => statedTopics.has(word))) continue;
      }
      const exact = endOfQuote(turn.rows, phrase);
      const direct = exact || turn.rows.find(line => relevant(line.body));
      const citedBefore = previousLine && relevant(previousLine.body);
      const outside = citedBefore ? previousLine.body.replace(/“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'/gu, ' ').trim() : '';
      const addressed = citedBefore && (fullLabel.test(outside) || (uniqueRole && shortRole.test(outside)));
      const denied = deniedTopic.exec(reply.body)?.[1];
      const answersPrior = citedBefore && ((addressed && response.test(reply.body)) ||
        (question && (addressed || !namedAddressee.test(outside)) && denied && topic.includes(denied) && !endsInRole.test(denied)));
      if (!direct && !answersPrior) continue;
      const line = direct || reply;
      const context = new Map();
      if (addressed || question) {
        context.set(prior.header.paragraph, prior.header);
        context.set(previousLine.row.paragraph, previousLine.row);
      }
      context.set(turn.header.paragraph, turn.header);
      const index = turn.rows.indexOf(line);
      for (const nearby of turn.rows.slice(Math.max(0, index - 1), index + 2))
        context.set(nearby.row.paragraph, nearby.row);
      context.delete(line.row.paragraph);
      const bucket = exact ? exactPassages : relatedPassages;
      bucket.push({...line.row, matched:[], context:[...context.values()].sort((a,b) => a.paragraph-b.paragraph),
        speaker:{label:turn.label, ...turn.header, match:direct ? 'same-turn' : 'adjacent-reply', exactQuote:Boolean(exact), excerpt:lines.slice(turn.start, line.index + 1).join('\n')}});
    }
    const passages = exactPassages.concat(relatedPassages);
    const label = target.name + ' ' + target.role;
    return {passages, notice:passages.length ?
      label + '의 발언 위치를 찾았습니다. 앞선 질의와 답변의 범위를 원문에서 대조하세요.' :
      label + '의 발언과 인용 내용을 연결할 구간을 찾지 못했습니다. 원문의 화자 표기와 앞뒤 발언을 확인하세요.'};
  }
  const api = {lookup};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalEvidenceTranscript = api;
})(globalThis);
