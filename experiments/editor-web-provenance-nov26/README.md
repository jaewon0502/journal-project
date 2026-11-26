# 게시일을 본문과 함께 넘기면 판정이 달라지는가

보이저 1호의 네 기기가 **6월 13일 기준으로** 과학 자료를 보냈는지 확인하려면 기기 상태를 밝힌 문단과 그 발표의 게시일이 모두 필요했다. 이전 블라인드 판독에 사용한 주장 6개와 원자료 52개 단락에 NASA 페이지의 게시·수정 표시만 추가했다. 별도의 AI 판독자는 NASA 3번 단락과 게시 시각을 함께 인용했다. 전 판독자의 사전 기준 일치는 5/6, 이번 판독자는 6/6이었다. 서로 다른 AI가 이미 살펴본 사례를 읽은 결과다. 인간 편집자나 전체 기사의 정확도는 이 수치로 추정할 수 없다. [이전 판독과 사전 기준](../editor-holdout-20261126/README.md) · [이번 답안](dated-answers.json) · [NASA 발표](https://science.nasa.gov/missions/voyager-program/voyager-1/voyager-1-returning-science-data-from-all-four-instruments/)

## 파일에서 전달되는 정보

기사 팩트체크 화면에서 **원자료 관리 → 파일에서 원자료 불러오기**로 로컬에 저장한 UTF-8 HTML을 연다. 후보 문단을 원본과 대조해 발췌한 뒤 **확인한 웹문서 정보 입력**을 누르면 파일에 표시된 자료 이름·주소·게시/수정 정보가 입력된다. 위치와 사실 판정은 편집자가 결정한다. HTML 파일의 스크립트와 외부 리소스는 실행하지 않는다. 표의 행·열은 이 HTML 경로에서 생략한다. 숫자를 대조하려면 표를 머리글과 함께 붙여 넣거나 원본 PDF를 사용한다.

NASA 자료로 오프라인 Chrome 390px·1280px에서 같은 문단을 채택하고 동일한 작업 파일·독립 평가 파일을 저장했다. 아래 수치는 **발췌문이 이미 선택된 뒤 세 가지 서지 정보를 옮기는 구간**만 센다. 이전 화면에는 같은 본문을 넣고, 새 화면에는 저장한 HTML 파일을 열었다. 외부 사이트 열기·저장이나 편집자의 검증 시간은 측정하지 않았다.

| 세 가지 서지 정보를 옮기는 작업 | 이전 화면 | 새 화면 |
|---|---:|---:|
| 직접 입력하거나 붙여 넣은 필드 | 3개 | 0개 |
| 확인한 웹문서 정보를 적용하는 버튼 | 해당 없음 | 1회 |
| 작업·독립 평가 파일에 담긴 선택 근거 | 두 파일 모두 1개 | 두 파일 모두 1개 |

## 다른 게시자의 날짜 표시

날짜 규칙을 고친 뒤에 시험한 두 새 정책 페이지에서 MBC 뉴스의 게시일은 맞았고, 유럽연합 집행위원회 보도자료는 **게시일 확인 필요**로 남았다. 후자의 원문 머리말에는 날짜가 보인다. 자동 제안의 분모에는 이 페이지도 포함했다. [MBC 원문](https://imnews.imbc.com/replay/2024/nwdesk/article/6590964_36515.html) · [집행위원회 원문](https://digital-strategy.ec.europa.eu/en/news/european-artificial-intelligence-act-comes-force)

| 시험과 판본 | 기준 게시일과 일치 | 틀린 날짜 | 자동 제안 유보 |
|---|---:|---:|---:|
| 처음 보는 한국어 기사·영문 발표 6개, 첫 규칙 | 4/6 | 0 | 2 |
| 같은 6개, 해당 문서의 구조화 메타데이터와 게시 표지를 추가한 뒤 | 6/6 | 0 | 0 |
| 두 새 정책 페이지에서 같은 규칙을 처음 시험 | 1/2 | 0 | 1 |
| 관련 기사에 다른 문서의 날짜가 붙지 않도록 고친 최종판, 같은 6개 재시험 | 5/6 | 0 | 1 |
| 최종판, 정책 페이지 2개 재시험 | 1/2 | 0 | 1 |

기준은 페이지 머리말에 표시된 **달력 날짜**다. 뉴시스의 첫 규칙은 날짜가 맞았지만 수정 시간을 최초 게시 시간으로 제안했다. 다음 판본은 서로 다른 시각을 감지해 같은 날짜까지만 제안했다. 최종판에서는 한 파일 안의 여러 기사 중 제목과 본문의 연결을 확정할 수 없어 이 페이지를 수동 확인으로 넘긴다. 관련 기사의 본문이 본 기사의 제목·게시일에 붙는 사례는 별도 회귀 시험에 포함했다. [6개 페이지의 기준 위치](reference.json) · [최종 6개 결과](current.json) · [정책 페이지 2개 결과](current-fresh.json)

## 재현

아래 명령을 저장소 루트에서 실행한다. Git 히스토리, Node와 설치된 프로젝트 의존성, curl이 필요하다. 전체 HTML은 임시 폴더에서만 사용한다. 게시자의 원문이나 표시가 바뀌면 검산이 멈출 수 있다.

```sh
raw_dir="$(node experiments/editor-transfer-nov26/download.cjs)"
curl -fLsS --retry 1 'https://digital-strategy.ec.europa.eu/en/news/european-artificial-intelligence-act-comes-force' -o "$raw_dir/eu-ai.html"
exp=experiments/editor-web-provenance-nov26
node "$exp/replay.cjs" "$raw_dir" initial "$exp/initial.json"
node "$exp/replay.cjs" "$raw_dir" revised "$exp/retest.json"
node "$exp/replay.cjs" "$raw_dir" fresh "$exp/fresh.json"
node "$exp/replay.cjs" "$raw_dir" current "$exp/current.json"
node "$exp/replay.cjs" "$raw_dir" current-fresh "$exp/current-fresh.json"
nasa_dir="$(node experiments/editor-holdout-20261126/download.cjs)"
node "$exp/score-dated.cjs" "$nasa_dir"
```

선택한 문단과 날짜를 실제 Chrome에서 확인하려면 Playwright와 Google Chrome을 사용할 수 있는 환경에서 다음을 실행한다.

```sh
old_dir="$(mktemp -d)"
git archive 2e0e028e7552aa2f3f3e209783d5d436738aba5c docs/reader | tar -x -C "$old_dir"
node experiments/editor-web-provenance-nov26/browser.cjs "$nasa_dir" "$old_dir/docs/reader" docs/reader
```
