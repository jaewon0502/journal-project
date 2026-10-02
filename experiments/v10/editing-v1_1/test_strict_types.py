"""Bounded v1.1 follow-up regression: typed delivery annotations only."""
import copy
import json
import unittest
from delivery import build_delivery, verify_delivery, strict_json_equal
from test_delivery import fixture, verdict

class StrictTypeTests(unittest.TestCase):
    def setUp(self):
        self.args=fixture(); self.audits=[verdict(self.args)]
        self.output,self.note=build_delivery(*self.args,self.audits)

    def test_reported_three_type_aliases_rejected_individually_and_together(self):
        for which in ('released','source_span','output_span','all'):
            n=copy.deepcopy(self.note)
            if which in ('released','all'): n['released']=1
            if which in ('source_span','all'): n['patches'][0]['source_span']=[False,True]
            if which in ('output_span','all'): n['patches'][0]['output_span']=[0.0,1.0]
            n=json.loads(json.dumps(n))
            with self.subTest(which=which), self.assertRaises(ValueError):
                verify_delivery(self.output,n,*self.args,self.audits)

    def test_normal_roundtrip_and_recursive_field_reordering_pass(self):
        def reorder(x):
            if type(x) is dict: return {k:reorder(v) for k,v in reversed(list(x.items()))}
            if type(x) is list: return [reorder(v) for v in x]
            return x
        for n in (json.loads(json.dumps(self.note)),reorder(self.note)):
            self.assertTrue(verify_delivery(self.output,n,*self.args,self.audits))

    def test_nonfinite_and_non_json_values_rejected(self):
        for value in (float('nan'),float('inf'),float('-inf'),None,'1',b'1',(0,1),{0,1}):
            n=copy.deepcopy(self.note); n['patches'][0]['output_span']=value
            with self.subTest(value=repr(value)), self.assertRaises(ValueError):
                verify_delivery(self.output,n,*self.args,self.audits)
        for value in (float('nan'),float('inf'),float('-inf')):
            self.assertFalse(strict_json_equal(value,value))

    def test_helper_exact_types_including_keys_and_custom_types(self):
        class FakeInt(int): pass
        for a,b in [(True,1),(1,1.0),(False,0),((1,),[1]),({1:'a'},{'1':'a'}),(FakeInt(1),1)]:
            with self.subTest(a=repr(a),b=repr(b)): self.assertFalse(strict_json_equal(a,b))
        for x in (None,True,False,0,1,1.5,'x',[],{}): self.assertTrue(strict_json_equal(x,x))

if __name__=='__main__': unittest.main(verbosity=2)
