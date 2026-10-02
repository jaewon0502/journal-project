"""Quote-free descriptive metrics from frozen reviews; no raw verdict mutation.
Run from any directory: python /historical-research/journal-v12/code/additional_metrics.py
"""
from pathlib import Path
from collections import Counter, defaultdict
import json, hashlib
B=Path(__file__).resolve().parents[1]; P=B.parent/'journal-v12-private'
def read(p): return json.loads(p.read_text())
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def counts(items,field): return dict(sorted(Counter(x.get(field,'missing') for x in items).items()))
def frac(n,d): return {'numerator':n,'denominator':d,'ratio':n/d if d else None}
rows=[]; baselines=defaultdict(list); hashes={}; output_unions={}
for mf in sorted(P.glob('review-map-v*.json')):
 v=mf.name.split('-')[2];hashes[str(mf.relative_to(B.parent))]=sha(mf)
 for r in read(mf):
  wf=P/f'writer-results-{v}'/f'{r["input_id"]}.json'; w=read(wf); hashes[str(wf.relative_to(B.parent))]=sha(wf)
  outid=f'{v}/{r["case_id"]}/{r["condition"]}'
  unions=defaultdict(set)
  for j in 'AB':
   rf=P/f'reviewer-results-{v}'/f'{j}__{r["packet_id"]}.json';x=read(rf);hashes[str(rf.relative_to(B.parent))]=sha(rf)
   f=x['finding_assessments']; patches=x['patch_assessments']; scope=x['unanswered_scope']
   assert {a['patch_id'] for a in patches}=={a['id'] for a in w['patches']}
   assert {a['writer_finding_id'] for a in f}<={a['id'] for a in w['findings']}
   byid={a['atomic_id']:a for a in f}; assert len(byid)==len(f)
   def root(a):
    seen=set(); k=a['atomic_id']
    while byid[k].get('duplicate_of'):
     assert k not in seen;seen.add(k); k=byid[k]['duplicate_of'];assert k in byid
    return k
   c=Counter(a['verdict'] for a in f); support=[a for a in f if a['verdict']=='supported']
   fl=[{k:a.get(k) for k in ['atomic_id','writer_finding_id','verdict','category','reference_ids','duplicate_of']} for a in f]
   pl=[]
   for a in patches:
    # This field describes the whole difference, not specifically the addition.
    if a['new_assertion']=='no': new='no_new_assertion_flag'
    elif a['new_assertion']=='yes' and a['evidence_justifies_difference']=='yes': new='justified_new_meaning'
    else: new='unknown_direction_specific_support'
    # Explicit prose strengthening, separately labeled post-hoc bounded coding.
    explicit=(v=='v1' and r['case_id']=='EN-DEV-01' and r['condition']=='B' and a['patch_id']=='P8')
    loss=a['meaning_loss']=='yes'; over=a['overediting']=='yes'
    tags=[]
    if loss:tags.append('meaning_loss')
    if over:tags.append('overediting')
    if explicit:tags.append('unsupported_strengthening_bounded_prose_indicator')
    if tags:unions[a['patch_id']].add(j)
    pl.append({**{k:a.get(k,'missing') for k in ['patch_id','warranted','new_assertion','meaning_loss','overediting','evidence_justifies_difference','location_correct','repairs_identified_issue']},'writer_finding_ids':next(z.get('finding_ids',[]) for z in w['patches'] if z['id']==a['patch_id']),'new_meaning_support_from_structured_fields':new,'bounded_prose_strengthening_indicator':explicit,'harm_tags':tags})
   scopeledger=[{'component_index':i+1,**{k:a.get(k) for k in ['question_id','status','acknowledged_by_writer']}} for i,a in enumerate(scope)]
   answered=sum(a['status']=='answered' for a in scope);unanswered=sum(a['status']=='unanswered' for a in scope)
   known_over=[a for a in patches if a['overediting'] in ['yes','no']]
   row={'output_id':outid,'version':v,'case_id':r['case_id'],'condition':r['condition'],'split':r['split'],'judge':j,'raw_review_sha256':sha(rf),'writer_finding_items':len(w['findings']),'findings':{'atomic_total':len(f),'verdict_counts':{k:c[k] for k in ['supported','unsupported','partial','unknown']},'supported_precision':frac(c['supported'],c['supported']+c['unsupported']),'excluded_partial_unknown':c['partial']+c['unknown'],'duplicate_of_unique_supported':len({root(a) for a in support}),'duplicate_links':[{'atomic_id':a['atomic_id'],'duplicate_of':a['duplicate_of']} for a in f if a.get('duplicate_of')],'semantic_unique_supported':None,'ledger':fl},'patches':{'total':len(patches),'new_meaning_structured_counts':counts(pl,'new_meaning_support_from_structured_fields'),'unsupported_new_meaning_final_metric':None,'bounded_prose_strengthening_patch_ids':[a['patch_id'] for a in pl if a['bounded_prose_strengthening_indicator']],'meaning_loss_counts':counts(patches,'meaning_loss'),'overediting':frac(sum(a['overediting']=='yes' for a in patches),len(known_over)),'overediting_excluded':len(patches)-len(known_over),'deduplicated_observed_harm_patch_ids':[a['patch_id'] for a in pl if a['harm_tags']],'observed_harm_union_rate':frac(sum(bool(a['harm_tags']) for a in pl),len(patches)),'ledger':pl},'unanswered_scope':{'writer_declared_entry_count':len(w.get('unanswered_scope',[])),'component_count':len(scope),'status_counts':counts(scope,'status'),'status_by_acknowledgment':dict(sorted(Counter(f"{a['status']}|acknowledged={a['acknowledged_by_writer']}" for a in scope).items())),'answered_among_assessable':frac(answered,answered+unanswered),'partial_unknown_excluded':sum(a['status'] in ['partial','unknown'] for a in scope),'silent_unanswered_or_partial':sum(a['status'] in ['unanswered','partial'] and a['acknowledged_by_writer'] is False for a in scope),'ledger':scopeledger}}
   rows.append(row)
   for a in x['reference_assessments']:baselines[(r['case_id'],r['article_text_sha256'],a['reference_id'])].append({'output_id':outid,'condition':r['condition'],'judge':j,'original_presence':a['original_presence']})
  output_unions[outid]={'patch_count':len(w['patches']),'any_judge_observed_harm_patches':[{'patch_id':k,'judges':sorted(z)} for k,z in sorted(unions.items())],'count':len(unions),'interpretation':'Distinct patch IDs, not independent errors or consensus adjudication.'}
