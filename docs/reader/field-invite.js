// Match a coordinator's copyable assignment to the exact local material.
// The digest detects a mismatched packet; the separate coordinator roster establishes assignment.
(function (root) {
  'use strict';
  const keys = ['participant', 'caseId', 'articleUrl', 'taskId', 'prompt', 'method'];
  const validId = value => typeof value === 'string' && value.length > 0 &&
    value.length <= 64 && value === value.trim();
  const invalid = () => Error('진행자가 준 배정 코드 전체를 확인하세요.');

  function participantPart(id) {
    const bytes = new TextEncoder().encode(JSON.stringify(id));
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  }
  async function encode(row) {
    if (!validId(row?.participant) || !keys.every(k => typeof row[k] === 'string' && row[k].trim()) ||
        !['manual', 'journal'].includes(row.method)) throw Error('배정표의 참여 코드와 과제·방식을 확인하세요.');
    if (!root.crypto?.subtle) throw Error('이 브라우저에서 배정 코드를 확인할 수 없습니다. 직접 입력을 이용하세요.');
    const bytes = new TextEncoder().encode(JSON.stringify(keys.map(k => row[k])));
    const digest = new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes));
    const tag = Array.from(digest.subarray(0, 12), b => b.toString(16).padStart(2, '0')).join('');
    return 'F1.' + participantPart(row.participant) + '.' + tag;
  }
  async function match(code, pack, methods) {
    const parts = /^F1\.([A-Za-z0-9_-]{1,600})\.([a-f0-9]{24})$/u.exec(code);
    if (!parts) throw invalid();
    let participant;
    try {
      const binary = atob(parts[1].replaceAll('-', '+').replaceAll('_', '/'));
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      participant = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    } catch { throw invalid(); }
    if (!validId(participant) || participantPart(participant) !== parts[1]) throw invalid();
    const candidates = pack.tasks.flatMap(task => methods.map(method => ({
      participant, caseId:pack.caseId, articleUrl:pack.articleUrl, taskId:task.id, prompt:task.prompt, method
    })));
    const codes = await Promise.all(candidates.map(encode));
    const index = codes.indexOf(code);
    if (index < 0) throw Error('이 코드와 기사·과제·방식이 일치하지 않습니다. 진행자가 보낸 배포본을 확인하세요.');
    return candidates[index];
  }
  const api = {encode, match};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalFieldInvite = api;
})(globalThis);
