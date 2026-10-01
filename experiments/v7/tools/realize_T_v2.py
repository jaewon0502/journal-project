#!/usr/bin/env python3
"""Mechanical T realization harness. No model calls or semantic success claims."""
import argparse
import hashlib
import json
from pathlib import Path
from patch_guard import check
import importlib.util

RENDERER_PATH = None
render = None

def load_renderer(path):
    global render, RENDERER_PATH
    RENDERER_PATH = path.resolve()
    spec=importlib.util.spec_from_file_location("selected_t_renderer",RENDERER_PATH)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    render=module.render
    return sha(RENDERER_PATH.read_bytes())

def resolve_quote(audit,sources):
    audit=dict(audit)
    resolution={"method":"supplied_offsets","normalized":False}
    if audit.get("shared_action")=="repair" and audit.get("standalone_context_safe")=="yes" and (audit.get("source_quote_start") is None or audit.get("source_quote_end") is None):
        raw=sources.get(audit.get("source_path"))
        quote=audit.get("exact_contiguous_source_quote")
        if raw is None or not isinstance(quote,str) or not quote:
            resolution["error"]="missing_source_or_quote"
        else:
            raw=raw.encode();needle=quote.encode();start=raw.find(needle)
            if start<0 or raw.find(needle,start+1)>=0:
                resolution["error"]="quote_not_exact_unique"
            else:
                audit["source_quote_start"]=start;audit["source_quote_end"]=start+len(needle)
                resolution.update(method="exact_unique_utf8_substring",start=start,end=start+len(needle),source_sha256=sha(raw),quote_sha256=sha(needle))
    return audit,resolution


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()


def read(path, provenance):
    raw=path.read_bytes()
    provenance[str(path)] = sha(raw)
    return json.loads(raw)


def exact_span(original, span):
    if not isinstance(span,dict):
        raise ValueError('missing_detector_span')
    start,end=span['start'],span['end']
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(original):
        raise ValueError('invalid_detector_byte_offsets')
    original[:start].decode();original[:end].decode()
    if original[start:end] != span['before'].encode():
        raise ValueError('detector_before_mismatch')


def realize(item, method, free_response=None):
    case,det,audit=item['case'],item['detector'],item['audit']
    original=case['draft'].encode(); span=det.get('span')
    record={'case_id':case['case_id'],'method':method,'original_sha256':sha(original),
        'authority_sha256':item['authority_sha256'],'execution_kind':'mechanical_NOT_model',
        'semantic_success':None,'candidate_sha256':None,'guard_status':'not_applied','quote_resolution':item.get('quote_resolution')}
    released=original; patches=[]; authorized=False; status='shared_hold'
    try:
        authority_payload={k:v for k,v in item.items() if k!='authority_sha256'}
        if sha(encode(authority_payload)) != item['authority_sha256']:
            raise ValueError('authority_binding_mismatch')
        if case['preimage_sha256'] != sha(original):
            raise ValueError('original_preimage_mismatch')
        action=audit.get('shared_action')
        if action=='no_op':
            status='no_op';authorized=True
        elif action=='repair' and audit.get('factual_error_confirmed')=='yes' and audit.get('span_approved')=='yes':
            exact_span(original,span)
            after=None
            if method=='typed':
                if audit.get('typed_eligible')!='yes':
                    status='unsupported';record['reason']=audit.get('typed_ineligibility_reason')
                else:
                    rendered=render({'before':span['before'],'repair_needed':True,'audit_decision':'approved','type':det['type'],'slots':det['slots']})
                    record['renderer_result']=rendered;after=rendered['text'];status='mechanical_rendered'
            elif method=='exact_extractive':
                if audit.get('standalone_context_safe')!='yes':
                    status='extractive_ineligible'
                else:
                    source_path=audit['source_path']
                    source=item['source_bytes_utf8'].get(source_path)
                    if source is None:
                        raise ValueError('quote_source_outside_common_source_set')
                    raw=source.encode();quote=audit['exact_contiguous_source_quote']
                    start,end=audit['source_quote_start'],audit['source_quote_end']
                    if type(start) is not int or type(end) is not int or not 0<=start<end<=len(raw) or raw[start:end]!=quote.encode():
                        raise ValueError('source_quote_exact_byte_match_failed_no_normalization')
                    record['source_quote_sha256']=sha(quote.encode())
                    after=quote;status='mechanical_extracted'
            elif method=='free':
                if free_response is None:
                    status='pending_model_response'
                else:
                    record['execution_kind']='mechanical_guard_of_supplied_model_response'
                    record['free_response_sha256']=sha(encode(free_response))
                    if free_response.get('case_id')!=case['case_id'] or any(free_response.get(k)!=span[k] for k in ('start','end','before')):
                        raise ValueError('free_response_changed_trusted_span')
                    if free_response.get('decision')=='patch':
                        after=free_response['after'];status='model_patch_guarded'
                    elif free_response.get('decision')=='hold' and free_response.get('after')==span['before']:
                        status='model_hold'
                    else:
                        raise ValueError('invalid_free_decision')
            else:
                raise ValueError('unknown_method')
            if after is not None:
                patches=[dict(span,after=after)];authorized=True
        proposal={'preimage_sha256':sha(original),'patches':patches}
        allowed={'allowed_spans':[span] if patches else []}
        candidate,details=check(original,proposal,allowed)
        record.update(guard_status='passed',guard_details=details,proposal_sha256=sha(encode(proposal)),candidate_sha256=sha(candidate))
        released=candidate if authorized else original
    except (KeyError,ValueError,TypeError,AttributeError,UnicodeError) as error:
        status='rollback';record.update(guard_status='failed',guard_error=str(error))
        released=original
    record.update(status=status,returned_sha256=sha(released),byte_identical_original=released==original,
        rollback_byte_identical=(released==original if status=='rollback' else None),
        model_invocation_by_harness=False)
    return released,record


