"""Build answer-free, method-specific offline kits for the real-article pilot."""
import argparse
from hashlib import sha256
from html import escape
from html.parser import HTMLParser
from io import BytesIO
import json
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
READER = ROOT / 'docs' / 'reader'
CASES = ROOT / 'experiments'
DEFAULT_CASE = 'cross-party-review'


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.names = set()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'script' and a.get('src'):
            self.names.add(a['src'])
        if tag == 'link' and a.get('rel') == 'stylesheet':
            self.names.add(a['href'])


def html(name, method, tasks):
    contents = (READER / name).read_text()
    # Coordinator dashboards and case documentation are kept out of both kits.
    contents, count = re.subn(r'<header>.*?</header>', '<header><strong>Journal</strong></header>',
                              contents, count=1, flags=re.S)
    assert count == 1
    if name == 'field-review.html':
        if method == 'manual':
            for asset in ('factcheck-engine.js', 'field-citation.js', 'field-evidence.js'):
                contents = contents.replace(f'<script defer src="{asset}"></script>', '')
            contents, count = re.subn(r'<details id="field-evidence".*?</details>', '', contents, count=1, flags=re.S)
            assert count == 1
        # Keep the participant JSON inert even if a quoted article contains an HTML end tag.
        payload = json.dumps(tasks, ensure_ascii=False).replace('<', r'\u003c')
        contents = contents.replace('</head>', '<script type="application/json" id="assigned-tasks">' +
                                    payload + '</script></head>', 1)
        contents, count = re.subn(r'id="case-file"', lambda _: 'id="case-file" data-case-id="' +
                                  escape(tasks['caseId'], quote=True) + '"', contents, count=1)
        assert count == 1
        contents, count = re.subn(r'<select id="method">.*?</select>',
                                  '<select id="method" disabled><option value="' + method + '">' +
                                  ('평소 검증 도구' if method == 'manual' else '평소 검증 도구와 저널') +
                                  '</option></select>', contents, count=1, flags=re.S)
        assert count == 1
    return contents


def packet_pair(case=DEFAULT_CASE):
    if Path(case).name != case:
        raise ValueError('사례 폴더 이름을 확인하세요.')
    raw = (CASES / case / 'blind-tasks.json').read_bytes()
    tasks = json.loads(raw)
    if (set(tasks) != {'caseId', 'title', 'articleUrl', 'tasks'} or not tasks['tasks']
            or not all(set(item) == {'id', 'prompt'} for item in tasks['tasks'])):
        raise ValueError('참여자용 과제 파일에 사례 정보, 과제 번호, 문장만 넣으세요.')
    guide = ('압축을 푼 뒤 field-review.html을 여세요. 진행자가 준 배정 코드를 확인하세요. 익명 코드와 과제 번호를 따로 받았다면 직접 입력하세요. '
        '과제 목록이 보이지 않으면 “과제 파일 직접 불러오기”에서 같은 폴더의 blind-tasks.json을 여세요. '
        '“시간 측정 시작”을 누르면 과제 문장과 기사 링크가 나타납니다. '
        '외부 기사와 원자료를 열려면 인터넷 연결이 필요합니다. 기록 파일은 완료 또는 중도 종료 후 직접 저장합니다.\n').encode()
    packets = {}
    assets = {}
    version = sha256()
    for method in ('manual', 'journal'):
        packet = {'blind-tasks.json': raw, '시작 안내.txt': guide}
        pages = ['field-review.html'] if method == 'manual' else ['field-review.html', 'factcheck.html']
        for name in pages:
            contents = html(name, method, tasks)
            packet[name] = contents.encode()
            scanner = Assets()
            scanner.feed(contents)
            for asset in scanner.names:
                assert Path(asset).name == asset
                if asset not in assets:
                    assets[asset] = (READER / asset).read_bytes()
                packet[asset] = assets[asset]
        # Identify the pair by the named contents of both arms before stamping the HTML.
        for name, data in sorted(packet.items()):
            version.update(f'{method}/{name}\0'.encode())
            version.update(sha256(data).digest())
        packets[method] = packet
    meta = f'<meta name="journal-field-kit" content="{version.hexdigest()}">'.encode()
    archives = {}
    for method, packet in packets.items():
        packet['field-review.html'] = packet['field-review.html'].replace(b'</head>', meta + b'</head>', 1)
        buffer = BytesIO()
        with ZipFile(buffer, 'w') as z:
            for name, data in sorted(packet.items()):
                info = ZipInfo(name, (2024, 1, 1, 0, 0, 0))
                info.external_attr = 0o644 << 16
                z.writestr(info, data, compress_type=ZIP_DEFLATED)
        archives[method] = buffer.getvalue()
    return archives


def packet_bytes(method, case=DEFAULT_CASE):
    if method not in ('manual', 'journal'):
        raise ValueError('검증 방식을 확인하세요.')
    return packet_pair(case)[method]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', choices=sorted(p.parent.name for p in CASES.glob('*/blind-tasks.json')),
                        default=DEFAULT_CASE, help='배부할 기사 사례')
    parser.add_argument('--output', type=Path, default=Path.home() / 'Downloads' / 'Journal-편집자-파일럿')
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if args.case != DEFAULT_CASE:
        output = (output / args.case).resolve()
    if output.is_relative_to(ROOT):
        parser.error('공개 저장소 밖의 배부 폴더를 지정하세요.')
    output.mkdir(parents=True, exist_ok=True)
    for method, data in packet_pair(args.case).items():
        dest = output / ('participant-' + method + '.zip')
        dest.write_bytes(data)
        print(dest)
