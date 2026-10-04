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
run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tools', '-p', 'test_*.py', '-v'])
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

# Source access / AI review follow-up: public saved records only, no source bundle required.
followup = ROOT / 'experiments' / 'source-evidence-ai-review'
run([sys.executable, 'tools/replay.py'], followup)
run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tools', '-p', 'test_*.py', '-v'], followup)
print('Source-evidence AI review public replay passed; new model calls: 0')
# v15 uses synthetic fixtures only; private article/model runs are not CI tests.
for relative in ('v15/code-audit/receipt', 'v15/code-audit/aggregation', 'v15/dependency', 'v15/blinding'):
    run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], ROOT / 'experiments' / relative)
print('v15 synthetic contract and regression checks passed; new model calls: 0')
run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], ROOT / 'experiments' / 'v16' / 'alignment')
print('v16 alignment contract checks passed; new model calls: 0')
run([sys.executable, 'synthetic/replay.py'], ROOT / 'experiments' / 'v16')
run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], ROOT / 'experiments' / 'v17' / 'code')
run([sys.executable, 'synthetic/replay.py'], ROOT / 'experiments' / 'v17')
run([sys.executable, 'annotation/replay.py'], ROOT / 'experiments' / 'v17')
print('v17 contract tests and saved synthetic/annotation replay passed; new model calls: 0')
run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], ROOT / 'experiments' / 'v18' / 'code')
print('v18 frozen delivery and separate atomic-coapplication checks passed; new model calls: 0')
run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], ROOT / 'experiments' / 'v19' / 'code-audit')
print('v19 realization identity and strict article input checks passed; new model calls: 0')
run([sys.executable, 'synthetic/replay.py'], ROOT / 'experiments' / 'v19')
for relative in ('v20/code-audit/sidecar', 'v20/code-audit/replay'):
    run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], ROOT / 'experiments' / relative)
run([sys.executable, 'code-audit/replay/verify_saved_v19.py'], ROOT / 'experiments' / 'v20')
print('v20 source-pinned sidecar and exact saved-output identity checks passed; new model calls: 0')

# v22 label/delivery guard and explicit semantic counterexamples
run([sys.executable, "-m", "unittest", "discover", "-s", "experiments/v22/code", "-p", "test_*.py"])
run([sys.executable, "experiments/v22/code/replay_challenge.py"])
print("v22 structural guard and constructed counterexample replay passed; no semantic truth certification")

run([sys.executable, "experiments/v22/code/replay_control.py"])

run([sys.executable, 'experiments/v23/replay.py'])
run([sys.executable, 'experiments/v23/binding-controls/replay.py'])
print('v23 saved synthetic delivery replay passed; semantic judgments remain separate')

for relative in ('v24/code', 'v24/code_v2'):
    run([sys.executable, '-m', 'unittest', 'discover', '-s', '.', '-p', 'test_*.py', '-v'], ROOT / 'experiments' / relative)
run([sys.executable, 'experiments/v24/replay.py'])
print('v24 original and repaired structural contracts, saved synthetic replay passed; semantic validity remains separately audited')

run([sys.executable, 'experiments/v25/replay.py'])
print('v25 public projections and audit aggregation replay passed; semantic validity remains separately audited')

run([sys.executable, 'experiments/v26/replay.py'])
print('v26 saved projection replay passed; prior structural tests do not certify meaning')

# v27/v28 structural regressions run on public synthetic fixtures, not private sources.
run([sys.executable, "-m", "unittest", "discover", "-s", "experiments/v27/code", "-p", "test_*.py", "-v"])
run([sys.executable, "experiments/v28/test_replay.py"])
print("v27/v28 partial application and replay regression checks passed; no semantic certification")
