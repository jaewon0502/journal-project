"""Build the offline coordinator kit for the controlled study and the field pilot."""
import argparse
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from build_field_participant_packs import Assets, CASES, READER, ROOT, html


CASE_FOLDERS = {'cross-party-review': '예비비', 'labour-field-review': '고용'}

START = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>진행자 집계 시작</title><link rel="stylesheet" href="editor-study.css"></head>
<body><main><h1>진행자 집계 시작</h1>
<p>집계도구.zip을 모두 풀고 이 파일을 브라우저로 여세요. 집계는 이 기기에서 진행합니다.
현장 기사의 원문을 대조할 때는 인터넷에 연결하세요. 실험 참여자에게는 배정한 참여자용 ZIP을 전달하세요.</p>
<section class="box"><h2>편집 시간과 정당 표기 효과</h2>
<ol><li><a href="editor-study.html">편집자 집계 화면 열기</a> → ‘실제 편집자 기록’ → ‘참여 기록 가져오기’에서 별도로 보관한 초대명부를 먼저 여세요.
첫 묶음의 기존 파일 이름은 <code>첫-4인-초대명부.json</code>입니다. 첫 명부가 없거나 기존 명부에 다음 네 명을 추가할 때는 ‘배정 묶음 발급’을 누르고 ‘모은 기록 내려받기’로 명부를 보관하세요.</li>
<li>‘다른 기기에서 참여할 초대 코드’를 펼쳐 <code>participant-editor-study.zip</code>과 화면 순서대로 코드 하나씩을 네 명에게 전달하세요. 참여자는 압축을 풀어 <code>editor-study.html</code>에서 각자 네 과제를 진행합니다.</li>
<li>돌아온 <code>journal-editor-….json</code> 파일을 ‘참여 기록 가져오기’로 엽니다. 등록·완료·분석 인원을 확인한 뒤 ‘모은 기록 내려받기’로 보관하세요. 네 명이 모두 네 과제를 마치면 첫 비교가 표시됩니다.</li></ol></section>
<section class="box"><h2>실제 기사에서 원자료 찾기</h2>
<ol><li><a href="field-allocation.html">현장 기사 과제 배정</a>을 열고 이 압축 안의 <code>참여 과제/예비비/blind-tasks.json</code> 또는 <code>참여 과제/고용/blind-tasks.json</code>을 고르세요.
참여 순서대로 익명 코드를 입력해 배정표를 만들고 배부 전에 JSON을 보관하세요.
예비비는 기본 배포 폴더, 고용은 <code>labour-field-review</code> 폴더에 참여자 ZIP이 있습니다.
각 행의 ‘코드 복사’를 눌러 참여자에게 본인의 배정 코드와 해당 ZIP을 전달합니다.</li>
<li>참여자는 압축을 풀어 <code>field-review.html</code>을 열고 본인의 배정 코드를 확인합니다. 익명 코드와 과제 번호를 따로 받았다면 직접 입력합니다.
현업 편집자·팩트체커는 본인이 ‘현업 참여’를 선택합니다. ‘시간 측정 시작’을 누르면 검토할 문장과 기사 링크가 나타납니다. 완료하거나 중단하면 참여 기록을 내려받아 진행자에게 전달합니다.
진행자가 이 압축의 참여 화면을 확인할 때는 <code>참여 과제</code> 폴더에서 해당 기사의 <code>blind-tasks.json</code>을 불러오세요.</li>
<li><a href="field-summary.html">현장 집계 화면 열기</a> → ‘진행자 기준 파일’에서 이 압축 안의
<code>채점표/예비비/coordinator-key.json</code> 또는 <code>채점표/고용/coordinator-key.json</code>을 고릅니다.
사전에 보관한 현장 배정표와 돌아온 참여 JSON을 각각 불러오고 ‘현업 참여’를 고르세요.</li>
<li>가능하면 두 방식의 답안을 한꺼번에 불러오세요. 참여 코드와 배정이 가려진 상태에서 제출한 표·행·열을 원자료와 대조해 채점합니다.
‘배정과 결과 보기’를 누르면 시간과 판정 품질이 나타납니다. 수정하려면 ‘배정 가리고 채점하기’를 누르세요.
‘판정과 집계 기록 저장’으로 보관한 <code>field-grades-….json</code>은 다음에 같은 화면에서 다시 열 수 있습니다.</li></ol></section>
<section class="box"><h2>기사의 정확성과 정치적 편향 비교</h2>
<ol><li><a href="factcheck.html">기사 팩트체크</a>에서 기사 입력을 확정하고 원자료를 등록하세요. ‘작업 파일 저장 · 이어 열기’에서 ‘독립 평가용 기사·자료 내려받기’를 누릅니다.</li>
<li>두 편집자에게 같은 기사·자료 JSON과 <a href="독립 기사 검토.zip" download>독립 기사 검토.zip</a>을 전달하세요. 각자 압축을 풀고 <code>factcheck.html</code>의 ‘파일 이어 열기’로 JSON을 연 뒤 문장 판정과 편향 평가를 기록합니다. 각자 저장한 작업 JSON은 따로 보관하세요.</li>
<li><a href="article-compare.html">기사 평가 비교</a>에서 ‘두 편집자의 평가’를 선택하고 각자의 작업 파일을 여세요.</li></ol>
<h3>수정 전후를 가리고 평가하려면</h3>
<ol><li><a href="article-compare.html#blind-revision">판본을 가린 평가 준비</a>에서 수정 전 작업 파일을 왼쪽, 수정 후 파일을 오른쪽에 넣으세요. A·B 평가용 파일 두 개와 진행자용 대응표를 내려받으세요. 대응표는 진행자가 따로 보관하세요.</li>
<li>편집자별 폴더에 세 파일을 저장하고, 각자에게는 자기 A·B 파일과 <a href="독립 기사 검토.zip" download>독립 기사 검토.zip</a>을 전달하세요. 두 번째 편집자는 ‘다음 편집자용 A·B 만들기’로 새 묶음을 배정하세요. 서로 의견을 나누기 전에 각자 두 결과 파일을 저장합니다.</li>
<li>같은 편집자가 돌려준 두 파일과 대응표를 진행자 화면에 열고 ‘순서 복원하고 비교’를 누르세요. ‘첫 편집자 결과로 선택’을 누른 뒤 둘째 편집자의 두 파일과 대응표를 여세요. 두 사람 모두 개선됐다고 평가한 항목과 판단이 갈린 항목을 확인하고, 해당 기준을 펼쳐 선택한 기사 구절과 원자료를 대조하세요.</li>
<li>‘기사별 평가 요약 저장’으로 기사마다 요약 한 개를 보관하세요. <a href="revision-series.html">여러 기사 개선율 집계</a>에서 요약들을 함께 열면 전체와 항목별 건수, 개선·악화율을 확인할 수 있습니다.</li></ol></section>
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


