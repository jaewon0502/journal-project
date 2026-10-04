"""Apply trusted v2 gate permissions; never fall back to raw proposal text."""
import importlib.util
from pathlib import Path
from fractions import Fraction
_spec = importlib.util.spec_from_file_location('_v24_gate_v2', Path(__file__).with_name('gate.py'))
_gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gate)
require, NUMBER, binding = _gate.require, _gate.NUMBER, _gate.binding

def enforce(unit, proposal, gate):
    article = unit.get('article') if isinstance(unit, dict) else None
    original = article.get('text') if isinstance(article, dict) and isinstance(article.get('text'), str) else None
    out = {'unit_id': unit.get('unit_id') if isinstance(unit, dict) else None, 'kind': 'deterministic gated delivery v2; not native model generation', 'status': 'blocked', 'full_edited_text': original, 'accepted_patch_ids': [], 'blocked_patches': [], 'raw_label_violations': [], 'local_review_required': [], 'semantic_correctness_certified': False, 'raw_output_preserved': True, 'reasons': []}
    try:
        uid, digest = binding(unit)
        require(isinstance(gate, dict) and gate.get('unit_id') == uid and gate.get('article_sha256') == digest and gate.get('status') == 'checked', 'gate unit/article binding or status invalid')
        require(isinstance(gate.get('results'), list), 'invalid gate results')
        results = {}
        for r in gate['results']:
            require(isinstance(r, dict) and isinstance(r.get('id'), str) and r['id'] not in results, 'invalid gate identifiers')
            results[r['id']] = r
        require(isinstance(proposal, dict) and isinstance(proposal.get('patches', []), list) and isinstance(proposal.get('clause_audit', []), list), 'invalid proposal')
        def references(obj):
            ids = obj.get('comparison_ids')
            require(isinstance(ids, list) and ids and all(isinstance(i, str) for i in ids) and len(set(ids)) == len(ids), 'invalid comparison references')
            require(all(i in results and results[i].get('gate_result') == 'eligible_mismatch' for i in ids), 'every comparison must exist and be eligible')
            return [results[i] for i in ids]
        def anchor(before):
            require(isinstance(before, str) and before and original.count(before) == 1, 'nonunique/absent original anchor')
            return original.index(before), original.index(before) + len(before)
        def permission(r):
            s, e = r['article_span']
            ns, ne = r['numeric_span']
            require(all(type(x) is int for x in (s, e, ns, ne)) and 0 <= s <= ns < ne <= e <= len(original), 'invalid permission spans')
            require(original[s:e] == r['article_quote'] and original[ns:ne] == r['original_numeric_token'], 'permission anchor mismatch')
            return ns, ne
        spans = []
        seen_ids = set()
        for p in proposal.get('patches', []):
            try:
                require(isinstance(p, dict), 'invalid patch')
                pid = p.get('id')
                require(isinstance(pid, str) and pid and pid not in seen_ids, 'invalid/duplicate patch ID')
                seen_ids.add(pid)
                refs = references(p)
                start, end = anchor(p.get('before'))
                before, after = p['before'], p.get('after')
                require(isinstance(after, str), 'invalid replacement')
                # Numeric token decomposition preserves suffixes, units, spacing and all prose.
                old, new = list(NUMBER.finditer(before)), list(NUMBER.finditer(after))
                require(len(old) == len(new) and old, 'replacement must change one numeric token')
                def pieces(text, tokens):
                    ends = [0] + [m.end() for m in tokens]
                    starts = [m.start() for m in tokens] + [len(text)]
                    return [text[a:b] for a, b in zip(ends, starts)]
                require(pieces(before, old) == pieces(after, new), 'non-numeric text/unit change; review_required')
                changed = [(a, b) for a, b in zip(old, new) if a.group() != b.group()]
                require(len(changed) == 1, 'exactly one numeric token may change; review_required')
                a, b = changed[0]
                ns, ne = start + a.start(), start + a.end()
                require(any(m.start() == ns and m.end() == ne for m in NUMBER.finditer(original)), 'partial numeric token patch')
                value = Fraction(b.group().replace(',', ''))
                for r in refs:
                    require(permission(r) == (ns, ne), 'numeric edit outside comparison permission')
                    require(Fraction(a.group().replace(',', '')) == Fraction(r['article_value']), 'original quantity mismatch')
                    require(value == Fraction(r['expected_value']), 'replacement differs from certified same-unit expected value')
                require(not any(start < e and s < end for s, e, _ in spans), 'overlapping patches')
                spans.append((start, end, after))
                out['accepted_patch_ids'].append(pid)
            except Exception as exc:
                before = p.get('before') if isinstance(p, dict) else None
                out['blocked_patches'].append({'id': p.get('id') if isinstance(p, dict) else None, 'before': before, 'reason': str(exc), 'disposition': 'review_required'})
                out['local_review_required'].append(before)
        for row in proposal.get('clause_audit', []):
            try:
                require(isinstance(row, dict) and isinstance(row.get('relation'), str), 'invalid audit row')
                if row['relation'] == 'contradicted':
                    refs = references(row)
                    s, e = anchor(row.get('quote'))
                    for r in refs:
                        ns, ne = permission(r)
                        require(s <= ns < ne <= e, 'contradiction label outside comparison permission')
            except Exception as exc:
                quote = row.get('quote') if isinstance(row, dict) else None
                out['raw_label_violations'].append({'quote': quote, 'delivered_disposition': 'review_required', 'reason': str(exc)})
                out['local_review_required'].append(quote)
        text = original
        for s, e, after in sorted(spans, reverse=True):
            text = text[:s] + after + text[e:]
        out['full_edited_text'] = text
        out['status'] = 'review_required' if out['blocked_patches'] or out['raw_label_violations'] else 'delivered'
    except Exception as exc:
        out['reasons'] = ['invalid input: ' + str(exc)]
        out['local_review_required'] = [original]
        out['accepted_patch_ids'] = []
        out['full_edited_text'] = original
    return out
