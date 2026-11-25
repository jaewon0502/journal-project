"""Build the offline coordinator kit for the controlled study and the field pilot."""
import argparse
from base64 import b64encode
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from build_editor_study_pack import versioned_packet as editor_participant_kit
from build_field_participant_packs import Assets, CASES, READER, ROOT, html, versioned_packet_pair


CASE_FOLDERS = {'cross-party-review': '예비비', 'labour-field-review': '고용'}
PRACTICE_SAMPLE = '연습 예시/고용률-판단이유-가상응답.json'
PARTIAL_GRADING_SAMPLE = '연습 예시/채점시간-일부누락-가상응답.json'
PARTY_LEDGER_SAMPLE = '연습 예시/정당별-결산표-이전-점수.json'
DISPUTE_FILES = {'editor-a.json': '연습 예시/핵심지출/편집자-A.json', 'editor-b.json': '연습 예시/핵심지출/편집자-B.json'}
QUOTE_PRACTICE = {
    'series-summary.json': '연습 예시/핵심발언/기사별-요약.json',
    'coordinator-case.json': '연습 예시/핵심발언/진행자용-대조기록.json'
}

START = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>진행자 집계 시작</title><link rel="stylesheet" href="editor-study.css"></head>
<body><main><h1>진행자 집계 시작</h1>
<p>집계도구.zip을 모두 풀고 이 파일을 브라우저로 여세요. 집계는 이 기기에서 진행합니다.
현장 기사의 원문을 대조할 때는 인터넷에 연결하세요. 실험 참여자에게는 배정한 참여자용 ZIP을 전달하세요.</p>
<section class="box"><h2>편집 시간과 정당 표기 효과</h2>
<ol><li><a href="editor-study.html">편집자 집계 화면 열기</a> → ‘실제 편집자 기록’ → ‘참여 기록 가져오기’에서 별도로 보관한 초대명부를 먼저 여세요.
첫 묶음의 기존 파일 이름은 <code>첫-4인-초대명부.json</code>입니다. 첫 명부가 없거나 기존 명부에 다음 네 명을 추가할 때는 ‘배정 묶음 발급’을 누르고 ‘모은 기록 내려받기’로 명부를 보관하세요.</li>
<li>‘다른 기기에서 참여할 초대 코드’를 펼쳐 새 코드를 발급하세요. 이번 판본의 참여자 ZIP은 한 번 내려받아 함께 씁니다. 각 행에서 그 사람의 참여 안내를 복사해 ZIP과 함께 개별 전달하세요. 새 코드는 지정한 판본을 열었을 때만 등록됩니다. 참여자는 압축을 풀어 <code>editor-study.html</code>에서 각자 네 과제를 진행합니다. 이 폴더에 동봉된 자료는 <a href="participant-editor-study.zip" download>편집자 비교 실험 참여자 ZIP</a>에서 다시 받을 수 있습니다.
<p>이 ZIP의 참여자 자료 식별값은 <code>{{EDITOR_KIT}}</code>입니다. 회신을 모은 뒤 ‘같은 참여자 자료를 사용한 묶음의 결과’에서 이 값과 일치하는 판본을 확인하세요.</p></li>
<li>돌아온 <code>journal-editor-….json</code> 파일을 ‘참여 기록 가져오기’로 엽니다. 등록·완료·분석 인원을 확인한 뒤 ‘모은 기록 내려받기’로 보관하세요. 네 명이 모두 네 과제를 마치면 첫 비교가 표시됩니다. 시간 차이를 볼 때는 같은 편집자들의 기준 판정 일치율과 대표 근거 일치율도 확인하세요.</li></ol>
<p><a href="editor-study.html">편집자 집계 화면</a>의 ‘가상 수치 예시’에서 ‘8명 · 빨리 끝냈지만 검증 성공은 줄어든 판본’을 고르면 사례당 평균 시간과 검증 성공 한 건에 쓴 시간을 비교할 수 있습니다. 미완료 묶음이 있다면 ‘8명 · 32건 중 한 건 미제출’에서 마지막 답에 따라 정당 표기 격차가 얼마나 달라지는지 확인하세요.</p>
<p>같은 자료를 고른 두 집단이 서로 다른 판정을 내린 경우도 살펴보세요. <a href="editor-study.html#demo-verdict-source">예산 기사의 판정과 근거 대조</a> ·
<a href="editor-study.html#demo-block-cue">두 묶음에서 정당 표기 차이가 상쇄된 예산 기사</a></p></section>
<section class="box"><h2>실제 기사에서 원자료 찾기</h2>
<ol><li><a href="field-allocation.html">현장 기사 과제 배정</a>에서 검토할 기사를 선택하세요. 같은 편집자의 두 방식을 비교하려면 ‘한 사람이 기사 두 건을 서로 다른 방식으로 검토’를 골라 기사별로 과제를 하나씩 정하세요. 교차 배정에서는 참여자마다 두 행이 생깁니다. 각 행의 순서에 맞춰 ZIP과 코드를 전달하세요.
과제별로 목표 활동 시간이 있으면 배정 전에 초 단위로 입력하세요. 참여 순서대로 익명 코드를 입력해 배정표를 만들고 배부 전에 JSON을 보관하세요.
각 참여자의 행에서 ‘코드 복사’를 누르고 같은 행의 ZIP을 내려받아 함께 전달하세요. 내장 기사의 배정 코드는 이 배포본에서 해당 기사와 방식이 일치할 때 과제를 엽니다. 다른 판본을 받았다면 배정표를 만들 때 사용한 진행자 ZIP에서 다시 받으세요.
<ul><li>예비비 기사 · <a href="참여 과제/예비비/예비비-평소도구.zip" download>평소 도구 ZIP</a> · <a href="참여 과제/예비비/예비비-저널.zip" download>저널 병행 ZIP</a></li>
<li>고용 기사 · <a href="참여 과제/고용/고용-평소도구.zip" download>평소 도구 ZIP</a> · <a href="참여 과제/고용/고용-저널.zip" download>저널 병행 ZIP</a></li></ul></li>
<li>참여자는 압축을 풀어 <code>field-review.html</code>을 열고 본인의 배정 코드를 확인합니다. 익명 코드와 과제 번호를 따로 받았다면 직접 입력합니다.
현업 편집자·팩트체커는 본인이 ‘현업 참여’를 선택합니다. ‘시간 측정 시작’을 누르면 검토할 문장과 기사 링크가 나타납니다. 완료하거나 중단하면 참여 기록을 내려받아 진행자에게 전달합니다. 저널 배정자는 과제를 수행하면서 직접 등록한 원자료 주소와 위치를 팩트체크 창에서 복사하거나 측정을 시작한 뒤 저장한 본인의 작업 파일에서 선택해 가져올 수 있습니다. 표·행과 판정 이유는 각자 확인해 작성합니다.
진행자가 이 압축의 참여 화면을 확인할 때는 <code>참여 과제</code> 폴더에서 해당 기사의 <code>blind-tasks.json</code>을 불러오세요.</li>
<li><a href="field-summary.html">현장 집계 화면 열기</a> → ‘진행자 기준 파일’에서 이 압축 안의
<code>채점표/예비비/coordinator-key.json</code> 또는 <code>채점표/고용/coordinator-key.json</code>을 고릅니다.
사전에 보관한 현장 배정표와 돌아온 참여 JSON을 각각 불러오고 ‘현업 참여’를 고르세요.</li>
<li>가능하면 두 방식의 답안을 한꺼번에 불러오세요. 참여 코드와 배정이 가려진 상태에서 제출한 표·행·열을 원자료와 대조해 채점합니다.
‘배정과 결과 보기’를 누르면 시간과 판정 품질이 나타납니다. 사전에 목표를 정했다면 ‘목표 시간 내 검증 성공률’에서 시간 안에 근거 위치와 판정을 모두 맞힌 건수도 보세요. 작업 중 끊긴 회신은 ‘중단 후 복원한 기록까지 포함한 활동 시간’에서 남아 있는 시간과 중도 종료 시간이 얼마인지 확인하세요. 답안을 덜 회수한 쪽이 빠르게 보이면 해당 과제의 ‘배정 전체의 검증 성공률’에서 미회수 결과가 비교를 얼마나 바꿀 수 있는지 확인하세요. 수정하려면 ‘배정 가리고 채점하기’를 누르세요.
‘다음 위치·판정 대조’를 누르면 채점이 남은 답안으로 이동합니다. 위치와 판정이 맞은 답안은 ‘다음 판단 이유 대조’에서 수치와 풀이까지 확인하세요. 두 기준의 시간 내 성공률을 나란히 볼 수 있습니다.
‘판정과 집계 기록 저장’으로 보관한 <code>field-grades-….json</code>은 다음에 같은 화면에서 다시 열 수 있습니다.</li></ol>
<p><a href="data:application/json;base64,{{PRACTICE_DATA}}" download="고용률-판단이유-가상응답.json">가상 답안 4건 내려받기</a> ·
<a href="field-summary.html" target="_blank" rel="noopener">새 집계 화면</a>에서 ‘참여 JSON 또는 이전 집계 JSON 불러오기’로 예시 파일을 여세요.
‘연습’을 고르고 ‘배정과 결과 보기’를 누르면 판단 이유까지 맞은 답안 한 건에 참여자와 진행자가 각각 몇 초를 썼는지 볼 수 있습니다. 두 역할의 시간은 모두 가상 값입니다.</p>
<p><a href="data:application/json;base64,{{PARTIAL_GRADING_DATA}}" download="채점시간-일부누락-가상응답.json">채점 시간이 일부 빠진 가상 답안 2건 내려받기</a> ·
같은 절차로 열면 참여자 평균은 60초에서 40초로 줄었지만 성공 한 건에 두 사람이 쓴 시간은 65초에서 최소 90초로 늘어난 사례가 나옵니다. ‘이 과제의 시간 비교표 HTML 저장’으로 숫자만 담은 파일을 열어 보세요.</p>
<details><summary>PDF 원문에서 후보가 있는 쪽 열기</summary>
<p>진행자가 원본 PDF와 같은 폴더에 <a href="prepare_pdf_source.py" download>검색 파일 변환 도구</a>를 저장합니다. Python 3.9 이상과 Poppler의 pdftotext가 있는 컴퓨터에서 <code>python3 prepare_pdf_source.py "원본.pdf"</code>를 실행하세요.</p>
<p><a href="factcheck.html">기사 팩트체크</a>에서 검토 목록을 만들고 ‘원자료 관리 → 원자료 본문에서 근거 구간 찾기 → 파일에서 원자료 불러오기’를 엽니다. 생성된 <code>.journal-source.json</code>과 원본 PDF를 차례로 고르세요. 검색 결과의 PDF 쪽 링크를 누르면 그 자리에서 원문을 대조할 수 있습니다. 발췌문을 옮긴 뒤 자료 주소를 확인하고 ‘확인한 PDF 쪽 입력’을 누르면 다음 편집자도 같은 PDF 판본과 쪽에서 근거를 열 수 있습니다. 검색 파일에는 자료 전문이 들어갑니다.</p></details>
<details id="deadline-example"><summary>목표 120초에서 검증 성공률이 뒤집히는 가상 예시</summary>
<p>15세 이상 고용률을 검증하는 과제입니다. 평소 도구를 쓴 두 명은 100초와 121초에 위치·판정·이유를 모두 맞혔습니다.
저널을 쓴 두 명은 각각 60초에 표와 판정을 맞혔지만, 판단 이유에는 15~64세 수치를 썼습니다.</p>
<table><caption>120초 안에 성공한 답안 / 원래 배정한 인원</caption><thead><tr><th scope="col">성공 기준</th><th scope="col">평소 도구</th><th scope="col">저널</th><th scope="col">차이</th></tr></thead>
<tbody><tr><th scope="row">근거 위치와 판정 일치</th><td>1/2</td><td>2/2</td><td>+50%p</td></tr>
<tr><th scope="row">판단 이유까지 일치</th><td>1/2</td><td>0/2</td><td>−50%p</td></tr></tbody></table></details></section>
<section class="box"><h2>기사의 정확성과 정치적 편향 비교</h2>
<ol><li><a href="factcheck.html">기사 팩트체크</a>에서 기사 입력을 확정하고 원자료를 등록하세요. ‘작업 파일 저장 · 이어 열기’에서 ‘독립 평가용 기사·자료 내려받기’를 누릅니다.</li>
<li>두 편집자에게 같은 기사·자료 JSON과 <a href="독립 기사 검토.zip" download>독립 기사 검토.zip</a>을 전달하세요. 각자 압축을 풀고 <code>factcheck.html</code>의 ‘파일 이어 열기’로 JSON을 연 뒤 문장 판정과 편향 평가를 기록합니다. 각자 저장한 작업 JSON은 따로 보관하세요.</li>
<li><a href="article-compare.html">기사 평가 비교</a>에서 ‘두 편집자의 평가’를 선택하고 각자의 작업 파일을 여세요.</li></ol>
<p><a href="article-compare.html#demo-core-dispute">학교 지출액의 판정이 갈린 근거 보기</a> · 공원과 학교에 같은 ‘20억 원’ 문장이 나옵니다. 두 편집자가 핵심으로 꼽은 학교 문장과 각자 인용한 결산서 쪽을 비교하세요.
개별 검토를 이어가려면 ‘파일 이어 열기’에서 <a href="연습 예시/핵심지출/편집자-B.json" download>편집자 B의 모의 작업 파일</a>을 열고 사실 정확성의 ‘핵심 5번’ 버튼을 누르세요.</p>
<p>두 정당에 같은 검증 기준을 적용했는지 연습하려면 <a href="factcheck.html">기사 검토 화면</a>에서
‘파일 이어 열기’로 <a href="연습 예시/정당별-결산표-이전-점수.json" download>정당별 결산표 모의 작업 파일</a>을 고르세요.
‘당사자에게 적용한 검증 기준’에서 두 근거가 왜 같은 당을 가리키는지 읽고 둘째 근거를 누리당의 집행액 행으로 바꿔 기록하세요.</p>
<h3>수정 전후를 가리고 평가하려면</h3>
<ol><li><a href="article-compare.html#blind-revision">판본을 가린 평가 준비</a>에서 수정 전 작업 파일을 왼쪽, 수정 후 파일을 오른쪽에 넣으세요. A·B 평가용 파일 두 개와 진행자용 대응표를 내려받으세요. 대응표는 진행자가 따로 보관하세요.</li>
<li>편집자별 폴더에 세 파일을 저장하고, 각자에게는 자기 A·B 파일과 <a href="독립 기사 검토.zip" download>독립 기사 검토.zip</a>을 전달하세요. 두 번째 편집자는 ‘다음 편집자용 A·B 만들기’로 새 묶음을 배정하세요. 서로 의견을 나누기 전에 각자 두 결과 파일을 저장합니다.</li>
<li>‘두 편집자의 결과 한꺼번에 열기’에서 작업 파일 4개와 대응표 2개를 선택하세요. 다른 폴더에 있으면 나눠서 추가하세요. 파일 6개가 모이면 같은 두 판본을 평가했는지 확인하고 결과가 열립니다. 판단이 갈린 구절이나 기준을 펼쳐 각자 선택한 원자료를 대조하세요.</li>
<li>‘기사별 평가 요약 저장’으로 기사마다 요약 한 개를 보관하세요. <a href="revision-series.html">여러 기사 개선율 집계</a>에서 편향 개선율과 공동 사실 판정 범위를 확인하세요. 수정본에 충돌 표시가 남았거나 원본에서 확인한 사실을 다시 대조해야 하면 해당 기사 이름을 누르세요. 작업 파일 4개와 대응표 2개를 열면 선택한 구절과 두 편집자의 근거가 나옵니다. 원본에서 두 사람이 반박한 구절은 정정 여부와 근거를 기록해 진행자 파일을 저장하세요. 여러 기사 화면의 ‘진행자가 대조한 정정 결과 집계’에 그 파일을 불러오면 정정 확인율과 대응 구절을 찾지 못한 건수를 따로 볼 수 있습니다.</li>
<li>‘같은 항목에서 본 중요한 왜곡’에서 원본과 수정본의 비율을 공통 개선율과 함께 확인하세요. 판단이 갈린 항목의 링크를 누르고 그 기사의 원래 파일을 열면, 해당 기준에 적은 두 편집자의 이유와 근거가 나옵니다.</li>
<li>원본 사실이 수정본에도 남았는지 직접 대조했다면 구절별 판단과 이유를 넣고 ‘진행자용 대조 파일 저장’을 누르세요. 다음에는 ‘두 편집자의 결과 한꺼번에 열기’에서 이 파일 하나로 이어갑니다. 이 파일에는 두 편집자의 원자료·미적용 초안과 진행자 대응표가 모두 들어갑니다.</li></ol>
<p><a href="article-compare.html#review={{QUOTE_REVIEW}}&amp;focus=core-context&amp;example=quote"><strong>가상 기사에서 바뀐 핵심 발언 대조하기</strong></a> ·
야당과 여당 의원의 발언을 대조하고 진행자 판단을 파일로 저장해 이어볼 수 있습니다. 집계 숫자부터 보려면
<a href="revision-series.html">여러 기사 개선율 집계</a>에서 <code>연습 예시/핵심발언/기사별-요약.json</code>을 여세요.
‘대응을 찾지 못한 원본 핵심 구절 1개 대조’를 누르고 같은 폴더의 <code>진행자용-대조기록.json</code>을 열면 원래 발언과 수정본을 읽을 수 있습니다.</p></section>
</main></body></html>
"""


def add_page(files, name, page):
    files[name] = page.encode()
    assets = Assets()
    assets.feed(page)
    for asset in assets.names:
        if Path(asset).name != asset:
            raise ValueError(f'집계 화면의 리소스 경로를 확인하세요: {asset}')
        files[asset] = (READER / asset).read_bytes()


def zip_bytes(files):
    buffer = BytesIO()
    with ZipFile(buffer, 'w') as archive:
        for name, data in sorted(files.items()):
            entry = ZipInfo(name, (2024, 1, 1, 0, 0, 0))
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, data, compress_type=ZIP_DEFLATED)
    return buffer.getvalue()


def field_practice_sample(*, partial_grading=False):
    key = json.loads((CASES / 'labour-field-review' / 'coordinator-key.json').read_text())
    task = next(item for item in key['tasks'] if item['id'] == 'labour-rate')
    basis = {**task, 'caseId': key['caseId'], 'articleUrl': key['articleUrl']}
    # A separate version keeps this worked example out of other practice cohorts.
    scenario = 'partial-grading-v1' if partial_grading else 'reason-comparison-v1'
    version = sha256(('journal-practice-only/labour-rate/' + scenario).encode()).hexdigest()
    correct = '분모는 15세 이상 인구다. 2023년 62.6%에서 2024년 62.7%로 0.1%포인트 올랐다.'
    wrong = '15~64세 인구에서 69.2%가 69.5%가 됐으므로 15세 이상 고용률이 0.1%포인트 올랐다.'
    entries = []
    responses = [('manual', correct, 5), ('journal', correct, 50)] if partial_grading else [
        ('manual', correct, 5), ('manual', correct, 5), ('journal', correct, 45), ('journal', wrong, 5)
    ]
    for i, (method, reason, grading_seconds) in enumerate(responses, start=1):
        trial = {
            'format': 'journal-field-trial-v1', 'id': f'practice-partial-grading-{i}' if partial_grading else f'practice-labour-reason-{i}',
            'participant': f'가상-부분채점-{i}' if partial_grading else f'가상-{i}', 'kind': 'practice', 'method': method,
            'caseId': key['caseId'], 'articleUrl': key['articleUrl'], 'taskId': task['id'],
            'prompt': task['prompt'], 'kitVersion': version, 'status': 'completed',
            'journalUse': 'yes' if method == 'journal' else 'no', 'recovered': False, 'split': True,
            'phaseMs': {'search': 30000 if method == 'manual' else 10000, 'locate': 20000, 'decide': 10000},
            'found': 'found', 'documentUrl': task['reference']['documentUrl'], 'locator': task['reference']['locator'],
            'verdict': 'supported', 'reason': reason
        }
        observation = {'id': sha256(('grading/' + trial['id']).encode()).hexdigest()[:32],
                       'ms': grading_seconds * 1000, 'status': 'complete', 'partial': partial_grading and method == 'journal'}
        entries.append({'trial': trial, 'basis': basis, 'expected': task['verdict'], 'locationGrade': 'yes',
                        'verdictGrade': 'yes', 'reasonGrade': 'no' if reason == wrong else 'yes',
                        'gradingTime': observation})
    return json.dumps({'format': 'journal-field-grades-v1', 'entries': entries}, ensure_ascii=False, indent=2).encode()


def packet_bytes():
    standalone = html('factcheck.html', 'journal', '')
    reviewer = {}
    add_page(reviewer, 'factcheck.html', standalone)
    practice = field_practice_sample()
    partial_grading = field_practice_sample(partial_grading=True)
    editor_edition, editor_zip = editor_participant_kit()
    # A data URL also downloads from a local file:// launch page in Chrome.
    start = START.replace('{{PRACTICE_DATA}}', b64encode(practice).decode('ascii')).replace('{{EDITOR_KIT}}', editor_edition)
    start = start.replace('{{PARTIAL_GRADING_DATA}}', b64encode(partial_grading).decode('ascii'))
    files = {**reviewer, '독립 기사 검토.zip': zip_bytes(reviewer),
             'participant-editor-study.zip': editor_zip, PRACTICE_SAMPLE: practice,
             PARTIAL_GRADING_SAMPLE: partial_grading,
             PARTY_LEDGER_SAMPLE: (CASES / 'party-ledger-review' / 'legacy-score.json').read_bytes(),
             'prepare_pdf_source.py': (ROOT / 'tools' / 'prepare_pdf_source.py').read_bytes()}
    for filename, destination in QUOTE_PRACTICE.items():
        files[destination] = (CASES / 'core-quote-revision' / filename).read_bytes()
    for filename, destination in DISPUTE_FILES.items():
        files[destination] = (CASES / 'core-spending-dispute' / filename).read_bytes()
    dispute = [json.loads(files[path]) for path in DISPUTE_FILES.values()]
    if not all(work['format'] == 'journal-local-factcheck-v1' and work['demo'] is True for work in dispute):
        raise ValueError('핵심 지출 대조 예시에는 두 편집자의 모의 작업 파일만 넣으세요.')
    case = json.loads(files[QUOTE_PRACTICE['coordinator-case.json']])
    if len(case['items']) != 6 or not all(item['data'].get('demo') is True for item in case['items']):
        raise ValueError('핵심 발언 연습에는 가상 기사 작업 파일과 가상 대응표만 넣으세요.')
    files['시작.html'] = start.replace('{{QUOTE_REVIEW}}', case['reviewId']).encode()
    files['factcheck.html'] = standalone.replace('</header>',
        '<nav aria-label="진행자 도구"><a href="article-compare.html">기사 평가 비교</a> · '
        '<a href="시작.html">진행자 시작 화면</a></nav></header>', 1).encode()
    for name in ('editor-study.html', 'field-summary.html', 'field-allocation.html', 'field-review.html', 'article-compare.html', 'revision-series.html'):
        page = (READER / name).read_text()
        if name == 'editor-study.html':
            stamp = f'<meta name="journal-editor-assigned-kit" content="{editor_edition}">'
            page = page.replace('</head>', stamp + '</head>', 1)
        if name in ('article-compare.html', 'revision-series.html'):
            page = page.replace('<a href="../article-rubric.md">상세 판정표와 집계식</a>',
                                '<a href="시작.html">진행자 시작 화면</a>')
        if name == 'article-compare.html':
            for element_id, data in [('quote-practice', case), ('core-dispute-practice', dispute)]:
                payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
                page = page.replace('</body>', f'<script id="{element_id}" type="application/json">{payload}</script></body>', 1)
        add_page(files, name, page)
    catalog = []
    for case, folder in CASE_FOLDERS.items():
        files[f'채점표/{folder}/coordinator-key.json'] = (CASES / case / 'coordinator-key.json').read_bytes()
        files[f'참여 과제/{folder}/blind-tasks.json'] = (CASES / case / 'blind-tasks.json').read_bytes()
        material = json.loads(files[f'참여 과제/{folder}/blind-tasks.json'])
        paths = {}
        edition, pair = versioned_packet_pair(case)
        for method, data in pair.items():
            label = '평소도구' if method == 'manual' else '저널'
            paths[method] = f'참여 과제/{folder}/{folder}-{label}.zip'
            files[paths[method]] = data
        catalog.append({'label': folder, 'material': material, 'files': paths, 'kitVersion': edition})
    payload = json.dumps(catalog, ensure_ascii=False, separators=(',', ':')).replace('<', r'\u003c')
    files['field-allocation.html'] = files['field-allocation.html'].replace(b'</body>',
        f'<script id="allocation-catalog" type="application/json">{payload}</script></body>'.encode(), 1)
    return zip_bytes(files)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path.home() / 'Downloads' / 'Journal-편집자-파일럿' / '진행자용')
    dest = parser.parse_args().output.expanduser().resolve() / '집계도구.zip'
    if dest.is_relative_to(ROOT):
        parser.error('저장소 밖의 진행자용 폴더를 지정하세요.')
    data = packet_bytes()
    dest.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=dest.parent, delete=False) as temp:
        temp.write(data)
    Path(temp.name).replace(dest)
    print(dest)
