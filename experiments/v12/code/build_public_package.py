#!/usr/bin/env python3
"""Build an allowlisted public package. No network, source publication, or model calls.

Run from the original local workspace after final report edits. The original
private sources are required for the fail-closed normalized overlap scan.
"""
from pathlib import Path
import argparse,base64,hashlib,html,json,re,shutil,unicodedata,zipfile

PUBLIC_FILES = ['PACKAGE-README.md', 'RELEASE-GATE.md', 'REPORT.md', 'USER-PROCEDURE.md', 'acquisition/en/packet-lock.json', 'acquisition/en/selection-access-log.json', 'acquisition/en/source-manifest.json', 'acquisition/ko/KO-DEV-01.manifest.json', 'acquisition/ko/KO-EVAL-01.manifest.json', 'acquisition/ko/README.md', 'acquisition/ko/selection-log.json', 'code/additional_metrics.py', 'code/analyze_scope.py', 'code/analyze_transfer.py', 'code/apply_exact.py', 'code/build_public_package.py', 'code/build_real_inputs.py', 'code/build_review_packets.py', 'code/build_scope_reviews.py', 'code/build_synthetic_review.py', 'code/build_transfer_reviews.py', 'code/build_v2_inputs.py', 'code/check_necessity.py', 'code/insert_report_tables.py', 'code/output_lengths.py', 'code/release_gate.py', 'code/run_release_gate.py', 'code/summarize_reviews.py', 'code/test_release_gate.py', 'code/validate_artifacts.py', 'code/verify_public_package.py', 'hidden-pairs/H0_method.txt', 'hidden-pairs/H1_method.txt', 'hidden-pairs/README.md', 'hidden-pairs/detector_inputs.jsonl', 'hidden-pairs/detector_instruction.txt', 'hidden-pairs/experiment_lock.json', 'hidden-pairs/experiment_protocol.md', 'hidden-pairs/final-method-lock.json', 'hidden-pairs/output_schema.json', 'hidden-pairs/shared_instruction.txt', 'protocol/B-v2-boundary-gate.txt', 'protocol/PREREGISTRATION.md', 'protocol/condition-prompts.md', 'protocol/development-method-v1-lock.json', 'protocol/deviations-and-approaches.md', 'protocol/evaluator-schema.json', 'protocol/final-method-lock-v2.json', 'protocol/output-schema.json', 'protocol/reference-lock.json', 'protocol/runtime-and-scoring.md', 'protocol/scoring-template.csv', 'protocol/third-audit.md', 'protocol/writer-input-lock-v1.json', 'results/additional-metrics.json', 'results/authorization-scope.json', 'results/deviations.json', 'results/extensions-development.json', 'results/extensions-evaluation.json', 'results/hidden-verdicts.json', 'results/independent-validation.json', 'results/mechanical-v1-development.json', 'results/mechanical-v2-development.json', 'results/mechanical-v2-locked_evaluation.json', 'results/metric-limitations.md', 'results/output-lengths.json', 'results/release-gate-results.json', 'results/report-final-review.json', 'results/report-review.json', 'results/review-scoreboard.json', 'results/supplement-validation.json', 'results/supplementary-primary-note.md', 'results/synthetic-exposure-deviation.json', 'supplementary/necessity/RESULTS.md', 'supplementary/necessity/input-hashes.json', 'supplementary/necessity/protocol.md', 'supplementary/necessity/results.json', 'supplementary/necessity/validation-summary.json', 'supplementary/scope/RESULTS.md', 'supplementary/scope/hash-lock.json', 'supplementary/scope/input-manifest.json', 'supplementary/scope/mechanical-results.json', 'supplementary/scope/protocol.md', 'supplementary/scope/results.json', 'supplementary/scope/reviewer-instruction-lock.json', 'supplementary/scope/reviewer-instruction.md', 'supplementary/transfer/RESULTS.md', 'supplementary/transfer/hashes.json', 'supplementary/transfer/mechanical-results.json', 'supplementary/transfer/prelaunch-correction.json', 'supplementary/transfer/protocol.md', 'supplementary/transfer/results.json']
SYNTHETIC_GROUPS = {
 'hidden-pairs': ('synthetic/main/design', ['frozen_pairs.json','source_only.jsonl','source_reference.json','private_mapping.json','experiment_private_mapping.json','experiment_lock.json','freeze_manifest.json','development_manifest.json','heldout_manifest.json']),
 'hidden-pairs/detector-inputs': ('synthetic/main/detector-inputs', ['*.json']),
 'hidden-detector-results': ('synthetic/main/detector-results', ['*.json']),
 'hidden-review-inputs': ('synthetic/main/repair-inputs', ['group*.json']),
 'hidden-review-results': ('synthetic/main/repair-reviews', ['group*.json']),
 'supplementary/necessity': ('synthetic/necessity', ['author-labels.json','manifest.json','source-and-task-only.json','orchestrator-provenance.json','freeze.sha256']),
 'supplementary/necessity/inputs': ('synthetic/necessity/inputs', ['*.json']),
 'supplementary/necessity/classifier-results': ('synthetic/necessity/classifier-results', ['*.json']),
 'supplementary/necessity/validation': ('synthetic/necessity/validation', ['*.json']),
}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write_json(p,d):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def norm(s):return ''.join(c for c in unicodedata.normalize('NFKC',s).casefold() if c.isalnum())
def strings(x):
 if isinstance(x,str):yield x
 elif isinstance(x,dict):
  for v in x.values():yield from strings(v)
 elif isinstance(x,list):
  for v in x:yield from strings(v)
