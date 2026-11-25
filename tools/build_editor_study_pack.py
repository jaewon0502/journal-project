"""Build the offline participant kit for the four-person editor experiment."""
import argparse
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import re
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from build_field_participant_packs import Assets, READER, ROOT, html


def public_cases():
    # Project only material the participant sees. Never copy the coordinator's
    # case objects or hidden properties into the ZIP, even if a future field is added.
    project = """
const cases = require(process.argv[1]);
const material = Object.fromEntries(cases.ids.map(id => [id, Object.fromEntries(['A','B'].map(label => {
  const {caseId, title, question, article, sources} = cases.get(id, label);
  const docs = sources.map(({id,title,version,locator,excerpt,url}) => ({id,title,version,locator,excerpt,url}));
  return [label, {caseId, title, question, article, sources:docs}];
}))]));
process.stdout.write(JSON.stringify(material));
"""
    contents = subprocess.check_output(['node', '-e', project, str(READER / 'editor-study-cases.js')], text=True)
    return """(function () {
  'use strict';
  const cases = """ + contents + """;
  globalThis.JournalStudyCases = Object.freeze({
    ids: Object.freeze(Object.keys(cases)),
    get(id, variant) {
      const item = cases[id][variant];
      return {...item, sources:item.sources.map(source => ({...source}))};
    }
  });
})();
"""


def participant_core():
    # Share the exact planner, submission validation and merge rules, stopping
    # before the first coordinator-only function (block analysis and example data).
    source = (READER / 'editor-study-core.js').read_text()
    core, marker, analysis = source.partition('  function blockRoster(records) {')
    if not marker or 'function demoRecords()' not in analysis or 'function mergeRecords(' not in core:
        raise ValueError('편집자용 코어와 진행자 집계 코드의 경계를 다시 확인하세요.')
    return core + '  return Object.freeze({protocol, stages, plan, createRecord, addTrial, validateRecord, mergeRecords, kitVersion, parseInvite});\n});\n'


def participant_ui():
    source = (READER / 'editor-study-ui.js').read_text()
    shared, *sections = source.split('  // coordinator-only:begin\n')
    end = '  // coordinator-only:end\n'
    if not sections or end in shared or any(section.count(end) != 1 for section in sections):
        raise ValueError('편집자 실험 화면의 진행자 전용 코드 경계를 확인하세요.')
    return shared + ''.join(section.partition(end)[2] for section in sections)


def participant_page():
    source = (READER / 'editor-study.html').read_text()
    head, dashboard, body = source.partition('<section id="dashboard">')
    _, participant, tail = body.partition('<section id="participant" hidden>')
    if not dashboard or not participant:
        raise ValueError('참여 영역과 진행자 영역의 위치를 확인하세요.')
    page = head + '<section id="participant">' + tail
    page = page.replace('<link rel="stylesheet" href="editor-study-roster.css">\n', '')
    page = page.replace('<html lang="ko">', '<html lang="ko" data-participant-kit>')
    page = re.sub(r'<header>.*?</header>', '<header><strong>Journal</strong><span>편집자 검토 과제</span></header>', page, count=1)
    page, count = re.subn(r'(<section id="enroll-box"[^>]*><h2>.*?</h2>)<p>.*?</p>', r'\1<p>진행자에게 받은 초대 코드를 입력하세요. 이어서 참여할 때도 같은 코드를 씁니다. 다른 기기로 옮길 때는 같은 코드로 등록한 뒤 과제를 시작하기 전에 본인의 이어하기 파일을 여세요.</p>', page, count=1)
    if count != 1:
        raise ValueError('참여용 등록 안내를 확인하세요.')
    return page.replace(' (공용 기기는 비움)', '').replace('id="invite-code" type="text"', 'id="invite-code" required type="text"')


def versioned_packet():
    packet = {}
    for name, page in [('editor-study.html', participant_page()), ('factcheck.html', html('factcheck.html', 'journal', ''))]:
        packet[name] = page.encode()
        scanner = Assets()
        scanner.feed(page)
        for asset in scanner.names:
            if Path(asset).name != asset:
                raise ValueError('참여용 리소스 경로를 확인하세요.')
            if asset == 'editor-study-cases.js':
                packet[asset] = public_cases().encode()
            elif asset == 'editor-study-core.js':
                packet[asset] = participant_core().encode()
            elif asset == 'editor-study-ui.js':
                packet[asset] = participant_ui().encode()
            else:
                packet[asset] = (READER / asset).read_bytes()
    packet['시작 안내.txt'] = (
        '압축을 모두 푼 뒤 editor-study.html을 여세요. 진행자에게 받은 본인의 초대 코드로 등록합니다. '
        '중간에 창을 닫았다면 같은 폴더와 브라우저에서 같은 코드를 입력하세요. '
        '다른 기기로 옮기려면 잠시 멈추기를 누르고 내 이어하기 파일을 저장하세요. 새 기기에서 본인 코드로 등록한 뒤 과제를 시작하기 전에 파일을 여세요. '
        '네 과제를 마치거나 중단한 뒤 내 참여 기록을 내려받아 진행자에게 전달하세요.\n').encode()
    # Fingerprint the exact participant assets before adding the stamp itself.
    digest = sha256()
    for name, contents in sorted(packet.items()):
        digest.update(name.encode() + b'\0')
        digest.update(sha256(contents).digest())
    edition = digest.hexdigest()
    stamp = f'<meta name="journal-editor-kit" content="{edition}">'.encode()
    for page in ('editor-study.html', 'factcheck.html'):
        if packet[page].count(b'</head>') != 1:
            raise ValueError(f'{page}에 참여자 자료 판본을 표시할 위치를 확인하세요.')
        packet[page] = packet[page].replace(b'</head>', stamp + b'</head>', 1)
    result = BytesIO()
    with ZipFile(result, 'w') as archive:
        for name, contents in sorted(packet.items()):
            info = ZipInfo(name, (2024, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            archive.writestr(info, contents, compress_type=ZIP_DEFLATED)
    return edition, result.getvalue()


def packet_bytes():
    return versioned_packet()[1]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path.home() / 'Downloads' / 'Journal-편집자-파일럿')
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if output.is_relative_to(ROOT):
        parser.error('저장소 밖의 배부 폴더를 지정하세요.')
    output.mkdir(parents=True, exist_ok=True)
    dest = output / 'participant-editor-study.zip'
    dest.write_bytes(packet_bytes())
    print(dest)
