from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_field_participant_packs import CASES, packet_bytes


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
                    html = z.read('field-review.html').decode()
                    self.assertIn(f'data-case-id="{key["caseId"]}"', html)
                    self.assertIn(f'<select id="method" disabled><option value="{method}">', html)
