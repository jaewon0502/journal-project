"""Saved synthetic outputs only; never generates or scores unseen model output."""
from pathlib import Path
import importlib.util,json,sys,hashlib
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
sys.path.insert(0,str(ROOT/'experiments/v18/code'))
spec=importlib.util.spec_from_file_location('strict_replay',HERE.parent/'code-audit/check_output_strict.py');checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
schema=json.loads((HERE.parent/'protocol/schema.json').read_text());rows=json.loads((HERE/'results.json').read_text())['rows']
for row in rows:
 uid=row['unit_id'];inp=HERE/f'{uid}-input.json';u=json.loads(inp.read_text());o=json.loads((HERE/f'{uid}-output.json').read_text());actual=checker.apply_checked(u,o,schema)
 assert len(o['patches'])==row['patches']
 assert (actual==u['article']['full_text'])==row['unchanged']
 assert len(actual)==row['delivered_chars']
 freeze=json.loads((HERE/'freeze.json').read_text());assert hashlib.sha256(inp.read_bytes()).hexdigest()==freeze['inputs'][uid+'.json']
 print(uid,row['decision'],'saved output replay verified')
print('Two synthetic native outputs replayed; new model calls: 0. Semantic findings remain saved AI judgments.')
