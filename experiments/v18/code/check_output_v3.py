"""Separate v3 contract: depends_on means necessary atomic co-application.

Dependency edges do not order text transformations. The frozen validator still
checks every substantive gate and exact native delivery using original offsets.
This version does not establish the factual correctness of any proposed edit.
"""
from copy import deepcopy
import importlib.util
from pathlib import Path

_path = Path(__file__).with_name('check_output.py')
_spec = importlib.util.spec_from_file_location('v18_frozen_atomic_adapter', _path)
_frozen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_frozen)


def apply_checked(unit, output, schema):
    # Validate the unmodified declaration before making the compatibility copy.
    _frozen.v17.schema_check(output, schema)
    patches = _frozen.v17.unique(output['patches'])
    for key, patch in patches.items():
        dependencies = patch['depends_on']
        if len(dependencies) != len(set(dependencies)):
            raise ValueError('duplicate patch dependency')
        if key in dependencies:
            raise ValueError('self patch dependency')
        if any(dependency not in patches for dependency in dependencies):
            raise ValueError('missing dependency')
    # All declared patches are mandatory. Cycles between distinct IDs express
    # co-application; removing edges only in this private copy bypasses the old
    # DAG check after original dependencies have been checked for closure.
    compatible = deepcopy(output)
    for patch in compatible['patches']:
        patch['depends_on'] = []
    return _frozen.apply_checked(unit, compatible, schema)
