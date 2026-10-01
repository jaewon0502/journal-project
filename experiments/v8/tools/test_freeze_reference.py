"""Schematic conservative reference merging checks, not research judgments."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from freeze_reference import merge_reference
from run_artifacts import paragraphs, sha


class Freeze(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        text = 'Actor claimed X.\n\nResponse Y.'
        self.common = dict(article_id='fixture', source=text, source_sha256=sha(text.encode()), paragraphs=paragraphs(text), evidence={})
        self.input = self.save('input.json', self.common)
        ids = dict(article_id='fixture', input_sha256=sha(self.input.read_bytes()), source_sha256=self.common['source_sha256'], read_complete=True)
        self.draft = dict(ids, claims=[dict(id='C1', paragraph_ids=['P001'], source_anchor='Actor claimed X.', meaning='claim', verification='supported_attribution')],
                          paragraphs=[dict(id='P001', claim_ids=['C1'], coverage='covered'), dict(id='P002', claim_ids=[], coverage='uncertain', nonclaim_reason='provisional gap')],
                          issues=[dict(id='I1', paragraph_ids=['P001'], claim_ids=['C1'], necessity='necessary', problem='test', criterion='test', reason='test', evidence_ids=[])], limits=['draft limit'])
        self.draft_path = self.save('draft.json', self.draft)
        self.audit = dict(article_id='fixture', input_sha256=ids['input_sha256'], draft_sha256=sha(self.draft_path.read_bytes()), read_complete=True,
                          paragraphs=[dict(id='P001', coverage='covered', missing_claims=[]), dict(id='P002', coverage='incomplete', missing_claims=[dict(id='external', paragraph_ids=['P002'], source_anchor='Response Y.', meaning='response')])],
                          claim_corrections=[dict(id='C1', reason='uncertain attribution', proposed_fields={'meaning':'replacement'})],
                          issues=[dict(id='I1', judgment='disagree', reason='not established', evidence_ids=[])], additional_issues=[], limitations=['audit limit'])

    def save(self, name, data):
        p = self.root/name
        p.write_text(json.dumps(data))
        return p

    def merge(self, audit=None, name='out'):
        return merge_reference(self.input, self.draft_path, self.save('audit.json', self.audit if audit is None else audit), self.root/name)

    def test_dispute_retains_content_unknown_and_exact_originals(self):
        result = self.merge()
        frozen = json.loads((self.root/'out/reference.frozen.json').read_text())
        self.assertEqual(frozen['claims'][0]['meaning'], 'claim')
        self.assertEqual(frozen['claims'][0]['verification'], 'unknown')
        self.assertEqual(frozen['issues'][0]['necessity'], 'unknown')
        self.assertEqual(frozen['issues'][0]['original_necessity'], 'necessary')
        self.assertEqual(frozen['claims'][1]['id'], 'AUDIT_C0001')
        self.assertEqual(frozen['paragraphs'][1]['claim_ids'], ['AUDIT_C0001'])
        self.assertEqual(frozen['paragraphs'][1]['coverage'], 'uncertain')
        self.assertEqual(result['counts']['necessity_after'], {'unknown':1})
        self.assertEqual((self.root/'out/draft.original.json').read_bytes(), self.draft_path.read_bytes())
        self.assertIn('audit limit', frozen['limits'])
        with self.assertRaises(FileExistsError): self.merge()

    def test_missing_review_and_unstructured_gap_remain_unknown(self):
        audit = deepcopy(self.audit)
        audit['issues'] = []
        audit['paragraphs'][1]['missing_claims'] = ['A missing response', {'source_anchor':'not present', 'meaning':'invalid'}]
        self.merge(audit)
        frozen = json.loads((self.root/'out/reference.frozen.json').read_text())
        self.assertEqual(len(frozen['claims']), 1)
        self.assertEqual(len(frozen['coverage_gaps']), 2)
        self.assertEqual(frozen['issues'][0]['audit_judgment'], 'missing')
        self.assertEqual(frozen['issues'][0]['necessity'], 'unknown')

    def test_hash_missing_paragraph_and_incomplete_rejected(self):
        for i, change in enumerate(('hash', 'paragraph', 'read')):
            audit = deepcopy(self.audit)
            if change == 'hash': audit['draft_sha256'] = 'bad'
            if change == 'paragraph': audit['paragraphs'].pop()
            if change == 'read': audit['read_complete'] = False
            with self.assertRaises(ValueError): self.merge(audit, name='bad'+str(i))
            self.assertFalse((self.root/('bad'+str(i))).exists())

    def test_agreement_and_additional_issue_no_semantic_adjudication(self):
        audit = deepcopy(self.audit)
        audit['issues'][0]['judgment'] = 'agree'
        audit['additional_issues'] = [dict(id='new', paragraph_ids=['P002'], claim_ids=['external'], necessity='necessary', reason='audit asserts necessity')]
        self.merge(audit)
        frozen = json.loads((self.root/'out/reference.frozen.json').read_text())
        self.assertEqual(frozen['issues'][0]['necessity'], 'necessary')
        self.assertEqual(frozen['issues'][1]['necessity'], 'unknown')
        self.assertEqual(frozen['issues'][1]['audit_original_issue']['claim_ids'], ['external'])


if __name__ == '__main__': unittest.main()
