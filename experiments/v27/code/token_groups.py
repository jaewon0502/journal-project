"""Deterministic token difference groups; not semantic units."""
import difflib,re

def token_groups(original, proposed):
    def tokenize(text):
        spans=list(re.finditer(r'\w+|\s+|[^\w\s]',text,re.UNICODE))
        return [m.group() for m in spans],[m.start() for m in spans]+[len(text)]
    a,apos=tokenize(original);b,bpos=tokenize(proposed);groups=[]
    for tag,i,j,k,l in difflib.SequenceMatcher(a=a,b=b,autojunk=False).get_opcodes():
        if tag!='equal':
            groups.append({'id':'G'+str(len(groups)+1),'edits':[{'start':apos[i],'end':apos[j],'before':original[apos[i]:apos[j]],'after':proposed[bpos[k]:bpos[l]]}]})
    return groups
