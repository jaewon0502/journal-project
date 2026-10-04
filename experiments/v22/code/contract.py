"""Typed-label/delivery guard. Flags demand review, never prove semantic falsity."""
import json,sys

def check(unit,result):
 errors=[];flags=[]
 def fail(m):errors.append(m)
 def flag(c,m):flags.append({'claim_id':c.get('id'),'rule':m})
 claims=result.get('claims');patches=result.get('patches');original=unit['article'].get('text',unit['article'].get('full_text'))
 if not isinstance(claims,list) or not isinstance(patches,list):return {'errors':['claims/patches must be arrays'],'flags':[],'gate':'review'}
 def index(items,label):
  out={}
  for x in items:
   if not isinstance(x,dict) or not isinstance(x.get('id'),str) or not x['id'].strip():fail(label+' invalid id');continue
   if x['id'] in out:fail(label+' duplicate id')
   out[x['id']]=x
  return out
 cs=index(claims,'claim');ps=index(patches,'patch')
 enums={'fact_support':{'supported','contradicted','not_established','not_applicable'},'attribution_support':{'supported','overstated','unverifiable','not_applicable'},'edit_necessity':{'required','optional','none','unresolved'},'decision':{'repair','keep','hold'},'rationale_rule':{'direct_conflict','source_scope_overclaim','unsupported_world_assertion','supported_original','optional_detail','unverified_attribution','missing_evidence'}}
 for c in cs.values():
  for k,values in enums.items():
   if not isinstance(c.get(k),str) or c[k] not in values:fail(c['id']+' invalid '+k)
  ids=c.get('patch_ids')
  if not isinstance(ids,list) or any(not isinstance(i,str) for i in ids):fail(c['id']+' invalid patch_ids');continue
  if len(ids)!=len(set(ids)):fail(c['id']+' duplicate patch reference')
  for p in ids:
   if p not in ps or c['id'] not in ps[p].get('claim_ids',[]):fail(c['id']+' broken patch link')
  decision=c.get('decision');necessity=c.get('edit_necessity')
  if decision=='repair' and (necessity!='required' or not ids):flag(c,'repair_without_required_patch')
  if decision=='keep' and (necessity not in ('none','optional') or ids):flag(c,'keep_incompatible_with_necessity_or_patch')
  if decision=='hold' and (necessity!='unresolved' or ids):flag(c,'hold_incompatible_with_necessity_or_patch')
  if decision=='keep' and (c.get('fact_support')=='contradicted' or c.get('attribution_support')=='overstated' or c.get('rationale_rule') in ('direct_conflict','source_scope_overclaim')):flag(c,'kept_declared_conflict_or_overclaim')
  if decision=='repair' and c.get('rationale_rule') in ('supported_original','optional_detail','unverified_attribution'):flag(c,'repair_without_declared_corrective_reason')
  if decision=='hold' and c.get('rationale_rule') in ('supported_original','optional_detail'):flag(c,'hold_for_supported_optional_reason')
 delivered=original
 for p in ps.values():
  ids=p.get('claim_ids');b=p.get('before');a=p.get('after')
  if not isinstance(ids,list) or not ids or any(not isinstance(i,str) for i in ids):fail(p['id']+' invalid claim_ids');continue
  if len(ids)!=len(set(ids)):fail(p['id']+' duplicate claim reference')
  for i in ids:
   if i not in cs or p['id'] not in cs[i].get('patch_ids',[]) or cs[i].get('decision')!='repair':fail(p['id']+' broken claim link')
  if not isinstance(b,str) or not b or not isinstance(a,str) or b==a:fail(p['id']+' invalid replacement');continue
  if delivered.count(b)!=1:fail(p['id']+' nonunique/missing before');continue
  delivered=delivered.replace(b,a,1)
 if result.get('unit_id')!=unit.get('unit_id'):fail('unit mismatch')
 if result.get('full_edited_article')!=delivered:fail('delivered text mismatch')
 return {'errors':errors,'flags':flags,'gate':'review' if errors or flags else 'structurally_consistent_only','meaning_verified':False}
if __name__=='__main__':
 u=json.load(open(sys.argv[1]));r=json.load(open(sys.argv[2]));print(json.dumps(check(u,r),ensure_ascii=False,indent=2))
