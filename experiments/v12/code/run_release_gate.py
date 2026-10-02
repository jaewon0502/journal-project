"""Replay existing artifacts only; never call models or alter core scores."""
from collections import Counter
from hashlib import sha256
from pathlib import Path
import json
from release_gate import release_gate, digest, LIMIT

P = Path('/historical-research/journal-v12-private')
B = Path('/historical-research/journal-v12')

def rawhash(path):
    return sha256(path.read_bytes()).hexdigest()

def main():
    private_rows, public_rows = [], []
    review_count = 0
    for version in ('v1', 'v2'):
        for mapping in sorted(P.glob(f'review-map-{version}-*.json')):
            for row in json.loads(mapping.read_text()):
                pid = row['packet_id']
                packet_path = P / f'reviewer-inputs-{version}' / f'{pid}.json'
                writer_path = P / f'writer-results-{version}' / f'{row["input_id"]}.json'
                packet = json.loads(packet_path.read_text())
                writer = json.loads(writer_path.read_text())
                reviews, provenance = [], []
                for judge in ('A', 'B'):
                    path = P / f'reviewer-results-{version}' / f'{judge}__{pid}.json'
                    if path.exists():
                        reviews.append(json.loads(path.read_text()))
                        provenance.append({'judge': judge, 'path': str(path), 'sha256': rawhash(path)})
                        review_count += 1
                    else:
                        reviews.append(None)
                result = release_gate(packet['original_text'], writer['patches'], reviews,
                    packet_id=pid, expected_source_sha256=row['article_text_sha256'],
                    expected_candidate_sha256=row['candidate_sha256'])
                issues = []
                if rawhash(packet_path) != row['review_input_sha256']:
                    issues.append('review_input_hash_mismatch')
                if rawhash(writer_path) != row['writer_raw_sha256']:
                    issues.append('writer_raw_hash_mismatch')
                if packet.get('packet_id') != pid or packet.get('writer_output') != writer:
                    issues.append('review_packet_binding_mismatch')
                if digest(packet['displayed_candidate']) != row['candidate_sha256']:
                    issues.append('displayed_candidate_hash_mismatch')
                if packet.get('application_status') not in ('applied', 'no-op'):
                    issues.append('saved_application_failed')
                if issues:
                    result.update(status='hold', delivered_text=packet['original_text'],
                                  delivered_sha256=digest(packet['original_text']),
                                  reasons=sorted(set(result['reasons'] + issues)))
                identity = {k: row[k] for k in ('case_id', 'condition', 'split')}
                identity.update(version=version, packet_id=pid)
                private_rows.append({**identity, **result, 'review_provenance': provenance,
                                     'expected_source_sha256': row['article_text_sha256'],
                                     'expected_candidate_sha256': row['candidate_sha256']})
                public_rows.append({**identity, 'status': result['status'], 'reasons': result['reasons'],
                                    'patch_count': len(writer['patches']),
                                    'original_retained': result['delivered_sha256'] == result['source_sha256']})
    counts = dict(Counter(r['status'] for r in public_rows))
    private_path = P / 'release-gate-results.json'
    private_path.write_text(json.dumps({'rows': private_rows}, ensure_ascii=False, indent=2) + '\n')
    private_path.chmod(0o600)
    report = {'scope': 'Post-experiment deterministic delivery replay; not model outputs or independent experiments.',
              'limitation': LIMIT, 'core_scores_unchanged': True,
              'output_count': len(public_rows), 'actual_review_count': review_count,
              'counts': counts, 'rows': public_rows}
    (B / 'results/release-gate-results.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('output_count', 'actual_review_count', 'counts')}))

if __name__ == '__main__':
    main()
