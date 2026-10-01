import unittest
from pathlib import Path
from realize_T_v2 import resolve_quote,load_renderer,realize
from test_realize_T import fixture,bind


class RealizationV2Tests(unittest.TestCase):
    def test_unique_exact_quote_resolves_only_null_offsets(self):
        audit={'shared_action':'repair','standalone_context_safe':'yes','source_path':'s',
               'source_quote_start':None,'source_quote_end':None,'exact_contiguous_source_quote':'é\fX'}
        resolved,log=resolve_quote(audit,{'s':'--é\fX!'})
        self.assertEqual((resolved['source_quote_start'],resolved['source_quote_end']),(2,6))
        self.assertFalse(log['normalized'])
        self.assertIsNone(audit['source_quote_start'])
        _,log=resolve_quote(audit,{'s':'é\fXé\fX'})
        self.assertEqual(log['error'],'quote_not_exact_unique')
        _,log=resolve_quote(audit,{'s':'é\nX'})
        self.assertEqual(log['error'],'quote_not_exact_unique')

    def test_renderer_load_and_span_guard(self):
        load_renderer(Path(__file__).with_name('typed_renderer_v2_dev.py'))
        item=fixture();item['audit']['typed_eligible']='yes';item['detector']['type']='protection_status'
        item['detector']['slots']={'discrimination_scope':'x','population':'y','protection_status':'retained','legal_context':'z'};bind(item)
        out,report=realize(item,'typed')
        self.assertTrue(out.endswith(b' Rest.'));self.assertEqual(report['guard_status'],'passed')
        item['detector']['span']['end']=5;bind(item)
        out,report=realize(item,'typed');self.assertEqual(out,b'Bad. Rest.');self.assertEqual(report['status'],'rollback')


if __name__=='__main__':unittest.main()
