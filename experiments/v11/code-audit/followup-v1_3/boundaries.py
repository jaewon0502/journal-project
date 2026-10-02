"""Additional final-version input-boundary checks; no implementation mutations."""
import codecs,json,sys,tempfile
from pathlib import Path
sys.path.insert(0,'/historical-research/journal-v11/receipt-v1_3')
import receipt as r
from test_receipt import fixture
ROOT=Path('/historical-research/journal-v11/code-audit/followup-v1_3')
observed={'encoding_variants':[],'malformed_utf8_and_raw_nul':[],'noop_korean':[],'stored_corrupt_encoding':[]}
a=fixture();rec=r.build(*a)
for encoding,bom in [('utf-16-le',codecs.BOM_UTF16_LE),('utf-16-be',codecs.BOM_UTF16_BE),('utf-32-le',codecs.BOM_UTF32_LE),('utf-32-be',codecs.BOM_UTF32_BE)]:
    for prefix in (b'',bom):
        # Schema-valid complete audit: prior v1.2 could mint this depth65 case.
        text=a[7][0][:-1].decode()+',"escaped":"\\\"","deep":'+'['*64+'0'+']'*64+'}'
        raw=prefix+text.encode(encoding)
        changed=list(a);changed[7]=(raw,);changed[0],changed[2]=r.v10.build_delivery(*changed[3:7],changed[7])
        try:r.build(*changed);accepted=True
        except (ValueError,UnicodeError):accepted=False
        assert not accepted
        # Actual RecursionError reproducer, larger than the supported depth.
        deep=prefix+('{"escape":"\\\"","deep":'+'['*10000+'0'+']'*10000+'}').encode(encoding)
        changed=list(a);changed[7]=(deep,)
        response=r.emit(rec,*changed)
        assert response['status']=='verification_failed' and response['receipt_sha256'] is None
        observed['encoding_variants'].append({'encoding':encoding,'bom':bool(prefix),'depth65_mint_rejected':True,'deep_bytes':len(deep),'deep_response':response['status']})
malformed=[b'\x80',b'\xc0\xaf',b'\xed\xa0\x80',b'\xf0\x9f\x92',b'\xf4\x90\x80\x80',b'{"x":"a\x00b"}',b'\x00{}',b'{}\x00']
for raw in malformed:
    for i in (4,5,6,7):
        changed=list(a);changed[i]=(raw,) if i==7 else raw
        for lang in ('EN','KO'):
            response=r.emit(rec,*changed,lang=lang)
            expected='Verification failed. No completion or application claim is available.' if lang=='EN' else '검증 실패. 완료 또는 적용 여부를 확인할 수 없습니다.'
            assert response=={'status':'verification_failed','receipt_sha256':None,'text':expected}
    observed['malformed_utf8_and_raw_nul'].append({'hex':raw.hex(),'all_four_json_input_paths_both_languages':'fixed verification_failed'})
    # Retrieval of corrupt bytes fails; caller-owned test files only.
    with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
        folder=Path(tmp)/'objects';store=r.Store(folder);address=r.digest(raw);(folder/(address+'.json')).write_bytes(raw)
        try:
            try:store.get(address,*a);accepted=True
            except (ValueError,UnicodeError):accepted=False
            assert not accepted
        finally:store.close()
    observed['stored_corrupt_encoding'].append({'hex':raw.hex(),'get_rejected':True})
for bom in (b'',codecs.BOM_UTF8):
    for depth in (63,64,65):
        changed=list(fixture('no-op','KO'));value=json.loads(changed[7][0]);value['quoted']='한글 [괄호] {문자열} "인용" \\ 널 \x00';head=r.canonical(value)[:-1]
        raw=bom+head+b',"depth":'+b'['*(depth-1)+b'0'+b']'*(depth-1)+b'}'
        assert b'\x00' not in raw and b'\\u0000' in raw
        changed[7]=(raw,);changed[0],changed[2]=r.v10.build_delivery(*changed[3:7],changed[7])
        try:
            receipt=r.build(*changed);emitted=r.emit(receipt,*changed,lang='KO');data=json.loads(receipt.raw)
            assert depth<=64 and data['status']=='no-op' and emitted['status']=='verified'
            assert data['question_resolution']=='not_adjudicated' and data['semantic_truth']=='not_independently_verified'
            state='verified no-op'
        except ValueError:
            assert depth==65;state='rejected at mint'
        observed['noop_korean'].append({'bom':bool(bom),'depth':depth,'result':state})
(ROOT/'boundary-results.json').write_text(json.dumps(observed,indent=2,ensure_ascii=False)+'\n')
print('PASS: 8 encoding bypass variants; 8 malformed/NUL variants across four input paths and both languages; 8 corrupt-store reads; 6 Korean no-op boundary cases')
