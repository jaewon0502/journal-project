"""Offline checks for the explicitly curated public tree; not a secret-proof guarantee."""
from pathlib import Path
import re
import hashlib
import sys

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'environment_path': re.compile(r'/(?:work' + r'space|tmp|home/agent)/'),
    'private_library_identity': re.compile(r'libfile' + r'_[0-9a-f]+|file_' + r'0000[0-9a-f]+'),
    'private_resource': re.compile(r'(?:sediment|oai-library)://|chatgpt[.]com/space/'),
    'internal_orchestration': re.compile(r'codex_' + r'delegation|source_thread_' + r'id|<multi_agent_' + r'role>'),
    'credential': re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
}
FORBIDDEN_SUFFIXES = {'.pdf', '.docx', '.har', '.pem', '.key', '.p12', '.zip'}

def main():
    errors = []
    checked = 0
    for path in sorted(ROOT.rglob('*')):
        if not path.is_file() or any(p in {'.git', '__pycache__', '.pytest_cache', '.venv'} for p in path.relative_to(ROOT).parts):
            continue
        if path == ROOT / '.git':
            continue
        rel = path.relative_to(ROOT).as_posix()
        if path.suffix.lower() in FORBIDDEN_SUFFIXES or path.name.startswith('.env'):
            errors.append(f'{rel}: excluded public artifact type')
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except UnicodeError:
            errors.append(f'{rel}: unreviewed binary')
            continue
        checked += 1
        for label, pattern in PATTERNS.items():
            if pattern.search(text):
                errors.append(f'{rel}: {label}')
    for manifest in sorted((ROOT / 'experiments').rglob('SHA256SUMS')):
        for line in manifest.read_text().splitlines():
            expected, name = line.split('  ', 1)
            target = (manifest.parent / name).resolve()
            if not target.is_relative_to(ROOT) or not target.is_file():
                errors.append(f'{manifest.relative_to(ROOT)}: invalid manifest target')
            elif hashlib.sha256(target.read_bytes()).hexdigest() != expected:
                errors.append(f'{target.relative_to(ROOT)}: digest mismatch')
    for error in errors:
        print(error)
    print(f'Public content checks: {checked} text files; {len(errors)} findings')
    return bool(errors)

if __name__ == '__main__':
    sys.exit(main())
