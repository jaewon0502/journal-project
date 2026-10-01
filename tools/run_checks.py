"""Run offline public-content checks and each isolated stdlib test directory."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def run(args, cwd=ROOT):
    result = subprocess.run(args, cwd=cwd, check=False)
    if result.returncode:
        raise SystemExit(result.returncode)

run([sys.executable, str(ROOT / 'tools' / 'validate_release.py')])
directories = sorted({p.parent for p in (ROOT / 'experiments').rglob('test_*.py')})
if not directories:
    raise SystemExit('No test suites found')
for directory in directories:
    print(f'Checking {directory.relative_to(ROOT)}', flush=True)
    run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], directory)
run([sys.executable, 'verify_archive.py'], ROOT / 'experiments' / 'legacy')
run([sys.executable, 'tools/reaggregate.py'], ROOT / 'experiments' / 'v7')
print(f'Passed {len(directories)} isolated test directories and archive/result verification')
