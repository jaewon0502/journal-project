"""Validate stored native output and apply exact patches. Not a semantic evaluator."""
import json
from pathlib import Path

def schema_check(value, spec, where='$'):
    if 'anyOf' in spec:
        for choice in spec['anyOf']:
            try:
                schema_check(value, choice, where)
                return
            except ValueError:
                pass
        raise ValueError(f'{where}: no permitted schema branch')
    kind=spec.get('type')
    types={'object':dict,'array':list,'string':str,'null':type(None)}
    if kind in types and type(value) is not types[kind]:
        raise ValueError(f'{where}: expected {kind}')
    if 'enum' in spec and value not in spec['enum']:
        raise ValueError(f'{where}: invalid enum')
    if kind=='object':
        required=set(spec.get('required',[])); props=spec.get('properties',{})
        if required-set(value):raise ValueError(f'{where}: missing keys')
        if spec.get('additionalProperties') is False and set(value)-set(props):raise ValueError(f'{where}: extra keys')
        for key,item in value.items():
            if key in props:schema_check(item,props[key],where+'.'+key)
    if kind=='array':
        for i,item in enumerate(value):schema_check(item,spec['items'],f'{where}[{i}]')

def unique(rows):
    result={}
    for row in rows:
        key=row['id']
        if not key.strip() or key in result:raise ValueError('blank or duplicate id')
        result[key]=row
    return result

def apply_checked(unit, output, schema):
    schema_check(output,schema)
    if output['unit_id']!=unit['unit_id']:raise ValueError('unit mismatch')
    findings=unique(output['findings']); patches=unique(output['patches'])
    sources={s['id']:s['text'] for s in unit['sources']}
    if len(sources)!=len(unit['sources']):raise ValueError('duplicate source id')
    for f in findings.values():
        if f['required_answer_missing']==f['answer_present_but_incorrect']=='yes':raise ValueError('missing and wrong answer conflated')
        if f['optional_clarification']=='yes' and (f['necessity']=='yes' or f['conclusion_changing_omission']=='yes'):raise ValueError('optional and required conflated')
        for field,text in [('original_quote',unit['original_text']),('candidate_quote',unit['candidate_text'])]:
            if f[field] and f[field] not in text:raise ValueError('inexact article quote')
        if any(ref not in sources for ref in f['source_refs']):raise ValueError('unknown source reference')
        for relation in f['evidence_relations']:
            for clause in [relation['supporting_clause'],relation['linked_clause']]:
                if clause is not None:
                    if clause['document_id'] not in sources or not clause['quote'] or clause['quote'] not in sources[clause['document_id']]:raise ValueError('inexact source witness')
    spans=[]; text=unit['candidate_text']
    if {f['id'] for f in findings.values() if f['local_action']=='patch'} != {p['finding_id'] for p in patches.values()}:
        raise ValueError('patch finding has no delivered patch or vice versa')
    for patch in patches.values():
        if patch['finding_id'] not in findings:raise ValueError('unknown finding')
        f=findings[patch['finding_id']]
        if f['local_action']!='patch' or any(f[k]!='yes' for k in ('necessity','evidence_support','preserves_other_meaning','context_safe')):raise ValueError('unapproved patch')
        if not patch['before'] or text.count(patch['before'])!=1:raise ValueError('nonunique patch anchor')
        if patch['before']==patch['after']:raise ValueError('empty edit reported as repair')
        start=text.index(patch['before']);end=start+len(patch['before'])
        if any(start<b and a<end for a,b,_ in spans):raise ValueError('overlapping patch anchors')
        spans.append((start,end,patch['after']))
        if any(x not in patches for x in patch['depends_on']):raise ValueError('missing dependency')
    visiting=set();done=set()
    def visit(key):
        if key in visiting:raise ValueError('cyclic patch dependency')
        if key in done:return
        visiting.add(key)
        for dep in patches[key]['depends_on']:visit(dep)
        visiting.remove(key);done.add(key)
    for key in patches:visit(key)
    held=bool(output['local_hold_reasons']) or any(f['local_action']=='hold' for f in findings.values())
    expected='repair' if patches else ('hold' if held else 'no_change')
    if output['preservation_decision']!=expected:raise ValueError('decision/action mismatch')
    if patches and output['selected_candidate_delta_safety']!='safe':raise ValueError('uncertain or unsafe selected edits')
    for h in output['local_hold_reasons']:
        if h['related_finding'] not in findings:raise ValueError('unlinked hold')
    for start,end,after in sorted(spans,reverse=True):text=text[:start]+after+text[end:]
    return text
