"""Validate input provenance and exact local patch replay, not semantic accuracy."""
import argparse
import hashlib
import json
from pathlib import Path


def require(condition, message):
    # Assertions are inappropriate here: python -O must retain every check.
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text())


def sha256_text(value):
    return hashlib.sha256(value.encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('private_dir', type=Path)
    parser.add_argument('v27_raw_dir', type=Path)
    parser.add_argument('--v27-input-dir', type=Path,
                        help='Defaults to the inputs directory beside v27_raw_dir.')
    args = parser.parse_args()
    p = args.private_dir
    input_dir = args.v27_input_dir or args.v27_raw_dir.parent / 'inputs'
    mapping = read_json(p / 'private-map.json')
    freeze = read_json(p / 'clean-freeze.json')
    clean_files = sorted((p / 'clean').glob('*.json'))
    require(len(clean_files) == 15, 'Expected exactly 15 clean inputs')
    require({f.name for f in clean_files} == set(freeze),
            'Clean input set differs from freeze')
    require(len(mapping) == 15 and len(set(mapping.values())) == 15,
            'Expected 15 distinct mapped v27 outputs')
    clean = {}
    for f in clean_files:
        require(hashlib.sha256(f.read_bytes()).hexdigest() == freeze[f.name],
                f'{f.name}: frozen input hash mismatch')
        d = read_json(f)
        require(set(d) == {'blind_id', 'article', 'sources', 'final_text'},
                f'{f.name}: unexpected clean input keys')
        blind_id = d['blind_id']
        require(blind_id == f.stem and blind_id in mapping and blind_id not in clean,
                f'{f.name}: invalid or duplicate blind ID')
        output_id = mapping[blind_id]
        old = read_json(args.v27_raw_dir / (output_id + '.json'))
        original_input = read_json(input_dir / (output_id + '.json'))
        require(d['final_text'] == old['full_selected_text'],
                f'{f.name}: v27 final text mismatch')
        for field in ('article', 'sources'):
            require(d[field] == original_input[field],
                    f'{f.name}: v27 {field} mismatch')
        clean[blind_id] = d
    require(set(clean) == set(mapping), 'Blind ID coverage differs from map')

    patch = read_json(p / 'local-patch.json')
    public_patch = read_json(Path(__file__).resolve().parent / 'local-patch.json')
    require(patch == public_patch, 'Public/private local patch mismatch')
    source_id = patch['source_final']
    require(source_id in clean, 'Patch source_final is not a clean input')
    source = clean[source_id]
    local = read_json(p / 'local-clean.json')
    require(set(local) == {'blind_id', 'article', 'sources', 'final_text'},
            'Unexpected local input keys')
    for field in ('article', 'sources'):
        require(local[field] == source[field], f'Local {field} changed')
    s, t = source['final_text'], local['final_text']
    start, end = patch['start'], patch['end']
    require(type(start) is int and type(end) is int and 0 <= start <= end <= len(s),
            'Invalid local patch coordinates')
    require(s[start:end] == patch['before'], 'Local patch before-text mismatch')
    require(s[:start] + patch['after'] + s[end:] == t,
            'Local patch reconstruction mismatch')
    require(sha256_text(s) == patch['input_sha256'], 'Local patch input hash mismatch')
    require(sha256_text(t) == patch['output_sha256'], 'Local patch output hash mismatch')
    print('15 frozen clean inputs with v27 article/source provenance; '
          '1 exact local patch replay passed. No semantic certification.')


if __name__ == '__main__':
    main()
