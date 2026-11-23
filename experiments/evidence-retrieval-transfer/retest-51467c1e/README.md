# 세 자료 재시험 · 2026년 11월 24일

각 표의 정답과 최초 결과를 확인한 후 같은 질의로 다시 측정했다. 각 행에서 화살표 왼쪽은 해당 표를 처음 본 검색기, 오른쪽은 같은 고정 판본으로 세 표를 다시 실행한 성적이다. 마지막 열은 정답이 없는 질문에서 후보를 한 개 이상 표시한 건수다.

| 자료 | 첫 후보 적중 | 상위 세 후보 적중 | 답 없는 질문의 후보 노출 |
|---|---:|---:|---:|
| [교통사고·선거투표율](road-vote.json) | 6/10 → 10/10 | 7/10 → 10/10 | 3/4 → 3/4 |
| [산불](forest.json) | 2/5 → 5/5 | 3/5 → 5/5 | 2/2 → 1/2 |
| [독서율](reading.json) | 1/5 → 5/5 | 2/5 → 5/5 | 2/2 → 0/2 |

검색기 SHA-256은 `51467c1eb7ecdb9b482a36267b88e3a72d50df93d8300e2dbf287b03c9682160`, 함께 읽는 기간 모듈은 `f0f05d007e9b377507105adcfeea8fec41074b7e4d94f43b8d23cd9fce29e64d`다. 저장소 루트에서 다음 명령을 실행하면 문항별 정답 위치와 실제 후보 순위가 출력된다. [검색기 고정본](../snapshots/final-51467c1e.cjs) · [기간 모듈 고정본](../snapshots/evidence-period.js)

```sh
node experiments/evidence-retrieval-transfer/score.cjs experiments/evidence-retrieval-transfer/snapshots/final-51467c1e.cjs
node experiments/evidence-retrieval-transfer/score.cjs experiments/evidence-retrieval-transfer/snapshots/final-51467c1e.cjs --second
node experiments/evidence-retrieval-transfer/score.cjs experiments/evidence-retrieval-transfer/snapshots/final-51467c1e.cjs --third
```