def packet_bytes():
    standalone = html('factcheck.html', 'journal', '')
    reviewer = {}
    add_page(reviewer, 'factcheck.html', standalone)
    files = {**reviewer, '독립 기사 검토.zip': zip_bytes(reviewer), '시작.html': START.encode()}
    files['factcheck.html'] = standalone.replace('</header>',
        '<nav aria-label="진행자 도구"><a href="article-compare.html">기사 평가 비교</a> · '
        '<a href="시작.html">진행자 시작 화면</a></nav></header>', 1).encode()
    for name in ('editor-study.html', 'field-summary.html', 'field-allocation.html', 'field-review.html', 'article-compare.html', 'revision-series.html'):
        page = (READER / name).read_text()
        if name in ('article-compare.html', 'revision-series.html'):
            page = page.replace('<a href="../article-rubric.md">기사 평가 기준과 계산식</a>',
                                '<a href="시작.html">진행자 시작 화면</a>')
        add_page(files, name, page)
    for case, folder in CASE_FOLDERS.items():
        files[f'채점표/{folder}/coordinator-key.json'] = (CASES / case / 'coordinator-key.json').read_bytes()
        files[f'참여 과제/{folder}/blind-tasks.json'] = (CASES / case / 'blind-tasks.json').read_bytes()
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
