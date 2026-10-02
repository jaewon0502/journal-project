"""Verify published bytes and replay saved synthetic patches. Does not call a model."""
from pathlib import Path
import hashlib,json,sys

def verify(root):
 manifest=json.loads((root/'PACKAGE-MANIFEST.json').read_text());errors=[]
 for r in manifest['files']:
  f=root/r['path']
  if not f.is_file() or hashlib.sha256(f.read_bytes()).hexdigest()!=r['sha256']:errors.append('hash mismatch: '+r['path'])
 count=0
 for f in sorted((root/'synthetic/main/repair-inputs').glob('group*.json')):
  for x in json.loads(f.read_text())['items']:
   before=x['original_candidate'];spans=[]
   for p in x['detector_output']['patches']:
    old=p['before'];new=p['after']
    if old:
     if before.count(old)!=1:errors.append('ambiguous anchor '+x['review_id']);continue
     a=before.index(old);spans.append((a,a+len(old),new))
    else:spans.append((len(before),len(before),new))
   spans.sort()
   if any(a[1]>b[0] for a,b in zip(spans,spans[1:])):errors.append('overlap '+x['review_id'])
   result=before
   for a,b,new in reversed(spans):result=result[:a]+new+result[b:]
   if result!=x['patched_candidate']:errors.append('replay mismatch '+x['review_id'])
   count+=1
 return {'manifest_entries_checked':len(manifest['files']),'saved_synthetic_patch_replays':count,'errors':errors,'semantic_validation':False,'new_model_outputs':0,'note':'Saved-output mechanical replay only. Natural sources/raw outputs deliberately excluded; full rerun needs authorized source reacquisition/private artifacts and fresh model contexts.'}
if __name__=='__main__':
 root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
 result=verify(root);print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(bool(result['errors']))
