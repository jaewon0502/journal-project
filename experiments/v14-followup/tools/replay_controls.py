"""Audit saved synthetic control judgments. Does not call AI or certify semantics."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def decode(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError('duplicate JSON key: ' + key)
            out[key] = value
        return out
    def invalid_constant(value):
        raise ValueError('invalid JSON constant: ' + value)
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)

def read(root, name):
    return decode((root / 'data' / name).read_bytes())

def unique_span(text, needle):
    if not isinstance(needle, str) or not needle:
        raise ValueError('patch anchor absent/nonunique')
    start = text.find(needle)
    if start < 0 or text.find(needle, start + 1) >= 0:
        raise ValueError('patch anchor absent/nonunique')
    return start, start + len(needle)

def unique_index(items, key):
    out = {}
    for item in items:
        ident = item[key]
        if ident in out:
            raise ValueError('duplicate ' + key)
        out[ident] = item
    return out

def replay(root=ROOT, check_saved=False):
    root = Path(root)
    input_raw = (root / 'data/control-input.json').read_bytes()
    packet = decode(input_raw)
    protocol = read(root, 'control-protocol.json')
    construction_raw = (root / 'data/control-construction.json').read_bytes()
    labels = decode(construction_raw)['cases']
    input_sha = digest(input_raw)
    if input_sha != protocol['input_sha256']:
        raise ValueError('control input hash mismatch')
    if digest(construction_raw) != protocol['construction_sha256']:
        raise ValueError('construction label hash mismatch')
    cases = unique_index(packet['cases'], 'case_id')
    labels = unique_index(labels, 'case_id')
    if set(cases) != set(labels):
        raise ValueError('construction coverage mismatch')
    docs = {p['id']: p['text'] for s in packet['sources'] for p in s['paragraphs']}
    sources = {s['id']: {p['id'] for p in s['paragraphs']} for s in packet['sources']}
    reference = {x['family']: cases[cid]['article'] for cid, x in labels.items() if x['construction'] == 'source_faithful'}
    results = []
    for reviewer in ('r1', 'r2'):
        review_raw = (root / ('data/control-review-' + reviewer + '.json')).read_bytes()
        report = decode(review_raw)
        if report['reviewer'] != reviewer or report['input_sha256'] != input_sha:
            raise ValueError('review binding mismatch: ' + reviewer)
        if not report.get('context_exposure'):
            raise ValueError('missing context exposure disclosure')
        judgments = unique_index(report['cases'], 'case_id')
        if set(judgments) != set(cases):
            raise ValueError('review coverage mismatch: ' + reviewer)
        rows = []
        for cid, c in cases.items():
            judgment = judgments[cid]
            label = labels[cid]
            decision = judgment['decision']
            patches = judgment['patches']
            if decision not in ('unchanged', 'repair', 'hold'):
                raise ValueError('invalid decision')
            if decision == 'unchanged' and patches or decision == 'repair' and not patches:
                raise ValueError('decision/patch mismatch')
            if not judgment.get('reason') or not isinstance(judgment['remaining_uncertainties'], list):
                raise ValueError('missing judgment rationale/uncertainties')
            article = c['article']
            positions = []
            target = label['contradiction_before']
            target_span = unique_span(article, target) if target else None
            outside = False
            for p in patches:
                before = p['before']
                start, end = unique_span(article, before)
                if not isinstance(p['after'], str) or before == p['after'] or not p.get('reason'):
                    raise ValueError('invalid replacement')
                if any(start < e and s < end for s, e, _ in positions):
                    raise ValueError('overlapping patches')
                positions.append((start, end, p['after']))
                if not p['anchors']:
                    raise ValueError('missing evidence anchors')
                for anchor in p['anchors']:
                    key, quote = anchor['document_id'], anchor['quote']
                    if key not in sources[c['source_id']] or not quote or quote not in docs[key]:
                        raise ValueError('inexact or wrong-family evidence anchor')
                if target_span is None or not (target_span[0] <= start and end <= target_span[1]):
                    outside = True
            candidate = article
            for start, end, after in sorted(positions, reverse=True):
                candidate = candidate[:start] + after + candidate[end:]
            rows.append({'case_id': cid, 'construction': label['construction'], 'observed_decision': decision,
                         'agrees_with_construction_decision': decision == label['expected_decision'],
                         'patch_count': len(patches), 'changed_outside_injected_span': outside,
                         'candidate_sha256': digest(candidate.encode()),
                         'exact_string_matches_faithful_pair': candidate == reference[label['family']],
                         'semantic_repair_validated_by_this_script': False})
        faithful = [r for r in rows if r['construction'] == 'source_faithful']
        injected = [r for r in rows if r['construction'] == 'one_injected_contradiction']
        results.append({'reviewer': reviewer, 'report_sha256': digest(review_raw),
                        'faithful_cases': len(faithful), 'faithful_unchanged': sum(r['observed_decision'] == 'unchanged' for r in faithful),
                        'faithful_repair_or_hold': sum(r['observed_decision'] != 'unchanged' for r in faithful),
                        'injected_cases': len(injected), 'injected_repair': sum(r['observed_decision'] == 'repair' for r in injected),
                        'injected_unchanged_or_hold': sum(r['observed_decision'] != 'repair' for r in injected),
                        'rows': rows})
    result = {'scope': 'saved synthetic control replay; construction labels are not independent human gold',
            'new_model_calls': 0, 'natural_news_articles': 0, 'unique_source_families': len(packet['sources']),
            'article_variants': len(cases), 'human_alignment_proven': False, 'original_v14_replayed': False,
            'reviewers': results}
    if check_saved and result != read(root, 'control-results.json'):
        raise ValueError('saved control results do not match actual judgments')
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--check-saved', action='store_true')
    args = parser.parse_args()
    try:
        result = replay(args.root, check_saved=args.check_saved)
    except (ValueError, KeyError, TypeError, OSError, json.JSONDecodeError) as exc:
        parser.exit(1, 'Control replay failed: ' + str(exc) + '\n')
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(text)
    else:
        print(text, end='')

if __name__ == '__main__':
    main()