def source_index(private):
 # Paragraphs from every fixed article/primary packet, plus additional primary passages.
 paths=sorted((private/'reference-inputs').glob('*.json'))
 if len(paths)!=8:raise RuntimeError('Expected all eight original natural source packets')
 units=[]
 def paragraphs(x,origin):
  if isinstance(x,dict):
   if 'paragraphs' in x:
    for p in x['paragraphs']:
     if isinstance(p,dict):units.append((origin+':'+str(p.get('id','')),p.get('text','')))
   for k,v in x.items():
    if k!='paragraphs':paragraphs(v,origin)
  elif isinstance(x,list):
   for v in x:paragraphs(v,origin)
 for p in paths:paragraphs(json.loads(p.read_text()),str(p.relative_to(private)))
 expanded=private/'supplementary/scope/EN-DEV-S-expanded.txt'
 if expanded.exists():
  for i,p in enumerate(expanded.read_text().splitlines()):
   if p.strip():units.append((str(expanded.relative_to(private))+':'+str(i),p))
 needles={}
 for origin,s in units:
  s=norm(s)
  # Detect full short paragraphs (>=60 normalized chars) and any 100-char excerpt.
  if 60<=len(s)<100:needles.setdefault(s,origin)
  for i in range(max(0,len(s)-99)):needles.setdefault(s[i:i+100],origin)
 if not needles:raise RuntimeError('No natural text available for leak checking')
 return needles,len(units)
def matches(text,index):
 try:
  decoded=json.loads(text)
  text=text+'\n'+'\n'.join(strings(decoded))
 except (ValueError,TypeError):pass
 n=norm(text);out=set()
 for size in (60,100):
  if size==100:
   for i in range(max(0,len(n)-99)):
    if n[i:i+100] in index:out.add(index[n[i:i+100]])
 # Full shorter paragraphs have variable length.
 for s,origin in index.items():
  if len(s)<100 and s in n:out.add(origin)
 return sorted(out)
def render(md):
 def inline(s):
  s=html.escape(s)
  s=re.sub(r'\[([^\]]+)\]\((https?://[^ )]+)\)',r'<a href="\2">\1</a>',s)
  s=re.sub(r'`([^`]+)`',r'<code>\1</code>',s)
  return re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',s)
 out=[];table=False;code=False
 for line in md.splitlines():
  if line.startswith('```'):
   out.append('</code></pre>' if code else '<pre><code>');code=not code;continue
  if code:out.append(html.escape(line)+'\n');continue
  if line.startswith('|'):
   if re.match(r'^\|[\s:|\-]+$',line):continue
   if not table:out.append('<div class="table"><table>');table=True
   out.append('<tr>'+''.join('<td>'+inline(c.strip())+'</td>' for c in line.strip().strip('|').split('|'))+'</tr>');continue
  if table:out.append('</table></div>');table=False
  m=re.match(r'^(#{1,6})\s+(.*)',line)
  if m:out.append(f'<h{len(m[1])}>'+inline(m[2])+f'</h{len(m[1])}>')
  elif line.strip():out.append('<p>'+inline(line)+'</p>')
 if table:out.append('</table></div>')
 return '\n'.join(out)
