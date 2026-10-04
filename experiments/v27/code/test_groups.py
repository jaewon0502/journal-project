import unittest
from groups import apply_groups,validate_partition

def group(i,a,b,before,after):return {'id':i,'edits':[{'start':a,'end':b,'before':before,'after':after}]}
class Delivery(unittest.TestCase):
 def test_unicode_offsets(self):
  g=[group('a',0,2,'정상','수정')];self.assertEqual(apply_groups('정상 문장',g,['a']),'수정 문장')
 def test_disjoint_partial(self):
  g=[group('a',0,1,'A','X'),group('b',2,3,'B','Y')];self.assertEqual(apply_groups('A B',g,['b']),'A Y')
 def test_noncontiguous_semantic_group(self):
  g=group('a',0,1,'A','X');g['edits']+=group('b',4,5,'C','Z')['edits'];self.assertEqual(apply_groups('A B C',[g],['a']),'X B Z')
 def test_overlapping_rejected(self):
  with self.assertRaises(ValueError):apply_groups('aaa',[group('a',0,2,'aa','x'),group('b',1,3,'aa','y')],['a'])
 def test_insertion_inside_replacement_rejected(self):
  with self.assertRaises(ValueError):apply_groups('abc',[group('a',0,3,'abc','x'),group('b',1,1,'','y')],['a'])
 def test_duplicate_boundary_rejected(self):
  with self.assertRaises(ValueError):apply_groups('a',[group('a',0,0,'','x'),group('b',0,0,'','y')],['a','b'])
 def test_nonlossless_rejected(self):
  with self.assertRaises(ValueError):validate_partition('A B','X Y',[group('a',0,1,'A','X')])
 def test_semantic_break_not_certified(self):
  g=[group('a',0,3,'not',''),group('b',4,8,'safe','unsafe')]
  result=validate_partition('not safe',' unsafe',g)
  self.assertEqual(result['semantic_validity'],'not_certified')
  self.assertEqual(apply_groups('not safe',g,['a']),' safe') # Structural acceptance does not establish truth.
if __name__=='__main__':unittest.main()
