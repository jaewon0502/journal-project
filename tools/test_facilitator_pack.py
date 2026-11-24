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
from build_editor_study_pack import packet_bytes as editor_participant_zip
from build_field_participant_packs import packet_pair


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
    def test_linked_participant_kits_match_the_standalone_distributions(self):
        with ZipFile(BytesIO(packet_bytes())) as coordinator:
            links = Dependencies()
            links.feed(coordinator.read('시작.html').decode())
            expected = {'participant-editor-study.zip': editor_participant_zip()}
            for case, folder in CASE_FOLDERS.items():
                pair = packet_pair(case)
                expected[f'참여 과제/{folder}/{folder}-평소도구.zip'] = pair['manual']
                expected[f'참여 과제/{folder}/{folder}-저널.zip'] = pair['journal']
            self.assertEqual(len(expected), 5)
            for name, contents in expected.items():
                with self.subTest(name=name):
                    self.assertIn(name, links.local)
                    self.assertEqual(coordinator.read(name), contents)

    def test_both_dashboards_and_their_offline_paths_resolve(self):
        with ZipFile(BytesIO(packet_bytes())) as archive:
            self.assertIsNone(archive.testzip())
            files = set(archive.namelist())
            for page in ('시작.html', 'editor-study.html', 'field-summary.html', 'field-allocation.html', 'field-review.html', 'factcheck.html', 'article-compare.html', 'revision-series.html'):
                links = Dependencies()
                links.feed(archive.read(page).decode())
                self.assertLessEqual(links.local, files, page)
                if page in ('article-compare.html', 'revision-series.html'):
                    self.assertTrue({'revision-facts.js', 'revision-facts-view.js'} <= links.local, page)
            for page in ('editor-study.html', 'field-summary.html', 'field-allocation.html', 'field-review.html'):
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

    def test_two_reviewers_receive_the_editor_without_scoring_keys_or_each_others_work(self):
        with ZipFile(BytesIO(packet_bytes())) as coordinator:
            start = Dependencies()
            guide = coordinator.read('시작.html').decode()
            start.feed(guide)
            self.assertTrue({'독립 기사 검토.zip', 'article-compare.html', 'revision-series.html', 'factcheck.html'} <= start.local)
            self.assertIn('href="article-compare.html#blind-revision"', guide)
            comparison = coordinator.read('article-compare.html').decode()
            self.assertIn('id="blind-revision"', comparison)
            self.assertIn('src="blind-revision.js"', comparison)
            self.assertIn('src="revision-evidence-example.js"', comparison)
            self.assertIn('href="article-compare.html"', coordinator.read('factcheck.html').decode())
            with ZipFile(BytesIO(coordinator.read('독립 기사 검토.zip'))) as reviewer:
                self.assertIsNone(reviewer.testzip())
                form = reviewer.read('factcheck.html').decode()
                self.assertIn('id="load-work"', form)
                self.assertIn('id="save-work"', form)
                dependencies = Dependencies()
                dependencies.feed(form)
                self.assertEqual(set(reviewer.namelist()), {'factcheck.html'} | dependencies.local)
                self.assertNotIn('blind-revision.js', reviewer.namelist())
                self.assertNotIn('article-compare.html', reviewer.namelist())
                self.assertTrue({'retention-case.js', 'retention-notes-ui.js'}.isdisjoint(reviewer.namelist()))
                self.assertTrue({'revision-series.html', 'revision-series.js', 'revision-series-ui.js',
                                 'revision-series-example.js', 'revision-facts.js',
                                 'revision-facts-view.js', 'revision-evidence-example.js'}.isdisjoint(reviewer.namelist()))
                self.assertTrue(all(name.endswith(('.js', '.css')) for name in dependencies.local))
                for name in dependencies.local:
                    self.assertEqual(reviewer.read(name), (READER / name).read_bytes())

    def test_rebuilding_next_to_a_private_roster_preserves_it(self):
        builder = Path(__file__).with_name('build_facilitator_pack.py')
        with TemporaryDirectory() as folder:
            out = Path(folder)
            roster = out / '첫-4인-초대명부.json'
            roster.write_bytes(b'private-roster-not-for-distribution')
            private_case = out / '진행자용-대조기록-예시.json'
            private_case.write_bytes(b'private-coordinator-notes-not-for-distribution')
            for _ in range(2):
                subprocess.run([sys.executable, str(builder), '--output', folder], check=True, capture_output=True)
            self.assertEqual(roster.read_bytes(), b'private-roster-not-for-distribution')
            self.assertEqual(private_case.read_bytes(), b'private-coordinator-notes-not-for-distribution')
            self.assertEqual({p.name for p in out.iterdir()}, {roster.name, private_case.name, '집계도구.zip'})
            with ZipFile(out / '집계도구.zip') as rebuilt:
                self.assertNotIn(private_case.name, rebuilt.namelist())
            self.assertEqual((out / '집계도구.zip').read_bytes(), packet_bytes())