def build(root,private,allow_incomplete=False):
 missing_required=[rel for rel in PUBLIC_FILES if not (root/rel).is_file()]
 if missing_required and not allow_incomplete:raise RuntimeError('Missing allowlisted files; finalize them or use --allow-incomplete for a draft: '+str(missing_required))
 stage=root/'public-package'
 if stage.exists():shutil.rmtree(stage)
 stage.mkdir();index,paragraph_count=source_index(private);projections=[];missing=[]
 def copy(src,dst,project=False):
  if not src.is_file():missing.append(str(src));return
  if src.is_symlink():raise RuntimeError('Symlink refused: '+str(src))
  data=src.read_text();hits=matches(data,index)
  if hits and project and src.suffix=='.json':
   def redact(x,path='$'):
    if isinstance(x,str) and matches(x,index):
     projections.append({'path':str(dst.relative_to(stage)),'field':path,'original_string_sha256':hashlib.sha256(x.encode()).hexdigest()})
     return '[Natural-source excerpt withheld; original retained privately.]'
    if isinstance(x,dict):return {k:redact(v,path+'.'+k) for k,v in x.items()}
    if isinstance(x,list):return [redact(v,path+'['+str(i)+']') for i,v in enumerate(x)]
    return x
   data=json.dumps(redact(json.loads(data)),ensure_ascii=False,indent=2)+'\n'
   hits=matches(data,index)
  if hits:raise RuntimeError('Natural-source overlap in '+str(src)+' with '+str(hits))
  dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text(data)
 for rel in PUBLIC_FILES:copy(root/rel,stage/rel,project=True)
 for srcdir,(dest,patterns) in SYNTHETIC_GROUPS.items():
  for pattern in patterns:
   for src in sorted((private/srcdir).glob(pattern)):copy(src,stage/dest/src.name)
 # Only path, length, and digest are published for all remaining private artifacts.
 natural=[]
 for p in sorted(private.rglob('*')):
  if not p.is_file() or '__pycache__' in p.parts:continue
  rel=str(p.relative_to(private))
  if rel.startswith(('hidden-','supplementary/necessity/','library-helper/')):continue
  natural.append({'path':rel,'bytes':p.stat().st_size,'sha256':sha(p)})
 write_json(stage/'NATURAL-ARTIFACT-HASHES.json',{'content_published':False,'scope':'Private natural-source and associated local artifacts; filenames and digests only.','files':natural})
 # Independent second pass checks the actual staged bytes, including projected JSON.
 leaks=[]
 for p in sorted(stage.rglob('*')):
  if p.is_file():
   hits=matches(p.read_text(),index)
   if hits:leaks.append({'file':str(p.relative_to(stage)),'source_locations':hits})
 scan={'status':'pass' if not leaks else 'fail','natural_paragraphs_checked':paragraph_count,'normalization':'Unicode NFKC, casefold, alphanumeric characters only','threshold':'Any 100 contiguous normalized characters, or an entire paragraph of 60–99 normalized characters','limitations':'Exact normalized overlap detection does not detect paraphrases or excerpts shorter than the thresholds; manual allowlisting additionally excludes all natural full texts and raw outputs.','leaks':leaks,'json_projections':projections,'missing_allowlisted_files':missing}
 write_json(stage/'PUBLIC-SAFETY-CHECK.json',scan)
 if leaks:raise RuntimeError('Leak scan failed')
 files=[{'path':str(p.relative_to(stage)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(stage.rglob('*')) if p.is_file()]
 write_json(stage/'PACKAGE-MANIFEST.json',{'schema_version':1,'algorithm':'sha256','self_excluded':True,'files':files})
 shutil.copy2(stage/'PACKAGE-MANIFEST.json',root/'PACKAGE-MANIFEST.json')
 zpath=root/'journal-v12-public.zip'
 with zipfile.ZipFile(zpath,'w',zipfile.ZIP_DEFLATED) as z:
  for p in sorted(stage.rglob('*')):
   if p.is_file():z.write(p,str(p.relative_to(stage)))
 sections=['REPORT.md','supplementary/necessity/RESULTS.md','supplementary/scope/RESULTS.md','supplementary/transfer/RESULTS.md','USER-PROCEDURE.md','PACKAGE-README.md']
 content='\n<hr>\n'.join('<section id="'+s.replace('/','-').replace('.','-')+'">'+render((stage/s).read_text())+'</section>' for s in sections if (stage/s).exists())
 nav='<nav aria-label="문서 목차">'+ ' · '.join('<a href="#'+s.replace('/','-').replace('.','-')+'">'+label+'</a>' for s,label in zip(sections,['종합 보고서','필수성 보충','자료범위 보충','전이 보충','사용 절차','패키지 안내']) if (stage/s).exists())+'</nav>'
 encoded=base64.b64encode(zpath.read_bytes()).decode()
 page='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Journal v12 공개 보고서</title><style>body{font-family:system-ui,sans-serif;max-width:1050px;margin:40px auto;padding:0 22px;line-height:1.75;color:#17202a}h1,h2,h3{line-height:1.3}a{color:#075daa}.table{overflow:auto}table{border-collapse:collapse;font-size:.91em}td{padding:9px;border:1px solid #ccd3da;vertical-align:top}tr:first-child{background:#eef3f8;font-weight:bold}code,pre{background:#eef1f4}pre{overflow:auto}hr{margin:55px 0}.download{display:inline-block;padding:12px 18px;background:#075daa;color:white;border-radius:5px}</style><body><p><a class="download" download="journal-v12-public.zip" href="data:application/zip;base64,'+encoded+'">공개 실험패키지 ZIP 다운로드</a></p><p>원문 전문·실제 원출력은 미포함. ZIP SHA-256: <code>'+sha(zpath)+'</code></p>'+nav+content+'</body></html>'
 (root/'journal-v12.html').write_text(page)
 print(json.dumps({'staging':str(stage),'zip':str(zpath),'html':str(root/'journal-v12.html'),'files':len(files)+1,'zip_sha256':sha(zpath),'scan':scan},ensure_ascii=False,indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path('/historical-research/journal-v12'));p.add_argument('--private',type=Path,default=Path('/historical-research/journal-v12-private'));p.add_argument('--allow-incomplete',action='store_true',help='Draft build only: record missing allowlisted files');a=p.parse_args();build(a.root,a.private,a.allow_incomplete)
