"""Preregistered deterministic proposal gates; no model calls or final safety audit."""
import argparse
import hashlib
import json
from pathlib import Path
import jsonschema
ROOT = Path(__file__).resolve().parents[1]
FIELDS = ('warranted','evidence_support','preserves_untargeted_meaning','context_safe','application_valid')
SCHEMA = json.loads((ROOT/'protocol/REVIEW_SCHEMA.json').read_text())
def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')
def sha(value):
    return hashlib.sha256(value).hexdigest()
def binding(bundle, raw):
    return {'bundle_id':bundle['bundle_id'],'input_sha256':sha(raw),'source_sha256':sha(canonical(bundle['source_documents'])),'original_sha256':sha(bundle['original_article'].encode('utf-8')),'patches_sha256':sha(canonical(bundle['proposed_patches']))}
def spans(bundle):
    original=bundle['original_article']; found={}; problems={}
    for patch in bundle['proposed_patches']:
        pid=patch['id']; before=patch['before']
        if not isinstance(before,str) or not before or not isinstance(patch['after'],str):
            problems[pid]='invalid patch text'; continue
        start=original.find(before)
        if start<0 or original.find(before,start+1)>=0:
            problems[pid]='before anchor absent or nonunique'; continue
        found[pid]=(start,start+len(before),patch['after'])
    for a,(s,e,_) in found.items():
        for b,(s2,e2,_) in found.items():
            if a!=b and s<e2 and s2<e:
                problems[a]='overlapping proposed spans'
    return found,problems

def apply(original, accepted, positions):
    out=original
    for pid in sorted(accepted,key=lambda p:positions[p][0],reverse=True):
        start,end,replacement=positions[pid]
        out=out[:start]+replacement+out[end:]
    return out

def documents(bundle):
    docs={'original':bundle['original_article']}
    for source in bundle['source_documents']:
        for paragraph in source['paragraphs']:
            if paragraph['id'] in docs:
                raise ValueError('duplicate source paragraph document_id')
            docs[paragraph['id']]=paragraph['text']
    return docs

def validate_review(review, expected, ids, docs):
    errors=[]
    for err in jsonschema.Draft202012Validator(SCHEMA).iter_errors(review):
        errors.append('schema '+'.'.join(map(str,err.absolute_path))+': '+err.message)
    if errors: return errors
    for key,value in expected.items():
        if review.get(key)!=value: errors.append('binding mismatch: '+key)
    patchids=[p['patch_id'] for p in review['patch_assessments']]
    if len(patchids)!=len(set(patchids)) or set(patchids)!=set(ids):
        errors.append('patch assessments must cover every proposal exactly once')
    issueids=[i['id'] for i in review['background_issues']]
    if len(issueids)!=len(set(issueids)): errors.append('duplicate background issue id')
    for item in review['patch_assessments']+review['background_issues']+[{'anchors':review['global_risk_anchors']}]:
        refs=item.get('dependencies',item.get('affects_patch_ids',[]))
        if any(p not in ids for p in refs): errors.append('unknown referenced patch id')
        for anchor in item['anchors']:
            if anchor['document_id'] not in docs or anchor['quote'] not in docs[anchor['document_id']]:
                errors.append('inexact or unknown evidence anchor')
    return errors

def evaluate(bundle, raw, reviews):
    original=bundle['original_article']; patches=bundle['proposed_patches']; ids=[p['id'] for p in patches]
    expected=binding(bundle,raw); positions,mechanical=spans(bundle)
    errors=[]
    if len(ids)!=len(set(ids)): errors.append('duplicate proposal id')
    if len(reviews)!=2: errors.append('exactly two independent review records required')
    try: docs=documents(bundle)
    except ValueError as e: docs={}; errors.append(str(e))
    for n,review in enumerate(reviews):
        errors += ['review '+str(n+1)+': '+e for e in validate_review(review,expected,ids,docs)]
    reasons={pid:[] for pid in ids}; global_reasons=list(errors); strict_extra=[]; deps={pid:set() for pid in ids}
    if not errors:
        for n,review in enumerate(reviews):
            prefix='review '+str(n+1)+': '
            if review['global_material_risk']!='no': global_reasons.append(prefix+'global material risk '+review['global_material_risk'])
            for p in review['patch_assessments']:
                pid=p['patch_id']; deps[pid].update(p['dependencies'])
                for field in FIELDS:
                    if p[field]!='yes': reasons[pid].append(prefix+field+'='+p[field])
                if p['dependency_status']!='complete': reasons[pid].append(prefix+'unknown dependencies')
            for issue in review['background_issues']:
                if issue['status']=='resolved': continue
                strict_extra.append(prefix+'unresolved background issue '+issue['id'])
                mapped=issue['affects_patch_ids']
                if issue['unrelated_to_edits']=='unknown':
                    global_reasons.append(prefix+'unknown issue relation '+issue['id'])
                if not mapped:
                    if issue['unrelated_to_edits']!='yes': global_reasons.append(prefix+'unlocalized unresolved issue '+issue['id'])
                elif issue['unrelated_to_edits']=='yes':
                    global_reasons.append(prefix+'contradictory issue relation '+issue['id'])
                elif issue['material']!='no':
                    for pid in mapped: reasons[pid].append(prefix+'mapped material/unknown issue '+issue['id'])
    for pid,problem in mechanical.items(): reasons[pid].append('application: '+problem)
    if global_reasons:
        for pid in ids: reasons[pid].extend(global_reasons)
    accepted={pid for pid in ids if not reasons[pid]}
    while True:
        removed={pid for pid in accepted if not deps[pid]<=accepted}
        if not removed: break
        for pid in sorted(removed): reasons[pid].append('dependency held: '+', '.join(sorted(deps[pid]-accepted)))
        accepted-=removed
    g0_ok=not global_reasons and not strict_extra and len(accepted)==len(ids)
    results={}
    for gate, selected in [('G0',set(ids) if g0_ok else set()),('G1',accepted)]:
        delivered=apply(original,selected,positions)
        local={pid:list(reasons[pid]) for pid in ids}
        if gate=='G0' and not g0_ok:
            for pid in ids:
                local[pid].append('strict whole-bundle hold')
        results[gate]={'proposal_ids':ids,'accepted_ids':[p for p in ids if p in selected],'held_ids':[p for p in ids if p not in selected],'delivered_text':delivered,'delivered_sha256':sha(delivered.encode('utf-8')),'reasons':local,'bundle_reasons':global_reasons+(strict_extra if gate=='G0' else []),'status':'held' if (global_reasons or (gate=='G0' and not g0_ok)) else ('no_op' if not ids else ('held' if not selected else 'proposed_delivery')),'final_audit_required':True}
    return {'binding':expected,'reviews_sha256':[sha(canonical(r)) for r in reviews],'results':results}

def prepare(bundle, raw):
    positions, problems=spans(bundle)
    return {'binding':binding(bundle,raw),'bundle':bundle,'full_candidate':None if problems else apply(bundle['original_article'],positions,positions),'candidate_application_errors':problems}

def main():
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest='command',required=True)
    prep=sub.add_parser('prepare'); prep.add_argument('bundle'); prep.add_argument('output')
    gate=sub.add_parser('evaluate'); gate.add_argument('bundle'); gate.add_argument('review1'); gate.add_argument('review2'); gate.add_argument('output')
    args=parser.parse_args(); raw=Path(args.bundle).read_bytes(); bundle=json.loads(raw)
    result=prepare(bundle,raw) if args.command=='prepare' else evaluate(bundle,raw,[json.loads(Path(args.review1).read_bytes()),json.loads(Path(args.review2).read_bytes())])
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__': main()
