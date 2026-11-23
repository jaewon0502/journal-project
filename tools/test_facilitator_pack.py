from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from urllib.parse import urlsplit
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_facilitator_pack import CASES, CASE_FOLDERS, READER, packet_bytes


class Dependencies(HTMLParser):
    def __init__(self):
        super().__init__()
        self.local = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for key in ('href', 'src'):
            url = urlsplit(attrs.get(key, ''))
            if url.path and not url.scheme and not url.netloc:
                self.local.add(url.path)


class FacilitatorPack(unittest.TestCase):
    def test_both_dashboards_and_their_offline_paths_resolve(self):
        with ZipFile(BytesIO(packet_bytes())) as archive:
            self.assertIsNone(archive.testzip())
            files = set(archive.namelist())
            for page in ('시작.html', 'editor-study.html', 'field-summary.html', 'field-review.html', 'factcheck.html'):
                links = Dependencies()
                links.feed(archive.read(page).decode())
                self.assertLessEqual(links.local, files, page)
            for page in ('editor-study.html', 'field-summary.html', 'field-review.html'):
                self.assertEqual(archive.read(page), (READER / page).read_bytes())
            for asset in (n for n in files if n.endswith(('.js', '.css'))):
                self.assertEqual(archive.read(asset), (READER / asset).read_bytes())
            self.assertIn(b'factcheck.html?study=1', archive.read('editor-study-ui.js'))
            expected_json = set()
            for case, label in CASE_FOLDERS.items():
                for subdir, name in [('채점표', 'coordinator-key.json'), ('참여 과제', 'blind-tasks.json')]:
                    packed = f'{subdir}/{label}/{name}'
                    self.assertEqual(archive.read(packed), (CASES / case / name).read_bytes())
                    expected_json.add(packed)
            self.assertEqual({n for n in files if n.endswith('.json')}, expected_json)

    def test_rebuilding_next_to_a_private_roster_preserves_it(self):
        builder = Path(__file__).with_name('build_facilitator_pack.py')
        with TemporaryDirectory() as folder:
            out = Path(folder)
            roster = out / '첫-4인-초대명부.json'
            roster.write_bytes(b'private-roster-not-for-distribution')
            for _ in range(2):
                subprocess.run([sys.executable, str(builder), '--output', folder], check=True, capture_output=True)
            self.assertEqual(roster.read_bytes(), b'private-roster-not-for-distribution')
            self.assertEqual({p.name for p in out.iterdir()}, {roster.name, '집계도구.zip'})
            self.assertEqual((out / '집계도구.zip').read_bytes(), packet_bytes())
