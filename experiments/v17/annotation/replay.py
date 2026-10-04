#!/usr/bin/env python3
"""Offline replay of fixed categorical comparisons and exact quote witnesses.
Does not rerun judges or mechanically certify semantic prose consistency.
"""
from pathlib import Path
import json, hashlib
P = Path(__file__).resolve().parent
load = lambda n: json.loads((P/n).read_text())
digest = lambda n: hashlib.sha256((P/n).read_bytes()).hexdigest()
manifest = load('hashes.json')
for name, expected in manifest['portable_file_sha256'].items():
    assert digest(name) == expected, ('portable hash mismatch', name)
freeze = load('prejudge-freeze.json')
for name, expected in freeze['payload_sha256'].items():
    assert digest(name) == expected, ('prejudge payload changed', name)
for name, expected in load('response-seal.json')['response_hashes'].items():
    assert digest(name) == expected, ('sealed response changed', name)
items = load('items.json')['records']
assert len(items) == 6
assert [i['kind'] for i in items].count('exposed_regression') == 2
assert [i['kind'] for i in items].count('fresh_synthetic') == 4
ids = [i['id'] for i in items]
sets = {name:load(name)['rows'] for name in ['judge01.json','judge02.json','reference-withheld.json']}
fields = ['original_proposition_changed','candidate_factual_error','normative_value_resolution']
allowed = {fields[0]: {'yes','no','unknown','not_applicable'}, fields[1]: {'yes','no','unknown','not_applicable'}, fields[2]: {'resolved','unresolved','not_applicable'}}
anchor_counts = {}
for name, rows in sets.items():
    assert [r['id'] for r in rows] == ids
    count = 0
    for it, r in zip(items, rows):
        assert all(r[f] in allowed[f] for f in fields)
        assert isinstance(r['changed_relation'], str) and r['changed_relation'].strip()
        docs = {'O': [it['O']], 'C': [it['C']]}
        for s in it['S']:
            docs.setdefault(s['id'], []).append(s['text'])
        anchors = r['source_anchors']
        assert {'O','C'} <= {a['document_id'] for a in anchors}
        assert any(a['document_id'].startswith('S') for a in anchors)
        for a in anchors:
            assert a['locator'] and a['quote']
            assert any(a['quote'] in text for text in docs.get(a['document_id'], [])), (name, r['id'], a)
            if a['document_id'].startswith('S'):
                assert any(a['locator'] == s['locator'] and a['quote'] in s['text'] for s in it['S'] if s['id'] == a['document_id'])
            count += 1
    anchor_counts[name] = count
comparisons = {}
for a,b in [('judge01.json','judge02.json'),('judge01.json','reference-withheld.json'),('judge02.json','reference-withheld.json')]:
    comparisons[a+' vs '+b] = {}
    for group in ['all','exposed_regression','fresh_synthetic']:
        idx = [n for n,it in enumerate(items) if group == 'all' or it['kind'] == group]
        comparisons[a+' vs '+b][group] = {f:{'agree':sum(sets[a][n][f] == sets[b][n][f] for n in idx),'total':len(idx)} for f in fields}
categorical_pass = all(sets[j][n][f] == sets['reference-withheld.json'][n][f] for j in ['judge01.json','judge02.json'] for n in range(6) for f in fields)
print(json.dumps({'categorical_criterion_pass':categorical_pass,'comparisons':comparisons,'exact_anchors_verified':anchor_counts,'manual_prose_review':'See ../annotation-results.md; not mechanically inferred by replay.','original_private_files':'Hashes retained; private originals are intentionally not bundled or required for portable replay.'}, indent=2))
