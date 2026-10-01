import argparse,json,pathlib,hashlib,collections
p=argparse.ArgumentParser();p.add_argument('--labels',nargs='+',required=True);p.add_argument('--runs',required=True);p.add_argument('--output',required=True);a=p.parse_args();rows=[]
for path in a.labels:
 label=json.loads(pathlib.Path(path).read_text());event={'event_id':label['event_id'],'branches':[]}
 for b in label['branches']:
  ip=pathlib.Path(b['input_path']);x=json.loads(ip.read_text());iid=x['item_id'];rp=pathlib.Path(a.runs)/(iid+'.raw.json');raw=json.loads(rp.read_text()) if rp.exists() else None
  packet=x['evidence_packet'];q=raw.get('evidence_quote') if raw else None
  event['branches'].append({'item_id':iid,'role':b['branch_role'],'expected':b['expected_relation_support'],'decision':raw.get('decision') if raw else None,'executed':raw is not None,'matches_expected':raw.get('decision')==b['expected_relation_support'] if raw else None,'quote_literal_substring':q in packet if isinstance(q,str) and q and q.lower()!='none' else None,'input_sha256':hashlib.sha256(ip.read_bytes()).hexdigest(),'raw_sha256':hashlib.sha256(rp.read_bytes()).hexdigest() if raw else None})
 event['triplet_matches']=all(v['matches_expected'] is True for v in event['branches']);rows.append(event)
summary={'events':len(rows),'assigned_judgments':sum(len(x['branches']) for x in rows),'actual_judgments':sum(v['executed'] for x in rows for v in x['branches']),'triplet_matches':sum(x['triplet_matches'] for x in rows),'by_branch':{}}
for role in sorted({v['role'] for x in rows for v in x['branches']}):
 vs=[v for x in rows for v in x['branches'] if v['role']==role];summary['by_branch'][role]={'assigned':len(vs),'executed':sum(v['executed'] for v in vs),'matches':sum(v['matches_expected'] is True for v in vs),'decisions':dict(collections.Counter(v['decision'] or 'not_executed' for v in vs))}
with pathlib.Path(a.output).open('x') as f:json.dump({'module':'J packet intervention, not whole-source accuracy','events':rows,'summary':summary},f,ensure_ascii=False,indent=2)
print(json.dumps(summary))
