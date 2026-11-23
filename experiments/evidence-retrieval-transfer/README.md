# 다른 분야의 통계표에서 근거 찾기

두 공공 통계표에서 기사 속 주장을 확인할 행을 검색한다. 교통사고 표는 연도가 행에 있고 사고 건수·사망자 수·부상자 수가 열에 있다. 선거투표율 표는 성별·연령대가 행에 있고 선거 종류와 연도가 열에 있다. 같은 2022년이라도 대통령선거와 지방선거의 값은 다르다. [한국도로교통공단 교통사고분석시스템](https://taas.koroad.or.kr/sta/acs/gus/selectTfcacdTrend.do?menuId=WEB_KMP_OVT_TAC_TCO) · [국가지표체계 선거투표율 표, 중앙선거관리위원회 자료](https://index.go.kr/unity/potal/eNara/sub/showStblGams3.do?stts_cd=426801)

2026년 11월 24일 원표를 확인한 뒤 내려받는 순서대로 행을 옮겼다. 교통사고 표는 기본 조회 화면의 2018~2024년 7개 행과 두 줄 머리글을 사용했다. 선거투표율 표는 7개 연도·선거 열과 인구집단 8개 행, 두 개의 작성 주석을 선택했다. 선거투표율 표의 대선·총선·지선 머리글이 차지하는 열 수는 각각 3개·2개·2개다. [질의와 정답, 원문 위치](holdout.json)

## 채점

- **첫 후보 및 상위 세 후보 적중**은 값·반증·단위·정의를 확인할 수 있는 10문항 중 사전에 정한 행이 해당 순위에 든 건수다. 정답 행 앞뒤의 문맥은 적중에 넣지 않는다. 값이 같은 행 안에서 서로 다른 열에 있을 때에는 편집자가 선거 종류와 연도를 함께 확인해야 한다.
- **답 없는 경우의 후보 노출**은 해당 표에 측정변수가 없는 4문항을 따로 본다. 반환한 후보 수가 0인지 1개 이상인지를 기록한다. 후보를 본 편집자가 승인했는지 유보했는지는 측정하지 않았다.
- 질의·원문·정답·기준을 동결한 SHA-256은 `dd857b5953ad13d8203bc1b3eb414a7a64688e724c16c1f7dd740e29ea26b09e`다. 검색기는 각 문항과 그 문항에 지정한 원표 발췌만 입력받는다. 채점기는 후보 본문이 원문에서 반환한 위치와 정확하게 같은지도 확인한다.

## 처음 실행한 독립 시험

| 지표 | 기존 | 새 검색기 첫 실행 |
|---|---:|---:|
| 첫 후보가 정답 행 | 7/10 | 6/10 |
| 상위 세 후보에 정답 행 포함 | 7/10 | 7/10 |
| 답 없는 질문에서 후보 노출 | 3/4 | 3/4 |
| 답 없는 질문에서 후보 없음 | 1/4 | 1/4 |

2022년 교통사고 부상자 수(r2)를 묻는 질문은 보도에 적힌 283,799명이 맞는지 확인하는 문항이다. 원표의 2022년 값은 281,803명이다. 283,799명은 2023년 값이다. 기존에는 2022년 행이 먼저 나왔으나 새 검색기의 첫 실행에서는 2023년 행이 1위, 2022년 행이 2위였다. 두 버전 모두 두 번째 단위 머리글(r4), 남자 행(v2), 투표율의 분모를 명시한 주석(v4)은 상위 세 후보에서 빠졌다. [최초 독립 평가 전체 순위](candidate-first.json)

첫 실행에서 검색기 파일의 SHA-256은 `2db82c02f6723458e597869b6de590f75d3e3dcb6e0c481b9199f4b157659209`, 그 검색기가 읽는 기간 모듈은 `f0f05d007e9b377507105adcfeea8fec41074b7e4d94f43b8d23cd9fce29e64d`이다. 최초 출력의 SHA-256은 `b3df819d8d3ebf2add090b250718d066e4076153ee86ca3883ca4867db4e21cb`이다. 결과를 공개한 뒤 같은 질의로 다시 측정한 값은 이 결과와 구분한다.

## 수정 후 재시험과 둘째 자료의 첫 시험

첫 자료의 누락과 순위 하락을 공개한 뒤 검색기를 수정했다. 같은 두 표를 다시 검색하니 10/10이 첫 후보에 나왔다. 이 10개는 이미 개선 과정에 쓰인 질의이므로 최초 독립 성적 6/10은 그대로 보관한다. [같은 두 표의 재시험 순위](retest.json)

다음 수정 전에 새로운 기관의 표를 따로 선정했다. [산림청 『2025년 산불 제대로 알기』 인쇄 11쪽](https://huyang.forest.go.kr/kfs/images/data/down/sb_1_02.pdf)의 연도별 산불 발생 건수·피해 면적 10년 표가 대상이다. PDF와 표를 대조했으며, 2024년 피해 면적은 표 표시값 123ha로 고정했다. 본문에서는 소수점까지 123.27ha로 제시한다. 자료 해시는 `26eb0623ebfd042a24fbf3bde19e88a81f578118d8222abcc33f22e1829f381c`다. [두 번째 질의와 정답](second/holdout.json)

| 서로 다른 평가 대상 | 기존 첫 후보 / 상위 3 | 수정 후 첫 후보 / 상위 3 | 답 없는 경우 후보 노출 |
|---|---:|---:|---:|
| 교통사고·선거투표율 10개, 공개 후 재시험 | 7/10 · 7/10 | 10/10 · 10/10 | 두 버전 모두 3/4 |
| 산불통계표 5개, 독립 첫 시험 | 3/5 · 3/5 | 2/5 · 3/5 | 두 버전 모두 2/2 |

산불통계표에서도 2022년 피해 면적을 검증하면서 2023년 값(4,992ha)을 잘못 인용한 문항에서 해당 금액이 있는 이듬해 행이 1위에 올랐다. 정답인 2022년 행(24,797ha)은 2위였다. 단위가 있는 머리글과 10년 평균 행도 상위 세 개에서 빠졌다. 동일한 종류의 오류를 다른 공식 표에서 다시 발견한 결과다. [산불표 기준선](second/baseline.json) · [산불표 최초 독립 결과](second/candidate-first.json)

수정 검색기의 해시는 `356496ce122f013cfbb12015281ece4a961fccd0a190fdaaebbc84b9662855a1`이다. 기간 모듈 해시는 첫 검색 버전과 같다. 두 개 표본의 분모와 최초 측정·재시험 결과를 각각 유지한다.

## 세 번째 독립 시험과 전체 성적

마지막 검색기 버전이 고정될 때까지 문화체육관광부의 2023년 독서실태 표는 어느 검색기에도 입력하지 않았다. 보도자료 5쪽 **매체별·연령대별 독서율(성인)** 표 전체에서 `pdftotext -layout`이 실제로 내놓은 공백, 세로쓰기로 나뉜 글자, 종이책·전자책·오디오북·종합마다 반복되는 2019·2021·2023년 열을 보존했다. 원 PDF와 렌더링 화면으로 실제 행을 대조했다. [문화체육관광부 보도자료와 원본 PDF](https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pSeq=21011) · [세 번째 시험의 원문과 정답](third/holdout.json)

| 정답 문항 | 기준선 첫 후보 / 상위 3 | 각 자료의 첫 독립 시험, 첫 후보 / 상위 3 | 마지막 버전, 첫 후보 / 상위 3 |
|---|---:|---:|---:|
| 교통사고·선거투표율 10개 | 7/10 · 7/10 | 6/10 · 7/10 | 10/10 · 10/10 (재시험) |
| 산불 발생·피해 5개 | 3/5 · 3/5 | 2/5 · 3/5 | 5/5 · 5/5 (재시험) |
| 매체별·연령대별 독서율 5개 | 1/5 · 2/5 | 1/5 · 2/5 | 1/5 · 2/5 (첫 시험) |
| **합계 20개** | **11/20 · 12/20** | **9/20 · 12/20** | **16/20 · 17/20** |

첫 독립 시험 열은 개발 과정 중 서로 다른 세 버전이 각자 처음 본 자료에서 낸 결과다. 상위 3 적중은 12/20으로 기준선과 같고, 첫 후보 적중은 11/20에서 9/20으로 낮았다. 마지막 버전은 앞서 공개된 15개를 전부 첫 후보에 올렸지만, 마지막 5개 중에는 1개만 첫 후보로, 2개만 상위 세 후보로 올렸다. 답 없는 8개 질문에서 검색기가 후보를 하나라도 반환한 건수는 기준선 7/8, 각 자료 첫 실행 7/8, 마지막 버전 6/8이다. [첫 자료 최종 재시험](final-retest.json) · [산불표 최종 재시험](second/retest.json) · [독서율 기준선](third/baseline.json) · [독서율 최초 독립 결과](third/candidate-first.json)

독서율 표는 60세 이상 행, 성인 전체 행, 괄호 속 증감의 뜻을 적은 단위 줄을 두 버전 모두 놓쳤다. 원자료 자체에도 불일치가 있다. 문체부 보도자료 제목은 2023년 성인 종합독서율을 43.0%로 발표했지만, 5쪽 표의 ‘전체’ 행과 ‘종합 2023’ 열이 만나는 칸에는 47.5(-4.5)가 인쇄돼 있다. 원 조사 보고서의 그림 2-7은 2021년 47.5%, 2023년 43.0%로 표시하고, 표 2-17도 2023년 성인 5,000명의 종합독서율을 43.0%로 보고한다. 따라서 이 수치를 인용할 때에는 조사 보고서의 표를 근거로 삼을 수 있다. 문제가 된 보도자료 표의 칸은 동결한 채점 대상에 없었다. ‘전체’ 행을 정답으로 쓰는 다른 문항은 2019년 **종이책** 열을 묻는다. [문체부 원문과 첨부 PDF](https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pSeq=21011) · [국회도서관에 수록된 원 조사 보고서](https://clik.nanet.go.kr/clikr-collection/policyinfo/226/1074/2024/CLIKC1748527459366069_attach_1.pdf)

## 자료가 답하지 못하는 질문을 화면에서 구분하는지

교통사고·선거투표율의 미수록 질문 4개를 Chrome에서 입력했다. 3개는 연도나 연령대가 겹쳐 검색기가 후보를 반환했다. 화면에서는 세 경우 모두 후보 문장을 접어 두고, 어떤 단위나 설명 항목을 원자료에서 확인하지 못했는지 먼저 알렸다. 나머지 1개는 검색 후보도 없었고 입원 일수가 없다는 안내가 보였다. 답이 있는 질문 10개에는 이런 안내가 뜨지 않았고, 위에서 공개한 뒤 재시험한 10개 정답 행이 첫 후보로 보였다. 이 결과는 자료가 부족하다는 경고 노출 4/4와 기본 원문 노출 0/4를 뜻한다. 실제 편집자의 유보나 기사 정확도는 측정하지 않았다. [화면 지표 사전 기준](ui-rule.json) · [Chrome의 실제 문구와 후보 상태](ui-first.json)

## 다단 표 보완 이후

연령·매체가 여러 열로 나뉜 독서율 표를 보완한 뒤 앞선 20문항을 같은 버전으로 다시 측정했다. 첫 후보에 지정 행이 나온 횟수는 20/20이었다. 이후 관세청·한국소비자원 자료와 질문 6개를 함께 고정해 그 버전을 처음 시험했다. 첫 후보는 기준선 3/6에서 4/6, 상위 세 후보는 4/6에서 4/6이었다. 관세청에서 놓친 수출액·수입 감소율을 보완한 다음 같은 질문을 다시 실행한 결과는 6/6이었다. [기존 20문항 재시험](retest-51467c1e/README.md) · [두 기관의 공동 최초 시험](prospective/README.md) · [후속 수정과 재시험](after-prospective/README.md)

## 재현

프로젝트 최상위에서 아래 명령을 실행한다.

```sh
node experiments/evidence-retrieval-transfer/score.cjs experiments/evidence-retrieval-transfer/baseline-finder.cjs
node experiments/evidence-retrieval-transfer/score.cjs docs/reader/evidence-finder.js
node experiments/evidence-retrieval-transfer/score.cjs experiments/evidence-retrieval-transfer/baseline-finder.cjs --second
node experiments/evidence-retrieval-transfer/score.cjs docs/reader/evidence-finder.js --second
node experiments/evidence-retrieval-transfer/score.cjs experiments/evidence-retrieval-transfer/baseline-finder.cjs --third
node experiments/evidence-retrieval-transfer/score.cjs docs/reader/evidence-finder.js --third
```

최초 독립 측정 세 번을 당시 코드로 다시 실행하려면 아래 명령을 사용한다. 세 사본이 공통으로 읽는 기간 모듈도 함께 보관했다.

```sh
node experiments/evidence-retrieval-transfer/score.cjs experiments/evidence-retrieval-transfer/snapshots/first.cjs
node experiments/evidence-retrieval-transfer/score.cjs experiments/evidence-retrieval-transfer/snapshots/second.cjs --second
node experiments/evidence-retrieval-transfer/score.cjs experiments/evidence-retrieval-transfer/snapshots/third.cjs --third
```

기준선 명령은 변경 직전 사본(파일 SHA-256 `90921959ada13a036f5ad1e1051f1bc25ed0f1b80a8aca4501f10090167af86e`)을 사용한다. [기준선의 문항별 결과](baseline.json)

Chrome과 Playwright를 사용할 수 있으면 `node experiments/evidence-retrieval-transfer/observe-ui.cjs docs/reader`로 첫 두 표의 화면 지표를 다시 확인할 수 있다. 최초 실행 기록은 각 결과 파일에 적힌 버전의 측정치다.
