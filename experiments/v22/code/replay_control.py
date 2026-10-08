"""Replay saved synthetic outputs; no inference call and no semantic truth claim."""
import json
from pathlib import Path
from contract import check
root=Path(__file__).resolve().parents[1]/'synthetic-control'
count=0
for name,fmt in {'c17':'joined','c28':'split','c39':'reordered','c41':'joined','c52':'split','c63':'reordered'}.items():
 for f in sorted((root/'raw'/name).glob('*.json')):
  result=check(json.loads((root/'inputs'/fmt/f.name).read_text()),json.loads(f.read_text()))
  assert not result['errors'] and not result['flags'],(f,result)
  count+=1
assert count==18
print('18 saved synthetic editing outputs: structural and exact patch delivery replay passed; meaning is not automatically verified.')
