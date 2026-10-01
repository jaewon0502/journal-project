import unittest
from typed_renderer import render,required_fields,TEMPLATES

class RendererTests(unittest.TestCase):
    def test_noop_ignores_unnecessary_slots(self):
        self.assertEqual(render({'before':'원래 문장\r\n','repair_needed':False})['text'],'원래 문장\r\n')
    def test_unapproved_rolls_back(self):
        self.assertEqual(render({'before':'원문','repair_needed':True,'audit_decision':'unknown'})['text'],'원문')
    def test_wrong_semantic_slots_not_detected_by_schema(self):
        # Synthetic test demonstrates a limitation, not an experiment result.
        slots=dict(entity='synthetic index',measure='prices',quantity_kind='level',baseline_time='t0',baseline_value='2',current_time='t1',current_value='3',unit='%',direction='decreased')
        out=render(dict(before='예시',repair_needed=True,audit_decision='approved',type='numeric_direction',slots=slots))
        self.assertIn('decreased',out['text'])
        self.assertFalse(out['semantic_validation'])
    def test_all_six_types_have_distinct_slots(self):
        self.assertEqual(len(TEMPLATES),6)
        for kind in TEMPLATES:
            self.assertEqual(len(required_fields(kind)),len(set(required_fields(kind))))

if __name__=='__main__': unittest.main()
