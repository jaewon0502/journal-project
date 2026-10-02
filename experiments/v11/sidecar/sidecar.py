"""Bounded source-linked review assertions, separate from frozen state receipts."""
from pathlib import Path
from dataclasses import dataclass
from hashlib import sha256
import importlib.util
import json
import os
import stat

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('_sidecar_portable_loader',ROOT.parent/'portable'/'loader.py')
loader=importlib.util.module_from_spec(spec); spec.loader.exec_module(loader)
R=loader.load_receipt('v1_3')
R.require(R.PORTABLE_REPLAY_PROVENANCE['original_receipt_sha256']=='3f3a4dc118c4311bd0adef8fe4893cd6d1340ce1e490b445febb7d13464a6014','unexpected receipt implementation')
MAX_INPUT_BYTES=2*1024*1024
MAX_ISSUES=16
MAX_EVIDENCE=32
MAX_SPAN_BYTES=2048
KINDS={'EN':{'question_comparison':'Question comparison','arithmetic':'Arithmetic'},'KO':{'question_comparison':'질문 비교','arithmetic':'산술'}}
CAVEAT={'EN':'Supplied review reports this issue unresolved; the sidecar does not independently verify the claim.','KO':'제공된 검토는 이 문제를 미해결로 보고합니다. 이 보조표가 그 주장을 독립 검증하지는 않습니다.'}
EMPTY={'EN':'No unresolved issues were supplied; this does not establish that all issues are resolved.','KO':'제공된 미해결 문제 목록은 비어 있습니다. 모든 문제가 해결됐다는 뜻은 아닙니다.'}
def digest(raw): return sha256(raw).hexdigest()
def need(value,message):
    if not value: raise ValueError(message)
def keys(value,expected):
    need(type(value) is dict and set(value)==set(expected),'missing or unexpected fields')
def ident(value):
    need(type(value) is str and 0<len(value)<=128 and value.strip()==value and all(ord(c)>=32 for c in value),'invalid identifier')
def hash_value(value):
    need(type(value) is str and len(value)==64 and all(c in '0123456789abcdef' for c in value),'invalid hash')
def parse(raw):
    need(type(raw) is bytes and len(raw)<=MAX_INPUT_BYTES,'bounded raw JSON bytes required')
    R.bounded_json_nesting(raw)
    return R.engine.parse(raw)
def read_container(path):
    need(type(path) is str and path and '\x00' not in path,'invalid receipt file path')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_size<=MAX_INPUT_BYTES,'invalid or overlength receipt container')
        with os.fdopen(fd,'rb',closefd=False) as f: raw=f.read(MAX_INPUT_BYTES+1)
        need(len(raw)<=MAX_INPUT_BYTES,'overlength receipt container')
        return raw
    finally: os.close(fd)
def span(value,body,*,evidence=False):
    fields={'start_byte','end_byte','text','sha256'}|({'evidence_id'} if evidence else set())
    keys(value,fields)
    start,end=value['start_byte'],value['end_byte']
    need(type(start) is int and type(end) is int and 0<=start<end<=len(body),'invalid UTF-8 byte span')
    need(type(value['text']) is str,'span text required')
    raw=value['text'].encode('utf-8')
    need(len(raw)<=MAX_SPAN_BYTES and body[start:end]==raw,'invented, split UTF-8, or overlength anchor')
    hash_value(value['sha256']); need(digest(raw)==value['sha256'],'span hash mismatch')

@dataclass(frozen=True)
class Sidecar:
    raw: bytes
    @property
    def address(self): return digest(self.raw)

