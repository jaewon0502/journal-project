// Match a coordinator's copyable assignment to the exact local material.
// The digest detects a mismatched packet; the separate coordinator roster establishes assignment.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && !!module.exports;
  const field = node ? require('./field-review-core.js') : root.JournalFieldReview;
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
    const values = keys.map(k => row[k]);
    const versioned = Object.hasOwn(row, 'assignedKitVersion');
    if (versioned) {
      if (!field.kitVersion(row.assignedKitVersion)) throw Error('배정표의 배포본 판본을 확인하세요.');
      values.push(row.assignedKitVersion);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(values));
    const digest = new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes));
    const tag = Array.from(digest.subarray(0, 12), b => b.toString(16).padStart(2, '0')).join('');
    return (versioned ? 'F2.' : 'F1.') + participantPart(row.participant) + '.' + tag;
  }
  async function match(code, pack, methods, kitVersion) {
    const parts = /^(F[12])\.([A-Za-z0-9_-]{1,600})\.[a-f0-9]{24}$/u.exec(code);
    if (!parts) throw invalid();
    const versioned = parts[1] === 'F2';
    const encodedId = parts[2];
    let participant;
    try {
      const binary = atob(encodedId.replaceAll('-', '+').replaceAll('_', '/'));
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      participant = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    } catch { throw invalid(); }
    if (!validId(participant) || participantPart(participant) !== encodedId) throw invalid();
    if (versioned && !field.kitVersion(kitVersion)) {
      throw Error('이 배정 코드는 배포본 판본을 확인해야 합니다. 진행자가 코드와 함께 보낸 ZIP을 풀고 그 안의 참여 화면을 여세요.');
    }
    const candidates = pack.tasks.flatMap(task => methods.map(method => ({
      participant, caseId:pack.caseId, articleUrl:pack.articleUrl, taskId:task.id, prompt:task.prompt, method
    })));
    const codes = await Promise.all(candidates.map(row => encode(versioned ? {...row, assignedKitVersion:kitVersion} : row)));
    const index = codes.indexOf(code);
    if (index < 0 && versioned) throw Error('이 코드와 과제·방식·배포본 판본이 일치하지 않습니다. 진행자가 코드와 함께 보낸 ZIP을 확인하세요.');
    if (index < 0) throw Error('이 코드와 기사·과제·방식이 일치하지 않습니다. 진행자가 보낸 배포본을 확인하세요.');
    return candidates[index];
  }
  const api = {encode, match};
  if (node) module.exports = api;
  else root.JournalFieldInvite = api;
})(globalThis);
