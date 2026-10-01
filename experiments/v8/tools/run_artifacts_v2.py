#!/usr/bin/env python3
"""v2 adds immutable source metadata to both arms' anonymous candidate audits.
The original v1 module stays unchanged. No scoring or model call occurs here.
"""
import argparse,json
from pathlib import Path
import run_artifacts as v1
from pilot_harness import sha

def compile_writer(input_path,response_path,arm,out):
 meta=v1.compile_writer(input_path,response_path,arm,out)
 if meta['mechanical_valid']:
  common=v1.read(input_path);p=Path(out)/'audit-packet.json';packet=v1.read(p)
  packet['source_context']={k:common.get(k) for k in ['metadata','url','language','scope']}
  packet['source_context']['input_sha256']=sha(Path(input_path).read_bytes())
  packet['audit_envelope_version']='v2-source-context'
  p.write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n')
  meta['audit_packet_sha256']=sha(p.read_bytes());meta['plumbing_version']='v2-source-context'
  (Path(out)/'metadata.private.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
 return meta
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('command',choices=['compile-writer']);a.add_argument('--input',required=True);a.add_argument('--response',required=True);a.add_argument('--arm',required=True);a.add_argument('--out',required=True);x=a.parse_args();m=compile_writer(x.input,x.response,x.arm,x.out);print(json.dumps(m));raise SystemExit(0 if m['mechanical_valid'] else 2)