def build(sidecar_raw,receipt_raw,*receipt_args,**receipt_kwargs):
    """Verify exact upstream receipt/output first; then every supplied issue.

    receipt_args/kwargs are the frozen v1.3 build contract (including policy).
    The receipt_address file is opened read-only and its exact bytes are bound.
    """
    receipt=R.Receipt(receipt_raw)
    R.verify(receipt,*receipt_args,**receipt_kwargs)
    data=parse(sidecar_raw)
    keys(data,{'schema','input_id','language','actual_output','output_sha256','receipt_address','evidence','issues'})
    need(data['schema']=='journal-v11.issue-sidecar-input.v1','invalid sidecar schema')
    ident(data['input_id']); lang=data['language']; need(type(lang) is str and lang in KINDS,'invalid language')
    need(type(data['actual_output']) is str,'output string required')
    output=data['actual_output'].encode('utf-8')
    need(output==receipt_args[0],'sidecar output differs from verified actual output')
    hash_value(data['output_sha256']); need(digest(output)==data['output_sha256'],'stale output hash')
    address=data['receipt_address']; keys(address,{'path','json_pointer','file_sha256','receipt_sha256'})
    need(address['json_pointer']=='/actual_receipt','unsupported receipt pointer')
    for key in ('file_sha256','receipt_sha256'): hash_value(address[key])
    container_raw=read_container(address['path'])
    need(digest(container_raw)==address['file_sha256'],'stale receipt file hash')
    container=parse(container_raw)
    need('actual_receipt' in container,'missing receipt pointer')
    need(R.canonical(container['actual_receipt'])==receipt_raw,'receipt object differs from verified receipt')
    need(digest(receipt_raw)==address['receipt_sha256'],'receipt address mismatch')
    need(json.loads(receipt_raw)['output_sha256']==data['output_sha256'],'receipt/output mismatch')
    evidence=data['evidence']; need(type(evidence) is list and len(evidence)<=MAX_EVIDENCE,'invalid or overlength evidence list')
    documents={}
    for item in evidence:
        keys(item,{'id','text','sha256'}); ident(item['id']); hash_value(item['sha256'])
        need(item['id'] not in documents and type(item['text']) is str,'duplicate evidence or invalid text')
        raw=item['text'].encode('utf-8'); need(digest(raw)==item['sha256'],'stale evidence hash')
        documents[item['id']]=raw
    issues=data['issues']; need(type(issues) is list and len(issues)<=MAX_ISSUES,'invalid or overlength issue list')
    seen=set(); lines=[]
    for issue in issues:
        keys(issue,{'id','kind','review_status','output_span','evidence_span'}); ident(issue['id'])
        need(issue['id'] not in seen,'duplicate issue ID'); seen.add(issue['id'])
        need(type(issue['kind']) is str and issue['kind'] in KINDS[lang],'unknown issue kind')
        need(issue['review_status']=='reported_unresolved','unsupported review assertion')
        span(issue['output_span'],output)
        anchor=issue['evidence_span']; need(type(anchor) is dict,'invalid evidence anchor')
        evidence_id=anchor.get('evidence_id'); need(type(evidence_id) is str and evidence_id in documents,'unknown evidence anchor')
        span(anchor,documents[evidence_id],evidence=True)
        quote=lambda value:json.dumps(value,ensure_ascii=False)
        lines.append(f"[{quote(issue['id'])}] {KINDS[lang][issue['kind']]}\n"+
            ('출력 인용: ' if lang=='KO' else 'Output quote: ')+quote(issue['output_span']['text'])+'\n'+
            ('근거 인용: ' if lang=='KO' else 'Evidence quote: ')+quote(anchor['text'])+'\n'+CAVEAT[lang])
    rendered='\n\n'.join(lines) if lines else EMPTY[lang]
    original=R.emit(receipt,*receipt_args,lang=lang,**receipt_kwargs)
    need(original['status']=='verified','upstream receipt annotation failed')
    combined=original['text']+'\n\n'+rendered
    need(len(combined)<=1600 if lang=='KO' else len(combined.split())<=400,'combined annotation exceeds language budget; no issue may be omitted')
    value={'schema':'journal-v11.issue-sidecar.v1','input_sha256':digest(sidecar_raw),'output_sha256':digest(output),
           'receipt_sha256':digest(receipt_raw),'language':lang,'issues':issues,
           'review_assertion':'reported_unresolved','independently_verified':False,'rendered_text':rendered}
    raw=R.canonical(value); need(len(raw)<=MAX_INPUT_BYTES,'overlength sidecar output')
    return Sidecar(raw)

def verify(sidecar,sidecar_raw,receipt_raw,*receipt_args,**receipt_kwargs):
    need(type(sidecar) is Sidecar and type(sidecar.raw) is bytes,'invalid sidecar')
    expected=build(sidecar_raw,receipt_raw,*receipt_args,**receipt_kwargs)
    need(sidecar.raw==expected.raw,'sidecar differs from full replay')
    return True

def emit(sidecar_raw,receipt_raw,*receipt_args,**receipt_kwargs):
    try:
        result=build(sidecar_raw,receipt_raw,*receipt_args,**receipt_kwargs)
        value=json.loads(result.raw)
        status=R.emit(R.Receipt(receipt_raw),*receipt_args,lang=value['language'],**receipt_kwargs)
        need(status['status']=='verified','upstream receipt annotation failed')
        return {'status':'verified','sidecar_sha256':result.address,'sidecar':value,
                'text':value['rendered_text'],'combined_text':status['text']+'\n\n'+value['rendered_text']}
    except (ValueError,TypeError,KeyError,IndexError,UnicodeError,OSError,AttributeError):
        return {'status':'verification_failed','sidecar_sha256':None,
                'text':'Sidecar verification failed; no issue annotation was accepted.'}
