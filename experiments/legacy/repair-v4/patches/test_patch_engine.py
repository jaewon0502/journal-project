"""Synthetic minimal pairs test specified byte operations, NOT semantic ability."""
import json
import unittest
from pathlib import Path
from patch_engine import apply, rollback, sha, Conflict

PAIRS=[
 ('attribution','위원회는 A사가 피해를 봤다고 밝혔다.\n정상 문장: 수치는 잠정치다.','A사는 피해를 봤다.\n정상 문장: 수치는 잠정치다.','A사는 피해를 봤다.','위원회는 A사가 피해를 봤다고 밝혔다.'),
 ('comparison_axis','취업자는 전년동월보다 8만명 늘었다.\n정상 문장: 조사 방식은 같다.','취업자는 전월보다 8만명 늘었다.\n정상 문장: 조사 방식은 같다.','전월보다','전년동월보다'),
 ('duration','청년 취업자는 19개월 연속 감소했다.\n정상 문장: 고용률은 46.9%다.','청년 취업자는 감소했다.\n정상 문장: 고용률은 46.9%다.','감소했다.','19개월 연속 감소했다.'),
 ('exception','일부 식품에도 적용했다. 다만 1월부터 그 적용을 중단했다.\n정상 문장: 법인만 고발했다.','일부 식품에도 적용했다.\n정상 문장: 법인만 고발했다.','일부 식품에도 적용했다.','일부 식품에도 적용했다. 다만 1월부터 그 적용을 중단했다.')
]
def spec(data,old=None,new=None):
 return {'source_sha256':sha(data),'edits':[] if old is None else [{'id':'single_element','old':old,'new':new}]}
class Tests(unittest.TestCase):
 def test_four_single_element_minimal_pairs_and_normal_controls(self):
  for name,good,bad,old,new in PAIRS:
   with self.subTest(pair=name):
    src=bad.encode(); target, receipt=apply(src,spec(src,old,new))
    self.assertEqual(target,good.encode())
    self.assertEqual(rollback(target,receipt),src)
    # Explicit empty patch on already-correct text. Not an auto detector.
    normal, noop=apply(target,spec(target))
    self.assertEqual(normal,target)
    self.assertEqual(noop['before_sha256'],noop['after_sha256'])
 def test_wrong_source_hash_fails(self):
  with self.assertRaises(Conflict): apply(b'changed',spec(b'original','original','new'))
 def test_missing_anchor_fails(self):
  with self.assertRaises(Conflict): apply(b'abc',spec(b'abc','missing','new'))
 def test_duplicate_anchor_fails(self):
  with self.assertRaises(Conflict): apply(b'a a',spec(b'a a','a','b'))
 def test_overlap_fails(self):
  s=spec(b'abcd','abc','A'); s['edits'].append({'id':'overlap','old':'bcd','new':'B'})
  with self.assertRaises(Conflict): apply(b'abcd',s)
 def test_rollback_conflict_fails(self):
  out,r=apply(b'original',spec(b'original','original','new'))
  with self.assertRaises(Conflict): rollback(out+b'!',r)
 def test_actual_outputs_spans_and_rollback(self):
  for eid in ['EVAL03','EVAL05','NEW01']:
   p=Path(__file__).parent
   s=json.loads((p/f'{eid}.spec.json').read_text())
   source=(p / s['source']).read_bytes(); out,r=apply(source,s)
   self.assertEqual(out,(p / s['output']).read_bytes())
   self.assertEqual(rollback(out,r),source)
   for span in r['unchanged_spans']:
    self.assertEqual(source[span['source_start']:span['source_start']+span['bytes']],out[span['output_start']:span['output_start']+span['bytes']])

if __name__ == '__main__':
 unittest.main()
