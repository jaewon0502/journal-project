#!/usr/bin/env python3
"""Strict combined delivery builder. --draft uses distinct provisional filenames.
Requires local private sources for overlap checking; no network or uploads.
"""
from pathlib import Path
import argparse,base64,hashlib,html,importlib.util,io,json,re,shutil,subprocess,sys,tempfile,zipfile
ROOT=Path(__file__).resolve().parents[1]
PUBLIC_FILES=['REPORT.md','code/README.md','code/gate.py','code/test_gate.py','code/build_schema.py','code/prepare_reviews.py','code/run_gates.py','code/analyze_results.py','code/build_public_package.py','code/verify_public_package.py','protocol/FREEZE_GATE.json','protocol/PREREGISTRATION.md','protocol/REVIEW_INSTRUCTIONS.md','protocol/REVIEW_SCHEMA.json','protocol/final-audit-input-lock.json','protocol/final-audit-instruction.md','protocol/initial-lock.sha256','protocol/real-input-lock.json','protocol/review-input-lock.json','protocol/synthetic-input-lock.json','results/independent-validation.json','results/preaudit-gates.json','results/synthetic-validation.json','results/analysis.json','results/report-final-review.json','protocol/FRESH-CONTROL-ADDENDUM.md','protocol/fresh-control-addendum-lock.sha256','code/analyze_fresh_control.py','code/prepare_fresh_review.py','code/run_fresh_gates.py','protocol/fresh-control-writer-lock.json','protocol/fresh-control-reference-lock.json','protocol/fresh-control-review-lock.json','protocol/fresh-control-audit-lock.json','results/report-core-review.json']
OPTIONAL=['RESULTS.md','results/RESULTS.md','USER-PROCEDURE.md','results/targeted-challenge-summary.json','results/report-review.json','results/final-validation.json','results/limitations.md','results/anchor-reconciliation.json','results/anchor-reconciliation-summary.json','results/anchor-reconciliation.md','protocol/fresh-control-source-lock.json','results/fresh-control.json','results/fresh-control.md']
SYNTHETIC_META=['synthetic-author-labels.json','synthetic-validation-comparison.json','synthetic-validation-source-first.json']
def load(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,obj):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def extend_fresh_source_index(safety,index,private):
    """Index private fresh source/article text without publishing any of it."""
    packet_path=private/'fresh-control/source-packet.json'
    if not packet_path.exists():return {'present':False,'text_units':0}
    if packet_path.is_symlink():raise ValueError('Refuse symlink fresh source packet')
    packet=load(packet_path);units=[]
    def collect(value,origin):
        if isinstance(value,str):
            for i,text in enumerate(value.splitlines()):
                if text.strip():units.append((origin+':'+str(i),text))
        elif isinstance(value,list):
            for i,item in enumerate(value):collect(item,origin+':'+str(i))
        elif isinstance(value,dict):
            for key in ('paragraphs','text','content'):
                if key in value:collect(value[key],origin+':'+key)
    if not packet.get('source_documents') or not packet.get('original_article'):raise ValueError('Fresh source packet missing source_documents/original_article')
    for key in ('source_documents','original_article'):collect(packet[key],'fresh-control/source-packet.json:'+key)
    if not units:raise ValueError('Fresh source packet has no indexable natural text')
    for origin,text in units:
        normalized=safety.norm(text)
        if 60<=len(normalized)<100:index.setdefault(normalized,origin)
        for i in range(max(0,len(normalized)-99)):index.setdefault(normalized[i:i+100],origin)
    return {'present':True,'text_units':len(units),'source_packet_sha256':sha(packet_path),'scope':'source_documents and original_article; private text withheld'}

