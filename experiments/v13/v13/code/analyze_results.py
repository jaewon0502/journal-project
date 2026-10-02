"""Read-only aggregation of frozen v13 records; no model calls or score rewriting."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
import gate
ROOT = Path(__file__).resolve().parents[1]
EN = '70d87266fca45f0cf61e141a'
FIELDS = gate.FIELDS

def read(p): return json.loads(p.read_text())
def dump(p, x): p.write_text(json.dumps(x, ensure_ascii=False, indent=2)+'\n')
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--private-root',type=Path,default=ROOT.parent/'journal-v13-private'); args=ap.parse_args(); private=args.private_root
    challenge_files=sorted(private.glob('modality-challenge-*.json')); challenges=[read(p) for p in challenge_files]
    challenge_release=len(challenges)==2 and all(c.get('complete') and c.get('release_recommendation')=='release' for c in challenges)
    pre=read(ROOT/'results/preaudit-gates.json')['rows']; rows=[]; detailed=[]; disagreements=[]; replay_checks=[]; audit_checks=[]
    for bid in sorted({r['bundle_id'] for r in pre}):
        wrapper=read(private/'inputs'/f'{bid}.json'); bundle=wrapper['bundle']; kind=next(r['kind'] for r in pre if r['bundle_id']==bid)
        source_path=private/('synthetic-inputs' if kind=='synthetic' else 'real-inputs')/f'{bid}.json'
        reviews=[read(private/'reviews'/f'{review}__{bid}.json') for review in ['A','B']]
        replay=gate.evaluate(bundle,source_path.read_bytes(),reviews)
        saved=read(private/'delivery'/f'{bid}.json')
        assert replay==saved, f'Frozen gate replay differs: {bid}'
        replay_checks.append({'bundle_id':bid,'exact_saved_replay':True})
        amap=[{p['patch_id']:p for p in r['patch_assessments']} for r in reviews]
        for pid in amap[0]:
            for field in (*FIELDS,'dependencies','dependency_status'):
                if amap[0][pid][field]!=amap[1][pid][field]: disagreements.append({'bundle_id':bid,'patch_id':pid,'field':field,'values':[m[pid][field] for m in amap]})
        for r in [r for r in pre if r['bundle_id']==bid]:
            a=read(private/'audit-results'/f"{r['audit_id']}.json"); packet=read(private/'audit-inputs'/f"{r['audit_id']}.json")
            assert hashlib.sha256(packet['candidate_article'].encode()).hexdigest()==r['delivered_sha256']
            docs={p['id']:p['text'] for d in packet['source_documents'] for p in d['paragraphs']}
            anchors=[]
            for change in a['changes']:
                for anchor in change['source_anchors']:
                    if isinstance(anchor,str):
                        aid,_,quote=anchor.partition(': ' )
                    else:
                        aid=anchor.get('paragraph_id',anchor.get('id',anchor.get('document_id'))); quote=anchor.get('quote',anchor.get('text'))
                    anchors.append({'id':aid,'exact':aid in docs and isinstance(quote,str) and quote in docs[aid]})
            coverage=set(a['read_source_paragraph_ids'])==set(docs)
            assert a['audit_id']==r['audit_id'] and a['complete'] and a['read_complete'] and a['original_paragraphs_read'] and coverage
            # Preserve non-exact raw audit anchors as evidence-quality exceptions.
            audit_checks.append({'audit_id':r['audit_id'],'candidate_hash_matches':True,'declared_full_source_coverage':coverage,'exact_source_anchor_count':sum(x['exact'] for x in anchors),'nonexact_source_anchors':[x for x in anchors if not x['exact']]})
            raw_pass=(a['release_recommendation']=='release' and a['full_context_safety']=='safe' and all(c['introduced_material_harm']=='no' for c in a['changes']))
            held=[]
            for pid in r['held_ids']:
                reasons=r['reasons'][pid]; vals=[m[pid] for m in amap]
                if any(s.startswith('dependency held:') for s in reasons): category='dependency_closure'
                elif any(v[f]=='no' for v in vals for f in ['evidence_support','preserves_untargeted_meaning','context_safe','application_valid']): category='review_assessed_unsafe'
                elif any(v[f]=='unknown' for v in vals for f in FIELDS): category='unresolved_unknown'
                elif any(v['warranted']=='no' for v in vals): category='supported_unwarranted'
                else: category='strict_bundle_only'
                held.append({'patch_id':pid,'primary_category':category,'unknown_fields':sorted({f for v in vals for f in FIELDS if v[f]=='unknown'}),'reasons':reasons})
            provisional=bid==EN and r['gate']=='G1' and not challenge_release
            row={**{k:r[k] for k in ['bundle_id','kind','gate','proposals','accepted_ids','held_ids','status','audit_id','delivered_sha256']},'held_classification':held,'raw_final_audit':{'release_recommendation':a['release_recommendation'],'full_context_safety':a['full_context_safety'],'release_eligible':raw_pass,'atomic_changes':len(a['changes']),'supported_warranted_atomic_changes':sum(c['warranted']=='yes' and c['evidence_support']=='yes' for c in a['changes']),'introduced_material_harm_count':sum(c['introduced_material_harm']=='yes' for c in a['changes']),'unknown_change_safety_count':sum(c['introduced_material_harm']=='unknown' for c in a['changes']),'residual_original_issue_count':len(a['original_residual_issues']),'unmet_required_answer_count':len(a['unmet_required_answers']),'criticism_preservation':a['criticism_preservation']['status']},'post_audit_disposition':'provisional_pending_targeted_challenge' if provisional else ('eligible_patch_delivery' if raw_pass and r['accepted_ids'] else ('eligible_unchanged_original' if raw_pass else 'hold_or_rollback')),'confirmed_patch_ids':r['accepted_ids'] if raw_pass and not provisional else [],'raw_audit_eligible_patch_ids':r['accepted_ids'] if raw_pass else []}
            rows.append(row); detailed.append({'row':row,'raw_audit':a,'source_scope_note':packet['source_scope_note'],'review_assessments':amap,'background_issues':[x['background_issues'] for x in reviews]})
    totals=[]
    for kind in ['synthetic','real']:
        for g in ['G0','G1']:
            rr=[r for r in rows if r['kind']==kind and r['gate']==g]
            totals.append({'kind':kind,'gate':g,'bundles':len(rr),'proposals':sum(r['proposals'] for r in rr),'preaudit_accepted_patches':sum(len(r['accepted_ids']) for r in rr),'raw_audit_eligible_patches':sum(len(r['raw_audit_eligible_patch_ids']) for r in rr),'confirmed_patch_ids_count':sum(len(r['confirmed_patch_ids']) for r in rr),'provisional_patch_count':sum(len(r['accepted_ids']) for r in rr if r['post_audit_disposition'].startswith('provisional')),'normal_noop_bundles':sum(r['status']=='no_op' for r in rr),'held_categories':dict(Counter(p['primary_category'] for r in rr for p in r['held_classification']))})
    result={'status':'audits_complete_with_source_fidelity_exception' if challenge_release else 'provisional_English_targeted_challenge_pending','posthoc_challenge':{'preregistered':False,'records':len(challenges),'record_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in challenge_files},'release_relative_to_original':challenge_release,'literal_modality_strengthening':True if challenge_release else None,'qualification':'Both targeted reviews retain release while acknowledging source-fidelity loss. Materiality is interpretive, not reader-outcome evidence. Raw primary audits are unchanged.'},'scope':{'bundles':8,'authored_synthetic_bundles':6,'authored_synthetic_patches':10,'exposed_real_regression_bundles':2,'saved_real_patches':17,'initial_review_records':16,'initial_patch_assessments':54,'gate_bundle_rows':16,'unique_final_candidate_audits':len({r['audit_id'] for r in rows}),'raw_final_audit_atomic_changes':sum(r['raw_final_audit']['atomic_changes'] for r in {r['audit_id']:r for r in rows}.values()),'unit_warning':'Stage records are not independent cases. Atomic changes are not proposal counts.'},'aggregates':totals,'rows':rows,'initial_patch_review_disagreements':disagreements,'mechanical_checks':{'exact_gate_replays':len(replay_checks),'unique_audit_records_checked':len({x['audit_id'] for x in audit_checks}),'unique_exact_final_source_anchors':sum(x['exact_source_anchor_count'] for x in {x['audit_id']:x for x in audit_checks}.values()),'nonexact_final_audit_anchor_count':sum(len(x['nonexact_source_anchors']) for x in {x['audit_id']:x for x in audit_checks}.values()),'meaning_warning':'Exact anchors, hashes and declared reading coverage do not prove semantic safety.'},'limits':['No human gold standard or independent human audit. Author labels remain provisional.','No controlled model version, seed or cost comparison; native agent default runtime.','G0 is a normalized new whole-bundle review rule, not bit-exact v12 replay.','All proposals and rationales were shared across gates; rationales can prime reviewers.','Six synthetic fixtures and two exposed regressions do not estimate generalization.','Preserve source gaps: absent eligible evidence is unverified, not refuted.','Raw final audit EN C3 accepts firmer generalizability wording; targeted challenge is separate evidence, not a rewrite of that verdict.','No composite quality score or precision estimate.']}
    operational_audit=private/'posthoc-wording/audit-result.json'
    operational_detail=None
    if operational_audit.exists():
        oa=read(operational_audit); edit=read(private/'posthoc-wording/edit-record.json'); packet=read(private/'posthoc-wording/audit-input.json')
        assert oa['complete'] and oa['read_complete'] and oa['audit_id']==edit['new_audit_id']
        assert hashlib.sha256(packet['candidate_article'].encode()).hexdigest()==edit['after_sha256']
        assert packet['original_article'].count(edit['before'])==1
        assert packet['original_article'].replace(edit['before'],edit['after'],1)==packet['candidate_article']
        result['posthoc_operational_repair']={'included_in_primary_metrics':False,'preregistered':False,'independent_writer_generation':False,'novel_issue_detection':False,'author':'root assistant explicit one-phrase edit','audit_id':oa['audit_id'],'before':edit['before'],'after':edit['after'],'candidate_sha256':edit['after_sha256'],'single_phrase_change_verified':True,'release_recommendation':oa['release_recommendation'],'full_context_safety':oa['full_context_safety'],'introduced_material_harm':[c['introduced_material_harm'] for c in oa['changes']],'qualification':'Separate operational source-fidelity repair of a known issue, outside preregistered one-pass experiment. Whole-article residual limitations remain. No new independent case or frozen gate improvement.'}
        operational_detail={'edit_record':edit,'audit':oa}
    dump(ROOT/'results/analysis.json',result); dump(private/'analysis-evidence.json',{'analysis':result,'gate_replay_checks':replay_checks,'audit_checks':audit_checks,'details':detailed,'posthoc_challenges':challenges,'posthoc_operational_repair':operational_detail})
    print(json.dumps({'aggregates':totals,'disagreements':disagreements,'checks':result['mechanical_checks']},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
