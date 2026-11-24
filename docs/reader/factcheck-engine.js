/* Local editorial decisions. Source suggestions never issue a verdict. */
(function (root) {
  'use strict';

  const protocol = 'journal-review/1';
  const fiscal = typeof module === 'object' && module.exports ? require('./evidence-fiscal.js') : root.JournalEvidenceFiscal;
  const fiscalTable = typeof module === 'object' && module.exports ? require('./evidence-fiscal-table.js') : root.JournalEvidenceFiscalTable;
  const states = ['fact', 'attribution', 'opinion', 'mixed', 'partial', 'held', 'contradicted'];
  const withEvidence = new Set(['fact', 'attribution', 'mixed', 'partial', 'contradicted']);
  const unresolved = new Set(['pending', 'partial', 'held', 'contradicted']);
  const nonblank = value => typeof value === 'string' && value.trim().length > 0;

  // Receipts also work from file://, offline, and in synchronous DOM event handlers.
  // SHA-256 binds the complete version without copying the article into every receipt.
  const shaConstants = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  const rotate = (value, count) => (value >>> count) | (value << (32 - count));
  function digest(value) {
    // JSON escaping preserves lone UTF-16 surrogates, which TextEncoder alone replaces.
    const raw = JSON.stringify(value);
    const bytes = new TextEncoder().encode(raw);
    const buffer = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    buffer.set(bytes);
    buffer[bytes.length] = 0x80;
    const view = new DataView(buffer.buffer);
    view.setUint32(buffer.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(buffer.length - 4, bytes.length * 8);
    const hash = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const words = new Uint32Array(64);
    for (let pos = 0; pos < buffer.length; pos += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(pos + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = words[i - 15], y = words[i - 2];
        words[i] = (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + words[i - 16]
          + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10)) + words[i - 7];
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let i = 0; i < 64; i++) {
        const t1 = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25))
          + ((e & f) ^ (~e & g)) + shaConstants[i] + words[i];
        const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a,b,c,d,e,f,g,h].forEach((word, i) => { hash[i] += word; });
    }
    return Array.from(hash, word => word.toString(16).padStart(8, '0')).join('');
  }

  function physicalPage(value) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new Error('PDF를 직접 열어 확인한 쪽번호를 1 이상의 정수로 입력하세요.');
    }
    return value;
  }

  const pdfViewParameters = new Set(['page', 'zoom', 'view', 'viewrect', 'nameddest', 'pagemode', 'search', 'highlight',
    'toolbar', 'navpanes', 'scrollbar', 'statusbar']);
  const signingParameter = /^(?:x-(?:amz|goog)-(?:algorithm|credential|date|expires|signature|signedheaders)|x-amz-(?:security-token|content-sha256)|AWSAccessKeyId|GoogleAccessId)$/iu;
  function documentParams(query, fragment = false, normalizeFile) {
    const params = new URLSearchParams();
    for (const [key, value] of new URLSearchParams(query)) {
      if (/^(?:utm_.*|gclid|fbclid|page|pageNo|token|access_token|signature|expires)$/iu.test(key)
          || signingParameter.test(key)
          || (fragment && (pdfViewParameters.has(key.toLowerCase()) || /^(?:section|anchor|tab)$/iu.test(key)))) continue;
      params.append(key, normalizeFile ? normalizeFile(key, value) : value);
    }
    params.sort();
    return params.toString();
  }
  // A viewer may select the document in a hash route or parameter. Anchors,
  // PDF pages, and tracking tokens change the view without changing its source.
  function documentSelector(hash, normalizeFile) {
    const fragment = hash.slice(1).split('#', 1)[0].split(':~:', 1)[0];
    if (!fragment) return '';
    const route = /^(!?[^?=&]*\/[^?=&]*|![^?=&]+)(?:\?(.*))?$/u.exec(fragment);
    if (route) {
      const query = documentParams(route[2], true, normalizeFile);
      const path = route[1].replace(/^!/u, '').replace(/\/+$/u, '');
      return path || query ? '#' + path + (query ? '?' + query : '') : '';
    }
    if (!fragment.includes('=')) return '';
    const selector = documentParams(fragment.replace(/^\?/u, ''), true, normalizeFile);
    return selector ? '#' + selector : '';
  }
  function sourceTarget(source) {
    const url = new URL(source.url);
    const mock = [url, ...(source.originUrl ? [new URL(source.originUrl)] : [])].some(u =>
      !['http:', 'https:'].includes(u.protocol) || u.username || u.password || /(^|\.)invalid$/iu.test(u.hostname.replace(/\.$/u, '')));
    if (mock) return null;
    const fragment = new URLSearchParams(url.hash.slice(1));
    const values = fragment.getAll('page');
    const documentFragment = documentSelector(url.hash);
    let page = null;
    if (source.pdfPage != null && source.pdfPage !== '') {
      page = physicalPage(source.pdfPage);
      if (/\.(?:xlsx?|csv|docx?|hwpx?|pptx?|txt|png|jpe?g|zip)$/iu.test(url.pathname) ||
          (!documentFragment && /\.html?$/iu.test(url.pathname))) {
        throw new Error('쪽번호를 연결하려면 확인한 문서 주소에 PDF 파일을 여는 주소를 입력하세요.');
      }
      if (documentFragment) return {href:url.href, page:null, localPage:page};
      // Direct PDF download endpoints may have no .pdf suffix. An explicit viewer
      // page is the editor's assertion about that file, never about its landing page.
      const view = new URLSearchParams({page});
      for (const key of ['zoom','view']) if (fragment.has(key)) view.set(key, fragment.get(key));
      url.hash = view.toString();
    } else if (!documentFragment && /\.pdf$/iu.test(url.pathname) && values.length === 1 && /^[1-9]\d*$/u.test(values[0])
        && Number.isSafeInteger(Number(values[0])) && !fragment.has('nameddest')) {
      page = values[0];
    }
    return {href: url.href, page};
  }

  function sourceCatalog(sources) {
    if (!Array.isArray(sources)) throw new Error('근거 목록 형식을 확인하세요.');
    const items = new Map();
    for (const entry of sources) {
      if (!entry || !['id', 'url', 'locator', 'excerpt', 'version'].every(key => nonblank(entry[key]))) {
        throw new Error('근거의 식별자, 원문 주소, 확인 위치, 발췌문, 자료 버전을 입력하세요.');
      }
      if (entry.originUrl != null && typeof entry.originUrl !== 'string') throw new Error('최초 문서 주소를 확인하세요.');
      for (const address of [entry.url, entry.originUrl].filter(Boolean)) {
        let url;
        try { url = new URL(address); } catch (_) { throw new Error('원문 주소를 확인하세요.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('원문의 HTTP 또는 HTTPS 주소를 입력하세요.');
      }
      const hasPage = entry.pdfPage != null && entry.pdfPage !== '';
      if (hasPage) {
        physicalPage(entry.pdfPage);
        sourceTarget(entry);
      }
      if (items.has(entry.id)) throw new Error('근거 식별자가 중복됐습니다.');
      if (entry.title != null && typeof entry.title !== 'string') throw new Error('근거 제목을 확인하세요.');
      items.set(entry.id, {id: entry.id, title: entry.title ?? '', url: entry.url, ...(entry.originUrl ? {originUrl: entry.originUrl} : {}), locator: entry.locator, excerpt: entry.excerpt, version: entry.version, ...(hasPage ? {pdfPage: entry.pdfPage} : {})});
    }
    const ordered = [...items.keys()].sort().map(id => items.get(id));
    return {items, key: digest(ordered)};
  }

  const quoteEnds = new Map([['“','”'], ['‘','’'], ['「','」'], ['『','』'], ['"','"']]);
  // Pasted text often opens with a straight " and closes with a curly ”.
  const closes = (expected, ch) => expected === ch || (expected === '"' && ch === '”');
  // After a quotation that ends with . ! or ?, the unit continues when what follows attaches
  // the quote to a speaker: a particle or verb on the quote itself (”라고 · ”고 · 하며 · 등의),
  // another double quotation in the same series, or a next sentence that only names the
  // speaker (김 의원은 이같이 말했다 · 이 같은 글을 올렸다 · 김 의원이 한 말이다 · 그가 물었다).
  const reportingVerb = /(?:말|밝|전|주장|강조|설명|반박|비판|지적|촉구|반대|찬성|답|물|되물|덧붙|비난|평가|해명|요구|호소|우려|반발|질타|꼬집|반문|토로|외)(?:했|혔|었|였|쳤)다[.!?]?$/u;
  const frameVerb = /(?:말|밝|전|주장|강조|설명|반박|비판|지적|촉구|반대|찬성|답|물|되물|덧붙|비난|평가|해명|요구|호소|우려|반발|질타|꼬집|반문|토로|외|올|남|높)(?:했|혔|었|였|쳤|렸|겼)다[.!?]?$/u;
  const frameReference = /이같이|이 같이|이와 같이|이렇게|이처럼|이같은|이 같은|이와 같은|이런|이러한/u;
  function quoteContinues(after) {
    if (/^(?:고\s)|^\s*(?:이?라고|이?라며|이?라면서|라는|하고|하며|하는(?!\s*수\s*없이)|하면서|하던|며\s|면서|등(?=\s|의)|[“"])/u.test(after)) return true;
    const line = after.split(/[\r\n]/u)[0];
    const end = line.search(/[.!?。！？](?=\s|$)/u);
    const next = (end < 0 ? line : line.slice(0, end + 1)).trim();
    if (!next || /[“"‘「『]/u.test(next)) return false;
    return (frameReference.test(next) && frameVerb.test(next))
      || (next.split(/\s+/u).length <= 2 && frameVerb.test(next))
      || /^\S+(?:\s\S+)?(?:이|가|은|는)\s+\S*(?:물었|답했|되물었|반문했)다[.!?]?$/u.test(next)
      || /(?:의|한)\s*(?:말|설명|주장|지적|입장|얘기|반응|글)이다[.!?]?$/u.test(next);
  }
  function segments(article) {
    const result = [], quotes = [];
    let start = 0;
    function emit(limit) {
      const raw = article.slice(start, limit), text = raw.trim();
      if (text) {
        const first = start + raw.length - raw.trimStart().length;
        for (const part of splitReportedClauses(text)) {
          result.push({text: part.text, start: first + part.start, end: first + part.start + part.text.length});
        }
      }
      start = limit;
    }
    for (let i = 0; i < article.length; i++) {
      const ch = article[i];
      // A line break always ends a unit. An unclosed quotation mark must not
      // fold later, independent sentences into one attribution-only row.
      if (ch === '\n' || ch === '\r') {
        quotes.length = 0;
        emit(i + 1);
        continue;
      }
      if (quotes.length && closes(quotes.at(-1), ch)) {
        quotes.pop();
        // “…다.” 의회는 …: a quotation that ends its own sentence also ends the unit,
        // unless what follows attaches it to a speaker.
        if (!quotes.length && /[.!?。！？]/u.test(article[i - 1] ?? '') && /\s/u.test(article[i + 1] ?? '')
          && !quoteContinues(article.slice(i + 1))) emit(i + 1);
        continue;
      }
      if (quoteEnds.has(ch)) { quotes.push(quoteEnds.get(ch)); continue; }
      if (quotes.length) continue;
      if (/[.!?。！？]/u.test(ch) && /\s/u.test(article[i + 1] ?? '')) emit(i + 1);
    }
    emit(article.length);
    return result;
  }

  const attributed = /[“”"]|(?:라고|다고|다며|라며)\s*(?:말|전|주장|밝|비판|강조|지적|설명|반박|촉구|발표|덧붙|평가|해명)|(?:주장|해명|발언|반박|비판|강조|발표|지적|설명|촉구|비난|평가)(?:했|했다|한다|하며|했다는)|(?:말했다|말한다|밝혔다|전했다|에\s*(?:따르면|의하면)|에\s*따른\s*주장)/u;
  const allegation = /의혹|혐의|고발|의심|용의자|비리|횡령|뇌물/u;
  const allegationQualifier = /의혹|혐의|의심|용의자/u;
  const assessment = /무책임|무능|참담|포퓰리즘|실정|졸속|폭거|망국|독선|탁월|치적|훌륭|위대|쾌거|현명|어리석|정쟁|기만|최악|최선|폭주|선동|굴욕|퍼주기|악법|잘못된|바람직|정당한|부당|해야\s*한다/u;
  // 정치+적, 상반기+만 and the legal term 부당이득금 each contain a different evaluative word.
  // Mask only that occurrence so a separate judgment in the same sentence still needs review.
  const neutralAssessmentOverlaps = /(?:정치|수치|가치|위치|자치|통치)적|(?:상반기|하반기|분기|학기|회기|임기|하기)만|부당이득|부당\s+이득(?:금|\s*반환)|시위대|실정법/gu;
  function hasAssessment(text) {
    return assessment.test(text.replace(neutralAssessmentOverlaps, ' '));
  }
  function endsInValueJudgment(quote) {
    // A direct verdict such as "부당하다" or "치적이다" differs from a report that
    // somebody reached that verdict ("부당하다고 판결했다").
    const predicate = /(?:^|\s)([가-힣]+)[.!。！]?$/u.exec(quote.trim())?.[1];
    if (!predicate) return false;
    if (/^(?:무책임|무능|참담|탁월|훌륭|위대|현명|부당|바람직)(?:하다|합니다|했다|했습니다)$/u.test(predicate)) return true;
    const noun = predicate.replace(/(?:이다|입니다|이었다|이었습니다|였다|였습니다|이에요|예요)$/u, '');
    return assessment.exec(noun)?.[0] === noun;
  }
  const quantitative = /\d(?:[\d.,]*\d)?\s*(?:[%％]|퍼센트|명|건|만|억|조|원|배|년|월|일|표|석|점|회|곳)/u;
  const proceeding = /기소(?:했|됐|되었|유예)|무죄.{0,8}(?:선고|판결|확정)|유죄.{0,8}(?:선고|판결|확정)|공소.{0,4}제기|수사.{0,5}(?:착수|개시)|수사\s*중|불송치|불기소|구속영장.{0,8}(?:청구|발부|기각)/u;
  const eventFact = /의결|가결|부결|표결|집행|통과|인상|인하|삭감|증액|감액|폐지|도입|인정했|선고|(?:판결|판시)(?:했|하였)|기소|체포|구속|증가|감소|늘렸|늘린|늘었|줄였|줄인|줄었|찬성했|반대했/;
  // A transcript cannot verify a narrator's independent assertion in a neighbouring clause.
  // Split only outside quotations, at a coordinated predicate followed by a new explicit subject.
  // In indirect speech ("A는 B가 X했고 C가 Y했다고 주장했다") the left clause belongs to the
  // reported claim. A clause that is not itself reported speech is split off only when
  //  - it has a single subject (no embedded "B가" after the speaker), and
  //  - the next clause is speech of its own: a direct quotation, or a topic-marked speaker
  //    ("시장은 …라고 밝혔다"), and
  //  - it does not open with the speaker topic while the next clause has a new 이/가 subject
  //    ("김 의원은 시장과 면담한 뒤 취재진이 묻자 …" is one speaker's sentence).
  //  - a direct speaker on the right ("…했고 시장이 “…”고 반발했다") may follow a topic.
  // A sentence reported as a whole (검찰에 따르면 … / …했다고 검찰은 밝혔다) is never split.
  const subjectWord = /[가-힣](?:은|는|이|가)$/u;
  // Adnominal forms (같은 · 많은 · 시행되는) and nouns ending in 이/가 (추가 · 국가 · 어린이)
  // are not subjects.
  const notSubject = /^(?:같|많|적|높|낮|작|좋|넓|깊|않|받|맡|늦|짧|옳|젊)은$|(?:하|되|있|없|않|오)는$|^(?:추가|국가|물가|평가|대가|작가|전문가|원가|단가|증가|참가|부가|주가|어린이|아이|사이|차이|높이|길이|넓이|깊이|같이|많이)$/u;
  const subjectsOf = clause => clause.split(/\s+/u).map(word => word.replace(/^[“"‘'「『(]+|[,，]$/gu, ''))
    .filter(word => subjectWord.test(word) && !notSubject.test(word));
  // Past-tense syllables (final ㅆ: 했 · 였 · 켰 · 렸 …) close a coordinated clause.
  const past = Array.from({length: 11172}, (_, i) => i % 28 === 20 ? String.fromCharCode(0xAC00 + i) : '').join('');
  const reportedWhole = /^(?:\S+\s+){0,2}?\S*에\s*(?:따르면|의하면)\s|(?:다|라)고\s+(?:\S+\s)?\S+(?:은|는|이|가)\s+(?:\S+\s+)?\S*(?:밝|말|전|주장|설명|강조|발표|덧붙|확인|보도|지적)(?:했|혔|였)다/u;
  function splitReportedClauses(text) {
    if (!attributed.test(text) || reportedWhole.test(text)) return [{text, start: 0}];
    const connective = new RegExp('(?:[' + past + '](?:고|으며|지만|으나|는데도?)|(?<=[가-힣])(?:하자|되자)|(?<=[가-힣])[한된]\\s+(?:뒤|후)' +
      '|(?:[한된난진른던힌인]|있는|없는)\\s+(?:가운데|상황에서))[,，]?\\s+', 'gu');
    // Lazy: the first subject-marked word after the connective (의회는, not 의회는 절차가).
    const subject = /^(?:[^\s“”"‘’「」『』]{1,20}\s+){0,3}?[^\s“”"‘’「」『』]+(?:은|는|이|가|측도|측은)\s+/u;
    const matches = [...text.matchAll(connective)];
    const chunks = [], stack = [];
    let cursor = 0, scanned = 0;
    for (const match of matches) {
      const end = match.index + match[0].length;
      for (; scanned < end; scanned++) {
        const ch = text[scanned];
        if (stack.length && closes(stack.at(-1), ch)) stack.pop();
        else if (quoteEnds.has(ch)) stack.push(quoteEnds.get(ch));
      }
      const head = stack.length ? null : subject.exec(text.slice(end));
      if (!head) continue;
      const left = text.slice(cursor, end).trimEnd(), rest = text.slice(end);
      const subjects = subjectsOf(left);
      const leftTopic = /(?:은|는)$/u.test(subjects[0] ?? '');
      const rightTopic = /(?:은|는|측은)\s+$/u.test(head[0]);
      // "시장이 “…”고 반발했다": the new subject speaks directly, with no further report layer.
      const directSpeaker = /^[“"‘]/u.test(rest.slice(head[0].length)) && !/[”"’](?:이?라고|고)\s+[^“”"]*(?:다|라)고\s/u.test(rest);
      if (leftTopic && !rightTopic && !directSpeaker) continue;
      if (!attributed.test(left)) {
        if (subjects.length > 1) continue;
        if (!/[“"‘「『]/u.test(rest) && !(rightTopic && attributed.test(rest))) continue;
      }
      chunks.push({text: left, start: cursor});
      cursor = end;
    }
    chunks.push({text: text.slice(cursor), start: cursor});
    return chunks;
  }
  // A short quoted name followed by a case particle (“노란봉투법”을) is a title, not speech.
  // A quotation ending like a sentence (“시장은 사퇴하라”는) or carrying an evaluation,
  // a figure, an event or an allegation is always speech.
  const nameQuote = /[“"]([^“”"\n]{1,30}[^다라요까죠\s.!?])[”"](?=(?:을|를|이|가|은|는|의|과|와|에|에서|으로|로|도)(?:[\s.,]|$))/gu;
  const asTitle = (match, name) => hasAssessment(name) || [quantitative, eventFact, allegation].some(re => re.test(name)) ? match : '「' + name + '」';
  function triage(text) {
    const speech = attributed.test(text.replace(nameQuote, asTitle)), suspicion = allegation.test(text);
    const number = quantitative.test(text), evaluation = hasAssessment(text);
    const mixed = evaluation && (number || eventFact.test(text));
    const hints = [];
    if (speech) hints.push('누가 누구에 대해 어떤 말을 했는지 원발언과 대조하세요. 발언 내용 자체의 사실성은 별도 쟁점입니다.');
    if (suspicion) hints.push('의혹 제기·수사·확정 판단의 단계, 당사자의 답변과 추가 근거를 확인하세요.');
    if (number) hints.push('수치의 기간, 단위, 분모와 비교 기준을 확인하세요.');
    if (evaluation) hints.push('평가·비판의 주체와 강도를 보존하고 확인할 사실이 함께 있는지 살펴보세요.');
    if (mixed) hints.push('같은 문장에 확인할 사실과 평가 표현이 있습니다. 확인한 구절을 지정하세요.');
    let allowedStatuses = [...states];
    if (speech) allowedStatuses = ['attribution', 'partial', 'held', 'contradicted'];
    // An evaluative word must not turn a reported allegation into a checkable fact span.
    else if (allegationQualifier.test(text) && !proceeding.test(text)) allowedStatuses = ['attribution', 'partial', 'held', 'contradicted'];
    else if (mixed) allowedStatuses = ['mixed', 'partial', 'held', 'contradicted'];
    else if (number || eventFact.test(text) || suspicion) allowedStatuses = ['fact', 'partial', 'held', 'contradicted', 'mixed'];
    else if (evaluation) allowedStatuses = ['opinion', 'mixed', 'partial', 'held', 'contradicted'];
    return {hints, allowedStatuses};
  }

  const stopWords = new Set(['했다','한다','됐다','이다','있다','없다','대한','대해','이번','것이다','the','and','of','to']);
  function terms(text, includeSurface = false) {
    const tokens = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:[.,]\d+)?[%％]?/gu) ?? [];
    const result = new Set();
    for (const raw of tokens) {
      const word = raw.replace(/([가-힣]{2,}?)(?:에서는|에서|으로|에게|에는|보다|까지|부터|의|을|를|가|이|는|은|에|와|과|도|로)$/u, '$1')
        .replace(/([가-힣]{2,}?)(?:했다는|했으며|했다|한다|하는|됐다|되는|된|한)$/u, '$1');
      if ((word.length < 2 && !/\d/u.test(word)) || stopWords.has(word)) continue;
      result.add(word);
      if (includeSurface) result.add(raw);
    }
    return result;
  }

  // A finalized plan still describes a plan. Read the document's purpose before its version.
  const preliminary = /초안|시안|가안|(?:요구|요청|신청)(?:서|안|액|량|하|한|했)|제안서|건의서|사전\s*검토|심의안|계획|예정|일정|전망|예측|목표|잠정/u;
  const observed = /확정|최종|승인|의결|가결|부결|실제|실적|결산|집계|관측|측정|결과|접수|제출했|준공|검수|마감|줄었다|늘었다|감소했다|증가했다/u;
  function claimStage(text) {
    const plan = preliminary.test(text), result = observed.test(text);
    if (plan && result) return 0;
    return plan ? -1 : result ? 1 : 0;
  }
  function sourceStage(source) {
    const heading = source.title + ' ' + source.locator;
    if (preliminary.test(heading)) return -1;
    if (observed.test(heading)) return 1;
    return claimStage(source.version);
  }
  function revisionStage(text) {
    const draft = /초안|초고|잠정|가안|초기본/u.test(text), final = /확정|최종|결정본/u.test(text);
    return draft === final ? 0 : draft ? -1 : 1;
  }
  function sourceScope(text) {
    // An interior month, quarter or year may be omitted from a printed interval.
    if (/\d\s*(?:년|월|분기)?\s*(?:[~∼〜–—-]\s*\d|부터|까지)/u.test(text)) return [];
    const years = new Set(Array.from(text.matchAll(/(?<!\d)((?:19|20)\d{2})\s*년/gu), m => m[1]));
    const quarters = new Set(Array.from(text.matchAll(/(?<!\d)([1-4])\s*분기/gu), m => m[1]));
    const months = new Set(Array.from(text.matchAll(/(?<!\d)(1[0-2]|0?[1-9])\s*월/gu), m => Number(m[1])));
    return [years, quarters, months];
  }
  function budgetBasis(text) {
    if (!/예산|회계|편성액|지출|집행액|사업비|결산/u.test(text)) return 0;
    const allocation = /예산안|편성|(?:요구|제출|정부|부처)안/u.test(text);
    const spending = /집행|지출|결산/u.test(text);
    return allocation === spending ? 0 : allocation ? -1 : 1;
  }
  function indexSource(source) {
    const heading = source.title + ' ' + source.locator;
    const content = heading + ' ' + source.excerpt;
    return {source, words: terms(content, true), heading: terms(heading, true),
      stage: sourceStage(source), revision: revisionStage(source.version), scope: sourceScope(content),
      basis: budgetBasis(source.locator + ' ' + source.excerpt), compact: content.normalize('NFKC').replace(/\s/gu, '')};
  }

  // Two otherwise identical titles can name different places, facilities or measurements.
  // Keep a competing title in view when its excerpt also addresses the requested subject.
  function indexCatalog(sources) {
    const indexed = [...sources].map(indexSource), alternatives = new Map();
    for (const candidate of indexed) {
      candidate.titleSlots = [];
      const parts = candidate.source.title.normalize('NFKC').toLowerCase().trim().split(/\s+/u);
      if (parts.length < 2 || parts.length > 12) continue;
      for (const [i, part] of parts.entries()) {
        const frame = JSON.stringify([...parts.slice(0, i), '', ...parts.slice(i + 1)]);
        if (!alternatives.has(frame)) alternatives.set(frame, new Set());
        const slot = alternatives.get(frame);
        slot.add(part);
        candidate.titleSlots.push(slot);
      }
    }
    return indexed;
  }
  const contextOnly = new Set(['올해','지난해','내년','최종','확정','자료','기준','공개','현재','대상','해당','실제']);
  // A document can cite last year's approved sum next to this year's request.
  // Associate its dates with the passage that actually names each measure.
  function fiscalScope(text) {
    const [, quarters, months] = sourceScope(text);
    return [fiscal.years(text), quarters ?? new Set(), months ?? new Set()];
  }
  function fiscalAmount(text, heading) {
    if (/\d[\d,.]*\s*(?:[십백천만억조]+\s*)?(?:원|%|퍼센트)|\d[\d,.]*\s*[억조](?=\s|[.,]|$)|(?:전액\s*삭감|전액\s*불용|영\s*원)/u.test(text)) return true;
    const withoutDates = text.replace(/\d+\s*(?:회계연도|년도|년|분기|월|일|쪽)/gu, '');
    return /(?:단위\s*[:：]?\s*[(（]?\s*|[(（]\s*)(?:[십백천만억조]+\s*)?원/u.test(heading) &&
      /\d[\d,.]*\s*$/u.test(withoutDates.trim());
  }
  function fiscalPassages(source) {
    const heading = source.title + ' ' + source.locator;
    const passages = fiscal.clauses(source.excerpt).map(part => ({...part,
      words: terms(part.text, true), hasAmount: fiscalAmount(part.text, heading)}));
    if (!passages.some(passage => passage.stage)) {
      const headerStage = fiscal.request(source.locator) || fiscal.request(source.title);
      // A labeled table can omit its measure in an individual amount cell.
      // A cover title alone also appears on forecasts and withheld figures.
      for (const passage of passages) {
        if (passage.hasAmount &&
            !(headerStage === 'spent' && (fiscal.otherExecutionMeasure(passage.text) || fiscal.otherExecutionMeasure(source.locator))) &&
            !/예정|계획|전망|미정|미공개|아직|보류|부결|예상|요구|요청|제출안|정부안|본예산|의결|승인|확정|가결|집행|지출|지급|결산|공개되지|않|못했|아니|아닌|취소|무산/u.test(passage.text)) {
          passage.stage = headerStage;
        }
      }
    }
    return passages;
  }
  const fiscalVocabulary = /^(?:사업|항목|규모|금액|총액|부처|국회|정부|의회|요구|신청|제출|의결|배정|편성|확정|예산|본예산|결산|집행|지출|실적|실제|당초|년도|회계연도|전년|작년|금년|지난해|올해|내년|대비|얼마|원(?:이다|이었다|이었다고|인가|입니까)|늘었다|줄었다|사업비)(?:안|서|액|본|액수|된|한|도|비|량)?$/u;
  function fiscalSubject(claim) {
    return [...claim].filter(word => !contextOnly.has(word) && !/\d/u.test(word) &&
      !fiscalVocabulary.test(word) && !fiscal.stages(word).size);
  }
  function fiscalFit(candidate, stage, wanted, project, subject) {
    if (!candidate.fiscalPassages) candidate.fiscalPassages = fiscalPassages(candidate.source);
    const heading = candidate.source.title + ' ' + candidate.source.locator;
    const passages = candidate.fiscalPassages.filter(passage => {
      if (passage.stage !== stage || !passage.hasAmount) return false;
      if (!project) return subject.every(word => candidate.heading.has(word) || passage.words.has(word));
      const parts = project.split(' ');
      if (passage.project && !passage.project.split(' ').every(part => parts.includes(part))) return false;
      const compact = (heading + ' ' + passage.text + ' ' + (passage.project || '')).replace(/[\s·ㆍ・]/gu, '');
      return parts.every(part => compact.includes(part));
    });
    if (!passages.length) return [];
    const span = passages.map(passage => passage.text).join(' ');
    const actual = fiscalScope(span), location = fiscalScope(candidate.source.locator), title = fiscalScope(candidate.source.title);
    actual[0] = new Set(passages.flatMap(passage => [...passage.years]));
    const coversPeriod = wanted.every((set, i) => {
      const available = actual[i].size ? actual[i] : location[i].size ? location[i] : title[i];
      return [...set].every(value => available.has(value));
    });
    if (!coversPeriod) return [];
    // A multi-year source can answer the question while its other figures are irrelevant.
    return passages.filter(passage => {
      const period = fiscalScope(passage.text);
      period[0] = passage.years;
      return wanted.every((set, i) => !set.size || !actual[i].size ||
        [...set].some(value => period[i].has(value)));
    });
  }
  function suggest(text, indexed) {
    const attributedClaim = attributed.test(text.replace(nameQuote, asTitle));
    const rateQuestion = !attributedClaim && fiscalTable.registeredRateQuestion(text);
    if (rateQuestion) {
      const candidates = [], bases = new Set();
      for (const {source} of indexed) {
        const cell = rateQuestion(source);
        if (cell.status !== 'compatible') continue;
        bases.add(cell.basis || '');
        candidates.push({id:source.id,
          reason:'원표의 집행률 · ' + cell.value + ' (단위 ' + cell.unit + ') · ' + source.locator});
      }
      if (bases.size > 1) return {candidates:[], caution:'등록 자료들의 집행률 분모가 서로 다르거나 일부 표에 빠져 있습니다. 기사에서 어느 예산을 기준으로 삼았는지 확인하세요.'};
      if (!candidates.length) return {candidates:[], caution:indexed.length
        ? '등록 자료에서 이 사업의 회계연도와 집행률 기준이 일치하는 셀을 특정하지 못했습니다. 원자료의 행과 분모를 확인하세요.' : null};
      return {candidates:candidates.slice(0, 4), caution:bases.has('')
        ? '선택한 집행률 열에 분모가 적혀 있지 않습니다. 원표 주석에서 기준 예산을 확인하세요.' : null};
    }
    const claim = terms(text), matches = [], askedSlots = new Map();
    const stage = claimStage(text), revision = revisionStage(text), scope = sourceScope(text), basis = budgetBasis(text);
    const financial = !attributedClaim && fiscal.request(text);
    const wanted = financial && fiscalScope(text);
    const project = financial && fiscal.project(text);
    const subject = financial && !project && fiscalSubject(claim);
    const quotes = attributedClaim
      ? Array.from(text.matchAll(/“([^”]+)”|"([^"]+)"/gu), m => m[1] || m[2]).filter(q => q.length >= 6) : [];
    for (const candidate of indexed) {
      const {source, words, heading} = candidate;
      const exact = source.excerpt.includes(text) || (source.excerpt.length >= 6 && text.includes(source.excerpt));
      const common = [...claim].filter(word => words.has(word));
      if (!exact && !common.some(word => /\p{L}/u.test(word) && !/^\d/u.test(word) && !contextOnly.has(word))) continue;
      // Absolute figure agreement is weak evidence. A conflicting figure can answer the same question.
      const overlap = common.reduce((sum, word) => sum + (/\d/u.test(word) ? 0.5 : 1) + (heading.has(word) ? 0.75 : 0), 0);
      const scopeConflict = scope.some((wanted, i) => wanted.size === 1 && candidate.scope[i]?.size === 1 &&
        ![...wanted].some(value => candidate.scope[i].has(value))) || candidate.titleSlots.some(slot => {
        if (slot.size < 2) return false;
        if (!askedSlots.has(slot)) {
          const named = [...slot].filter(part => claim.has(part));
          askedSlots.set(slot, named.length === 1 ? named[0] : null);
        }
        const named = askedSlots.get(slot);
        return named && !words.has(named);
      });
      const quotedSpeech = quotes.some(q => source.excerpt.includes(q)) &&
        /발언|속기|녹취|회의록|연설|회견|인터뷰|성명|입장문|답변서/u.test(source.title + ' ' + source.locator);
      const score = overlap + (exact || quotedSpeech ? 4 : 0) +
        (common.length >= 2 ? 3 * stage * candidate.stage + 2 * revision * candidate.revision : 0) +
        (common.length >= 2 || common.some(word => heading.has(word)) ? 3 * basis * candidate.basis : 0);
      let reason = exact ? '입력 문장과 같은 구절' : `함께 나온 표현 · ${common.slice(0, 4).join(', ')}`;
      let fiscalRank = 0;
      if (financial && !scopeConflict && (project ? project.split(' ').every(part => candidate.compact.replace(/[·ㆍ・]/gu, '').includes(part)) :
        subject.every(word => words.has(word)))) {
        const passages = fiscalFit(candidate, financial, wanted, project, subject);
        fiscalRank = passages.length ? 2 : 1;
        if (passages.length) {
          const termsInPassage = common.filter(word => passages.some(passage => passage.words.has(word)));
          reason = `예산 단계 · ${fiscal.label(financial)}`;
          if (termsInPassage.length) reason += ` / 해당 구절과 겹친 표현 · ${termsInPassage.slice(0, 4).join(', ')}`;
        }
      }
      matches.push({id: source.id, score, scopeConflict, fiscalRank, reason});
    }
    matches.sort((a, b) => Number(a.scopeConflict) - Number(b.scopeConflict) ||
      b.fiscalRank - a.fiscalRank || b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const candidates = matches.slice(0, 4).map(({id, reason}) => ({id, reason}));
    const caution = financial && matches.length && !matches.some(match => match.fiscalRank === 2) ? fiscal.gap(financial) : null;
    return {candidates, caution};
  }

  // Limit caution to an expressly unresolved reference or a named post-event change.
  // A document measuring the same outcome still belongs in view when its numbers disagree.
  const unclearTime = /(?:시점|시기|기준일|기준년도?|기준\s*연도|기간|언제)(?:을|를|이|가|은|는|에)?\s*(?:을?\s*기준(?:으로)?\s*)?(?:(?:한\s*것|삼은\s*것|말한\s*것|것)?인지|인지는|인지가|인지를)?\s*(?:불분명하다|불명확하다|명확하지\s*않다|분명하지\s*않다|알\s*수\s*없다|확인되지\s*않았다|밝혀지지\s*않았다)[.!?。]?$/u;
  function sourceCaution(text, indexed) {
    if (unclearTime.test(text)) return '어느 시점이나 기간의 수치인지 기사 작성자 또는 원자료에서 확인하세요.';
    if (!/(?:줄었다|늘었다|감소했다|증가했다|낮아졌다|높아졌다|단축됐다|줄었는가|늘었는가)[.!?。]?$/u.test(text)) return null;
    const after = /(?:^|\s)(?:이후|후|뒤)(?:에는|에)?\s+([^.,;!?]{1,100})/u.exec(text);
    if (!after || !/보다|대비|절반|배로|%|퍼센트/u.test(after[1])) return null;
    const subjects = [...after[1].matchAll(/(?:^|\s)([가-힣]{2,16})(?:은|는|이|가)(?=\s)/gu)];
    if (subjects.length !== 1) return null;
    const subject = subjects[0][1];
    if (/^(?:수치|결과|효과|대상|것|경우)$/u.test(subject)) return null;
    const stem = subject.replace(/(?:률|율|량|도)$/u, '');
    // A shared noun also covers close compounds and differences in word spacing.
    const keys = [subject];
    if (stem.length >= 2) keys.push(stem);
    if (subject.length >= 4) keys.push(subject.slice(-2));
    if (indexed.some(record => keys.some(key => record.compact.includes(key)))) return null;
    return `‘${subject}’의 변화량과 비교 기간을 확인할 수 있는 원문 구간을 찾아보세요.`;
  }

  function strictSpan(text, span, name) {
    if (!nonblank(span) || span !== span.trim() || span === text || !text.includes(span)) {
      throw new Error(`${name}을 원문 안에서 그대로 선택하세요.`);
    }
    const where = text.indexOf(span);
    if (where !== text.lastIndexOf(span)) throw new Error(`${name}이 두 번 나옵니다. 구분할 수 있게 앞뒤 문구를 포함하세요.`);
    return {start: where, end: where + span.length};
  }
  function outside(text, spans) {
    const remainder = [];
    let position = 0;
    for (const span of spans) {
      if (position < span.start) remainder.push(text.slice(position, span.start));
      position = span.end;
    }
    if (position < text.length) remainder.push(text.slice(position));
    return remainder;
  }
  // A substring of a quote, conditional, or denial can reverse its meaning.
  // Partial checks are for independently readable clauses separated in the original.
  // Clause ends accepted for a separately checked span, incl. any past-tense syllable + 고 (통과시켰고).
  const clauseEnd = new RegExp('(?:[' + past + ']고|으며|하며|지만|으나|는데|한데|반면|이고|되고|것은|것이)$', 'u');
  const separateEnd = new RegExp('(?:[' + past + ']고|지만|으나|으며|하고|하며|인데|는데|했다)[,;\\s]*$', 'u');
  function clauseBoundary(left, right) {
    if (!left.trim() || !right.trim()) return true;
    if (/[,;:，；：·]/u.test(left.trimEnd().at(-1)) || /^[,;:，；：·]/u.test(right.trimStart())) return true;
    if (!/\s$/u.test(left) && !/^\s/u.test(right)) return false;
    return clauseEnd.test(left.trimEnd())
      || /^(?:하지만|그러나|반면|그리고|한편|반대로)\s/u.test(right.trimStart());
  }
  function checkedClause(text, range) {
    const left = text.slice(0, range.start), right = text.slice(range.end), span = text.slice(range.start, range.end);
    if (!/[\p{L}]/u.test(span) || !clauseBoundary(left, span) || !clauseBoundary(span, right)) throw new Error('주체와 부정·조건을 포함해 독립적으로 대조할 절 전체를 선택하세요.');
    if (attributed.test(span) || /(?:에\s*(?:따르면|의하면)|(?:다는|라고|다고)\s*)[,:\s]*$/u.test(left)
      || /^(?:라고|다고|라며|다며|[”’」』"])/u.test(right.trimStart())
      || /(?:라면|다면|경우|때에만|때만|전제로|조건으로|않고|아니라)[,\s]*$/u.test(left)) throw new Error('발언·조건·부정에 속한 표현은 독립된 사실 구절로 저장할 수 없습니다.');
    // If speech is present, a partial fact can only be a separate clause outside it.
    if (attributed.test(text)) {
      const separate = (attributed.test(left) && separateEnd.test(left)) || (attributed.test(right) && separateEnd.test(span));
      if (!separate) throw new Error('원발언 속 주장은 발언 확인에서 내용의 별도 근거와 함께 검토하세요.');
    }
  }
  // Keep document selectors such as ?docId=, discard navigation and tracking variants.
  function originAddress(url, depth = 0) {
    const parsed = new URL(url);
    const files = [];
    function normalizeFile(key, value) {
      if (depth >= 4 || !/^(?:file|pdf|fileUrl|pdfUrl|docUrl|documentUrl)$/iu.test(key)
          || !/^https?:\/\//iu.test(value)) return value;
      let file;
      try { file = new URL(value); } catch (_) { return value; }
      if (file.username || file.password) return value;
      const address = originAddress(file, depth + 1);
      const normalized = 'https://' + address;
      files.push({address, selector:new URLSearchParams([[key, normalized]]).toString()});
      return normalized;
    }
    const query = documentParams(parsed.search, false, normalizeFile);
    const hash = documentSelector(parsed.hash, normalizeFile);
    // A viewer selecting only one file is another way to open that file. Keep
    // other selectors (such as an edition ID) when they also choose the document.
    if (files.length === 1 && ((!hash && query === files[0].selector) || (!query && hash === '#' + files[0].selector))) {
      return files[0].address;
    }
    // A mobile or www copy is the same document as the desktop page.
    return parsed.host.toLowerCase().replace(/^(?:www|m|mobile)\./u, '') + parsed.pathname.replace(/\/+$/u, '')
      + (query ? '?' + query : '') + hash;
  }
  // From the editor's recorded provenance only. Reprints may name another reprint
  // as their source, and two differently worded reports can share that chain.
  function relatedDocuments(catalog, selected) {
    const links = new Map();
    for (const source of catalog.items.values()) {
      if (!source.originUrl) continue;
      const copy = originAddress(source.url), original = originAddress(source.originUrl);
      if (!links.has(copy)) links.set(copy, []);
      if (!links.has(original)) links.set(original, []);
      links.get(copy).push(original);
      links.get(original).push(copy);
    }
    const related = new Set(selected.map(s => originAddress(s.url)));
    for (const address of related) {
      for (const linked of links.get(address) || []) related.add(linked);
    }
    return related;
  }
  function excerptIdentity(source) {
    return source.excerpt.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '');
  }
  const forecast = /(?:될|할|늘|오를|내릴|줄|높아질|낮아질|늘어날|감소할|증가할|이길|패할|거둘|받을|넘을|이어질|커질)\s*(?:것|전망|예정|계획|가능성)|예상(?:된|한|했)|전망(?:된|한|했)/u;
  const relativeQuantity = /절반|반값|반액|과반|(?:\d+|[일이삼사오육칠팔구십백천만]+)분의\s*(?:\d+|[일이삼사오육칠팔구십백천만]+)|(?<![가-힣])(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|[일이삼사오육칠팔구십백천만]+)\s*배(?=$|[\s\p{P}]|가|나|는|를|만|로|라|인|였|이|에|씩|다|일|임|입|의|보다|와)/u;
  function speechScope(text) {
    const quotes = [...text.matchAll(/[“"]([^“”"]+)[”"]/gu)].map(match => match[1]);
    // Without quotation marks, a calendar date right after the speaker belongs to the frame,
    // not the claim. A duration (3일 만에, 10일 넘게) is part of what is reported.
    const content = quotes.length ? quotes.join(', ')
      : text.replace(/^(\S+(?:\s\S+)?(?:은|는)\s+)(?:지난\s*)?(?:\d{4}년\s*)?(?:\d{1,2}월\s*)?\d{1,2}일(?!\s*(?:만|넘게|째|간|동안|이상|연속|가량|여|사이|내내|남짓|이내|안|뒤|후))\s+/u, '$1');
    // A projection may contain numbers. An observed fact in the same quote still needs evidence.
    const clauses = content.split(/[,;]|(?:였고|했고|됐고|었고|았고|이며|지만|으나|으며|이고)\s+/u).filter(part => part.trim());
    const hasForecast = clauses.some(part => forecast.test(part));
    const allNonfactual = clauses.length > 0 && clauses.every(part => {
      if (allegation.test(part)) return false;
      if (forecast.test(part)) return true;
      return hasAssessment(part) && !quantitative.test(part) && !eventFact.test(part);
    });
    // A date places a speech in time. An outside amount, allegation or event
    // ("의회가 3억 원을 삭감하자 시장은 …") can instead make an independent claim.
    // Remove the speaker's bare name and the final speech verb, not everything
    // after the quote: a second action or reported figure can follow it.
    const frame = quotes.length ? text.replace(/(?<!\S)[가-힣]+(?:은|는|이|가)\s+(?=[“"])/gu, '')
      .replace(/[“"][^“”"]+[”"]/gu, ' ')
      .replace(/[가-힣]+에(?:도|는)?\s+(?:찬성|반대)했다[.!?]?$/u, '').replace(reportingVerb, '') : '';
    const frameFact = allegation.test(frame) || eventFact.test(frame) || relativeQuantity.test(frame)
      || /\d(?:[\d.,]*\d)?\s*(?:[%％]|퍼센트|명|건|만|억|조|원|배|표|석|점|곳)/u.test(frame);
    return {hasForecast, allNonfactual: allNonfactual && !frameFact, quotes, frameFact};
  }
  const reportEnding = /^(?:고|이?라고|하고)\s*(?:말했다|밝혔다|주장했다|반박했다|설명했다|전했다|발표했다|강조했다|답했다|덧붙였다)[.!。！]?$/u;
  const multipleClaims = /(?:,(?!\d)|(?<!\d),)|[，、;；]|[.!。！]\s*\S|(?:[았었였했됐이하되]고|지만|으나|이며|으며|면서|는데|은데|반면)\s/u;
  const secondQuantity = /\d[\d.,]*\s*(?:[%％]|억|조|원|명|건|표|석|곳)[^.!?]{0,60}\s+[가-힣]+(?:은|는|이|가)\s+\d[\d.,]*\s*(?:[%％]|억|조|원|명|건|표|석|곳)/u;
  const nonAssertion = /[?？]|겠|(?:을|할|될|일)\s*(?:것|계획|방침|예정|전망)|약속(?:한|했|드)|(?:라면|다면|이면|경우에는)|해야\s*(?:한|합)/u;
  // Korean reports frequently omit the copula for a named, measured quantity.
  // A bare number, document title or noun phrase does not identify a proposition.
  const namedMeasurement = /[가-힣](?:은|는|이|가)\s+(?:[약총]\s*)?\d[\d,.]*\s*(?:천|만|억|조)?\s*(?:원|명|건|석|곳|표|개|[%％]|퍼센트)[.!。！]?$/u;
  const futurePeriod = /내년|내일|다음\s*(?:달|해|분기)/u;
  const recordedDecision = /(?:확정|의결|가결|승인|편성|기재|기록)(?:됐|되었|했|하였|되지\s*않았|하지\s*않았|(?:돼|되어)\s*있었?)(?:다|어요|습니다)(?:고\s*\S+다)?[.!。！]?$/u;
  function conflictClaim(original, text, scope) {
    const quote = /[“"]([^“”"]+)[”"]/u.exec(text);
    const marks = text.match(/[“”"]/gu) || [];
    const error = '화자가 직접 단정한 하나의 사실 진술만 대조하세요. 부인·질문·약속이거나 범위가 모호하면 발언 내용 미확인으로 남겨 주세요.';
    if (scope.allNonfactual || scope.frameFact || !attributed.test(original)) throw new Error(error);
    let assertion;
    if (marks.length) {
      if (marks.length !== 2 || !quote) throw new Error(error);
      const before = text.slice(0, quote.index).trim(), after = text.slice(quote.index + quote[0].length).trim();
      // The reporting tail must itself affirm this utterance. A final "밝혔다" alone
      // also matches "말한 적이 없다고 밝혔다", which reverses the inner quotation.
      if (!reportEnding.test(after) || /[?？]|다면|라면|조건으로|가정해/u.test(before)) throw new Error(error);
      assertion = quote[1].trim();
    } else {
      const reported = /^(.+(?:다|아니라))(고\s*[^\s]+[.!。！]?)$/u.exec(text);
      if (!reported || !reportEnding.test(reported[2]) || /(?:말|주장|밝|전|답|발언)(?:하지|하였|했|한|혔|힌|했다던)|(?:다고|라고)\s/u.test(reported[1])) throw new Error(error);
      assertion = reported[1];
    }
    // Only a complete declarative assertion can be contradicted as a whole.
    // Ignore commas and periods inside numbers when looking for a second claim.
    const declarative = /(?:다|[았었였했됐]어요|이에요|예요)[.!。！]?$/u.test(assertion) || namedMeasurement.test(assertion)
      || (!quote && assertion.endsWith('아니라'));
    if (!declarative || nonAssertion.test(assertion) || hasAssessment(assertion)
        || multipleClaims.test(assertion.replace(/(?<=\d)\.(?=\d)/gu, '')) || secondQuantity.test(assertion)) throw new Error(error);
    return quote ? assertion : original;
  }
  function contentFields(row, decision, catalog, speechIds) {
    const contentStatus = decision.contentStatus ?? 'unverified';
    if (!['unverified','opinion','supported','contradicted'].includes(contentStatus)) throw new Error('발언 내용의 검토 상태를 확인하세요.');
    if (contentStatus === 'unverified') return {contentStatus};
    if (decision.contentChecked !== true || !nonblank(decision.contentReason)) throw new Error('발언 내용의 범위와 판단 이유를 확인하세요.');
    const checkingConflict = contentStatus === 'contradicted';
    const scopedText = contentStatus !== 'opinion' ? row.text.replace(/[‘「『]/gu, '“').replace(/[’」』]/gu, '”')
      .replace(/(?<![A-Za-z])'([^'\n]+)'(?![A-Za-z])/gu, '“$1”') : row.text;
    const scope = speechScope(scopedText);
    if (contentStatus === 'opinion') {
      if (!scope.allNonfactual) throw new Error('발언에 남은 사실·의혹을 별도 근거로 확인하거나 내용 미확인으로 남겨 주세요.');
      return {contentStatus, contentChecked: true, contentReason: decision.contentReason};
    }
    if (scope.frameFact && contentStatus === 'supported') {
      throw new Error('인용 밖에도 확인할 사실이 있습니다. 발언 귀속만 기록하거나, 독립적으로 확인한 절이 있으면 ‘일부 사실만 확인’을 골라 그 구절을 지정하세요.');
    }
    const content = scope.quotes.length ? scope.quotes.join(' ') : scopedText;
    if (/(?:것으로|것이라(?:고)?|으로|로)\s*(?:추정|추산)(?:된|될|됐|했|하|한|되|됩)/u.test(content)) {
      throw new Error('추정치를 실제 확정된 수치로 판정하기 어려우면 내용 미확인으로 남기고, 자료가 제시한 수치의 성격을 기록하세요.');
    }
    if (scope.hasForecast || /일\s*것|일\s*전망|예측(?:한|했|이)|예상(?:이|하)|전망(?:이|하)/u.test(content)
        || (futurePeriod.test(content) && !recordedDecision.test(content))) {
      throw new Error('전망은 발언 당시의 예상으로 기록하세요. 실제 결과를 판단할 자료가 부족하면 내용 미확인으로 남겨 주세요.');
    }
    const closing = Math.max(scopedText.lastIndexOf('”'), scopedText.lastIndexOf('"'));
    const speechAct = closing < 0 ? scopedText : scopedText.slice(closing + 1);
    if (scope.quotes.length === 1 && reportEnding.test(speechAct.trim()) && endsInValueJudgment(scope.quotes[0])) {
      throw new Error('화자의 가치 판단은 의견으로 기록하고, 함께 언급된 사실은 범위를 구분해 확인하세요.');
    }
    if (/[?？]|겠(?:다|습니)|(?:인가요|일까요|나요|습니까)[.!]?$/u.test(content)
        || (closing >= 0 && /아니(?:라|었|냐)|사실이\s*아니/u.test(speechAct))
        || /(?:말한|주장한|발표한|발언한|밝힌)\s*(?:적|사실)(?:이|은)?\s*없|(?:말하|주장하|발표하|발언하|밝히)지\s*않|(?:부인했|물었|되물었|반문했|질문했|약속했)다/u.test(speechAct)) {
      throw new Error('부인·질문·약속의 원발언을 확인하고, 발언 속 표현을 독립된 사실로 단정하기 어려우면 내용 미확인으로 남겨 주세요.');
    }
    const contentClaim = checkingConflict ? conflictClaim(row.text, scopedText, scope) : null;
    const ids = decision.contentSourceIds;
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !catalog.items.has(id)) || new Set(ids).size !== ids.length) throw new Error('발언의 내용 자체를 확인한 별도의 원자료를 선택하세요.');
    const speech = speechIds.map(id => catalog.items.get(id));
    const speechDocuments = relatedDocuments(catalog, speech);
    const speechExcerpts = new Set(speech.map(excerptIdentity));
    for (const id of ids) {
      const source = catalog.items.get(id);
      if (speechDocuments.has(originAddress(source.url)) || speechExcerpts.has(excerptIdentity(source))) {
        throw new Error('발언과 다른 원자료가 필요합니다. 같은 문서, 그 문서를 재인용한 자료, 같은 발췌문은 발언 내용의 독립 근거가 될 수 없습니다.');
      }
    }
    return {contentStatus, contentChecked: true, contentReason: decision.contentReason, contentSourceIds: [...ids].sort(),
      ...(contentClaim ? {contentClaim} : {})};
  }
  function decisionFields(row, decision, catalog) {
    if (!decision || decision.acknowledged !== true) throw new Error('원문과 판단 범위를 직접 확인했다는 표시가 필요합니다.');
    if (!row.allowedStatuses.includes(decision.status)) throw new Error('이 구간의 발언·평가·사실 범위를 구분하는 처리를 선택하세요.');
    if (!nonblank(decision.reason)) throw new Error('판단 이유 또는 추가로 확인할 내용을 적으세요.');
    if (!Array.isArray(decision.sourceIds) || decision.sourceIds.some(id => !catalog.items.has(id)) || new Set(decision.sourceIds).size !== decision.sourceIds.length) throw new Error('목록에서 확인한 근거를 다시 선택하세요.');
    if (withEvidence.has(decision.status) && !decision.sourceIds.length) throw new Error('직접 확인한 원자료를 하나 이상 선택하세요.');
    const fields = {status: decision.status, sourceIds: [...decision.sourceIds].sort(), reason: decision.reason, acknowledged: true};
    if (fields.status === 'attribution') Object.assign(fields, contentFields(row, decision, catalog, fields.sourceIds));
    if (fields.status === 'contradicted' && decision.correction != null && decision.correction !== '') {
      if (!nonblank(decision.correction) || decision.correction.trim() === row.text.trim() || decision.correctionChecked !== true) {
        throw new Error('원문과 다른 정정 문구를 입력하고 근거가 정정 문구 전체를 지지하는지 확인하세요.');
      }
      fields.correction = decision.correction;
      fields.correctionChecked = true;
    }
    if (['partial','mixed'].includes(fields.status)) {
      const fact = strictSpan(row.text, decision.factSpan, '확인한 사실 구절');
      checkedClause(row.text, fact);
      fields.factSpan = decision.factSpan;
      if (fields.status === 'mixed') {
        const opinion = strictSpan(row.text, decision.opinionSpan, '평가 구절');
        if (fact.start < opinion.end && opinion.start < fact.end) throw new Error('사실과 평가 구절이 겹칩니다.');
        const gaps = outside(row.text, [fact, opinion].sort((a, b) => a.start - b.start));
        if (gaps.some(gap => gap.replace(/[\s\p{P}]/gu, '') !== '')) throw new Error('사실·평가 구절에 포함되지 않은 말이 있습니다. 두 구절에 포함하거나 부분 확인으로 남겨 주세요.');
        if (hasAssessment(decision.factSpan) && !hasAssessment(decision.opinionSpan)
          || !forecast.test(decision.opinionSpan) && (quantitative.test(decision.opinionSpan) || eventFact.test(decision.opinionSpan))) {
          throw new Error('평가로 표시한 구절에 확인할 사실이 있거나 사실과 평가 구절의 위치가 바뀌었습니다.');
        }
        fields.opinionSpan = decision.opinionSpan;
      } else {
        fields.remainingSpans = outside(row.text, [fact]);
        if (!fields.remainingSpans.some(span => /[\p{L}\p{N}]/u.test(span))) throw new Error('미확인 주장이 남는 구간을 구별하세요.');
      }
    }
    return fields;
  }
  function receiptBody(row, fields, recordedAt, catalog, binding = row.binding) {
    const linked = [...new Set([...fields.sourceIds, ...(fields.contentSourceIds ?? [])])].sort();
    const references = digest(linked.map(id => catalog.items.get(id)));
    return {protocol, rowId: row.id, articleBinding: row.articleBinding, binding, references, recordedAt, ...fields};
  }
  function decide(row, decision, sources = []) {
    const catalog = sourceCatalog(sources);
    if (!row || catalog.key !== row.sourceKey) throw new Error('근거가 달라졌습니다. 현재 자료로 항목을 다시 열어 주세요.');
    const fields = decisionFields(row, decision, catalog);
    const body = receiptBody(row, fields, new Date().toISOString(), catalog);
    return {...body, checksum: digest(body)};
  }
  function restore(row, candidates, catalog) {
    if (!candidates.length) return;
    if (candidates.length !== 1) {
      row.reviewNote = '같은 구간의 판단 기록이 여러 개입니다. 다시 확인하세요.';
      return;
    }
    const saved = candidates[0];
    if (saved.protocol !== protocol || saved.articleBinding !== row.articleBinding) {
      row.reviewNote = '이전 검토 뒤 기사 또는 근거 자료가 달라졌습니다.';
      return;
    }
    try {
      if (!nonblank(saved.recordedAt) || !Number.isFinite(Date.parse(saved.recordedAt))) throw new Error();
      const fields = decisionFields(row, saved, catalog);
      const body = receiptBody(row, fields, saved.recordedAt, catalog, saved.binding);
      if (saved.references !== body.references || digest(body) !== saved.checksum) throw new Error();
      if (saved.binding !== row.binding) {
        row.reviewNote = '기사와 인용 근거는 그대로지만 자료 목록이 달라졌습니다. 추가·변경된 근거를 확인한 뒤 다시 판단하세요.';
        row.priorDecision = {...body, checksum: saved.checksum};
        return;
      }
      row.receipt = {...body, checksum: saved.checksum};
      row.status = fields.status;
    } catch (_) { row.reviewNote = '기록의 문구·근거·판단을 대조할 수 없습니다. 다시 확인하세요.'; }
  }
  function prepare(article, sources = [], receipts = []) {
    if (typeof article !== 'string' || !Array.isArray(receipts)) throw new Error('기사 본문과 검토 기록의 형식을 확인하세요.');
    const catalog = sourceCatalog(sources);
    const articleKey = digest([protocol, article]);
    const scope = digest([articleKey, catalog.key]);
    const indexed = indexCatalog(catalog.items.values());
    const decisions = new Map();
    for (const receipt of receipts) {
      if (!receipt || typeof receipt.rowId !== 'string') continue;
      if (!decisions.has(receipt.rowId)) decisions.set(receipt.rowId, []);
      decisions.get(receipt.rowId).push(receipt);
    }
    const units = segments(article), groups = [];
    for (const unit of units) {
      const previous = groups.at(-1);
      const last = previous?.at(-1);
      const gap = last ? article.slice(last.end, unit.start) : '';
      if (last && last.text === unit.text && !attributed.test(unit.text) && !/[\r\n][ \t]*[\r\n]/u.test(gap)) previous.push(unit);
      else groups.push([unit]);
    }
    const rows = groups.map((group, i) => {
      const {text, start} = group[0];
      const positions = group.map(({start, end}) => ({start, end}));
      const before = groups[i - 1]?.at(-1) ?? group[0];
      const after = groups[i + 1]?.[0] ?? group.at(-1);
      const {candidates: sourceMatches, caution} = suggest(text, indexed);
      const row = {id: `unit-${start}`, text, positions, context: article.slice(before.start, after.end),
        articleBinding: digest([articleKey, positions]), priorDecision: null,
        binding: digest([scope, positions]), sourceKey: catalog.key, ...triage(text), sourceMatches,
        sourceCaution: (sourceMatches.length && sourceCaution(text, indexed)) || caution,
        sourceIds: sourceMatches.map(match => match.id), status: 'pending', receipt: null, reviewNote: ''};
      restore(row, decisions.get(row.id) ?? [], catalog);
      row.needsReview = unresolved.has(row.status) || row.receipt?.contentStatus === 'unverified';
      return row;
    });
    const count = state => rows.filter(row => row.status === state).length;
    const pendingCount = rows.filter(row => row.needsReview).length;
    const contentCount = state => rows.filter(row => row.receipt?.contentStatus === state).length;
    return {article, rows, pendingCount, complete: rows.length > 0 && pendingCount === 0,
      contentSupportedCount: contentCount('supported'), contentOpinionCount: contentCount('opinion'), contentUnverifiedCount: contentCount('unverified'),
      contentContradictedCount: contentCount('contradicted'),
      confirmedCount: count('fact'), attributedCount: count('attribution'), opinionCount: count('opinion'),
      mixedCount: count('mixed'), partialCount: count('partial'), heldCount: count('held'), contradictedCount: count('contradicted')};
  }

  const api = Object.freeze({prepare, decide, report: prepare, sourceTarget, digestValue: digest});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalFactcheck = api;
})(typeof window === 'undefined' ? globalThis : window);