def build(root,private,v12,private12,draft=False):
    safety=module('v12_public_safety',v12/'code/build_public_package.py')
    checkpoint=load(v12/'results/final-delivery.json')
    for rel in ('REPORT.md','journal-v12-public.zip'):
        if sha(v12/rel)!=checkpoint['files'][rel]['sha256']:raise ValueError('Immutable v12 checkpoint changed: '+rel)
    missing=[r for r in PUBLIC_FILES if not (root/r).is_file()]
    if missing and not draft:raise ValueError('Missing final files: '+str(missing))
    pending=[]
    for rel in ['REPORT.md','RESULTS.md','results/RESULTS.md','results/analysis.json','results/report-final-review.json']:
        p=root/rel
        if p.exists() and re.search(r'RESULTS_PENDING|FINAL_CONCLUSIONS_PENDING|\bTODO\b|\bTBD\b|provisional_English_targeted_challenge_pending|provisional_pending_targeted_challenge',p.read_text()):pending.append(rel)
    if pending and not draft:raise ValueError('Final placeholders/pending analysis: '+str(pending))
    if not draft:
        review=load(root/'results/report-final-review.json')
        if review.get('must_fix'):raise ValueError('Final report review has unresolved must-fix items')
        if review.get('report_sha256')!=sha(root/'REPORT.md'):raise ValueError('Final review is not bound to current report')
        for rel,digest in review.get('supporting_document_sha256',{}).items():
            if sha(root/rel)!=digest:raise ValueError('Final supporting document changed: '+rel)
    amap=load(private/'audit-map.json'); audits=amap['audits']
    if len({a['audit_id'] for a in audits})!=len(audits):raise ValueError('Duplicate audit IDs')
    # All final reviews must exist, even those whose text is withheld.
    for a in audits:
        p=private/'audit-inputs'/f"{a['audit_id']}.json";r=load(private/'audit-results'/f"{a['audit_id']}.json")
        if sha(p)!=a['input_sha256'] or r.get('audit_id')!=a['audit_id'] or not all(r.get(k) is True for k in ('complete','read_complete','original_paragraphs_read')):raise ValueError('Incomplete or unbound final audit '+a['audit_id'])
    if load(root/'protocol/final-audit-input-lock.json')['audits']!=audits:raise ValueError('Final audit lock differs')
    synthetic={k:[r for r in amap[k] if r['kind']=='synthetic'] for k in ('audits','outputs')}
    bids=sorted({r['bundle_id'] for r in synthetic['outputs']})
    if len(bids)!=6 or len(synthetic['outputs'])!=12 or len(synthetic['audits'])!=11:raise ValueError('Unexpected synthetic inventory')
    index,paragraphs=safety.source_index(private12)
    fresh_source_scan=extend_fresh_source_index(safety,index,private)
    paragraphs+=fresh_source_scan['text_units']
    name='journal-final-draft' if draft else 'journal-final'
    stage=root/(name+'-public-package')
    if stage.exists():shutil.rmtree(stage)
    stage.mkdir()
    def copy(src,rel,binary=False):
        if src.is_symlink():raise ValueError('Refuse symlink '+str(src))
        data=src.read_bytes()
        if not binary:
            hits=safety.matches(data.decode('utf-8'),index)
            if hits:raise ValueError('Natural source overlap: '+str(src)+' '+str(hits))
        target=stage/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    for rel in PUBLIC_FILES+OPTIONAL:
        if (root/rel).is_file():copy(root/rel,'v13/'+rel)
    for bid in bids:
        copy(private/'synthetic-inputs'/f'{bid}.json',f'v13/synthetic/inputs/{bid}.json')
        for role in ('A','B'):copy(private/'reviews'/f'{role}__{bid}.json',f'v13/synthetic/reviews/{role}__{bid}.json')
    for rel in SYNTHETIC_META:copy(private/rel,'v13/synthetic/'+rel)
    for a in synthetic['audits']:
        for folder in ('audit-inputs','audit-results'):copy(private/folder/f"{a['audit_id']}.json",f"v13/synthetic/{folder}/{a['audit_id']}.json")
    write(stage/'v13/synthetic/audit-map.json',synthetic)
    copy(v12/'journal-v12-public.zip','checkpoint-v12/journal-v12-public.zip',binary=True)
    copy(v12/'REPORT.md','checkpoint-v12/REPORT.md')
    copy(v12/'results/final-delivery.json','checkpoint-v12/final-delivery.json')
    # Renderer/safety code retained as an explicit build dependency, no v12 mutation.
    copy(v12/'code/build_public_package.py','checkpoint-v12/build_public_package.py')
    published={f'synthetic-inputs/{b}.json' for b in bids}|{f'reviews/{r}__{b}.json' for b in bids for r in ('A','B')}|set(SYNTHETIC_META)|{f"{d}/{a['audit_id']}.json" for a in synthetic['audits'] for d in ('audit-inputs','audit-results')}
    write(stage/'v13/PRIVATE-ARTIFACT-HASHES.json',{'content_published':False,'files':[{'path':str(p.relative_to(private)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(private.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and str(p.relative_to(private)) not in published]})
    procedure='# 사용 절차\n\n근거 자료와 원문·질문·수정안을 고정하고 수정별 근거, 의미 보존, 문맥, 의존관계를 독립적으로 검토한다. 미확인 또는 연결된 위험이 있는 수정은 보류한다. 허용된 수정만 정확히 적용한 후보 전체를 원자료와 다시 대조한다. 새 중대 위험이나 미확인이 있으면 전달을 보류한다. 기계적 재실행은 의미의 정답이나 안전 보증이 아니다.\n'
    if (root/'USER-PROCEDURE.md').is_file():copy(root/'USER-PROCEDURE.md','USER-PROCEDURE.md')
    else:(stage/'USER-PROCEDURE.md').write_text(procedure)
    (stage/'README.md').write_text('# Combined public research package\n\n'+('DRAFT: incomplete, not a final delivery.\n\n' if draft else '')+'v13 is the main continuation; checkpoint-v12 contains the unchanged earlier report and ZIP. Natural article full texts, real raw reviews, deliveries, and challenges are withheld; private artifact paths and hashes are included. The synthetic examples are authored fictional fixtures.\n\nVerify offline with Python 3: `python v13/code/verify_public_package.py .`. This stdlib check verifies every file hash and replays selected exact patches. For full deterministic gate replay install jsonschema (`python -m pip install jsonschema`) and run `python v13/code/verify_public_package.py . --full-gate`. Neither path makes model calls or validates semantic judgments. Full private reruns additionally require original private data and the paths used by the recorded scripts.\n')
    leaks=[]
    for p in sorted(stage.rglob('*')):
        if p.is_file() and p.suffix!='.zip':
            hits=safety.matches(p.read_text(),index)
            if hits:leaks.append({'path':str(p.relative_to(stage)),'origins':hits})
    if leaks:raise ValueError('Staged overlap scan failed '+str(leaks))
    write(stage/'PUBLIC-SAFETY-CHECK.json',{'status':'pass','natural_paragraphs_checked':paragraphs,'fresh_source_scan':fresh_source_scan,'normalization':'NFKC, casefold, alphanumeric only','threshold':'100 normalized contiguous characters, or complete 60–99 character paragraphs','limitations':'Does not detect paraphrases or shorter quotes. Explicit allowlist excludes natural fulltext/raw reviews/deliveries/challenges.','binary_exclusion':'Only hash-verified immutable checkpoint-v12/journal-v12-public.zip','leaks':leaks,'draft':draft,'missing_final_files':missing,'pending_files':pending})
    write(stage/'PACKAGE-MANIFEST.json',{'algorithm':'sha256','self_excluded':True,'files':[{'path':str(p.relative_to(stage)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(stage.rglob('*')) if p.is_file()]})
    verifier=module('public_verify',root/'code/verify_public_package.py'); checks=verifier.verify(stage,True)
    zpath=root/(name+'-public.zip')
    with zipfile.ZipFile(zpath,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(stage.rglob('*')):
            if p.is_file() and '__pycache__' not in p.parts:
                info=zipfile.ZipInfo(str(p.relative_to(stage)),(2026,10,2,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes())
    with zipfile.ZipFile(zpath) as z:
        if z.testzip():raise ValueError('ZIP CRC failure')
        for p in sorted(stage.rglob('*')):
            if p.is_file() and '__pycache__' not in p.parts and z.read(str(p.relative_to(stage)))!=p.read_bytes():raise ValueError('ZIP byte mismatch')
    sections=[('v13-main','v13 추가검증 — 주 보고서',stage/'v13/REPORT.md')]
    for rel in ('v13/RESULTS.md','v13/results/RESULTS.md'):
        if (stage/rel).exists():sections.append(('v13-results','v13 상세 결과',stage/rel))
    if (stage/'v13/results/fresh-control.md').exists():sections.append(('fresh-control','별도 사전등록한 신규 실제 대조',stage/'v13/results/fresh-control.md'))
    sections += [('procedure','사용 절차',stage/'USER-PROCEDURE.md'),('v12-checkpoint','v12 원본 체크포인트 — 별도 보존',stage/'checkpoint-v12/REPORT.md')]
    nav=' · '.join(f'<a href="#{sid}">{html.escape(label)}</a>' for sid,label,_ in sections)
    content=''.join(f'<section id="{sid}"><h1>{html.escape(label)}</h1>'+safety.render(p.read_text())+'</section><hr>' for sid,label,p in sections)
    encoded=base64.b64encode(zpath.read_bytes()).decode();old_encoded=base64.b64encode((v12/'journal-v12-public.zip').read_bytes()).decode()
    page='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Journal 최종 추가검증'+(' — DRAFT' if draft else '')+'</title><style>body{font-family:system-ui,sans-serif;max-width:1080px;margin:36px auto;padding:0 24px;line-height:1.75;color:#17202a}a{color:#075daa}table{border-collapse:collapse}td{border:1px solid #ccd3da;padding:8px;vertical-align:top}.table,pre{overflow:auto}section{margin-top:45px}code{overflow-wrap:anywhere}h1,h2,h3{line-height:1.35}</style></head><body><h1>Journal 최종 추가검증'+(' — DRAFT / 미완료' if draft else '')+'</h1><p>v13 주 보고서와 변경하지 않은 v12 체크포인트</p><nav>'+nav+'</nav><p><a download="'+zpath.name+'" href="data:application/zip;base64,'+encoded+'">전체 공개 패키지 ZIP</a> · <a download="journal-v12-public.zip" href="data:application/zip;base64,'+old_encoded+'">v12 원본 ZIP</a></p><p>전체 ZIP SHA-256: <code>'+sha(zpath)+'</code></p>'+content+'</body></html>'
    if safety.matches(content,index):raise ValueError('Rendered report overlap')
    hpath=root/(name+'.html');hpath.write_text(page)
    embedded=re.findall(r'href="data:application/zip;base64,([A-Za-z0-9+/=]+)"',page)
    if [base64.b64decode(x) for x in embedded]!=[zpath.read_bytes(),(v12/'journal-v12-public.zip').read_bytes()]:raise ValueError('Embedded ZIP identity failed')
    if not all(f'id="{sid}"' in page for sid,_,_ in sections) or '<table>' not in page:raise ValueError('HTML render structure failed')
    result={'status':'draft' if draft else 'built_not_uploaded','html':str(hpath),'zip':str(zpath),'html_sha256':sha(hpath),'zip_sha256':sha(zpath),'checks':checks,'embedded_zip_identity':'pass','html_sections':[s[0] for s in sections],'synthetic_inputs':6,'synthetic_risk_reviews':12,'synthetic_unique_final_audits':11,'immutable_v12':'pass','pending_files':pending,'missing_final_files':missing}
    write(root/(name+'-verification.json'),result);print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--private',type=Path,default=Path('/historical-research/journal-v13-private'));p.add_argument('--v12',type=Path,default=Path('/historical-research/journal-v12'));p.add_argument('--private12',type=Path,default=Path('/historical-research/journal-v12-private'));p.add_argument('--draft',action='store_true');a=p.parse_args();build(a.root,a.private,a.v12,a.private12,a.draft)
