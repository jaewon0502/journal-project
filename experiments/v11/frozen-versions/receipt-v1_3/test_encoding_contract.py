"""Encoding guard regression: authored fixtures only, no hidden reader cases."""
import codecs
import json
import unittest
import receipt as r
from test_receipt import fixture

ENCODINGS=(('utf-16-le',codecs.BOM_UTF16_LE),('utf-16-be',codecs.BOM_UTF16_BE),
           ('utf-32-le',codecs.BOM_UTF32_LE),('utf-32-be',codecs.BOM_UTF32_BE))

def deep_text(depth):
    return '{"escape":"\\\"","deep":'+'['*depth+'0'+']'*depth+'}'

class EncodingContractTests(unittest.TestCase):
    def test_utf16_utf32_endian_bom_variants_deep_fail_closed(self):
        args=list(fixture()); rec=r.build(*args)
        for encoding,bom in ENCODINGS:
            for prefix in (b'',bom):
                with self.subTest(encoding=encoding,bom=bool(prefix)):
                    # Confirm JSON decoder's genuine encoding-autodetection behavior
                    # with a shallow equivalent before testing the deep attack.
                    self.assertIsInstance(json.loads(prefix+deep_text(2).encode(encoding)),dict)
                    raw=prefix+deep_text(10000).encode(encoding)
                    self.assertLess(len(raw),r.engine.MAX_BYTES)
                    with self.assertRaises((ValueError,UnicodeError)): r.bounded_json_nesting(raw)
                    args[7]=(raw,)
                    for lang in ('EN','KO'):
                        result=r.emit(rec,*args,lang=lang)
                        self.assertEqual(result['status'],'verification_failed')
                        self.assertIsNone(result['receipt_sha256'])

    def test_complete_depth65_utf16_utf32_cannot_mint(self):
        for encoding,bom in ENCODINGS:
            for prefix in (b'',bom):
                args=list(fixture())
                text=args[7][0][:-1].decode()+',"escaped":"\\\"","deep":'+'['*64+'0'+']'*64+'}'
                raw=prefix+text.encode(encoding)
                self.assertIsInstance(json.loads(raw),dict)
                args[7]=(raw,)
                args[0],args[2]=r.v10.build_delivery(*args[3:7],args[7])
                with self.assertRaises((ValueError,UnicodeError)): r.build(*args)

    def test_utf8_korean_escapes_escaped_nul_and_optional_bom(self):
        for bom in (b'',codecs.BOM_UTF8):
            args=list(fixture(lang='KO'))
            final=json.loads(args[7][0])
            final['extra']='한글 "인용" \\ [] {} 실제 문자열 내 널: \x00'
            raw=bom+r.canonical(final)
            self.assertIn(b'\\u0000',raw)
            self.assertNotIn(b'\x00',raw)
            self.assertEqual(r.bounded_json_nesting(raw),raw)
            args[7]=(raw,)
            args[0],args[2]=r.v10.build_delivery(*args[3:7],args[7])
            rec=r.build(*args)
            self.assertEqual(r.emit(rec,*args,lang='KO')['status'],'verified')

    def test_raw_nul_and_invalid_utf8_all_input_boundaries(self):
        args=fixture(); rec=r.build(*args)
        for raw in (b'{"x":"a\x00b"}',b'{"x":"\xff"}',deep_text(2).encode('utf-16-le')):
            for index in (4,5,6):
                altered=list(args); altered[index]=raw
                self.assertEqual(r.emit(rec,*altered)['status'],'verification_failed')
            altered=list(args); altered[7]=(raw,)
            self.assertEqual(r.emit(rec,*altered)['status'],'verification_failed')
            with self.assertRaises((ValueError,UnicodeError)): r.Receipt(raw)
            forged=object.__new__(r.Receipt); object.__setattr__(forged,'raw',raw)
            self.assertEqual(r.emit(forged,*args)['status'],'verification_failed')

if __name__=='__main__': unittest.main()
