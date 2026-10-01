#!/usr/bin/env python3
"""Deterministic conservative reference merger; no semantic adjudication."""
import argparse
from collections import Counter
from copy import deepcopy
import json
from pathlib import Path
from run_artifacts import load_input, read, sha, validate_reference, write


def merge_reference(input_path, draft_path, audit_path, out):
    common, input_hash = load_input(input_path)
    validate_reference(input_path, draft_path)
    draft_bytes, audit_bytes = Path(draft_path).read_bytes(), Path(audit_path).read_bytes()
    draft, audit = json.loads(draft_bytes), json.loads(audit_bytes)
    for field, expected in [('article_id', common['article_id']), ('input_sha256', input_hash), ('draft_sha256', sha(draft_bytes))]:
        if audit.get(field) != expected:
            raise ValueError('audit identity mismatch: '+field)
    if 'source_sha256' in audit and audit['source_sha256'] != common['source_sha256']:
        raise ValueError('audit source hash mismatch')
    if audit.get('read_complete') is not True:
        raise ValueError('audit did not finish source reading')
    source_paragraphs = {p['id']: p for p in common['paragraphs']}
    audited = {}
    for row in audit['paragraphs']:
        if row['id'] in audited or row['id'] not in source_paragraphs or row['coverage'] not in {'covered', 'incomplete', 'uncertain'} or not isinstance(row['missing_claims'], list):
            raise ValueError('invalid/duplicate audit paragraph')
        audited[row['id']] = row
    if set(audited) != set(source_paragraphs):
        raise ValueError('audit must cover every source paragraph')
    frozen = deepcopy(draft)
    frozen['schema'] = 'v8-frozen-reference-conservative-1'
    frozen['provenance'] = dict(input_sha256=input_hash, source_sha256=common['source_sha256'],
                                draft_sha256=sha(draft_bytes), audit_sha256=sha(audit_bytes),
                                merger='freeze_reference-v1', semantic_adjudication=False, completeness_proven=False)
    claims = {c['id']: c for c in frozen['claims']}
    original_claims = len(claims)
    for c in frozen['claims']:
        c['original_draft_claim'] = deepcopy(c)
    disputes = []
    for correction in audit['claim_corrections']:
        if correction['id'] not in claims:
            raise ValueError('claim correction references unknown draft claim')
        c = claims[correction['id']]
        c.setdefault('audit_disputes', []).append(deepcopy(correction))
        c['verification'] = 'unknown'
        c['verification_reason'] = 'Unresolved reference-audit dispute; proposed fields not adopted.'
        disputes.append(deepcopy(correction))
    frozen['claim_corrections_unresolved'] = disputes
    gaps, added, paragraph_additions = [], [], {p: [] for p in source_paragraphs}
    used_claim_ids = set(claims)
    for pid, row in audited.items():
        for item in row['missing_claims']:
            valid = isinstance(item, dict) and isinstance(item.get('source_anchor'), str) and bool(item['source_anchor']) and isinstance(item.get('meaning'), str) and bool(item['meaning'].strip())
            pids = item.get('paragraph_ids', [pid]) if isinstance(item, dict) else []
            valid = valid and isinstance(pids, list) and bool(pids) and pid in pids and len(pids) == len(set(pids)) and all(p in source_paragraphs for p in pids)
            valid = valid and any(item['source_anchor'] in source_paragraphs[p]['text'] for p in pids)
            if not valid:
                gaps.append(dict(paragraph_id=pid, descriptor=deepcopy(item), reason='Unstructured or invalid exact anchored addition; no claim fabricated.'))
                continue
            n = len(added)+1
            cid = f'AUDIT_C{n:04d}'
            while cid in used_claim_ids:
                n += 1
                cid = f'AUDIT_C{n:04d}'
            used_claim_ids.add(cid)
            c = {key: [] for key in ('actor', 'action', 'affected_party', 'attribution', 'modality', 'time', 'conditions', 'quantities', 'criticism_rebuttal', 'relations', 'evidence_ids')}
            c.update(deepcopy(item))
            c.update(id=cid, paragraph_ids=pids, verification='unknown',
                     verification_reason='Audit-added provisional claim; no independent adjudication.',
                     audit_original_claim=deepcopy(item), audit_added_provisional=True)
            frozen['claims'].append(c)
            added.append(cid)
            for p in pids:
                paragraph_additions[p].append(cid)
    for p in frozen['paragraphs']:
        row = audited[p['id']]
        p['original_coverage'] = p['coverage']
        p['audit_coverage'] = row['coverage']
        p['audit_row'] = deepcopy(row)
        p['claim_ids'] = list(dict.fromkeys(p['claim_ids'] + paragraph_additions[p['id']]))
        has_gap = any(g['paragraph_id'] == p['id'] for g in gaps)
        if has_gap:
            p['coverage'] = 'uncertain'
            p['coverage_basis'] = 'Unresolved audit coverage gap.'
        elif paragraph_additions[p['id']]:
            p['coverage'] = 'uncertain'
            p['coverage_basis'] = 'Anchored audit additions merged; not independently reviewed after addition; completeness unproven.'
        else:
            p['coverage'] = 'covered' if p['original_coverage'] == row['coverage'] == 'covered' else ('incomplete' if 'incomplete' in (p['original_coverage'], row['coverage']) else 'uncertain')
            p['coverage_basis'] = 'Draft and audit coverage retained; covered is a judgment, not proof of completeness.'
    issue_reviews = {}
    known_issues = {i['id'] for i in frozen['issues']}
    for review in audit['issues']:
        if review['id'] not in known_issues or review['id'] in issue_reviews or review['judgment'] not in {'agree', 'disagree', 'uncertain'}:
            raise ValueError('invalid/duplicate issue review')
        issue_reviews[review['id']] = review
    before = Counter(i['necessity'] for i in frozen['issues'])
    for issue in frozen['issues']:
        original = deepcopy(issue)
        review = issue_reviews.get(issue['id'])
        issue['original_draft_issue'] = original
        issue['original_necessity'] = issue['necessity']
        issue['necessity_history'] = [dict(stage='draft', necessity=issue['necessity'], reason=issue.get('reason')),
                                      dict(stage='audit', review=deepcopy(review), reason='No issue review supplied' if review is None else review.get('reason'))]
        if review is None or review['judgment'] != 'agree':
            issue['necessity'] = 'unknown'
        issue['audit_judgment'] = review['judgment'] if review else 'missing'
    additional = []
    for entry in audit['additional_issues']:
        if entry.get('id') in known_issues and issue_reviews.get(entry['id'], {}).get('judgment') == 'agree':
            target = next(i for i in frozen['issues'] if i['id'] == entry['id'])
            target.setdefault('audit_additional_records', []).append(deepcopy(entry))
            continue
        if not entry.get('paragraph_ids') or any(p not in source_paragraphs for p in entry['paragraph_ids']):
            raise ValueError('additional issue has invalid paragraphs')
        # Keep proposed claim identifiers as provenance; only resolvable IDs link the union.
        n = len(additional)+1
        iid = f'AUDIT_I{n:04d}'
        while iid in known_issues:
            n += 1
            iid = f'AUDIT_I{n:04d}'
        known_issues.add(iid)
        issue = deepcopy(entry)
        issue.update(id=iid, necessity='unknown', original_necessity=entry.get('necessity'),
                     audit_original_issue=deepcopy(entry), audit_added_provisional=True,
                     claim_ids=[c for c in entry.get('claim_ids', []) if c in used_claim_ids],
                     reason='Unresolved auditor-added issue; no necessity adjudication. Original reasoning retained.')
        frozen['issues'].append(issue)
        additional.append(iid)
    frozen['coverage_gaps'] = gaps
    # Resolve only unambiguous auditor-supplied IDs; never guess from meaning.
    aliases = {}
    for claim in frozen['claims']:
        if claim.get('audit_added_provisional') and isinstance(claim['audit_original_claim'].get('id'), str):
            aliases.setdefault(claim['audit_original_claim']['id'], []).append(claim['id'])
    for issue in frozen['issues']:
        if issue.get('audit_added_provisional'):
            linked, unresolved = [], []
            for cid in issue['audit_original_issue'].get('claim_ids', []):
                if cid in used_claim_ids:
                    linked.append(cid)
                elif len(aliases.get(cid, [])) == 1:
                    linked.append(aliases[cid][0])
                else:
                    unresolved.append(cid)
            issue['claim_ids'] = list(dict.fromkeys(linked))
            issue['unresolved_audit_claim_ids'] = unresolved
    frozen['limits'] = deepcopy(draft.get('limits', [])) + deepcopy(audit.get('limitations', [])) + ['Conservative mechanical merger; no complete gold standard or semantic adjudication.']
    frozen['audit_limitations'] = deepcopy(audit.get('limitations', []))
    summary = dict(original_claims=original_claims, audit_added_claims=len(added), disputed_claims=len({d['id'] for d in disputes}),
                   coverage_gaps=len(gaps), original_issues=len(draft['issues']), audit_added_issues=len(additional),
                   disputed_or_missing_issue_reviews=sum(i['audit_judgment'] != 'agree' for i in frozen['issues'] if 'audit_judgment' in i),
                   necessity_before=dict(before), necessity_after=dict(Counter(i['necessity'] for i in frozen['issues'])))
    out = Path(out)
    out.mkdir(exist_ok=False)
    (out/'draft.original.json').write_bytes(draft_bytes)
    (out/'audit.original.json').write_bytes(audit_bytes)
    write(out/'reference.frozen.json', frozen)
    manifest = dict(**frozen['provenance'], reference_sha256=sha((out/'reference.frozen.json').read_bytes()), counts=summary)
    write(out/'manifest.json', manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('input', 'draft', 'audit', 'out'):
        parser.add_argument('--'+key, required=True)
    args = parser.parse_args()
    print(json.dumps(merge_reference(args.input, args.draft, args.audit, args.out), ensure_ascii=False))


if __name__ == '__main__':
    main()
