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
directories = sorted({p.parent for name in ('legacy', 'v6', 'v7', 'v8', 'v9') for p in (ROOT / 'experiments' / name).rglob('test_*.py')})
if not directories:
    raise SystemExit('No test suites found')
for directory in directories:
    print(f'Checking {directory.relative_to(ROOT)}', flush=True)
    run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], directory)
run([sys.executable, 'verify_archive.py'], ROOT / 'experiments' / 'legacy')
run([sys.executable, 'tools/reaggregate.py'], ROOT / 'experiments' / 'v7')
print(f'Passed {len(directories)} isolated test directories and archive/result verification')

# Public derivatives: replay saved records; do not launch models or rerun archived faulty versions.
for version in ('v10', 'v11'):
    run([sys.executable, 'run_checks.py'], ROOT / 'experiments' / version)
run([sys.executable, 'portable/replay.py', '--version', 'v1_3'], ROOT / 'experiments' / 'v11')
for relative in ('v12/code', 'v13/v13/code'):
    run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], ROOT / 'experiments' / relative)
run([sys.executable, 'code/verify_public_package.py', '.'], ROOT / 'experiments' / 'v12')
run([sys.executable, 'v13/code/verify_public_package.py', '.', '--full-gate'], ROOT / 'experiments' / 'v13')
print('v10-v13 saved-output and public derivative checks passed; new model calls: 0')
