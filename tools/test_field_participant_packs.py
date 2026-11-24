from html.parser import HTMLParser
from io import BytesIO
import json
from pathlib import Path
from shutil import copytree
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_field_participant_packs import CASES, READER, html, packet_bytes, packet_pair


class EmbeddedCase(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.inside = False
        self.payload = ''
        self.versions = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta' and attrs.get('name') == 'journal-field-kit':
            self.versions.append(attrs['content'])
        self.inside = (tag == 'script' and attrs.get('id') == 'assigned-tasks' and
                       attrs.get('type') == 'application/json')

    def handle_data(self, data):
        if self.inside:
            self.payload += data

    def handle_endtag(self, tag):
        if tag == 'script':
            self.inside = False


class FieldKits(unittest.TestCase):
    def paired_version(self, pair):
        versions = set()
        for data in pair.values():
            with ZipFile(BytesIO(data)) as z:
                page = EmbeddedCase(z.read('field-review.html').decode())
                self.assertEqual(len(page.versions), 1)
                self.assertRegex(page.versions[0], r'^[a-f0-9]{64}$')
                versions.update(page.versions)
        self.assertEqual(len(versions), 1)
        return versions.pop()

    def test_both_arms_identify_the_same_reproducible_pair_and_track_changes(self):
        pair = packet_pair()
        self.assertEqual(pair, packet_pair())
        original = self.paired_version(pair)
        with TemporaryDirectory() as folder:
            reader = copytree(READER, Path(folder) / 'reader')
            with patch('build_field_participant_packs.READER', reader):
                for name in ('factcheck-ui.js', 'field-review-core.js', 'field-review.html'):
                    with self.subTest(name=name):
                        asset = reader / name
                        before = asset.read_bytes()
                        asset.write_bytes(before + b'\n')
                        self.assertNotEqual(self.paired_version(packet_pair()), original)
                        asset.write_bytes(before)
                # Changes to the coordinator dashboard do not change the delivered pair.
                (reader / 'field-summary.js').write_bytes(b'// coordinator only')
                self.assertEqual(packet_pair(), pair)

    def test_ready_to_distribute_kits_match_source_without_scoring_keys(self):
        for case in ('cross-party-review', 'labour-field-review'):
            key = json.loads((CASES / case / 'coordinator-key.json').read_bytes())
            for method in ('manual', 'journal'):
                with self.subTest(case=case, method=method), ZipFile(BytesIO(packet_bytes(method, case))) as z:
                    blind = json.loads(z.read('blind-tasks.json'))
                    self.assertEqual(blind['caseId'], key['caseId'])
                    self.assertEqual(blind['articleUrl'], key['articleUrl'])
                    self.assertEqual(blind['tasks'], [{k: t[k] for k in ('id', 'prompt')} for t in key['tasks']])
                    self.assertEqual([n for n in z.namelist() if n.endswith('.json')], ['blind-tasks.json'])
                    self.assertFalse(any('coordinator' in name or 'summary' in name for name in z.namelist()))
                    self.assertEqual(method == 'journal', 'factcheck.html' in z.namelist())
                    page = z.read('field-review.html').decode()
                    self.assertEqual(method == 'journal', 'id="field-evidence"' in page)
                    for asset in ('field-citation.js', 'field-evidence.js', 'factcheck-engine.js'):
                        self.assertEqual(method == 'journal', asset in z.namelist())
                    self.assertEqual(json.loads(EmbeddedCase(page).payload), blind)
                    self.assertIn(f'data-case-id="{key["caseId"]}"', page)
                    self.assertIn(f'<select id="method" disabled><option value="{method}">', page)

    def test_quoted_html_stays_inside_the_inert_json_payload(self):
        blind = json.loads((CASES / 'labour-field-review' / 'blind-tasks.json').read_bytes())
        blind['tasks'][0]['prompt'] = '검토할 인용문 “</ScRiPt><p>공고 & 서식</p>”'
        page = html('field-review.html', 'manual', blind)
        self.assertNotIn('</ScRiPt><p>', page)
        self.assertEqual(json.loads(EmbeddedCase(page).payload), blind)
