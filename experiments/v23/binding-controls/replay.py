import json
from pathlib import Path
p=Path(__file__).resolve().parent
assert {f.stem for f in (p/'raw').glob('*.json')}=={'K731','K842','K953','K164'}
for f in sorted((p/'raw').glob('*.json')):
 u=json.loads((p/f.name).read_text());r=json.loads(f.read_text());t=u['article']['text']
 for x in r['patches']:
  assert t.count(x['before'])==1
  t=t.replace(x['before'],x['after'],1)
 assert t==r['full_edited_text']
 assert not r['whole_text_hold']
 print(f.stem,'literal replay passes; semantic judgment is separate')