disagreements=[]
for (case,h,rid),obs in sorted(baselines.items()):
 if len({a['original_presence'] for a in obs})>1:disagreements.append({'case_id':case,'article_text_sha256':h,'reference_id':rid,'observations':obs,'interpretation':'Same original article; baseline rating inconsistency, not a text-change effect.'})
paired=[]
for b in [z for z in rows if z['condition']=='B']:
 candidates=[a for a in rows if a['case_id']==b['case_id'] and a['condition']=='A' and a['judge']==b['judge'] and a['version']==b['version']]
 if not candidates:continue
 a=candidates[0];paired.append({'version':b['version'],'case_id':b['case_id'],'judge':b['judge'],'supported_count_B_minus_A':b['findings']['verdict_counts']['supported']-a['findings']['verdict_counts']['supported'],'duplicate_of_unique_supported_B_minus_A':b['findings']['duplicate_of_unique_supported']-a['findings']['duplicate_of_unique_supported'],'precision_B_minus_A':b['findings']['supported_precision']['ratio']-a['findings']['supported_precision']['ratio'],'observed_harm_patch_count_B_minus_A':len(b['patches']['deduplicated_observed_harm_patch_ids'])-len(a['patches']['deduplicated_observed_harm_patch_ids'])})
result={'schema_version':'1.0','status':'DESCRIPTIVE_WITH_UNRESOLVED_ADJUDICATION','raw_verdicts_and_frozen_criteria_changed':False,'review_rows':len(rows),'distinct_outputs':len(output_unions),'scope':'Ten real outputs, including two exposed v2 development B reruns. Authored tests excluded. No source quotations.','rules':{'precision':'supported/(supported+unsupported); partial/unknown excluded and shown. Zero denominator -> null.','unique':'Transitive duplicate_of roots among supported rows only; not semantic adjudication.','patch_harm':'Do not equate new_assertion=yes with unsupported meaning. Raw loss and overediting=yes are observed tags; union counted once per patch. P8 prose strengthening is explicitly separate bounded post-hoc coding.','scope':'Judge-defined component inventories differ; no pooled coverage inference or component-equivalence assumption.','baseline':'Compare identical article hashes; do not silently repair fixed-denominator scores.'},'per_output_per_judge':rows,'paired_same_version_B_minus_A':paired,'cross_judge_patch_unions':output_unions,'same_article_original_presence_disagreements':disagreements,'input_sha256':hashes}
(B/'results/additional-metrics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('rows',len(rows),'outputs',len(output_unions),'baseline inconsistent atoms',len(disagreements))
for r in rows:
 f=r['findings'];c=f['verdict_counts'];p=r['patches'];s=r['unanswered_scope']; print(r['output_id'],r['judge'],f"{c['supported']}/{f['supported_precision']['denominator']}",c['partial'],c['unknown'],f['duplicate_of_unique_supported'],p['deduplicated_observed_harm_patch_ids'],s['status_counts'])
print('baseline',[(a['case_id'],a['reference_id']) for a in disagreements])
# Cross-check mechanical population totals already independently validated.
iv=read(B/'results/independent-validation.json')
assert len(rows)==iv['review_totals']['review_outputs']==20
assert sum(r['findings']['atomic_total'] for r in rows)==iv['review_totals']['finding_assessments']==128
assert sum(r['patches']['total'] for r in rows)==iv['review_totals']['patch_assessments']==112
assert sum(r['patch_count'] for r in output_unions.values())==iv['writer_exact_patches']==56
md='''# Additional descriptive metrics and limitations

This supplement preserves every raw verdict and fixed reference criterion. It reports 20 judge rows for ten real outputs (four v1 development, two exposed v2 development B reruns, four v2 locked evaluation). Two judges are correlated assessments, not extra experiments. The original score ledger remains authoritative for fixed-reference omission and required-meaning scores. This supplement does not revise those scores or accept new reference extensions.

Run `python journal-v12/code/additional_metrics.py` from the workspace. The code reads private maps, writer IDs, and reviews, emits public quote-free IDs/counts, and cross-checks population totals against `independent-validation.json`. Reproduction needs the private inputs; the public files alone do not recreate semantic judgments. Exact before/after anchors remain in the private reviews and are deliberately excluded here.

## Precision and yield

Precision is supported / (supported + unsupported). Partial and unknown rows are excluded, never silently credited. These fractions describe assessable findings, not all submitted findings; high excluded counts can make perfect fractions misleading. The table's P/U column gives partial/unknown exclusions. Unique means connected roots of explicit `duplicate_of` links among supported rows. It is **not an independently adjudicated semantic-unique yield**. Both KO-DEV v1 A reviews mark F1b as duplicating F1a, but F1b is partial; therefore the supported-root counts remain the supported counts. Missing duplicate links do not prove uniqueness. Atomic decomposition also differs between judges; counts must stay separate. No manual semantic deduplication is performed.

| Output | Judge | Supported/assessable | P/U excluded | Explicit-link unique supported | Observed harmful patch union / proposed |
|---|---|---:|---:|---:|---:|
'''
for r in rows:
 f=r['findings'];p=r['patches'];c=f['verdict_counts']
 md+=f"| {r['output_id']} | {r['judge']} | {c['supported']}/{f['supported_precision']['denominator']} | {c['partial']}/{c['unknown']} | {f['duplicate_of_unique_supported']} | {len(p['deduplicated_observed_harm_patch_ids'])}/{p['total']} |\n"
md+='''
The sole unsupported atomic verdict is in EN-EVAL A judge B (3/4 assessable, one further partial excluded). Every other assessable precision fraction is 100%, often with partial exclusions. Same-version paired B-minus-A count and precision differences are stored in JSON. v2 development has no new A output, so no same-version pair is invented; its A baseline is reused from v1 and was not rerun.

## Patch diagnostics and harm

The 56 proposed patches have 112 judge assessments. `new_assertion=yes` occurs 107 times, **not 107 harmful patches**. Of these, 99 assessments also have evidence_justifies_difference=yes and are reported as justified new meaning. Eight have evidence_justifies_difference=no, but all eight also flag meaning loss and overediting. That whole-patch field cannot automatically identify which new assertion is unsupported. Direction-specific unsupported-new-meaning totals remain null rather than invented. Five assessments have no new-assertion flag.

A bounded, explicitly post-hoc reading of existing review reasons identifies strengthening on v1 EN-DEV B P8 in both judges. This is one patch with two observations, not two independent harms. It is recorded separately from raw structured flags; it does not alter any raw verdict. The other mixed justification rows remain direction-specifically unknown, not automatically unsupported additions. No new semantic generation or source re-adjudication was performed.

Loss and overediting are separately reported, with overlapping tags unioned by patch ID. There are eight loss flags and eight overediting flags on the same eight judge-patch rows: three distinct patches agreed by both judges (v1 EN-DEV A P6; v1 EN-DEV B P7/P8), plus two contested patches (v2 KO-DEV B P2; v2 EN-DEV B P2). The any-judge union is therefore **five distinct patches**, not sixteen errors. Four locked outputs have no flagged patch harm in these two reviews; that is absence of recorded flags, not proof of absence of harm. The per-judge observed-union rate uses all proposed patches here because all loss/overedit tags are binary; it is not a complete adjudicated rate for every possible unsupported strengthening.

All raw overediting tags are yes/no, so overediting denominators equal proposed-patch counts. Those labels combine unnecessary loss within otherwise warranted patches with whole-patch overediting. The raw schema does not separately adjudicate the preregistered narrower numerator of patches wholly lacking a discrepancy or justified integration. That narrower normal-text-overediting metric remains unresolved. No edit-distance proxy is substituted.

## Unanswered scope

Each row below gives answered / unanswered / partial / unknown components; acknowledgment refers to explicit `acknowledged_by_writer` labels. Silent gaps count unanswered or partial components marked false. Writer-declared entry counts and per-component question/status/acknowledgment IDs are in JSON. Honest unknown-limit disclosure is not coverage success. Component inventories differ between judges and outputs, and cannot be summed or aligned as an exhaustive common denominator. Answered/(answered+unanswered) in JSON is only the descriptive fraction within that review's inventory; partial/unknown are excluded explicitly. All-unknown or all-partial inventories produce null.

| Output | Judge | Answered / unanswered / partial / unknown | Acknowledged components / total | Silent unanswered or partial |
|---|---|---:|---:|---:|
'''
for r in rows:
 s=r['unanswered_scope'];c=s['status_counts']; vals=' / '.join(str(c.get(k,0)) for k in ['answered','unanswered','partial','unknown']);ack=sum(a['acknowledged_by_writer'] is True for a in s['ledger'])
 md+=f"| {r['output_id']} | {r['judge']} | {vals} | {ack}/{s['component_count']} | {s['silent_unanswered_or_partial']} |\n"
md+='''
## Identical-original baseline inconsistencies

Two reference atoms receive inconsistent original_presence ratings despite identical original article hashes:

- **KO-EVAL R09:** both judges say covered for condition A and partial for condition B. The B-side challenge concerns an entitlement unit within a compound reference atom. This is baseline-rating inconsistency on the same original, not content changed by condition B. Any apparent pre/post gain using these different baselines inherits that inconsistency. A shared baseline adjudication and possible atom split are needed before interpreting that gain causally; the frozen score is not silently repaired.
- **EN-EVAL R25:** judge A says absent for condition A and partial for condition B; judge B says partial for both. Again this is the same original. All original observations and matching hashes are retained in JSON.

The protocol's compound atoms, differing finding atomization, unadjudicated semantic duplication, direction-specific patch support, and differing scope inventories limit comparative interpretation. An accepted-extension union and its overlap require the separate extension/counter-audit process; these raw counts do not create acceptance. No claims of population performance, independent validation, or complete unknown-error recall follow from this supplement.
'''
(B/'results/metric-limitations.md').write_text(md)
