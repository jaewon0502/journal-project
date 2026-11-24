from html.parser import HTMLParser
from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_field_participant_packs import CASES, html, packet_bytes


class EmbeddedCase(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.inside = False
        self.payload = ''
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.inside = (tag == 'script' and dict(attrs).get('id') == 'assigned-tasks' and
                       dict(attrs).get('type') == 'application/json')

    def handle_data(self, data):
        if self.inside:
            self.payload += data

    def handle_endtag(self, tag):
        if tag == 'script':
            self.inside = False


class FieldKits(unittest.TestCase):
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
                    self.assertEqual(json.loads(EmbeddedCase(page).payload), blind)
                    self.assertIn(f'data-case-id="{key["caseId"]}"', page)
                    self.assertIn(f'<select id="method" disabled><option value="{method}">', page)

    def test_quoted_html_stays_inside_the_inert_json_payload(self):
        blind = json.loads((CASES / 'labour-field-review' / 'blind-tasks.json').read_bytes())
        blind['tasks'][0]['prompt'] = '검토할 인용문 “</ScRiPt><p>공고 & 서식</p>”'
        page = html('field-review.html', 'manual', blind)
        self.assertNotIn('</ScRiPt><p>', page)
        self.assertEqual(json.loads(EmbeddedCase(page).payload), blind)
