import unittest
from realize_T import realize,sha,encode


def fixture():
    item={'case':{'case_id':'DEV-synthetic','draft':'Bad. Rest.','preimage_sha256':sha(b'Bad. Rest.')},
        'detector':{'span':{'start':0,'end':4,'before':'Bad.'},'type':None,'slots':{}},
        'audit':{'shared_action':'repair','factual_error_confirmed':'yes','span_approved':'yes','typed_eligible':'no',
            'standalone_context_safe':'yes','source_path':'s','source_quote_start':0,'source_quote_end':5,'exact_contiguous_source_quote':'Good.'},
        'source_bytes_utf8':{'s':'Good.'}}
    return bind(item)


def bind(item):
    item.pop('authority_sha256',None)
    item['authority_sha256']=sha(encode(item))
    return item


class RealizationTests(unittest.TestCase):
    def test_noop_and_unsupported_preserve_bytes(self):
        item=fixture()
        out,r=realize(item,'typed');self.assertEqual(out,b'Bad. Rest.');self.assertEqual(r['status'],'unsupported')
        item['audit']['shared_action']='no_op';bind(item)
        for method in ('typed','free','exact_extractive'):
            out,r=realize(item,method);self.assertEqual(out,b'Bad. Rest.');self.assertEqual(r['status'],'no_op')

    def test_extractive_exact_and_no_newline_normalization(self):
        item=fixture();out,r=realize(item,'exact_extractive')
        self.assertEqual(out,b'Good. Rest.');self.assertEqual(r['guard_details']['unchanged_bytes'],6)
        item['source_bytes_utf8']['s']='Go\fod.';bind(item)
        out,r=realize(item,'exact_extractive');self.assertEqual(out,b'Bad. Rest.');self.assertEqual(r['status'],'rollback')

    def test_free_cannot_expand_span_or_use_stale_authority(self):
        item=fixture();response={'case_id':'DEV-synthetic','decision':'patch','start':0,'end':10,'before':'Bad. Rest.','after':'Good.'}
        out,r=realize(item,'free',response);self.assertEqual(out,b'Bad. Rest.');self.assertEqual(r['guard_status'],'failed')
        item['audit']['span_approved']='no'
        out,r=realize(item,'exact_extractive');self.assertEqual(out,b'Bad. Rest.');self.assertEqual(r['guard_error'],'authority_binding_mismatch')


if __name__=='__main__':unittest.main()
