"""Public synthetic calibration replay, not a fresh AI evaluation."""
import json
from pathlib import Path
from contract import check
root=Path(__file__).resolve().parents[1]/'guard-challenge'
for p in sorted(root.glob('G*.json')):
 x=json.loads(p.read_text());r=check(x['input'],x['output'])
 assert r['gate']=='structurally_consistent_only' and not r['meaning_verified']
 print(x['blind_id']+': mechanically consistent only; source/rationale still needs semantic audit')
print('3 constructed fixtures replayed. Two contain deliberate semantic errors. Saved AI audit is not rerun. New model calls: 0.')
