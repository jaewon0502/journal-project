"""Offline literal-delivery replay. Semantic judgments remain in AI audit records."""
import json,sys,hashlib
from pathlib import Path
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent/'synthetic'
rows=[]
for f in sorted((root/'edit').glob('*/*.json')):
 u=json.loads((root/'inputs'/f.name).read_text());r=json.loads(f.read_text());text=u['article']['text'];errors=[]
 for patch in r['patches']:
  if not patch['before'] or text.count(patch['before'])!=1:errors.append('nonunique/missing patch');continue
  text=text.replace(patch['before'],patch['after'],1)
 if text!=r['full_edited_text']:errors.append('delivery mismatch')
 rows.append({'output':str(f.relative_to(root)),'unchanged':r['full_edited_text']==u['article']['text'],'patches':len(r['patches']),'whole_text_hold':r['whole_text_hold'],'errors':errors,'meaning_verified':False})
expected={(str(Path('edit')/arm/f.name)) for arm in ['visible','masked'] for f in (root/'inputs').glob('*.json')}
assert {x['output'] for x in rows}==expected and expected, 'Missing or extra saved output'
assert all(not x['errors'] for x in rows),rows
print(json.dumps(rows,ensure_ascii=False,indent=2))
