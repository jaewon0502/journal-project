#!/usr/bin/env python3
"""DEV-only v2 candidate; not EVAL-authorized. Deterministic clause templates. Valid syntax NEVER implies source support.
Input: {type, slots, repair_needed, audit_decision, before}.
This component renders text only; trusted harness builds/guards its patch.
"""
import argparse
import json
from pathlib import Path

TEMPLATES = {
    'numeric_direction': 'The {quantity_kind} of {measure} for {entity} {direction} from {baseline_value}{unit} in {baseline_time} to {current_value}{unit} in {current_time}.',
    'causal_contribution': 'The {driver_direction} in {driver_entity} contributed to the {net_direction} in {net_measure}, while the {offset_direction} in {offset_entity} {offset_degree} offset it.',
    'temporal_status': 'As of {as_of}, {action} for {entity} has status {status}; the relevant effective time is {effective_time}.',
    'definition_scope': 'Within {scope}, {term} means {definition}; {exclusion} is excluded from this definition.',
    'eligibility_condition': '{benefit} applies to members of {population} satisfying {condition}; {exclusion} is excluded.',
    'protection_status': 'Protection against {discrimination_scope} for {population} is {protection_status} under {legal_context}.',
    'dataset_scope': '{dataset} reports {measure} for {included} within {population} during {time_window}; {excluded} is excluded from the count.'
}
# Every value below is a structural enum; it does not validate evidence.
ENUMS = {
    'quantity_kind': {'level','growth rate','decline rate','proportion','change'},
    'direction': {'increased','decreased','remained unchanged'},
    'net_direction': {'increase','decrease'},
    'driver_direction': {'increase','decrease'},
    'offset_direction': {'increase','decrease'},
    'offset_degree': {'partly','fully'},
    'status': {'planned','proposed','approved','in effect','completed','suspended','flash estimate','final reading'},
    'protection_status': {'retained','removed'}
}

def required_fields(kind):
    import string
    return list(dict.fromkeys(name for _,name,_,_ in string.Formatter().parse(TEMPLATES[kind]) if name))


def render(item):
    before = item['before']
    if not isinstance(before,str) or type(item['repair_needed']) is not bool:
        raise ValueError('before must be string; repair_needed must be boolean')
    if not item['repair_needed']:
        return {'text':before,'changed':False,'status':'no_op','semantic_validation':False}
    if item.get('audit_decision') != 'approved':
        return {'text':before,'changed':False,'status':'audit_not_approved','semantic_validation':False}
    kind,slots = item['type'],item['slots']
    if kind not in TEMPLATES or not isinstance(slots,dict):
        raise ValueError('unknown type or invalid slots')
    required = required_fields(kind)
    if set(slots) != set(required):
        raise ValueError('slots must exactly match declared type fields')
    for name,value in slots.items():
        if not isinstance(value,str) or not value.strip() or '\n' in value or '\r' in value:
            raise ValueError('slot must be nonempty single-line string: '+name)
        if name in ENUMS and value not in ENUMS[name]:
            raise ValueError('slot is outside declared structural enum: '+name)
    result = TEMPLATES[kind].format(**slots)
    return {'text':result,'changed':result != before,'status':'rendered','semantic_validation':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path)
    parser.add_argument('--schema',action='store_true')
    args=parser.parse_args()
    if args.schema:
        print(json.dumps({k:{'template':v,'required_slots':required_fields(k)} for k,v in TEMPLATES.items()},ensure_ascii=False,indent=2))
        return
    if not args.input:
        parser.error('--input or --schema required')
    print(json.dumps(render(json.loads(args.input.read_text(encoding='utf-8'))),ensure_ascii=False,indent=2))

if __name__=='__main__': main()
