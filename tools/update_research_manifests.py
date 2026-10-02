"""Refresh current public-derivative checksums, never original study hashes or judgments."""
from pathlib import Path
import hashlib
import json
ROOT = Path(__file__).resolve().parents[1]
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def files(root):
    return sorted(p for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
for version in range(10, 14):
    root = ROOT / 'experiments' / f'v{version}'
    provenance = root / 'PUBLIC-DERIVATION.json'
    record = json.loads(provenance.read_text())
    for row in record['files']:
        path = root / row['path']
        row['current_public_sha256'] = digest(path) if path.is_file() else None
    provenance.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    rows = [f'{digest(p)}  {p.relative_to(root).as_posix()}' for p in files(root)
            if p.name not in {'SHA256SUMS', 'PACKAGE-MANIFEST.json'}]
    (root / 'SHA256SUMS').write_text('\n'.join(rows) + '\n')
    if version >= 12:
        entries = [{'path': p.relative_to(root).as_posix(), 'sha256': digest(p), 'bytes': p.stat().st_size}
                   for p in files(root) if p.name != 'PACKAGE-MANIFEST.json']
        (root / 'PACKAGE-MANIFEST.json').write_text(json.dumps({'scope': 'Current Git public derivative; original study locks remain historical.', 'files': entries}, indent=2) + '\n')
