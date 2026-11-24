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
현장 기사의 원문을 대조할 때는 인터넷에 연결하세요. 참여자에게는 아래에서 배정한 참여자용 ZIP만 전달하세요.</p>
<section class="box"><h2>편집 시간과 정당 표기 효과</h2>
<ol><li><a href="editor-study.html">편집자 집계 화면 열기</a> → ‘실제 편집자 기록’ → ‘참여 기록 가져오기’에서 별도로 보관한 초대명부를 먼저 여세요.
첫 묶음의 기존 파일 이름은 <code>첫-4인-초대명부.json</code>입니다. 첫 명부가 없거나 기존 명부에 다음 네 명을 추가할 때는 ‘배정 묶음 발급’을 누르고 ‘모은 기록 내려받기’로 명부를 보관하세요.</li>
<li>‘다른 기기에서 참여할 초대 코드’를 펼쳐 <code>participant-editor-study.zip</code>과 화면 순서대로 코드 하나씩을 네 명에게 전달하세요. 참여자는 압축을 풀어 <code>editor-study.html</code>에서 각자 네 과제를 진행합니다.</li>
<li>돌아온 <code>journal-editor-….json</code> 파일을 ‘참여 기록 가져오기’로 엽니다. 등록·완료·분석 인원을 확인한 뒤 ‘모은 기록 내려받기’로 보관하세요. 네 명이 모두 네 과제를 마치면 첫 비교가 표시됩니다.</li></ol></section>
<section class="box"><h2>실제 기사에서 원자료 찾기</h2>
<ol><li>예비비는 배포 폴더의 기본 위치, 고용은 <code>labour-field-review</code> 폴더에서 참여자용 ZIP을 고릅니다.
평소 도구는 <code>participant-manual.zip</code>, 저널 병행은 <code>participant-journal.zip</code>입니다.
예비비의 두 과제(<code>reserve-plan</code>, <code>reserve-settlement</code>) 또는 고용의 세 과제(<code>labour-growth</code>, <code>labour-rate</code>, <code>labour-period</code>)를 각각 두 방식에 한 번씩 배정하세요.
배정표를 섞고 같은 기사에서는 한 사람에게 한 과제만 줍니다. 참여자에게 해당 ZIP, 과제 번호, 본인의 익명 코드를 전달하세요.</li>
<li>참여자는 압축을 풀어 <code>field-review.html</code>을 열고 배정받은 과제 번호를 선택한 뒤 익명 코드를 입력합니다.
현업 편집자·팩트체커는 본인이 ‘현업 참여’를 선택합니다. ‘시간 측정 시작’을 누르면 검토할 문장과 기사 링크가 나타납니다. 완료하거나 중단하면 참여 기록을 내려받아 진행자에게 전달합니다.
진행자가 이 압축의 참여 화면을 확인할 때는 <code>참여 과제</code> 폴더에서 해당 기사의 <code>blind-tasks.json</code>을 불러오세요.</li>
<li><a href="field-summary.html">현장 집계 화면 열기</a> → ‘진행자 기준 파일’에서 이 압축 안의
<code>채점표/예비비/coordinator-key.json</code> 또는 <code>채점표/고용/coordinator-key.json</code>을 고릅니다.
‘참여 JSON 또는 이전 집계 JSON 불러오기’에서 돌아온 <code>field-….json</code>을 열고 ‘현업 참여’ 기록을 보세요.</li>
<li>가능하면 두 방식의 답안을 한꺼번에 불러오세요. 참여 코드와 배정이 가려진 상태에서 제출한 표·행·열을 원자료와 대조해 채점합니다.
‘배정과 결과 보기’를 누르면 시간과 판정 품질이 나타납니다. 수정하려면 ‘배정 가리고 채점하기’를 누르세요.
‘판정과 집계 기록 저장’으로 보관한 <code>field-grades-….json</code>은 다음에 같은 화면에서 다시 열 수 있습니다.</li></ol></section>
</main></body></html>
"""


def packet_bytes():
    files = {'시작.html': START.encode()}
    for name in ('editor-study.html', 'field-summary.html', 'field-review.html', 'factcheck.html'):
        # The study's Journal iframe needs the full fact-check page. Use the
        # standalone navigation for that page so it has no links outside the kit.
        page = html(name, 'journal', '') if name == 'factcheck.html' else (READER / name).read_text()
        files[name] = page.encode()
        assets = Assets()
        assets.feed(page)
        for asset in assets.names:
            if Path(asset).name != asset:
                raise ValueError(f'집계 화면의 리소스 경로를 확인하세요: {asset}')
            files[asset] = (READER / asset).read_bytes()
    for case, folder in CASE_FOLDERS.items():
        files[f'채점표/{folder}/coordinator-key.json'] = (CASES / case / 'coordinator-key.json').read_bytes()
        files[f'참여 과제/{folder}/blind-tasks.json'] = (CASES / case / 'blind-tasks.json').read_bytes()
    buffer = BytesIO()
    with ZipFile(buffer, 'w') as archive:
        for name, data in sorted(files.items()):
            entry = ZipInfo(name, (2024, 1, 1, 0, 0, 0))
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, data, compress_type=ZIP_DEFLATED)
    return buffer.getvalue()


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
