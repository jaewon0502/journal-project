"""Schematic fixture checks only, never article-performance evidence."""
import json
from pathlib import Path
import tempfile
import unittest
from run_artifacts import compile_writer, release, validate_reference, paragraphs, sha


class Artifacts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        source = '가 가\n\nTail e\u0301\n'
        self.common = dict(article_id='fixture', source=source, source_sha256=sha(source.encode()),
                           paragraphs=paragraphs(source), evidence={'records': []})
        self.input = self.save('input.json', self.common)
        self.ids = dict(article_id='fixture', source_sha256=self.common['source_sha256'],
                        input_sha256=sha(self.input.read_bytes()), read_complete=True)

    def save(self, name, data):
        path = self.root / name
        path.write_text(json.dumps(data, ensure_ascii=False))
        return path

    def compile(self, patches=None, arm='LOCAL', name='candidate', **extra):
        response = dict(self.ids)
        response['status'] = 'complete'
        response.update({'patches': patches or []} if arm == 'LOCAL' else {'output': 'Changed\n\nTail e\u0301\n'})
        response.update(extra)
        response_path = self.save(name+'-response.json', response)
        directory = self.root / name
        meta = compile_writer(self.input, response_path, arm, directory)
        return directory, meta

    def patch(self, **extra):
        p = dict(paragraph_id='P001', before='가', after='나', occurrence=1, reason='fixture', evidence_ids=[])
        p.update(extra)
        return p

    def audit(self, directory, **extra):
        packet = json.loads((directory / 'audit-packet.json').read_text())
        verdict = {k: packet[k] for k in ('opaque_id', 'source_sha256', 'candidate_sha256')}
        verdict.update(read_complete=True, complete=True, decision='approved',
                       coverage=[dict(source_paragraph_id=p['id'], status='covered') for p in packet['source_paragraphs']],
                       output_support=[dict(candidate_paragraph_id=p['id'], status='unknown') for p in packet['candidate_paragraphs']],
                       changes=[dict(change_id=c['change_id'], decision='approved') for c in packet['changes']])
        verdict.update(extra)
        return self.save('audit.json', verdict)

    def test_unicode_occurrence_and_anonymous_packet(self):
        directory, meta = self.compile([self.patch()])
        self.assertTrue(meta['mechanical_valid'])
        self.assertEqual((directory/'candidate.txt').read_bytes(), '가 나\n\nTail e\u0301\n'.encode())
        packet = json.loads((directory/'audit-packet.json').read_text())
        self.assertTrue(packet['changes'])
        self.assertFalse({'arm', 'article_id', 'reason', 'proposal'} & set(packet))
        report = release(directory, self.audit(directory), self.root/'released')
        self.assertFalse(report['rollback'])
        with self.assertRaises(FileExistsError):
            release(directory, self.audit(directory), self.root/'released')

    def test_ambiguity_crossparagraph_and_overlap(self):
        ambiguous = self.patch()
        ambiguous.pop('occurrence')
        for i, patches in enumerate(([ambiguous], [self.patch(before='가\n\nTail')], [self.patch(), self.patch()])):
            directory, meta = self.compile(patches, name='bad'+str(i))
            self.assertFalse(meta['mechanical_valid'])
            self.assertFalse((directory/'candidate.txt').exists())
            report = release(directory, self.root/'missing-audit', self.root/('released'+str(i)))
            self.assertTrue(report['rollback'])

    def test_missing_incomplete_wrong_hash_and_hunk_audits_rollback(self):
        directory, _ = self.compile([self.patch()])
        for i, overrides in enumerate(({'complete': False}, {'candidate_sha256':'bad'}, {'changes':[]}, {'coverage':[]}, {'output_support':[]}, {'decision':'unknown'})):
            report = release(directory, self.audit(directory, **overrides), self.root/('release'+str(i)))
            self.assertTrue(report['rollback'])
            self.assertEqual(report['output_sha256'], self.common['source_sha256'])
        self.assertTrue(release(directory, self.root/'missing', self.root/'missing-release')['rollback'])

    def test_fullrewrite_diagnostic_only_and_invalid_no_fake_output(self):
        directory, meta = self.compile(arm='FULLREWRITE')
        report = release(directory, self.audit(directory, decision='rejected'), self.root/'released')
        self.assertEqual(report['output_sha256'], meta['candidate_sha256'])
        self.assertFalse(report['rollback'])
        bad, _ = self.compile(arm='FULLREWRITE', name='bad', input_sha256='wrong')
        report = release(bad, self.root/'missing', self.root/'bad-release')
        self.assertFalse(report['output_exists'])

    def test_noop_and_tamper_detection(self):
        directory, _ = self.compile()
        report = release(directory, self.audit(directory), self.root/'released')
        self.assertFalse(report['rollback'])
        self.assertEqual(report['output_sha256'], self.common['source_sha256'])
        (directory/'candidate.txt').write_text('tampered')
        with self.assertRaises(ValueError):
            release(directory, self.audit(directory), self.root/'tamper-release')

    def test_declared_incomplete_and_input_collision(self):
        directory, meta = self.compile(status='incomplete')
        self.assertFalse(meta['mechanical_valid'])
        self.assertFalse((directory/'candidate.txt').exists())
        before = self.input.read_bytes()
        with self.assertRaises(FileExistsError):
            compile_writer(self.input, self.root/'candidate-response.json', 'LOCAL', self.input)
        self.assertEqual(self.input.read_bytes(), before)

    def test_reference_all_paragraphs_links_and_anchors(self):
        ref = dict(self.ids, claims=[dict(id='c1', paragraph_ids=['P001'], source_anchor='가')],
                   paragraphs=[dict(id='P001', claim_ids=['c1'], coverage='covered'), dict(id='P002', claim_ids=[], coverage='uncertain', nonclaim_reason='fixture only')],
                   issues=[dict(id='i1', paragraph_ids=['P001'], claim_ids=['c1'], necessity='unknown', problem='fixture', criterion='fixture', reason='fixture', evidence_ids=[])])
        path = self.save('reference.json', ref)
        self.assertTrue(validate_reference(self.input, path)['structural_valid'])
        for mutate in ('anchor', 'paragraph', 'link', 'necessity'):
            bad = json.loads(json.dumps(ref))
            if mutate == 'anchor': bad['claims'][0]['source_anchor'] = 'absent'
            if mutate == 'paragraph': bad['paragraphs'].pop()
            if mutate == 'link': bad['paragraphs'][0]['claim_ids'] = []
            if mutate == 'necessity': bad['issues'][0]['necessity'] = 'success'
            with self.assertRaises(ValueError):
                validate_reference(self.input, self.save('bad-ref.json', bad))


if __name__ == '__main__':
    unittest.main()
