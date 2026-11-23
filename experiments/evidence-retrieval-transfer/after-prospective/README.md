# 수출입·소비자 피해구제 통계표 공개 후 재시험

2026년 11월 24일, 두 기관의 첫 시험 결과를 공개한 뒤 동일한 표와 질문으로 다시 측정했다. 관세청에서 놓친 두 행이 모두 첫 후보에 들었다. 표에 없는 측정값을 묻는 두 질문에는 빈 목록을 반환했다. [공동 시험 최초 결과](../prospective/result.json) · [재시험 문항별 결과](result.json)

| 지표 | 관세청 | 한국소비자원 | 합계 |
|---|---:|---:|---:|
| 첫 후보, 최초 → 재시험 | 1 → 3 | 3 → 3 | 4 → 6 |
| 상위 세 후보, 최초 → 재시험 | 1 → 3 | 3 → 3 | 4 → 6 |
| 별도 미수록 질문에서 후보가 나온 건수 | 1/1 → 0/1 | 1/1 → 0/1 | 2/2 → 0/2 |

같은 질문을 Chrome 검증 화면에 입력한 재시험에서도 정답이 있는 6문항 모두 첫 후보에 해당 원문 행이 보였고, 잘못된 유보 안내는 0건이었다. 표에 답이 없는 2문항은 모두 원표의 단위를 확인하라는 안내가 나타났고 보이는 후보는 0개였다. 이 두 문항의 사실 여부는 미결로 남았다. [Chrome 화면 재시험 문항별 기록](ui-retest.json)

관세청 2025년 1월 확정치에서 수출은 49,128백만 달러다. 질문에 잘못 인용된 50,988은 같은 달의 수입액이다. 검색기는 처음에 수입 행을 골랐고, 수정 후 수출 원행을 첫 후보로 돌려줬다. 수입의 전년 동기 대비 감소율 6.4%는 수입 금액 다음 행에 있다. 처음에는 연도와 월 머리글만 나왔고, 이번에는 7행이 첫 후보에 들었다. 문맥에 단위, 연도, 월, 상위 지표인 수입 행을 함께 제공한다. 편집자가 월별 열과 누계 열을 구별하고 부호를 확인해야 한다. [관세청 공식 보도자료](https://www.customs.go.kr/kcs/na/ntt/selectNttInfo.do?bbsId=1362&mi=2891&nttSn=10131214&nttSnUrl=0d6cf45ec0389ee7ade33c0e060bc107) · [배포 PDF 인쇄 1쪽 왼쪽 총괄표](https://www.kormia.co.kr/data/2025/03/7bf1d3b5c0d5fea6f0ea51485b8b6e8f.pdf)

관세청 표는 금액과 증감률을, 소비자원 표는 건수·인구 대비 건수·비율을 제공한다. 각각 질문한 수출 중량과 환급액 합계는 표에서 확인할 수 없다. 소비자원 표의 2023년 환급 비중, 2021년 교환 비중, 구제율 산식은 수정 전후 모두 첫 후보에서 찾았다. [국가지표체계 원표 F014701](https://www.index.go.kr/unity/potal/eNara/sub/showStblGams3.do?freq=Y&idx_cd=F0147&period=N&stts_cd=F014701)

검색기는 한 쪽 안에서 단위와 연도·월 머리글, 같은 수의 값이 반복되는 지표 행을 확인한다. 지표 이름의 조판용 공백은 검색할 때만 접고 발췌할 때는 그대로 돌려준다. 전월·전년 등 비교 기준이 같은 행을 그 바로 위 지표 묶음에서 찾는다. 표가 두 개이거나 중간에 별도 문장이 있으면 기존 일반 검색을 사용한다. 원자료에서 수작업으로 전사한 행을 대상으로 측정했으며, 셀 자동 판독, 기사 정확도, 실제 편집 시간, 정치 편향에는 점수를 매기지 않았다. [고정한 입력과 채점 기준](../prospective/holdout.json)

## 회귀 확인

기존 4세트의 첫 후보와 상위 세 후보는 각각 8/8, 10/10, 5/5, 5/5였다. 미수록 질문에서 후보가 나온 건수는 세트 순서대로 2/2, 3/4, 1/2, 0/2였다. 교통·선거, 산불, 독서율에서는 모든 문항의 후보 순서도 직전 판본과 같았다. 91쪽 고용동향에서는 기사 문장만 입력했을 때 1/3, 고정한 앞 문맥을 추가한 재검색에서 2/2였다. 그중 한 문항은 기사 발행일도 확인해야 한다. [회귀 문항별 원결과](regressions.json) · [직전 세 자료 재시험](../retest-51467c1e/README.md)

장비 대여·판매를 예로 든 별도 단위시험은 다른 지표에 같은 수치가 있는 경우, 전월과 전년 비교행이 연속한 경우, 빠진 달, 단위 불일치, 중간 설명문, 추가 주석, 서로 다른 두 표를 확인한다. 검색·기간·추세 모듈의 단위시험 39개와 당시 전체 테스트 178개가 통과했다. [단위시험](../../../tools/test_evidence_finder.cjs)

## 재현

저장소 루트에서 실행한다. 채점기는 고정한 표·질문, 기준선, 후보 검색기와 기간 모듈의 SHA-256을 확인한다. 마지막 세 명령은 교통·선거, 산불, 독서율을 각각 다시 채점한다.

```sh
candidate=experiments/evidence-retrieval-transfer/after-prospective/candidate.cjs
node experiments/evidence-retrieval-transfer/prospective/score.cjs "$candidate" c2f87284ab11685d7a0cd466afc99d1367326697e1a1a38a0f5b3774775be886 f0f05d007e9b377507105adcfeea8fec41074b7e4d94f43b8d23cd9fce29e64d
node experiments/evidence-retrieval-pilot/score.cjs "$candidate"
node experiments/evidence-retrieval-transfer/score.cjs "$candidate"
node experiments/evidence-retrieval-transfer/score.cjs "$candidate" --second
node experiments/evidence-retrieval-transfer/score.cjs "$candidate" --third
```
