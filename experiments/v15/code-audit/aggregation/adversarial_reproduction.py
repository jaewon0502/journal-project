import sys,json,hashlib,unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import score_T_checked as checked
from test_aggregation import AggregationRegression
out=[]
for val in [None, True, 1, 1.0, '', [], {}]:
    fixture=AggregationRegression();fixture.setUp()
    try:
        fixture.write(fixture.private/'T-blind-inputs/eval/input.json',{'cases':[{'opaque_output_id':val,'original':'draft','revised':'draft'}]})
        fixture.write(fixture.private/'T-blind-inputs/eval/private-mapping.json',{'mapping':{}})
        fixture.judgments=[{'opaque_output_id':val}]
        try:
            result=fixture.run_score();status='ACCEPT';count=result['unique_judged_outputs']
        except Exception as e:status=type(e).__name__;count=None
        out.append({'value':val,'status':status,'judged':count,'output_written':fixture.output.exists()})
    finally:fixture.doCleanups()
print(json.dumps(out,indent=2))
