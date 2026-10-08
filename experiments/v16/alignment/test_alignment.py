import unittest
from copy import deepcopy
from alignment import build_alignment, replay

class AlignmentTests(unittest.TestCase):
    def test_multilingual_insert_delete_replace(self):
        for a,b in [('시가 책임졌다. 일부만 지급.','시가 책임졌다. 모두 지급.'),('He did not approve.','He did approve.'),('작년 9, 올해 10.','올해 10.'),('ab','axb'),('🙂🙂 가','🙂🙂 나')]:
            self.assertEqual(replay(a,build_alignment(a,b)),b)
    def test_unchanged_is_not_semantic_certification(self):
        x=build_alignment('A says X.','A says X.')
        self.assertEqual(x['rows'],[])
        self.assertIn('not semantic',x['warning'])
    def test_repeated_spans_have_exact_offsets(self):
        a='aa aa aa';b='aa XX aa';x=build_alignment(a,b)
        self.assertEqual(replay(a,x),b)
        self.assertEqual(x['rows'][0]['original_start'],3)
    def test_digest_or_offset_tampering_fails(self):
        x=build_alignment('abcd','abXd')
        for field,value in [('original_sha256','wrong'),('candidate_sha256','wrong')]:
            y=deepcopy(x);y[field]=value
            with self.assertRaises(ValueError):replay('abcd',y)
        y=deepcopy(x);y['rows'][0]['original_start']=0
        with self.assertRaises(ValueError):replay('abcd',y)
    def test_input_types_and_context(self):
        for v in [True,-1,1001,1.2,'80']:
            with self.assertRaises(ValueError):build_alignment('a','b',v)
        with self.assertRaises(ValueError):build_alignment(None,'b')

if __name__=='__main__':unittest.main()