def prepare(input_root,runs,prompt,split):
    provenance={str(RENDERER_PATH):sha(RENDERER_PATH.read_bytes())};items=[]
    for input_path in sorted(input_root.glob('*.json')):
        group=input_path.stem
        bundle=read(input_path,provenance)
        detector=read(runs/f'detector-{group}.raw.json',provenance)
        audit=read(runs/f'source-audit-{group}.raw.json',provenance)
        ds={x['case_id']:x for x in detector['cases']}; audits={x['case_id']:x for x in audit['cases']}
        if len(ds)!=len(detector['cases']) or len(audits)!=len(audit['cases']):raise ValueError('duplicate_case_id')
        for case in bundle['cases']:
            if not case['case_id'].startswith(split.upper()):raise ValueError('Case split mismatch')
            cid=case['case_id'];sources={}
            for source in case['source']:
                for field,hashfield in [('text_path','text_sha256'),('raw_path','sha256')]:
                    path=Path(source[field]); raw=path.read_bytes()
                    if sha(raw)!=source[hashfield]:raise ValueError('source_hash_mismatch')
                    provenance[str(path)]=sha(raw)
                    if field=='text_path':sources[str(path)]=raw.decode('utf-8')
            effective_audit,resolution=resolve_quote(audits[cid],sources)
            item={'case':case,'detector':ds[cid],'audit':effective_audit,'original_audit':audits[cid],'quote_resolution':resolution,'source_bytes_utf8':sources,
                  'bound_provenance':dict(provenance),
                  'declaration':'Same original/source/detector/audit/frozen span for all branches; no implicit length cap; byte guard is not semantic validation.'}
            item['authority_sha256']=sha(encode(item));items.append(item)
    prompt_raw=prompt.read_bytes();provenance[str(prompt)]=sha(prompt_raw)
    free_items=[]
    for item in items:
        audit=item['audit']
        if audit.get('shared_action')=='repair' and audit.get('factual_error_confirmed')=='yes' and audit.get('span_approved')=='yes':
            exact_span(item['case']['draft'].encode(),item['detector']['span'])
            free_items.append(item)
    return {'schema':'T-realization-v2','provenance':provenance,'items':items}, {'prompt':prompt_raw.decode(),'cases':free_items}


def write_new(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as stream:stream.write(data)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inputs',type=Path,required=True)
    p.add_argument('--runs',type=Path,required=True)
    p.add_argument('--prompt',type=Path,required=True)
    p.add_argument('--prepared',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--free-response',type=Path)
    p.add_argument('--split',choices=['dev','eval'],default='dev')
    p.add_argument('--renderer',type=Path,required=True)
    a=p.parse_args()
    renderer_hash=load_renderer(a.renderer)
    if a.output.exists():raise ValueError('Fresh output directory required')
    response_hash=None
    if a.free_response:
        bundle=json.loads((a.prepared/'prepared.json').read_bytes())
        for path,h in bundle['provenance'].items():
            if sha(Path(path).read_bytes())!=h:raise ValueError('Bound input changed')
        response_raw=a.free_response.read_bytes();response_hash=sha(response_raw)
        responses=json.loads(response_raw)
        if isinstance(responses,dict):responses=responses.get('cases',[responses])
        indexed={r['case_id']:r for r in responses}
        if len(indexed)!=len(responses):raise ValueError('Duplicate free response')
        methods=['free']
    else:
        if a.prepared.exists():raise ValueError('Prepared inputs frozen; use new version')
        bundle,free=prepare(a.inputs,a.runs,a.prompt,a.split)
        write_new(a.prepared/'prepared.json',encode(bundle))
        write_new(a.prepared/'free.json',encode(free))
        indexed={};methods=['free','typed','exact_extractive']
    records=[]
    for item in bundle['items']:
        cid=item['case']['case_id']
        for method in methods:
            returned,record=realize(item,method,indexed.get(cid))
            path=a.output/f'{cid}.{method}.txt';write_new(path,returned)
            record['output_path']=str(path);records.append(record)
    report={'execution':'mechanical realization/guard only; no model invocation','records':records,
        'prepared_sha256':sha((a.prepared/'prepared.json').read_bytes()),'free_response_raw_sha256':response_hash,
        'code_sha256':sha(Path(__file__).read_bytes()),'renderer_sha256':renderer_hash,'renderer_path':str(RENDERER_PATH),
        'guard_sha256':sha(Path(__file__).with_name('patch_guard.py').read_bytes())}
    write_new(a.output/'report.json',encode(report))
    print(json.dumps({'records':len(records),'statuses':{s:sum(r['status']==s for r in records) for s in sorted({r['status'] for r in records})},'report_sha256':sha(encode(report))}))


if __name__=='__main__':main()
