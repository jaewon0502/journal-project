"""Real overdepth JSON input and explicit nesting boundaries; no hidden cases."""
import json
import unittest
from unittest.mock import patch
import receipt as r
from test_receipt import fixture


def final_with_metadata(args, depth):
    # Root object is one level; array chain brings total to depth.
    original=args[7][0]
    return original[:-1]+b',"extra":'+b'['*(depth-1)+b'0'+b']'*(depth-1)+b'}'

class NestingContractTests(unittest.TestCase):
    def test_actual_twenty_thousand_byte_reproduction(self):
        args=list(fixture()); rec=r.build(*args)
        raw=b'{"deep":'+b'['*10000+b'0'+b']'*10000+b'}'
        self.assertEqual(len(raw),20010)
        args[7]=(raw,)
        for lang in ('EN','KO'):
            result=r.emit(rec,*args,lang=lang)
            self.assertEqual(result,{'status':'verification_failed','receipt_sha256':None,
                'text':'Verification failed. No completion or application claim is available.' if lang=='EN' else '검증 실패. 완료 또는 적용 여부를 확인할 수 없습니다.'})
        with self.assertRaisesRegex(ValueError,'nesting exceeds supported limit'): r.build(*args)

    def test_genuine_valid_json_at_and_beyond_supported_depth(self):
        self.assertEqual(r.MAX_JSON_NESTING,64)
        for depth in (63,64):
            args=list(fixture()); args[7]=(final_with_metadata(args,depth),)
            self.assertIsInstance(json.loads(args[7][0]),dict)
            args[0],args[2]=r.v10.build_delivery(*args[3:7],args[7])
            rec=r.build(*args)
            self.assertEqual(r.emit(rec,*args)['status'],'verified')
        args=list(fixture()); args[7]=(final_with_metadata(args,65),)
        args[0],args[2]=r.v10.build_delivery(*args[3:7],args[7])
        with self.assertRaisesRegex(ValueError,'nesting exceeds supported limit'): r.build(*args)

    def test_string_brackets_and_escaped_quotes_do_not_count(self):
        data={'text':'['*10000+'\\"'+']'*10000}
        raw=r.canonical(data)
        self.assertEqual(r.bounded_json_nesting(raw),raw)
        args=list(fixture()); final=json.loads(args[7][0]); final['extra']=data['text']
        args[7]=(r.canonical(final),)
        args[0],args[2]=r.v10.build_delivery(*args[3:7],args[7])
        rec=r.build(*args)
        self.assertEqual(r.emit(rec,*args)['status'],'verified')

    def test_all_raw_input_paths_and_forged_receipt(self):
        args=fixture(); rec=r.build(*args)
        deep=b'{"deep":'+b'['*10000+b'0'+b']'*10000+b'}'
        for index in (4,5,6):
            changed=list(args); changed[index]=deep
            self.assertEqual(r.emit(rec,*changed)['status'],'verification_failed')
        forged=object.__new__(r.Receipt); object.__setattr__(forged,'raw',deep)
        self.assertEqual(r.emit(forged,*args)['status'],'verification_failed')
        with self.assertRaisesRegex(ValueError,'nesting exceeds supported limit'): r.Receipt(deep)

    def test_programming_recursion_error_is_not_hidden(self):
        args=fixture(); rec=r.build(*args)
        with patch.object(r.v10,'verify_delivery',side_effect=RecursionError('application defect')):
            with self.assertRaisesRegex(RecursionError,'application defect'): r.emit(rec,*args)

if __name__=='__main__': unittest.main()
