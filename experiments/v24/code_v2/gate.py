"""Structural permissions only: certificate semantics are not proven."""
import ast
import hashlib
import re
from fractions import Fraction

AXES = ('referent', 'property', 'population', 'conditions', 'time')
UNITS = {'count': ('count', 1), 'percent': ('ratio', Fraction(1,100)), 'ratio': ('ratio', 1), 'm': ('length',1), 'cm': ('length',Fraction(1,100)), 'km': ('length',1000), 'm2': ('area',1), 'cm2': ('area',Fraction(1,10000)), 'km2': ('area',1000000), 'g': ('mass',1), 'kg': ('mass',1000), 'tonne': ('mass',1000000), 'l': ('volume',1), 'ml': ('volume',Fraction(1,1000)), 'currency': ('currency',1)}
LIMITS = 'Exact anchors, rational quantities and dimensional arithmetic only; AI semantic binding may be false. Necessary not sufficient. Gate artifacts must be trusted, not model supplied.'
NUMBER = re.compile(r'(?<![\w.,])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\d,])')

def require(ok, message):
    if not ok:
        raise ValueError(message)

def fraction(value):
    require(isinstance(value, (str, int, float)) and not isinstance(value, bool), 'invalid scalar')
    return Fraction(str(value))

def scalar(q):
    require(isinstance(q, dict) and q.get('unit') in UNITS, 'quantity/unit absent')
    dimension, factor = UNITS[q['unit']]
    return dimension, fraction(q['value']) * factor

def dimension(name):
    return {} if name == 'ratio' else {'length': 2} if name == 'area' else {name: 1}

def arithmetic(expr, operands):
    require(isinstance(expr, str) and isinstance(operands, list) and operands, 'arithmetic absent')
    values = {}
    for operand in operands:
        require(isinstance(operand, dict), 'invalid operand')
        name = operand.get('name')
        require(isinstance(name, str) and name.isidentifier() and name not in values, 'invalid/duplicate operand')
        d, v = scalar(operand)
        values[name] = (dimension(d), v)
    def walk(node):
        if isinstance(node, ast.Name) and node.id in values:
            return values[node.id]
        require(isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)), 'arithmetic requires anchored names, no constants/calls')
        da, a = walk(node.left)
        db, b = walk(node.right)
        if isinstance(node.op, (ast.Add, ast.Sub)):
            require(da == db, 'addition/subtraction dimension mismatch')
            return da, a + b if isinstance(node.op, ast.Add) else a - b
        sign = 1 if isinstance(node.op, ast.Mult) else -1
        out = dict(da)
        for key, power in db.items():
            out[key] = out.get(key, 0) + sign * power
        return {k: v for k, v in out.items() if v}, a * b if sign == 1 else a / b
    return walk(ast.parse(expr, mode='eval').body)

def binding(unit):
    require(isinstance(unit, dict) and isinstance(unit.get('unit_id'), str) and unit['unit_id'], 'invalid unit')
    require(isinstance(unit.get('article'), dict) and isinstance(unit['article'].get('text'), str), 'invalid article')
    return unit['unit_id'], hashlib.sha256(unit['article']['text'].encode('utf-8')).hexdigest()

def check(unit, c, sources):
    result = {'id': c.get('id') if isinstance(c, dict) else None, 'gate_result': 'blocked', 'reasons': [], 'semantic_identity_verified': False}
    try:
        require(isinstance(c, dict), 'invalid comparison')
        text = unit['article']['text']
        quote = c.get('article_quote')
        require(isinstance(quote, str) and quote and text.count(quote) == 1, 'article anchor absent/nonunique')
        def witness(w):
            return isinstance(w, dict) and isinstance(w.get('source_id'), str) and w['source_id'] in sources and isinstance(w.get('quote'), str) and bool(w['quote']) and w['quote'] in sources[w['source_id']]
        def witnesses(ws):
            return isinstance(ws, list) and bool(ws) and all(witness(w) for w in ws)
        require(witnesses(c.get('evidence')), 'evidence anchor absent')
        require(isinstance(c.get('axes'), dict), 'invalid axes')
        for axis in AXES:
            x = c['axes'].get(axis)
            require(isinstance(x, dict) and x.get('relation') == 'same', axis + ': identity not certified')
            require(isinstance(x.get('article_anchor'), str) and x['article_anchor'] and x['article_anchor'] in text, axis + ': article anchor absent')
            require(witnesses(x.get('source_anchors')), axis + ': source anchor absent')
        ad, av = scalar(c['article_quantity'])
        ed, ev = scalar(c['evidence_quantity'])
        require(ad == ed, 'incompatible units')
        calc = c.get('arithmetic')
        if calc is not None:
            require(isinstance(calc, dict) and witnesses(calc.get('operands')), 'arithmetic anchor absent')
            require(arithmetic(calc['expression'], calc['operands']) == (dimension(ed), ev), 'typed arithmetic result mismatch')
        start = text.index(quote)
        raw = fraction(c['article_quantity']['value'])
        matches = [m for m in NUMBER.finditer(text) if start <= m.start() and m.end() <= start + len(quote) and Fraction(m.group().replace(',', '')) == raw]
        require(len(matches) == 1, 'article numeric token absent/ambiguous; review_required')
        token = matches[0]
        result.update(gate_result='eligible_mismatch' if av != ev else 'normalized_equal', article_quote=quote, article_span=[start, start + len(quote)], numeric_span=[token.start(), token.end()], original_numeric_token=token.group(), article_unit=c['article_quantity']['unit'], article_value=str(raw), expected_value=str(ev / UNITS[c['article_quantity']['unit']][1]), normalized_expected_value=str(ev), dimension=ed)
    except Exception as exc:
        result['reasons'] = ['invalid comparison: ' + str(exc)]
    return result

def run(unit, certificate):
    out = {'unit_id': unit.get('unit_id') if isinstance(unit, dict) else None, 'article_sha256': None, 'results': [], 'status': 'blocked', 'reasons': [], 'limits': LIMITS}
    try:
        out['unit_id'], out['article_sha256'] = binding(unit)
        require(isinstance(unit.get('sources'), list), 'invalid sources')
        sources = {}
        for source in unit['sources']:
            require(isinstance(source, dict) and isinstance(source.get('id'), str) and source['id'] and source['id'] not in sources and isinstance(source.get('text'), str), 'invalid/duplicate source')
            sources[source['id']] = source['text']
        require(isinstance(certificate, dict) and isinstance(certificate.get('comparisons'), list), 'invalid comparisons')
        ids = []
        for c in certificate['comparisons']:
            require(isinstance(c, dict) and isinstance(c.get('id'), str) and c['id'] and c['id'] not in ids, 'invalid/duplicate comparison identifiers')
            ids.append(c['id'])
        out['results'] = [check(unit, c, sources) for c in certificate['comparisons']]
        out['status'] = 'checked'
    except Exception as exc:
        out['reasons'] = ['invalid input: ' + str(exc)]
    return out

if __name__ == '__main__':
    import json, sys
    print(json.dumps(run(json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))), ensure_ascii=False, indent=2))
