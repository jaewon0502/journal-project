def args_for(c):
    s = c['source'].encode()
    patches = [{'id': p['id'], 'before': p['before'], 'after': p['after'], 'start': p['start_byte'], 'end': p['end_byte']} for p in c['proposed_patches']]
    proposal = raw({'writer_id': 'authored-confirmation-writer', 'preimage_sha256': R.digest(s), 'patches': patches})
    ids = [p['id'] for p in patches]
    binding = {'source_sha256': R.digest(s), 'proposal_sha256': R.digest(proposal), 'complete': True, 'read_complete': True}
    comp = {p: i for i, a in enumerate(c['dependency_components']) for p in a}
    dep = raw({**binding, 'auditor_id': 'authored-confirmation-dependency', 'patch_ids': ids, 'pairs': [{'ids': list(pair), 'relation': 'dependent' if comp[pair[0]] == comp[pair[1]] else 'independent', 'reason': 'Stipulated dependency fixture, not inferred world truth.'} for pair in itertools.combinations(ids, 2)]})
    findings = [{'id': 'I1', 'description': 'The fixture includes an inherited unresolved meaning issue; application status does not resolve it.', 'source_anchor': 'authored scope', 'evidence_ids': [x['id'] for x in c['evidence']]}] if c['semantic_facts']['meaning_resolution'] == 'unresolved' else []
    audit = raw({**binding, 'auditor_id': 'authored-confirmation-patch', 'patch_decisions': [{'id': p, 'decision': c['review_decisions'][p], 'reason': 'Independently authored operational decision, not a world-truth judgment.', 'evidence_ids': []} for p in ids], 'preexisting_findings': findings})
    initial = R.engine.propose_selection(s, proposal, dep, audit)
    uncertain = any((x == 'unknown' for x in c['review_decisions'].values()))
    final = raw({**binding, 'auditor_id': 'authored-confirmation-final', 'candidate_sha256': initial.candidate_sha256, 'selected_ids': list(initial.selected_ids), 'whole_candidate_reviewed': True, 'decision': 'unknown' if uncertain else 'approved', 'findings': []})
    finals = (final,)
    output, note = R.v10.build_delivery(s, proposal, dep, audit, finals)
    assert output == c['actual_output'].encode(), c['case_id']
    assert note['applied_ids'] == c['actual_applied_receipt']['applied_ids']
    assert R.digest(output) == c['actual_applied_receipt']['output_sha256']
    return (output, initial.candidate, note, s, proposal, dep, audit, finals)
