"""Read-only artifact verification; emits hashes/counts only, never source quotations."""
from pathlib import Path
from collections import Counter, defaultdict
import json,hashlib,sys,datetime
from apply_exact import apply
P=Path('/historical-research/journal-v12-private'); B=Path('/historical-research/journal-v12')
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def digest(x):return hashlib.sha256(json.dumps(x,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
errors=[]; notes=[]; checks=Counter(); artifacts={}
def check(ok,label,ident=''):
 checks[label]+=1
 if not ok:errors.append({'check':label,'id':ident})
def lock(p,h,label):
 check(p.exists() and sha(p)==h,label,str(p.relative_to('/workspace')))
 if p.exists():artifacts[str(p.relative_to('/workspace'))]=sha(p)
def strs(x):
 if isinstance(x,str):return [x]
 if isinstance(x,list):return sum((strs(y) for y in x),[])
 if isinstance(x,dict):return sum((strs(y) for y in x.values()),[])
 return []
counts={}; actual={}; lengthrows=[]; refcounts={}; score_rows=[]; review_totals=Counter(); writer_patch_count=0; literal_anchor_counts=Counter()
for v in ['v1','v2']:
 rows=read(P/f'writer-map-{v}.json'); locked=read(B/'protocol'/('writer-input-lock-v1.json' if v=='v1' else 'final-method-lock-v2.json'))['rows']
 check(rows==locked,'writer_map_equals_lock',v); bycase=defaultdict(list); actual[v]=[]
 for r in rows:
  i=r['input_id']; ip=P/f'writer-inputs-{v}'/f'{i}.json'; lock(ip,r['input_sha256'],'writer_input_hash'); x=read(ip)
  common={k:val for k,val in x.items() if k not in ['input_id','method_instruction']};check(digest(common)==r['common_input_sha256'],'common_hash',i); bycase[r['case_id']].append(common)
  source='\n\n'.join(z['text'] for z in x['article']['paragraphs']);check(hashlib.sha256(source.encode()).hexdigest()==r['article_text_sha256'],'article_hash',i)
  wp=P/f'writer-results-{v}'/f'{i}.json'
  if not wp.exists():continue
  actual[v].append(i); w=read(wp); writer_patch_count+=len(w['patches']); artifacts[str(wp.relative_to('/workspace'))]=sha(wp)
  n=[]
  for z in w['findings']:n+=strs({k:z[k] for k in ['description','materiality','status','limits'] if k in z})
  for z in w['patches']:n+=strs({k:z[k] for k in ['after','justification'] if k in z})
  for z in w['question_answers']:n+=strs({k:z[k] for k in ['answer','remaining_unknown'] if k in z})
  n+=strs(w.get('unanswered_scope',[]))+strs(w.get('no_change_reason',''))+strs(w.get('declared_limits',[])); t='\n'.join(n)
  lengthrows.append({'version':v,'case_id':r['case_id'],'condition':r['condition'],'input_id':i,'total_json_characters':len(wp.read_text()),'total_json_whitespace_words':len(wp.read_text().split()),'narrative_characters':len(t),'narrative_whitespace_words':len(t.split()),'requested_cap':900 if r['language']=='EN' else 3500,'exceeds_requested_cap':len(t.split())>900 if r['language']=='EN' else len(t)>3500})
 for c,cs in bycase.items():check(len(cs)==2 and cs[0]==cs[1],'paired_common_bytes',v+':'+c)
 counts[v]={'generated_inputs':len(rows),'actual_outputs':len(actual[v]),'generated_unused_inputs':len(rows)-len(actual[v]),'metadata_sidecars':len(list((P/f'writer-results-{v}').glob('*.meta.json')))}
for case,r in read(B/'protocol/reference-lock.json')['cases'].items():
 fp=P/'frozen-reference'/f'{case}.frozen-reference.json';lock(fp,r['sha256'],'reference_hash'); ref=read(fp); aa=ref['atoms'];rc={'atoms':len(aa),'eligible_required':sum(bool(a['eligible_required']) for a in aa),'eligible_omission':sum(bool(a['eligible_omission']) for a in aa)};refcounts[case]=rc
 for k,val in rc.items():check(val==r['counts'][k],'reference_count',case+':'+k)
 check(all(not a['eligible_omission'] or a['eligible_required'] for a in aa),'omission_subset_required',case)
scoreboard={(r['version'],r['packet_id']):r for r in read(B/'results/review-scoreboard.json')}
for v in ['v1','v2']:
 mapped=[]
 for mp in sorted(P.glob(f'review-map-{v}-*.json')):
  for r in read(mp):
   i=r['input_id'];pid=r['packet_id'];mapped.append(i); ip=P/f'reviewer-inputs-{v}'/f'{pid}.json';wp=P/f'writer-results-{v}'/f'{i}.json';lock(ip,r['review_input_sha256'],'review_input_hash');lock(wp,r['writer_raw_sha256'],'writer_output_hash');x=read(ip);w=read(wp);ref=read(P/'frozen-reference'/f"{r['case_id']}.frozen-reference.json")
   check(x['writer_output']==w,'review_writer_exact',pid);check(x.get('frozen_reference',x.get('provisional_reference'))==ref,'review_reference_exact',pid)
   applied=apply(x['original_text'],w['patches']);check(applied['candidate']==x['displayed_candidate'],'candidate_recomputed',pid);check(applied==read(P/f'candidates-{v}'/f'{pid}.json'),'candidate_file_exact',pid);check(applied['candidate_sha256']==r['candidate_sha256'],'candidate_hash',pid)
   req={a['id'] for a in ref['atoms'] if a['eligible_required']};om={a['id'] for a in ref['atoms'] if a['eligible_omission']};judges=[]
   for judge in ['A','B']:
    fp=P/f'reviewer-results-{v}'/f'{judge}__{pid}.json';check(fp.exists(),'review_exists',judge+pid)
    if not fp.exists():continue
    q=read(fp);artifacts[str(fp.relative_to('/workspace'))]=sha(fp);check(q.get('complete') is True and q.get('read_complete') is True,'review_complete_flags',judge+pid)
    ra=q['reference_assessments'];pa=q['patch_assessments'];fa=q['finding_assessments'];rr={z['reference_id']:z for z in ra}
    check(len(ra)==len(rr) and set(rr)=={a['id'] for a in ref['atoms']},'all_reference_atoms_once',judge+pid)
    check(Counter(z['patch_id'] for z in pa)==Counter(z['id'] for z in w['patches']),'all_patches_once',judge+pid)
    check({z['writer_finding_id'] for z in fa}=={z['id'] for z in w['findings']},'all_findings_assessed',judge+pid)
    check(q['packet_id']==pid,'review_packet_id',judge+pid)
    s={'judge':judge,'raw_sha256':sha(fp),'omission_identified':sum(rr[k]['writer_identified']=='yes' for k in om),'omission_denom':len(om),'candidate_covered_semantic_match':sum(rr[k]['candidate_presence']=='covered' and rr[k]['semantic_answer_match']=='yes' for k in req),'required_denom':len(req),'original_covered':sum(rr[k]['original_presence']=='covered' for k in req),'eligibility_challenges':[k for k in req if rr[k]['eligibility_agreement']!='agree'],'finding_verdicts':{val:sum(z['verdict']==val for z in fa) for val in ['supported','partial','unknown','unsupported']},'patch_verdicts':{field:{val:sum(z[field]==val for z in pa) for val in ['yes','no','partial','unknown','not_applicable']} for field in ['warranted','new_assertion','meaning_loss','overediting','repairs_identified_issue']},'overall_flags':q['overall_flags']}
    expected=next(z for z in scoreboard[(v,pid)]['scores'] if z['judge']==judge)
    for k,val in s.items():check(sorted(val)==sorted(expected[k]) if k=='eligibility_challenges' else val==expected[k],'scoreboard_recomputation',judge+pid+':'+k)
    source_texts=[x['original_text']]+strs(x['primary_evidence'])
    for atom in ra:
     for field,haystacks in [('source_anchor',source_texts),('candidate_anchor',[x['displayed_candidate']])]:
      anchor=atom.get(field,'');literal_anchor_counts[field+'_checked']+=1
      literal_anchor_counts[field+('_literal_substring' if isinstance(anchor,str) and bool(anchor) and any(anchor in text for text in haystacks) else '_not_literal_substring')]+=1
    review_totals.update({'review_outputs':1,'reference_assessments':len(ra),'finding_assessments':len(fa),'patch_assessments':len(pa),'new_assertion_yes':sum(z['new_assertion']=='yes' for z in pa),'meaning_loss_yes':sum(z['meaning_loss']=='yes' for z in pa),'overediting_yes':sum(z['overediting']=='yes' for z in pa)})
    judges.append({'omission_candidate_covered_semantic_match':sum(rr[k]['candidate_presence']=='covered' and rr[k]['semantic_answer_match']=='yes' for k in om),**{k:s[k] for k in ['judge','omission_identified','omission_denom','candidate_covered_semantic_match','required_denom','original_covered','eligibility_challenges']}})
   for suffix in ['audit','source-first']:check((P/f'third-results-{v}'/f'{pid}.{suffix}.json').exists(),'third_artifact_exists',v+pid+suffix)
   score_rows.append({'version':v,'case_id':r['case_id'],'condition':r['condition'],'packet_id':pid,'judges':judges})
 check(Counter(mapped)==Counter(actual[v]),'all_actual_writers_review_mapped',v)
check(lengthrows==read(B/'results/output-lengths.json')['rows'],'existing_length_measurement_matches')
for name,h in read(B/'protocol/development-method-v1-lock.json')['files'].items():lock(B/name,h,'development_method_lock')
v2lock=read(B/'protocol/final-method-lock-v2.json');lock(B/'protocol/B-v2-boundary-gate.txt',v2lock['gate_sha256'],'v2_gate_lock');lock(B/'protocol/development-method-v1-lock.json',v2lock['v1_lock_sha256'],'v1_lock_digest')
hp=P/'hidden-pairs';hu=B/'hidden-pairs';hm=read(hp/'experiment_private_mapping.json'); hreviews={};hinputs={};synthetic=[]
for gp in (P/'hidden-review-results').glob('*.json'):
 for r in read(gp):check(r['review_id'] not in hreviews,'unique_hidden_review_id',r['review_id']);hreviews[r['review_id']]=r
for gp in (P/'hidden-review-inputs').glob('*.json'):
 for r in read(gp)['items']:hinputs[r['review_id']]=r
hrmap={r['packet_id']:r for r in read(P/'hidden-review-map.json')}; verdicts={r['packet_id']:r for r in read(B/'results/hidden-verdicts.json')}; paired=defaultdict(list)
for r in hm:
 pid=r['packet_id'];ip=hp/'detector-inputs'/f'{pid}.json';lock(ip,r['sha256'],'hidden_packet_hash');x=read(ip);wpath=P/'hidden-detector-results'/f'{pid}.json';w=read(wpath);artifacts[str(wpath.relative_to('/workspace'))]=sha(wpath);paired[r['candidate_item_id']].append(x)
 check(w['verdict']==verdicts[pid]['actual'] and len(w['patches'])==verdicts[pid]['patch_count'],'hidden_verdict_ledger',pid)
 rm=hrmap[pid];rv=hreviews[rm['review_id']];ri=hinputs[rm['review_id']];check(ri['detector_output']==w,'hidden_review_raw_exact',pid);check(ri['original_candidate']==x['input']['candidate'],'hidden_review_candidate_exact',pid)
 c=x['input']['candidate'];spans=[]
 for patch in w['patches']:
  before=patch['before'];check(not before or c.count(before)==1,'hidden_anchor_unique',pid);start=c.index(before) if before else len(c);spans.append((start,start+len(before),patch['after']))
 for a,b,repl in sorted(spans,reverse=True):c=c[:a]+repl+c[b:]
 check(c==ri['patched_candidate'],'hidden_repair_recomputed',pid)
 # Contract excludes only exact copied source_anchor and candidate_anchor strings.
 n=[]
 def nonanchors(obj):
  if isinstance(obj,dict):
   for k,val in obj.items():
    if k not in ['source_anchor','candidate_anchor']:nonanchors(val)
  elif isinstance(obj,list):
   for val in obj:nonanchors(val)
  elif isinstance(obj,str):n.append(obj)
 nonanchors(w);lang=x['input']['language'];chars=sum(map(len,n));words=sum(len(t.split()) for t in n); cap=300 if lang=='en' else 1000
 synthetic.append({'packet_id':pid,'split':r['split'],'method':r['method'],'role':r['role'],'verdict_matches_author':w['verdict']==r['expected_verdict'],'patch_count':len(w['patches']),'repair_review':{k:rv[k] for k in ['original_verdict','detector_verdict_supported','patch_warranted','repaired','introduced_error','unnecessary_edit']},'non_anchor_characters':chars,'non_anchor_words':words,'cap':cap,'exceeds_cap':words>cap if lang=='en' else chars>cap})
for cid,ps in paired.items():
 check(len(ps)==2,'two_procedures_per_candidate',cid)
 check(ps[0]['shared_instruction']==ps[1]['shared_instruction'] and ps[0]['output_schema']==ps[1]['output_schema'] and all(ps[0]['input'][k]==ps[1]['input'][k] for k in ['language','source','fixed_broad_question','candidate']),'synthetic_common_contract',cid)
for root,key in [(hp,'private_files'),(hu,'public_files')]:
 for name,h in read(hp/'freeze_manifest.json')[key].items():lock(root/name,h,'original_synthetic_freeze')
for name,h in read(hu/'final-method-lock.json')['sha256'].items():lock(hu/name,h,'final_synthetic_lock')
for path,h in read(hp/'experiment_lock.json')['private_artifacts_sha256'].items():lock(Path(path),h,'hidden_private_lock')
for name,h in read(hu/'experiment_lock.json')['shared_artifacts_sha256'].items():lock(hu/name,h,'hidden_shared_lock')
for entry in read(hu/'experiment_lock.json')['exact_input_hashes']:lock(hp/'detector-inputs'/f"{entry['packet_id']}.json",entry['sha256'],'hidden_public_input_lock')
check({r['packet_id'] for r in hm}==set(hrmap)==set(verdicts),'synthetic_id_sets')
for v in ['v1','v2']:
 check({f.stem for f in (P/f'writer-results-{v}').glob('*.json') if not f.name.endswith('.meta.json')}==set(actual[v]),'no_unmapped_writer_outputs',v)
check(len(hreviews)==len(hrmap)==len(hinputs)==len(hm)==24,'synthetic_24_complete');check(len({r['base_id'] for r in hm})==6 and len(paired)==12,'synthetic_6_bases_12_candidates')
notes += [
 'Actual writer outputs are 4 v1 development + 2 v2 development B reruns + 4 v2 locked evaluation = 10. Six generated inputs have no output by design; do not count them as runs. Development A baseline is reused, not rerun.',
 'Ten saved writer response artifacts and 24 saved detector response artifacts are observed; counts do not independently prove actual AI invocation counts or exclude unsaved/retried calls. The 56 exact writer patches belong to 10 outputs, and 112 patch assessments reflect two reviews of each patch.',
 'writer_identified=yes can reflect mention in question-answer prose; it is not proof of repair in the displayed article. The additional omission_candidate_covered_semantic_match column separately requires covered plus semantic match among eligible omission atoms, without modifying the original score.',
 'Literal anchor check is limited to reviewer reference-assessment source_anchor/candidate_anchor fields as contiguous substrings of supplied article/primary string values or the displayed candidate. Nonmatches include explicit absence labels, abbreviated/truncated excerpts and potentially inexact quotations; no semantic validity judgment follows automatically. Other reviewer quote fields were not exhaustively validated for literal exactness.',
 'Twenty real reviewer outputs are two correlated assessments per ten writer outputs; reference/patch assessment totals are not independent cases. Synthetic 24 procedure verdicts and 24 repair reviews arise from six bases/twelve candidates, not 24 independent bases.',
 'New_assertion=yes is a diagnostic of added meaning, not a harmful-patch verdict; supported omission repairs may properly add assertions. Do not sum this field as harms or sum overlapping harm tags.',
 'summarize_reviews.py silently skips missing review files and does not itself require complete/read_complete flags or assess patch/finding ID coverage; this validator independently checks current artifact completeness.',
 'summarize_reviews.py finding verdict totals are atomic assessment rows, not deduplicated supported findings or precision denominators; partial/unknown cannot silently count as successes.',
 'Fixed eligible-reference denominators are reproduced exactly. Eligibility challenges and per-judge discrepancies must remain visible; candidate coverage requires both covered and semantic_answer_match=yes.',
 'Real output cap measurement reproduces existing output_lengths.py exactly. Synthetic cap counts all string values except source_anchor/candidate_anchor; identifiers/verdict/before/after are counted as its explicit contract requires.',
 'Only one of ten real writer results has a timing metadata sidecar. Missing per-run start/end time, order evidence, deployment, seed, token usage, enforced generation ceiling, latency, retries and monetary cost cannot be reconstructed from content hashes or file timestamps.',
 'Hashes establish present-byte agreement with locks, not independently authenticated historical freeze/execution timing. This is data/code verification, not a new semantic model judgment.'
]
report={'generated_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'read-only counts, exact artifact/hash checks, existing score and cap measurement recomputation; no source quotations or new semantic judgments','status':'PASS_WITH_LIMITATIONS' if not errors else 'PROBLEMS_FOUND','counts':counts,'reference_counts':refcounts,'writer_exact_patches':writer_patch_count,'reference_anchor_literal_check_counts':dict(literal_anchor_counts),'review_totals':dict(review_totals),'check_counts':dict(checks),'errors':errors,'notes':notes,'real_scores':score_rows,'real_output_lengths':lengthrows,'synthetic_counts':{'bases':len({r['base_id'] for r in hm}),'candidates':len(paired),'verdicts':len(hm),'repair_reviews':len(hreviews),'verdict_matches':sum(r['verdict_matches_author'] for r in synthetic),'repaired_yes':sum(r['repair_review']['repaired']=='yes' for r in synthetic),'repaired_not_applicable':sum(r['repair_review']['repaired']=='not_applicable' for r in synthetic),'cap_exceedances':sum(r['exceeds_cap'] for r in synthetic)},'synthetic_rows':synthetic,'artifact_sha256':artifacts}
output=B/'results/independent-validation.json';output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n'); print(json.dumps({'status':report['status'],'errors':errors,'counts':counts,'reviews':dict(review_totals),'synthetic_counts':report['synthetic_counts'],'real_cap_exceedances':[r for r in lengthrows if r['exceeds_requested_cap']],'report_sha256':sha(output)},indent=2))
