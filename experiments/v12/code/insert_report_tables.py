from pathlib import Path
import json
B=Path('/historical-research/journal-v12'); data=json.loads((B/'results/independent-validation.json').read_text())
lines=['| 구분·사례 | 절차 | 발견/언급 | 최종 본문 누락 회복 | 기존 본문 필수 항목 | 수정 본문 필수 항목 |','|---|---|---|---|---|---|']
for r in data['real_scores']:
 phase='최초 개발' if r['version']=='v1' else ('개발 회귀' if 'DEV' in r['case_id'] else '신규 평가')
 method=r['condition']+('-v2' if r['condition']=='B' and r['version']=='v2' else ('-v1' if r['condition']=='B' else ''))
 def pair(field,den):return ' · '.join(f"{j[field]}/{j[den]}" for j in r['judges'])
 lines.append('| '+phase+' '+r['case_id']+' | '+method+' | '+pair('omission_identified','omission_denom')+' | '+pair('omission_candidate_covered_semantic_match','omission_denom')+' | '+pair('original_covered','required_denom')+' | '+pair('candidate_covered_semantic_match','required_denom')+' |')
p=B/'REPORT.md';s=p.read_text();s=s.replace('<!-- SCORE_TABLES -->','\n'.join(lines));p.write_text(s)
