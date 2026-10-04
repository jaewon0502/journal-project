"""Hand-authored synthetic contract tests. These are NOT actual AI assessments."""
import copy
import unittest
from gate import FIELDS, apply_exact, decide, digest, prepare_candidates


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.original = 'A=5; B=4; total=9; note=short.'
        self.patches = [
            {'id': 'P', 'before': 'A=5', 'after': 'A=6'},
            {'id': 'Q', 'before': 'total=9', 'after': 'total=10'},
            {'id': 'R', 'before': 'note=short', 'after': 'note=clear'},
        ]
        self.sources = {'S': 'A=6; B=4; total=10. A clear note is optional.'}
        self.reviews = [{'patch_assessments': [dict(patch_id=p['id'], **dict.fromkeys(FIELDS, 'yes'))
                                              for p in self.patches],
                         'global_risk': False, 'new_errors': []} for _ in range(2)]

    def relation(self, p='P', q='Q', kind='requires'):
        a = next(a for a in prepare_candidates(self.original, self.patches)
                 if (a['dependent'], a['prerequisite']) == (p, q))
        yesno = 'yes' if kind == 'requires' else 'no'
        return dict(dependent=p, prerequisite=q, reviewer_index=0, kind=kind, has_new_break=yesno,
                    p_only_breaks=yesno, p_plus_q_repairs=yesno,
                    original_span=a['original'], broken_candidate_span=a['p_only'],
                    repaired_candidate_span=a['p_plus_q'], source_document_id='S',
                    source_quote='A=6; B=4; total=10.',
                    reason='Synthetic assertion of new numeric inconsistency and repair.',
                    **{k: a[k] for k in ('original_sha', 'p_only_sha', 'p_plus_q_sha')})

    def complete_relations(self, overrides=()):
        # Explicit synthetic double-review context judgments for untouched pairs.
        rows = []
        for a in prepare_candidates(self.original, self.patches):
            pair = (a['dependent'], a['prerequisite'])
            chosen = [r for r in overrides if (r.get('dependent'), r.get('prerequisite')) == pair]
            if not chosen:
                chosen = [self.relation(*pair, kind='context_only')]
            for r in chosen:
                for reviewer in (0, 1):
                    rows.append(dict(r, reviewer_index=reviewer))
        rows.extend(r for r in overrides if (r.get('dependent'), r.get('prerequisite')) not in
                    {(a['dependent'], a['prerequisite']) for a in prepare_candidates(self.original, self.patches)})
        return rows

    def run_gate(self, relations=()):
        return decide(self.original, self.patches, self.reviews,
                      self.complete_relations(relations), self.sources)

    def hold(self, p):
        next(r for r in self.reviews[1]['patch_assessments'] if r['patch_id'] == p)['necessity'] = 'no'

    def test_candidates_are_actual_and_hashed(self):
        a = prepare_candidates(self.original, self.patches)[0]
        self.assertEqual(a['p_only'], 'A=6; B=4; total=9; note=short.')
        self.assertEqual(a['p_plus_q'], 'A=6; B=4; total=10; note=short.')
        for field in ('original', 'p_only', 'p_plus_q'):
            self.assertEqual(a[field + '_sha'], digest(a[field]))

    def test_context_only_never_closes(self):
        self.hold('Q')
        self.assertEqual(self.run_gate([self.relation(kind='context_only')])['accepted_ids'], ['P', 'R'])

    def test_true_required_blocks_half_application(self):
        self.hold('Q')
        result = self.run_gate([self.relation()])
        self.assertEqual(result['accepted_ids'], ['R'])
        self.assertIn('required_prerequisite_held', result['reasons']['P'])

    def test_no_automatic_reverse_edge(self):
        self.hold('P')
        self.assertEqual(self.run_gate([self.relation()])['accepted_ids'], ['Q', 'R'])

    def test_missing_required_fields_or_false_anchors_hold_only_dependent(self):
        for field in ('original_span', 'broken_candidate_span', 'repaired_candidate_span',
                      'source_quote', 'reason', 'has_new_break'):
            with self.subTest(field=field):
                r = self.relation()
                del r[field]
                self.assertEqual(self.run_gate([r])['accepted_ids'], ['Q', 'R'])
        for field in ('original_span', 'broken_candidate_span', 'repaired_candidate_span', 'source_quote'):
            with self.subTest(false_anchor=field):
                r = self.relation()
                r[field] = 'invented absent quotation'
                self.assertEqual(self.run_gate([r])['accepted_ids'], ['Q', 'R'])

    def test_false_hashes_and_unknown_source(self):
        for field in ('original_sha', 'p_only_sha', 'p_plus_q_sha', 'source_document_id'):
            r = self.relation()
            r[field] = 'false'
            with self.subTest(field=field):
                self.assertEqual(self.run_gate([r])['accepted_ids'], ['Q', 'R'])

    def test_unknown_and_contradiction_propagate_along_other_required_edge(self):
        for field, value in [('kind', 'unknown'), ('has_new_break', 'unknown'),
                             ('p_only_breaks', 'no'), ('p_plus_q_repairs', 'no')]:
            r = self.relation()
            r[field] = value
            result = self.run_gate([r, self.relation('R', 'P')])
            with self.subTest(field=field):
                self.assertEqual(result['accepted_ids'], ['Q'])

    def test_context_claim_with_break_assertion_is_not_silently_ignored(self):
        r = self.relation(kind='context_only')
        r['has_new_break'] = 'yes'
        result = self.run_gate([r])
        self.assertEqual(result['accepted_ids'], ['Q', 'R'])
        self.assertEqual(result['required_edges']['P'], [])

    def test_existing_unresolved_error_not_new_break(self):
        r = self.relation()
        r['has_new_break'] = 'no'
        result = self.run_gate([r])
        self.assertEqual(result['accepted_ids'], ['Q', 'R'])
        self.assertEqual(result['required_edges']['P'], [])

    def test_identical_original_or_repair_contrast_rejected(self):
        r = self.relation()
        r['original_span'] = r['broken_candidate_span'] = 'B=4'
        self.assertEqual(self.run_gate([r])['accepted_ids'], ['Q', 'R'])
        r = self.relation()
        r['broken_candidate_span'] = r['repaired_candidate_span'] = 'A=6'
        self.assertEqual(self.run_gate([r])['accepted_ids'], ['Q', 'R'])

    def test_unknown_ids_and_self_edges(self):
        for q in ('MISSING', 'P'):
            r = self.relation()
            r['prerequisite'] = q
            self.assertEqual(self.run_gate([r])['accepted_ids'], ['Q', 'R'])
        r = self.relation()
        r['dependent'] = 'MISSING'
        with self.assertRaisesRegex(ValueError, 'unknown dependent'):
            self.run_gate([r])

    def test_cycles_apply_atomically_or_hold_together(self):
        relations = [self.relation(), self.relation('Q', 'P')]
        result = self.run_gate(relations)
        self.assertEqual(result['accepted_ids'], ['P', 'Q', 'R'])
        self.assertEqual(result['candidate_article'], 'A=6; B=4; total=10; note=clear.')
        self.hold('Q')
        self.assertEqual(self.run_gate(relations)['accepted_ids'], ['R'])

    def test_conflicting_reviewed_relation_never_downgrades_required(self):
        result = self.run_gate([self.relation(), self.relation(kind='context_only'), self.relation('R', 'P')])
        self.assertEqual(result['accepted_ids'], ['Q'])
        self.assertEqual(result['required_edges']['P'], ['Q'])

    def test_empty_nonunique_duplicate_and_overlapping_patches_rejected(self):
        bad_sets = [
            [{'id': 'P', 'before': '', 'after': 'x'}],
            [{'id': 'P', 'before': 'missing', 'after': 'x'}],
            [{'id': 'P', 'before': 'A=5', 'after': 'x'}, {'id': 'P', 'before': 'B=4', 'after': 'y'}],
            [{'id': 'P', 'before': 'A=5', 'after': 'x'}, {'id': 'Q', 'before': '=5', 'after': 'y'}],
        ]
        for patches in bad_sets:
            with self.subTest(patches=patches), self.assertRaises(ValueError):
                prepare_candidates(self.original, patches)
        with self.assertRaises(ValueError):
            apply_exact('aa', [{'id': 'P', 'before': 'a', 'after': 'b'}])

    def test_overlapping_occurrences_are_ambiguous_even_for_one_patch(self):
        reviews = [dict(global_risk=False, patch_assessments=[
            dict(patch_id='P', **dict.fromkeys(FIELDS, 'yes'))]) for _ in range(2)]
        for original, before in [('aaa', 'aa'), ('ababa', 'aba'), ('aaaa', 'aaa')]:
            patches = [dict(id='P', before=before, after='X')]
            with self.subTest(original=original), self.assertRaisesRegex(ValueError, 'nonunique anchor'):
                decide(original, patches, reviews, [], {})
        self.assertEqual(apply_exact('baab', [dict(id='P', before='aa', after='X')]), 'bXb')

    def test_four_axis_two_reviewer_default_and_risk_gate(self):
        for field in FIELDS:
            for verdict in ('no', 'unknown'):
                old = copy.deepcopy(self.reviews)
                self.reviews[1]['patch_assessments'][0][field] = verdict
                self.assertEqual(self.run_gate()['accepted_ids'], ['Q', 'R'])
                self.reviews = old
        for risk in ('major', 'global', 'missing'):
            old = copy.deepcopy(self.reviews)
            if risk == 'major':
                self.reviews[0]['new_errors'] = [{'severity': 'major'}]
            elif risk == 'global':
                self.reviews[0]['global_risk'] = True
            else:
                del self.reviews[0]['global_risk']
            self.assertEqual(self.run_gate()['accepted_ids'], [])
            self.reviews = old

    def test_three_way_interaction_is_not_certified_by_pairwise_contracts(self):
        # Hypothetical constraint: at most two switches may be on. Every pair is safe.
        original = 'X=0 Y=0 Z=0'
        patches = [dict(id=i, before=f'{i}=0', after=f'{i}=1') for i in 'XYZ']
        reviews = [dict(global_risk=False, new_errors=[], patch_assessments=[
            dict(patch_id=i, **dict.fromkeys(FIELDS, 'yes')) for i in 'XYZ']) for _ in range(2)]
        self.assertTrue(all(a['p_plus_q'].count('=1') == 2 for a in prepare_candidates(original, patches)))
        self.original, self.patches, self.reviews = original, patches, reviews
        # Every pair receives two explicit context-only judgments. The complete
        # graph still cannot detect a genuinely three-way semantic interaction.
        relations = self.complete_relations()
        result = decide(original, patches, reviews, relations, self.sources)
        self.assertEqual(result['candidate_article'].count('=1'), 3)
        self.assertTrue(result['requires_final_audit'])
        self.assertEqual(result['final_audit_status'], 'not_performed')

    def test_anchor_occurrence_does_not_prove_source_semantics(self):
        r = self.relation()
        r['source_quote'] = 'A clear note is optional.'
        # Procedurally valid but irrelevant evidence: independent AI assessment must catch this.
        self.assertEqual(self.run_gate([r])['accepted_ids'], ['P', 'Q', 'R'])
        self.assertTrue(self.run_gate([r])['requires_final_audit'])

    def test_missing_pair_or_reviewer_holds_dependent(self):
        result = decide(self.original, self.patches, self.reviews, [], self.sources)
        self.assertEqual(result['accepted_ids'], [])
        rows = self.complete_relations()
        rows = [r for r in rows if not (r['dependent'] == 'P' and r['prerequisite'] == 'Q' and r['reviewer_index'] == 1)]
        result = decide(self.original, self.patches, self.reviews, rows, self.sources)
        self.assertEqual(result['accepted_ids'], ['Q', 'R'])

    def test_missing_pair_propagates_via_other_required_edge(self):
        rows = self.complete_relations([self.relation('R', 'P')])
        rows = [r for r in rows if not (r['dependent'] == 'P' and r['prerequisite'] == 'Q')]
        self.assertEqual(decide(self.original, self.patches, self.reviews, rows, self.sources)['accepted_ids'], ['Q'])

    def test_duplicate_reviewer_cannot_replace_independent_judgment(self):
        rows = self.complete_relations()
        for r in rows:
            if r['dependent'] == 'P' and r['prerequisite'] == 'Q':
                r['reviewer_index'] = 0
        self.assertEqual(decide(self.original, self.patches, self.reviews, rows, self.sources)['accepted_ids'], ['Q', 'R'])
        rows = self.complete_relations()
        rows.append(copy.deepcopy(rows[0]))
        self.assertEqual(decide(self.original, self.patches, self.reviews, rows, self.sources)['accepted_ids'], ['Q', 'R'])

    def test_malformed_contract_fields_fail_closed(self):
        for key, value in [('reviewer_index', True), ('reviewer_index', '0'),
                           ('reviewer_index', 2), ('reviewer_index', []),
                           ('kind', []), ('has_new_break', {}), ('prerequisite', [])]:
            rows = self.complete_relations()
            rows[0][key] = value
            with self.subTest(key=key, value=value):
                self.assertEqual(decide(self.original, self.patches, self.reviews, rows, self.sources)['accepted_ids'], ['Q', 'R'])
        rows = self.complete_relations()
        rows[0]['dependent'] = []
        with self.assertRaisesRegex(ValueError, 'unknown dependent'):
            decide(self.original, self.patches, self.reviews, rows, self.sources)
        with self.assertRaisesRegex(ValueError, 'relation must be an object'):
            decide(self.original, self.patches, self.reviews, [None], self.sources)

    def test_single_patch_has_no_pair_coverage_requirement(self):
        reviews = [dict(global_risk=False, patch_assessments=[dict(patch_id='P', **dict.fromkeys(FIELDS, 'yes'))]) for _ in range(2)]
        result = decide('A=5', [self.patches[0]], reviews, [], {})
        self.assertEqual(result['accepted_ids'], ['P'])
        self.assertEqual(result['relation_coverage'], [])

    def test_noop_requires_explicit_acceptability_and_final_audit(self):
        reviews = [dict(global_risk=False, patch_assessments=[], no_change_acceptable='yes') for _ in range(2)]
        result = decide('accurate criticism', [], reviews, [], {})
        self.assertEqual(result['status'], 'unchanged_acceptable')
        self.assertTrue(result['requires_final_audit'])
        del reviews[0]['no_change_acceptable']
        self.assertEqual(decide('accurate criticism', [], reviews, [], {})['status'], 'hold')


if __name__ == '__main__':
    unittest.main()
