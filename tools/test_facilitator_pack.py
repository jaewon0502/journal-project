from base64 import b64decode
from html.parser import HTMLParser
from io import BytesIO
import json
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from urllib.parse import urlsplit
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_facilitator_pack import CASES, CASE_FOLDERS, PRACTICE_SAMPLE, QUOTE_PRACTICE, READER, packet_bytes
from build_editor_study_pack import packet_bytes as editor_participant_zip
from build_field_participant_packs import packet_pair


class Dependencies(HTMLParser):
    def __init__(self):
        super().__init__()
        self.local = set()
        self.downloads = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a' and attrs.get('download'):
            self.downloads[attrs['download']] = attrs['href']
        for key in ('href', 'src'):
            url = urlsplit(attrs.get(key, ''))
            if url.path and not url.scheme and not url.netloc:
                self.local.add(url.path)


class FacilitatorPack(unittest.TestCase):
    def test_linked_participant_kits_match_the_standalone_distributions(self):
        with ZipFile(BytesIO(packet_bytes())) as coordinator:
            links = Dependencies()
            links.feed(coordinator.read('시작.html').decode())
            self.assertIn('prepare_pdf_source.py', links.local)
            self.assertEqual(coordinator.read('prepare_pdf_source.py'), Path(__file__).with_name('prepare_pdf_source.py').read_bytes())
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
            for page in ('editor-study.html', 'field-summary.html', 'field-review.html'):
                self.assertEqual(archive.read(page), (READER / page).read_bytes())
            allocation = archive.read('field-allocation.html').decode()
            catalog_tag = r'<script id="allocation-catalog" type="application/json">(.*?)</script>'
            self.assertEqual(re.sub(catalog_tag, '', allocation, flags=re.S), (READER / 'field-allocation.html').read_text())
            [catalog_text] = re.findall(catalog_tag, allocation, re.S)
            catalog = json.loads(catalog_text)
            self.assertEqual(len(catalog), len(CASE_FOLDERS))
            for entry, (case, label) in zip(catalog, CASE_FOLDERS.items()):
                self.assertEqual(entry['label'], label)
                self.assertEqual(entry['material'], json.loads((CASES / case / 'blind-tasks.json').read_bytes()))
                for method, contents in packet_pair(case).items():
                    self.assertEqual(archive.read(entry['files'][method]), contents)
            for asset in (n for n in files if n.endswith(('.js', '.css'))):
                self.assertEqual(archive.read(asset), (READER / asset).read_bytes())
            self.assertIn(b'factcheck.html?study=1', archive.read('editor-study-ui.js'))
            expected_json = {PRACTICE_SAMPLE, *QUOTE_PRACTICE.values()}
            for case, label in CASE_FOLDERS.items():
                for subdir, name in [('채점표', 'coordinator-key.json'), ('참여 과제', 'blind-tasks.json')]:
                    packed = f'{subdir}/{label}/{name}'
                    self.assertEqual(archive.read(packed), (CASES / case / name).read_bytes())
                    expected_json.add(packed)
            self.assertEqual({n for n in files if n.endswith('.json')}, expected_json)

    def test_only_the_coordinator_receives_the_synthetic_political_quote_reviews(self):
        with ZipFile(BytesIO(packet_bytes())) as archive:
            for name, bundled in QUOTE_PRACTICE.items():
                self.assertEqual(archive.read(bundled), (CASES / 'core-quote-revision' / name).read_bytes())
            case = json.loads(archive.read(QUOTE_PRACTICE['coordinator-case.json']))
            self.assertIn(f'#review={case["reviewId"]}&amp;focus=core-context&amp;example=quote',
                          archive.read('시작.html').decode())
            embedded = re.findall(r'<script id="quote-practice" type="application/json">(.*?)</script>',
                                  archive.read('article-compare.html').decode(), re.S)
            self.assertEqual([json.loads(data) for data in embedded], [case])
            self.assertEqual(len(case['items']), 6)
            self.assertTrue(all(item['data']['demo'] is True for item in case['items']))
            for name in archive.namelist():
                if name.endswith('.zip'):
                    with ZipFile(BytesIO(archive.read(name))) as nested:
                        self.assertTrue(set(QUOTE_PRACTICE.values()).isdisjoint(nested.namelist()))
                        self.assertNotIn('core-context-notes-ui.js', nested.namelist())
                        for page in (n for n in nested.namelist() if n.endswith('.html')):
                            self.assertNotIn(b'id="quote-practice"', nested.read(page))

    def test_synthetic_rationales_are_only_in_the_coordinator_kit(self):
        with ZipFile(BytesIO(packet_bytes())) as coordinator:
            links = Dependencies()
            links.feed(coordinator.read('시작.html').decode())
            data_url = links.downloads[Path(PRACTICE_SAMPLE).name]
            header, data = data_url.split(',', 1)
            self.assertEqual(header, 'data:application/json;base64')
            self.assertEqual(b64decode(data, validate=True), coordinator.read(PRACTICE_SAMPLE))
            sample = json.loads(coordinator.read(PRACTICE_SAMPLE))
            self.assertEqual(sample['format'], 'journal-field-grades-v1')
            rows = sample['entries']
            self.assertEqual(len(rows), 4)
            key = json.loads(coordinator.read('채점표/고용/coordinator-key.json'))
            target = next(task for task in key['tasks'] if task['id'] == 'labour-rate')
            for row in rows:
                self.assertEqual(row['trial']['kind'], 'practice')
                self.assertEqual(row['trial']['verdict'], target['verdict'])
                self.assertEqual(row['basis'], {**target, 'caseId': key['caseId'], 'articleUrl': key['articleUrl']})
            self.assertEqual(len({r['trial']['participant'] for r in rows}), 4)
            self.assertEqual(len({r['trial']['id'] for r in rows}), 4)
            self.assertEqual(len({r['gradingTime']['id'] for r in rows}), 4)
            for method, expected in [('manual', (60000, 60000, 65000)), ('journal', (40000, 80000, 130000))]:
                arm = [r for r in rows if r['trial']['method'] == method]
                self.assertEqual(len(arm), 2)
                self.assertTrue(all(r['locationGrade'] == r['verdictGrade'] == 'yes' for r in arm))
                total = sum(sum(r['trial']['phaseMs'].values()) for r in arm)
                verified = sum(r['reasonGrade'] == 'yes' for r in arm)
                self.assertTrue(all(not r['gradingTime']['partial'] and r['gradingTime']['status'] == 'complete' for r in arm))
                person_ms = total + sum(r['gradingTime']['ms'] for r in arm)
                self.assertEqual((total / len(arm), total / verified, person_ms / verified), expected)
            for name in coordinator.namelist():
                if name.endswith('.zip'):
                    with ZipFile(BytesIO(coordinator.read(name))) as participant:
                        self.assertNotIn(PRACTICE_SAMPLE, participant.namelist())

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
