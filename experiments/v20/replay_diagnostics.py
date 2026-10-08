"""Verify saved v20 inputs/outputs/audits and report their fixed judgments."""
import argparse,hashlib,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(root):
 manifest=read(HERE/'private-artifact-hashes.json')
 for relative,expected in manifest.items():assert sha(root/relative)==expected, 'Changed saved artifact: '+relative
 rows=[]
 for phase in ['diagnostic','transfer']:
  freeze=read(root/phase/'mapping-freeze.json');result=read(root/phase/'audit/result.json');assert result['pre_sha256']==sha(root/phase/'audit/pre.json')
  byid={x['unit_id']:x for x in result['units']};assert len(byid)==len(result['units'])==4
  sources=[]
  for cond in freeze['rows']:
   uid=cond['id'];inp=root/phase/'inputs'/f'{uid}.json';raw=root/phase/'raw'/f'{uid}.json';u=read(inp);o=read(raw);assert sha(inp)==cond['sha256'];assert len(inp.read_text())==cond['input_chars'];assert u['unit_id']==o['unit_id']==uid
   source={s['id']:s['text'] for s in u['sources']};sources.append(source)
   a=byid[uid]
   witnesses=a.get('applicable_source_anchors',a.get('applicable_source_witnesses',[]))
   for w in witnesses:
    doc=w.get('source',w.get('document_id'));assert w['quote'] in source[doc], 'Missing audit witness: '+uid
   obs=a.get('observable_output',a)
   rows.append({'phase':phase,'unit_id':uid,'target':cond['target'],'alignment':cond['alignment'],'strict_detection':obs['strict_focal_detection'],'terminology_notice':obs.get('terminology_difference_noticed',obs.get('merely_noticed_difference',False)),'requires_focal_correction':obs.get('requires_focal_correction',obs.get('focal_necessary_correction_identified')),'normal_unnecessary_correction':obs['normal_focal_unnecessary_correction'],'normal_unsupported_hold':obs['normal_focal_unsupported_hold'],'input_file_chars':len(inp.read_text()),'output_file_chars':len(raw.read_text()),'input_sha256':sha(inp),'output_sha256':sha(raw)})
  assert all(s==sources[0] for s in sources), 'Sources differ within factorial study'
 return {'native_reference_outputs':8,'new_article_source_contexts':1,'exposed_article_contexts':1,'fresh_independent_AI_audits':2,'rows':rows,'new_native_article_edits':0,'limits':'Saved AI judgments, not semantic truth from code. Aided location diagnostic, no autonomy/general-completeness claim. Exact model/seed/cost unavailable.'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--private-root',type=Path,required=True);p.add_argument('--output',type=Path);a=p.parse_args();s=json.dumps(run(a.private_root),ensure_ascii=False,indent=2)
 if a.output:a.output.write_text(s+'\n')
 print(s)
