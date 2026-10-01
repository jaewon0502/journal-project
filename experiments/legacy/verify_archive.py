"""Validate this public derivative; no network, private files, or model calls."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parent

def read(name):
    return json.loads((ROOT / name).read_text())

def verify():
    inventory = read('inventory.json')
    citation = inventory['public_source_citations']
    assert hashlib.sha256((ROOT / citation['file']).read_bytes()).hexdigest() == citation['public_sha256']
    sources = read(citation['file'])
    assert len(sources) == citation['entries']
    assert sum(bool(s['public_url']) for s in sources) == citation['public_urls']
    for item in inventory['artifacts']:
        p = ROOT / item['public_file']
        assert hashlib.sha256(p.read_bytes()).hexdigest() == item['public_sha256'], item['public_file']
    for group, count in inventory['output_markdown_files'].items():
        assert len(list((ROOT / group / 'outputs').glob('*.md'))) == count, group
    rows = read('experiment/ratings.json')['rows']
    outputs = {p.stem for p in (ROOT / 'experiment/outputs').glob('*.md')}
    assert len(rows) == 54 and {r['run_id'] for r in rows} == outputs
    detailed = [o for p in (ROOT / 'experiment/claim-ratings').glob('*.json') for o in json.loads(p.read_text())['outputs']]
    assert len(detailed) == 54 and {o['run_id'] for o in detailed} == outputs
    correction = read('repair-v3/minimum-wage-consistency.json')['outputs']
    assert {o['run_id'] for o in correction} == {'DEV01-D-v1', 'DEV01-D-v2'}
    for o in correction:
        assert next(c for c in o['core'] if c['id'] == 'F7')['status'] == 'partial'
        assert o['F7_subchecks'] == dict(speaker=True, force=True, scope=False, causal_distinction=True)
    drafts = {x['id']:x['draft'] for x in read('repair-v4/synthetic-fixtures.json')['items']}
    synth = read('repair-v4/synthetic-responses.json')['items']
    assert len(synth) == 4
    for item in synth:
        result = drafts[item['id']]
        for edit in item['changes']:
            assert result.count(edit['old']) == 1
            result = result.replace(edit['old'], edit['new'])
        assert result == item['final_text'], item['id']
    counts = {}
    for row in rows:
        group = 'evaluation_v2' if row['case_id'].startswith('EVAL') else ('development_v1' if row['run_id'].endswith('v1') else 'development_D_v2')
        key = group + ':' + row['arm']
        counts.setdefault(key, {'passes':0, 'rows':0})
        counts[key]['passes'] += int(row['gate_pass'])
        counts[key]['rows'] += 1
    print(json.dumps({'status':'passed', 'output_markdown_files':88, 'v4_synthetic_responses':4, 'stored_gate_counts':counts}, indent=2))

if __name__ == '__main__':
    verify()
