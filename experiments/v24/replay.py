"""Replay stored synthetic artifacts. No model calls or semantic truth scoring."""
from pathlib import Path
import json,importlib.util
p=Path(__file__).resolve().parent

def load(f):return json.loads(f.read_text())
def module(version,name):
 s=importlib.util.spec_from_file_location('replay_'+version+'_'+name,p/version/(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
v1g,v1d=module('code','gate'),module('code','delivery');v2g,v2d=module('code_v2','gate'),module('code_v2','delivery')
def literal(u,r):
 t=u['article']['text']
 for x in r['patches']:
  assert t.count(x['before'])==1;t=t.replace(x['before'],x['after'],1)
 assert t==r['full_edited_text']
units=sorted((p/'cases').glob('*.json'));assert len(units)==10
for f in units:
 u=load(f);c=load(p/'certificates'/f.name);g=v1g.run(u,c);assert g==load(p/'gate-results'/f.name)
 for arm in ['baseline','enforced']:
  r=load(p/'edited'/arm/f.name);literal(u,r);assert v1d.enforce(u,r,g)==load(p/'delivered'/arm/f.name)
  for variant in ['original_certificate','enriched_certificate']:
   cc=c
   if variant=='enriched_certificate' and (p/'certificates-v2-enriched'/f.name).exists():cc=load(p/'certificates-v2-enriched'/f.name)
   gg=v2g.run(u,cc);dd=v2d.enforce(u,r,gg);assert {'gate':gg,'delivery':dd}==load(p/'v2-replay'/variant/arm/f.name)
s=p/'si-pair';units=sorted((s/'cases').glob('*.json'));assert len(units)==2
for f in units:
 u=load(f);c=load(s/'certificates'/f.name);g=v2g.run(u,c)
 for arm in ['baseline','enforced']:
  r=load(s/'edited'/arm/f.name);literal(u,r);assert {'gate':g,'delivery':v2d.enforce(u,r,g)}==load(s/'delivered'/arm/f.name)
print('24 native edits, v1/v2 derived deliveries and counterfactual replays match saved artifacts; semantics not certified')
