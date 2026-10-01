"""Synthetic mechanical contract tests, NOT semantic experiments."""
from dataclasses import replace
from itertools import combinations
import json
import unittest

from selective_rollback import digest, propose_selection, release_selection


def raw(value):
    return json.dumps(value).encode()


class GateTests(unittest.TestCase):
    def fixture(self, count=4, dependent=(), unknown=(), rejected=()):
        source = b'a b c d'
        ids = list('ABCD')[:count]
        proposal = dict(writer_id='writer', preimage_sha256=digest(source), patches=[
            dict(id=p, start=i*2, end=i*2+1, before=chr(97+i), after=p)
            for i, p in enumerate(ids)])
        proposal_raw = raw(proposal)
        binding = dict(source_sha256=digest(source), proposal_sha256=digest(proposal_raw), complete=True, read_complete=True)
        dep = dict(**binding, auditor_id='dependency-auditor', patch_ids=ids, pairs=[
            dict(ids=[a, b], relation=('dependent' if a+b in dependent else 'unknown' if a+b in unknown else 'independent'))
            for a, b in combinations(ids, 2)])
        audit = dict(**binding, auditor_id='patch-auditor', patch_decisions=[
            dict(id=p, decision='rejected' if p in rejected else 'approved') for p in ids])
        return source, proposal, dep, audit

    def select(self, fixture):
        source, proposal, dep, audit = fixture
        return propose_selection(source, raw(proposal), raw(dep), raw(audit))

    def verdict(self, selection, **updates):
        value = dict(source_sha256=digest(selection.source), proposal_sha256=digest(selection.proposal_raw),
                     auditor_id='final-auditor', complete=True, read_complete=True,
                     candidate_sha256=selection.candidate_sha256, selected_ids=list(selection.selected_ids),
                     whole_candidate_reviewed=True, decision='approved', findings=[])
        value.update(updates)
        return raw(value)

    def finding(self, relation='offending', ids=('B',)):
        return dict(id='F1', description='Synthetic fixture finding', relation=relation, patch_ids=list(ids))

    def test_normal_release_and_noop_require_final_review(self):
        for count, expected in [(4, b'A B C D'), (0, b'a b c d')]:
            with self.subTest(count=count):
                selection = self.select(self.fixture(count=count))
                self.assertEqual(selection.candidate, expected)
                self.assertFalse(release_selection(selection, b'{}').released)
                result = release_selection(selection, self.verdict(selection))
                self.assertTrue(result.released)
                self.assertEqual(result.output, expected)

    def test_rejected_member_drops_transitive_component(self):
        selection = self.select(self.fixture(dependent=('AB', 'BC'), rejected=('C',)))
        self.assertEqual(selection.selected_ids, ('D',))
        self.assertEqual(selection.candidate, b'a b c D')

    def test_unknown_edge_drops_linked_component_only(self):
        selection = self.select(self.fixture(dependent=('AB',), unknown=('BC',)))
        self.assertEqual(selection.selected_ids, ('D',))

    def test_unknown_patch_vote_drops_component(self):
        fixture = self.fixture(dependent=('AB',))
        fixture[3]['patch_decisions'][0]['decision'] = 'unknown'
        self.assertEqual(self.select(fixture).selected_ids, ('C', 'D'))

    def test_cycle_is_atomic(self):
        selection = self.select(self.fixture(dependent=('AB', 'BC', 'AC'), rejected=('B',)))
        self.assertEqual(selection.selected_ids, ('D',))

    def test_missing_extra_duplicate_pairs_fail_closed(self):
        for mode in ('missing', 'extra', 'duplicate'):
            fixture = self.fixture()
            pairs = fixture[2]['pairs']
            if mode == 'missing':
                pairs.pop()
            elif mode == 'extra':
                pairs.append(dict(ids=['A', 'Z'], relation='independent'))
            else:
                pairs.append(dict(ids=['B', 'A'], relation='independent'))
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                self.select(fixture)

    def test_missing_extra_duplicate_patch_votes_fail_closed(self):
        for mode in ('missing', 'extra', 'duplicate'):
            fixture = self.fixture()
            votes = fixture[3]['patch_decisions']
            if mode == 'missing':
                votes.pop()
            else:
                votes.append(dict(id='Z' if mode == 'extra' else 'A', decision='approved'))
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                self.select(fixture)

    def test_wrong_source_proposal_and_preimage_hashes(self):
        for index, field in [(1, 'preimage_sha256'), (2, 'source_sha256'), (2, 'proposal_sha256'), (3, 'source_sha256'), (3, 'proposal_sha256')]:
            fixture = self.fixture()
            fixture[index][field] = '0'*64
            with self.subTest(index=index, field=field), self.assertRaises(ValueError):
                self.select(fixture)

    def test_wrong_final_binding_and_incomplete_review_hold_all(self):
        selection = self.select(self.fixture())
        for update in [dict(candidate_sha256='0'*64), dict(source_sha256='0'*64),
                       dict(proposal_sha256='0'*64), dict(selected_ids=['A']),
                       dict(whole_candidate_reviewed=False), dict(complete=False), dict(read_complete=False),
                       dict(auditor_id='writer'), dict(auditor_id='patch-auditor')]:
            with self.subTest(update=update):
                result = release_selection(selection, self.verdict(selection, **update))
                self.assertFalse(result.released)
                self.assertEqual(result.output, selection.source)
                self.assertEqual(result.provisional.selected_ids, ())

    def test_final_finding_removes_whole_component_and_requires_new_verdict(self):
        selection = self.select(self.fixture(dependent=('AB', 'BC')))
        verdict = self.verdict(selection, findings=[self.finding()])
        result = release_selection(selection, verdict)
        self.assertFalse(result.released)
        self.assertEqual(result.output, selection.source)
        self.assertEqual(result.provisional.selected_ids, ('D',))
        self.assertEqual(result.provisional.candidate, b'a b c D')
        self.assertFalse(release_selection(result.provisional, verdict).released)
        approved = release_selection(result.provisional, self.verdict(result.provisional))
        self.assertTrue(approved.released)
        self.assertEqual(approved.output, b'a b c D')
        self.assertIn(verdict, approved.provisional.disclosures_raw)

    def test_preexisting_independent_contradiction_preserved_and_disclosed(self):
        selection = self.select(self.fixture(rejected=('A',)))
        verdict = self.verdict(selection, findings=[self.finding('preexisting_independent', ())])
        result = release_selection(selection, verdict)
        self.assertTrue(result.released)
        self.assertEqual(result.output, b'a B C D')
        self.assertEqual(result.provisional.disclosures_raw, (verdict,))

    def test_unknown_and_unlocalized_final_findings_hold_all(self):
        selection = self.select(self.fixture())
        for relation, ids in [('unknown', ('A',)), ('unknown', ()), ('offending', ())]:
            result = release_selection(selection, self.verdict(selection, findings=[self.finding(relation, ids)]))
            self.assertFalse(result.released)
            self.assertEqual(result.provisional.selected_ids, ())
            self.assertEqual(result.output, selection.source)

    def test_rejected_or_unknown_final_verdict_never_releases_patch_votes(self):
        selection = self.select(self.fixture())
        for decision in ('rejected', 'unknown'):
            result = release_selection(selection, self.verdict(selection, decision=decision))
            self.assertFalse(result.released)
            self.assertEqual(result.output, selection.source)

    def test_cannot_release_arbitrary_partial_component_or_altered_candidate(self):
        selection = self.select(self.fixture(dependent=('AB',)))
        for altered in [replace(selection, selected_ids=('A', 'C', 'D'), candidate=b'A b C D'),
                        replace(selection, candidate=b'forged'), replace(selection, components=())]:
            with self.assertRaises(ValueError):
                release_selection(altered, self.verdict(altered))

    def test_duplicate_json_keys_and_nonexact_text_rejected(self):
        with self.assertRaises(ValueError):
            propose_selection(b'', b'{"patches":[],"patches":[]}', b'{}', b'{}')
        fixture = self.fixture()
        fixture[1]['patches'][0]['before'] = 'wrong'
        with self.assertRaises(ValueError):
            self.select(fixture)

    def test_bounds_and_utf8_boundary(self):
        fixture = self.fixture()
        fixture[1]['patches'] *= 17
        with self.assertRaises(ValueError):
            self.select(fixture)
        fixture = self.fixture()
        fixture = (b'\xc3\xa9 b c d', *fixture[1:])
        fixture[1]['preimage_sha256'] = digest(fixture[0])
        with self.assertRaises(ValueError):
            self.select(fixture)

    def test_malformed_final_raw_is_preserved(self):
        selection = self.select(self.fixture())
        result = release_selection(selection, b'not json')
        self.assertFalse(result.released)
        self.assertEqual(result.final_audit_raw, b'not json')
        self.assertEqual(result.provisional.disclosures_raw, (b'not json',))


if __name__ == '__main__':
    unittest.main()
