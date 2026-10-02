import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def obj(props,required=None):
 return {'type':'object','properties':props,'required':required or list(props),'additionalProperties':False}
string={'type':'string','minLength':1}
tri={'enum':['yes','no','unknown']}
anchor=obj({'document_id':string,'quote':string})
anchors={'type':'array','items':anchor,'minItems':1}
patch=obj({'patch_id':string,**{k:tri for k in ['warranted','evidence_support','preserves_untargeted_meaning','context_safe','application_valid']},'dependencies':{'type':'array','items':string,'uniqueItems':True},'dependency_status':{'enum':['complete','unknown']},'anchors':anchors,'reason':string,'confidence':{'enum':['low','medium','high']}})
issue=obj({'id':string,'status':{'enum':['resolved','unresolved']},'material':tri,'affects_patch_ids':{'type':'array','items':string,'uniqueItems':True},'unrelated_to_edits':tri,'anchors':anchors,'reason':string})
schema=obj({'bundle_id':string,**{k:{'type':'string','pattern':'^[a-f0-9]{64}$'} for k in ['input_sha256','source_sha256','original_sha256','patches_sha256']},'complete':{'const':True},'read_complete':{'const':True},'patch_assessments':{'type':'array','items':patch},'background_issues':{'type':'array','items':issue},'global_material_risk':tri,'global_risk_reason':string,'global_risk_anchors':{'type':'array','items':anchor},'preference_differences':{'type':'array','items':obj({'description':string,'reason_preference_only':string})},'overall_reason':string})
schema['allOf']=[{'if':{'properties':{'global_material_risk':{'enum':['yes','unknown']}}},'then':{'properties':{'global_risk_anchors':{'minItems':1}}}}]
schema['$schema']='https://json-schema.org/draft/2020-12/schema'
(ROOT/'protocol/REVIEW_SCHEMA.json').write_text(json.dumps(schema,indent=2)+'\n')
