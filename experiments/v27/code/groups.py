"""Exact offset delivery only: grouping and dependency truth remain semantic judgments."""
def apply_groups(original, groups, selected):
    ids=[g['id'] for g in groups]
    if any(not isinstance(i,str) or not i.strip() for i in ids) or len(set(ids))!=len(ids):raise ValueError('invalid group IDs')
    if len(set(selected))!=len(selected) or not set(selected)<=set(ids):raise ValueError('invalid selection')
    edits=[]
    for g in groups:
        if not g.get('edits'):raise ValueError('empty group')
        for e in g['edits']:
            a,b=e['start'],e['end']
            if type(a)!=int or type(b)!=int or not 0<=a<=b<=len(original):raise ValueError('invalid offset')
            if original[a:b]!=e['before'] or not isinstance(e['after'],str):raise ValueError('anchor mismatch')
            if e['before']==e['after']:raise ValueError('no-op edit')
            edits.append((a,b,e['after'],g['id']))
    ordered=sorted(edits,key=lambda e:(e[0],e[1]))
    for x,y in zip(ordered,ordered[1:]):
        if x[0]==y[0] or x[1]>y[0]:raise ValueError('overlap/ambiguous insertion boundary')
    text=original
    for a,b,after,gid in sorted(edits,reverse=True):
        if gid in selected:text=text[:a]+after+text[b:]
    return text

def validate_partition(original, proposed, groups):
    if apply_groups(original,groups,[g['id'] for g in groups])!=proposed:raise ValueError('not lossless full-proposal partition')
    return {'exact_partition':True,'semantic_validity':'not_certified'}
