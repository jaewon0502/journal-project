/* Frozen, synthetic Korean case packets for the editor pilot. Both variants
   share the exact question, documents and gold. Only the political cue changes. */
(function (root) {
  'use strict';
  const cases = {
    transit: {
      title: '야간버스 조례 표결', question: '이 조례안이 본회의에서 찬성 7표로 가결됐는지 판단하세요.',
      claim: '의원모임 다온이 발의한 야간버스 조례안은 본회의에서 찬성 7표로 가결됐다.',
      docs: [
        ['교통위원회 심의록', '4월 3일 확정본', '제2안건', '다온이 발의한 야간버스 조례안을 본회의에 회부함. 위원회 표결은 찬성 4표, 반대 2표.'],
        ['본회의 의결록', '4월 8일 확정본', '제5안건 표결표', '야간버스 조례안. 발의자 다온. 출석 12명, 찬성 7표, 반대 4표, 기권 1표. 가결을 선포함.'],
        ['교통과 사업 설명서', '3월 21일 초안', '운행 계획', '야간 운행 대상 노선은 7개다. 사업 시행은 조례 의결 후 공포일부터 가능하다.']
      ], key: 'supported', anchor: 2
    },
    filing: {
      title: '사업비 자료 제출', question: '최종 자료가 지정한 기한보다 이틀 늦게 접수됐는지 판단하세요.',
      claim: '의원모임 해솔은 사업비 정산 자료를 지정한 기한보다 이틀 늦게 제출했다.',
      docs: [
        ['의회 사무국 최종 접수대장', '6월 14일 마감본', '정산자료 접수표 제18행', '제출자 해솔. 최종 자료 제출 기한 6월 10일, 실제 제출 및 접수 6월 12일. 기한 연장 없음. 지연 일수는 달력일로 계산한다.'],
        ['사전 검토 접수표', '6월 8일자', '검토용 파일 목록', '해솔이 사전 검토용 요약본을 6월 8일 냈다. 최종 정산 자료는 별도로 제출한다.'],
        ['자료 공개 일정', '6월 1일자', '공개 예정일', '의회 누리집에 모든 의원모임 자료를 공개하는 예정일은 6월 14일이다.']
      ], key: 'supported', anchor: 1
    },
    repair: {
      title: '주택 보수 예산', question: '올해 확정 예산이 지난해 확정 예산보다 20% 늘었는지 판단하세요.',
      claim: '의원모임 한울이 발의한 주택 보수 사업의 올해 확정 예산은 지난해보다 20% 늘었다.',
      docs: [
        ['예산 요구서', '9월 2일 요구안', '신청액', '한울이 발의한 주택 보수 사업에 올해 12억 원을 요구했다. 전년도 확정액은 10억 원이었다.'],
        ['예산안 부속 설명서', '10월 1일 심의안', '집행 실적', '지난해 실제 지출은 8억 원이다. 올해 집행 실적은 결산 뒤 공개한다.'],
        ['의결 예산 비교표', '12월 18일 확정본', '주택 보수 항목', '같은 범위의 확정 예산은 지난해 10억 원, 올해 11억 원이다. 발의자 한울. 추가경정분은 양쪽 모두 제외했다.']
      ], key: 'contradicted', anchor: 3
    },
    permits: {
      title: '인허가 처리 기간', question: '도시 전체의 평균 처리 기간이 절반으로 줄었는지 판단하세요.',
      claim: '의원모임 마루가 제안한 절차 개편 이후 시 전체의 평균 인허가 처리 기간은 절반으로 줄었다.',
      docs: [
        ['운영 계획', '2월 1일 시행안', '대상 구역', '시내에는 네 구역이 있다. 마루가 제안한 절차 개편을 한 구역에서 먼저 시험하고 확대 여부를 정한다.'],
        ['운영 결과표', '8월 31일 집계본', '표 2와 표 주석', '시범 구역의 평균 처리 기간은 시행 전 8일, 시행 후 4일이다. 다른 세 구역의 처리 일수와 건수, 시 전체 평균은 확보하지 못했다.'],
        ['민원 만족도 결과', '9월 1일 공개본', '설문 집계', '응답자 120명 중 72명이 절차에 만족한다고 답했다. 만족도 설문에서는 실제 처리 일수를 묻지 않았다.']
      ], key: 'insufficient', anchor: 2
    }
  };
  const labels = {A: '보수 성향', B: '진보 성향'};
  function get(caseId, variant) {
    if (!Object.hasOwn(cases, caseId) || !Object.hasOwn(labels, variant)) throw new Error('측정 과제 또는 표기가 올바르지 않습니다.');
    const item = cases[caseId];
    return {
      caseId, title: item.title, question: item.question, article: labels[variant] + ' ' + item.claim,
      sources: item.docs.map(([title, version, locator, excerpt], index) => ({
        id: 'doc-' + (index + 1), title, version, locator, excerpt,
        url: 'https://study.invalid/' + caseId + '/' + (index + 1)
      })),
      expectedVerdict: item.key, expectedSourceIds: ['doc-' + item.anchor]
    };
  }
  const api = Object.freeze({ids: Object.freeze(Object.keys(cases)), get});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalStudyCases = api;
})(globalThis);
