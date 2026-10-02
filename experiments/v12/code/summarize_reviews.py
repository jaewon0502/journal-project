from pathlib import Path
import json,hashlib
P=Path('/historical-research/journal-v12-private');B=Path('/historical-research/journal-v12')
out=[]
for version in ['v1','v2']:
 for mf in sorted(P.glob(f'review-map-{version}-*.json')):
  rows=json.loads(mf.read_text())
  if isinstance(rows,dict): rows=rows.get('rows',rows.get('packets',[]))
  for row in rows:
   pid=row.get('packet_id',row.get('review_id'))
   if not pid:raise ValueError(row)
   packet=json.loads((P/f'reviewer-inputs-{version}'/f'{pid}.json').read_text())
   ref=packet.get('frozen_reference',packet.get('provisional_reference'))
   if ref is None:raise ValueError(packet.keys())
   elig={a['id'] for a in ref['atoms'] if a['eligible_required']};om={a['id'] for a in ref['atoms'] if a['eligible_omission']}
   scores=[];judges={}
   for judge in ['A','B']:
    f=P/f'reviewer-results-{version}'/f'{judge}__{pid}.json'
    if not f.exists():continue
    x=json.loads(f.read_text());rr={z['reference_id']:z for z in x['reference_assessments']};judges[judge]=rr
    if set(rr)!={a['id'] for a in ref['atoms']}:raise ValueError('reference coverage '+str(f))
    score={'judge':judge,'raw_sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'omission_identified':sum(rr[k]['writer_identified']=='yes' for k in om),'omission_denom':len(om),'candidate_covered_semantic_match':sum(rr[k]['candidate_presence']=='covered' and rr[k]['semantic_answer_match']=='yes' for k in elig),'required_denom':len(elig),'original_covered':sum(rr[k]['original_presence']=='covered' for k in elig),'eligibility_challenges':[k for k in elig if rr[k]['eligibility_agreement']!='agree'],'finding_verdicts':{v:sum(z['verdict']==v for z in x['finding_assessments']) for v in ['supported','partial','unknown','unsupported']},'patch_verdicts':{field:{v:sum(z[field]==v for z in x['patch_assessments']) for v in ['yes','no','partial','unknown','not_applicable']} for field in ['warranted','new_assertion','meaning_loss','overediting','repairs_identified_issue']},'overall_flags':x['overall_flags']}
    scores.append(score)
   diffs=[]
   if len(judges)==2:
    for k in sorted(elig):
     for field in ['eligibility_agreement','original_presence','writer_identified','candidate_presence','semantic_answer_match']:
      if judges['A'][k][field]!=judges['B'][k][field]:diffs.append({'reference_id':k,'field':field,'A':judges['A'][k][field],'B':judges['B'][k][field]})
   out.append({'version':version,**row,'provisional_denominator_fixed':True,'scores':scores,'reference_field_disagreements':diffs,'warning':'New_assertion=yes alone is not harm: warranted evidence-backed additions also create assertions. Do not sum as harmful patches.'})
(B/'results/review-scoreboard.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
for row in out:print(row['version'],row.get('case_id'),row.get('condition'),[(x['judge'],x['omission_identified'],x['candidate_covered_semantic_match'],x['required_denom']) for x in row['scores']],len(row['reference_field_disagreements']))
