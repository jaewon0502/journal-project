"""Synthetic v3 regression tests; fixtures are not factual correctness evidence."""
import copy
import importlib.util
import itertools
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('frozen_v18', ROOT/'v18/code/check_output.py')
frozen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frozen)
SCHEMA = json.loads(Path(__file__).with_name('schema.json').read_text())
from check_output_v3 import apply_checked


def closure_oracle(patches, selected):
    """Necessary co-application = every selected patch's dependencies selected.

    This is a test oracle, not an alternate validator. Self-edges are deliberately
    unresolved by this proposal; examples exercise only distinct patch IDs.
    """
    by_id = {p['id']: p for p in patches}
    return set(selected) <= by_id.keys() and all(
        dep in selected for key in selected for dep in by_id[key]['depends_on'])


def fixture():
    text = 'Title alpha.\nBody beta.\nTail unchanged.'
    unit = {'unit_id': 'SYNTHETIC', 'article': {'full_text': text},
            'sources': [{'id': 'S', 'text': 'Synthetic support.'}]}
    props = SCHEMA['properties']['findings']['items']['properties']
    finding = {k: ([] if p.get('type') == 'array' else
                   p['enum'][0] if 'enum' in p else '') for k,p in props.items()}
    finding.update(id='F', question_part='Synthetic coordinated edit', origin='inherited',
                   factual_error='no', conclusion_changing_omission='no',
                   optional_clarification='no', required_answer_missing='no',
                   answer_present_but_incorrect='no', original_proposition_changed='yes',
                   necessity='yes', evidence_support='yes', preserves_other_meaning='yes',
                   context_safe='yes', local_action='patch', source_refs=['S'])
    patches = [dict(id='P1', finding_id='F', before='alpha', after='ALPHA LONG', depends_on=['P2']),
               dict(id='P2', finding_id='F', before='beta', after='B', depends_on=['P1'])]
    output = dict(unit_id='SYNTHETIC', findings=[finding], patches=patches,
                  preservation_decision='repair', local_hold_reasons=[], coverage_gaps=[],
                  selected_candidate_delta_safety='safe', overall_readiness='unknown',
                  overall_reason='Synthetic only', read_scope='Synthetic only', protection_items=[],
                  full_edited_article='Title ALPHA LONG.\nBody B.\nTail unchanged.')
    return unit, output


class DependencyContract(unittest.TestCase):
    def test_frozen_acyclic_control_and_original_offsets(self):
        u,o = fixture(); o['patches'][1]['depends_on']=[]
        self.assertEqual(apply_checked(u,o,SCHEMA),o['full_edited_article'])

    def test_frozen_mutual_cycle_failure_preserved(self):
        u,o = fixture(); o['patches'][1]['depends_on']=['P1']
        self.assertTrue(closure_oracle(o['patches'], {'P1','P2'}))
        with self.assertRaisesRegex(ValueError, 'cyclic patch dependency'):
            frozen.apply_checked(u,o,SCHEMA)
        before=copy.deepcopy(o)
        self.assertEqual(apply_checked(u,o,SCHEMA),o['full_edited_article'])
        self.assertEqual(o,before)

    def test_mutual_group_cannot_be_partially_selected(self):
        _,o = fixture(); o['patches'][1]['depends_on']=['P1']
        for selected in [{'P1'}, {'P2'}]:
            self.assertFalse(closure_oracle(o['patches'], selected))

    def test_three_node_cycle_and_outgoing_dependency(self):
        patches=[{'id':'A','depends_on':['B']}, {'id':'B','depends_on':['C']},
                 {'id':'C','depends_on':['A','D']}, {'id':'D','depends_on':[]}]
        self.assertTrue(closure_oracle(patches, {'A','B','C','D'}))
        self.assertFalse(closure_oracle(patches, {'A','B','C'}))

    def test_three_node_cycle_native_delivery(self):
        u,o=fixture()
        o['patches'][1]['depends_on']=['P3']
        o['patches'].append(dict(id='P3',finding_id='F',before='unchanged',after='changed',depends_on=['P1']))
        o['full_edited_article']=o['full_edited_article'].replace('unchanged','changed')
        self.assertEqual(apply_checked(u,o,SCHEMA),o['full_edited_article'])

    def test_missing_dependency_rejected(self):
        u,o=fixture(); o['patches'].pop()
        self.assertFalse(closure_oracle(o['patches'], {'P1'}))
        with self.assertRaisesRegex(ValueError, 'missing dependency'):
            apply_checked(u,o,SCHEMA)

    def test_partial_native_delivery_rejected(self):
        u,o=fixture(); o['full_edited_article']=u['article']['full_text'].replace('alpha','ALPHA LONG')
        with self.assertRaisesRegex(ValueError, 'native whole article'):
            apply_checked(u,o,SCHEMA)

    def test_overlapping_spans_rejected(self):
        u,o=fixture(); o['patches'][1]['before']='Title alpha'
        with self.assertRaisesRegex(ValueError, 'overlapping patch anchors'):
            apply_checked(u,o,SCHEMA)

    def test_created_anchor_is_not_a_sequential_dependency(self):
        u,o=fixture(); o['patches'][1]['before']='ALPHA LONG'
        with self.assertRaisesRegex(ValueError, 'nonunique patch anchor'):
            apply_checked(u,o,SCHEMA)

    def test_patch_list_order_does_not_set_execution_order(self):
        u,o=fixture()
        for patches in itertools.permutations(o['patches']):
            candidate=copy.deepcopy(o); candidate['patches']=list(patches)
            self.assertEqual(apply_checked(u,candidate,SCHEMA),o['full_edited_article'])

    def test_gate_failures_remain_rejected(self):
        for gate in ['necessity','evidence_support','preserves_other_meaning','context_safe']:
            for value in ['no','unknown']:
                with self.subTest(gate=gate,value=value):
                    u,o=fixture(); o['findings'][0][gate]=value
                    with self.assertRaisesRegex(ValueError,'unapproved patch'):
                        apply_checked(u,o,SCHEMA)

    def test_duplicate_dependency_rejected(self):
        u,o=fixture(); o['patches'][0]['depends_on']=['P2','P2']
        with self.assertRaisesRegex(ValueError,'duplicate patch dependency'):
            apply_checked(u,o,SCHEMA)

    def test_duplicate_patch_id_rejected(self):
        u,o=fixture(); o['patches'][1]['id']='P1'
        with self.assertRaisesRegex(ValueError,'blank or duplicate id'):
            apply_checked(u,o,SCHEMA)

    def test_source_reference_rejected(self):
        u,o=fixture(); o['findings'][0]['source_refs']=['MISSING']
        with self.assertRaisesRegex(ValueError,'unknown source reference'):
            apply_checked(u,o,SCHEMA)

    def test_unsafe_combination_rejected(self):
        for safety in ['unsafe','unknown']:
            u,o=fixture(); o['selected_candidate_delta_safety']=safety
            with self.assertRaisesRegex(ValueError,'uncertain or unsafe selected edits'):
                apply_checked(u,o,SCHEMA)

    def test_self_reference_existing_rejection_preserved(self):
        u,o=fixture(); o['patches'][0]['depends_on']=['P1']
        with self.assertRaisesRegex(ValueError,'self patch dependency'):
            apply_checked(u,o,SCHEMA)

if __name__ == '__main__':
    unittest.main(verbosity=2)
