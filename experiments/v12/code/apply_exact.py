"""Exact local replacement only. No semantic inference, browsing, or original writes."""
import hashlib

def sha(b):return hashlib.sha256(b).hexdigest()
def apply(source,patches):
 if type(source) is not str or type(patches) is not list:raise ValueError('source string and patch list required')
 raw=source.encode('utf-8');spans=[];seen=set()
 for p in patches:
  if type(p) is not dict:raise ValueError('patch object required')
  pid=p.get('id');before=p.get('before');after=p.get('after')
  if type(pid) is not str or not pid or pid in seen:raise ValueError('unique nonempty patch id required')
  if type(before) is not str or not before or type(after) is not str:raise ValueError('exact before/after required')
  old=before.encode();new=after.encode()
  if raw.count(old)!=1:raise ValueError(f'{pid}: anchor missing or ambiguous')
  start=raw.index(old);end=start+len(old);spans.append((start,end,new,pid));seen.add(pid)
 ordered=sorted(spans)
 if any(a[1]>b[0] for a,b in zip(ordered,ordered[1:])):raise ValueError('overlapping patches')
 result=raw
 for start,end,new,pid in reversed(ordered):result=result[:start]+new+result[end:]
 return {'source_sha256':sha(raw),'candidate_sha256':sha(result),'candidate':result.decode(),'patches':[{'id':p,'start_byte':s,'end_byte':e,'replacement_bytes':len(n)} for s,e,n,p in ordered],'outside_patches_unchanged_by_construction':True,'semantic_approval':False}

if __name__=='__main__':
 assert apply('가 나',[{'id':'p','before':'나','after':'다'}])['candidate']=='가 다'
 assert apply('same',[])['candidate']=='same'
 for source,patch in [('a a',[{'id':'p','before':'a','after':'b'}]),('abc',[{'id':'p','before':'ab','after':'x'},{'id':'q','before':'bc','after':'y'}])]:
  try:apply(source,patch)
  except ValueError:pass
  else:raise AssertionError('invalid anchor accepted')
 print('4 authored mechanical checks passed; not model outputs or meaning validation')
