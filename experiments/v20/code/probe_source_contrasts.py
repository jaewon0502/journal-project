"""Deterministic candidate extraction, not a truth or necessity classifier."""
import argparse,hashlib,json,re
from pathlib import Path
PATTERN=re.compile(r'\brather\s+than\b|\binstead\s+of\b|\bunlike\b',re.I)
def extract(unit):
 rows=[]
 for source in unit['sources']:
  text=source['text']
  for match in PATTERN.finditer(text):
   begin=max(0,match.start()-120);end=min(len(text),match.end()+220)
   rows.append({'document_id':source['id'],'marker':match.group(),'marker_start':match.start(),'start':begin,'end':end,'quote':text[begin:end],'source_sha256':hashlib.sha256(text.encode()).hexdigest(),'meaning':'unclassified candidate; may be irrelevant'})
 return rows
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);a=p.parse_args();u=json.loads(a.input.read_text());rows=extract(u);a.output.write_text(json.dumps({'unit_id':u['unit_id'],'input_sha256':hashlib.sha256(a.input.read_bytes()).hexdigest(),'pattern':PATTERN.pattern,'candidates':rows,'limits':'English explicit contrast markers only; no semantic identification, recall, necessity or cross-language guarantee'},ensure_ascii=False,indent=2));print(u['unit_id'],len(rows),'unclassified candidates')
