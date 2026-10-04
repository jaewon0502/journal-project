"""Replay saved real AI records for one adaptive synthetic integration demonstration."""
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('v14_followup_gate', ROOT / 'code/gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

def replay():
    data = ROOT / 'data'
    bundle = (data/'integration-bundle.json').read_bytes()
    protocol = json.loads((data/'integration-protocol.json').read_bytes())
    if hashlib.sha256(bundle).hexdigest() != protocol['input_sha256']:
        raise ValueError('integration input digest mismatch')
    for relative, field in [('code/gate.py','gate_code_sha256_before_review'), ('protocol/RELATION-CONTRACT.md','contract_sha256_before_review')]:
        if hashlib.sha256((ROOT/relative).read_bytes()).hexdigest() != protocol[field]:
            raise ValueError('recorded implementation differs: '+relative)
    if gate.prepare(bundle) != json.loads((data/'integration-prepared.json').read_bytes()):
        raise ValueError('prepared wrapper mismatch')
    reviews = [(data/('integration-review-'+r+'.json')).read_bytes() for r in ('r1','r2')]
    provisional = gate.evaluate(bundle, reviews)
    if provisional != json.loads((data/'integration-provisional.json').read_bytes()):
        raise ValueError('provisional result mismatch')
    audit_input = json.loads((data/'integration-audit-input.json').read_bytes())
    for key, expected in {'bundle': json.loads(bundle), 'candidate_text': provisional['candidate_text'],
                          'selected_ids': provisional['selected_ids'], 'audit_binding': provisional['audit_binding'],
                          'relation_notes': provisional.get('relation_notes', {})}.items():
        if audit_input.get(key) != expected:
            raise ValueError('actual final audit input mismatch: '+key)
    final = gate.evaluate(bundle, reviews, (data/'integration-audit.json').read_bytes())
    if final != json.loads((data/'integration-final.json').read_bytes()):
        raise ValueError('final result mismatch')
    if provisional['validation_errors'] or final['validation_errors'] or final['audit_errors']:
        raise ValueError('saved execution contains validation/audit errors')
    return {'scope':'one adaptive reused synthetic control case, not new performance sample',
            'new_model_calls':0,'provisional_status':provisional['status'],'final_status':final['status'],
            'publication_allowed_before_final_audit':provisional['publication_allowed'],
            'publication_allowed_after_final_audit':final['publication_allowed'],
            'candidate_sha256':final.get('candidate_sha256'),'human_or_general_accuracy_proven':False}

if __name__ == '__main__':
    try:
        print(json.dumps(replay(),ensure_ascii=False,indent=2))
    except (ValueError, KeyError, OSError) as exc:
        raise SystemExit('Integration replay failed: '+str(exc))
