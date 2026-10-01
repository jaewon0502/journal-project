"""Verify the metadata correction applies symmetrically to both editing arms."""
import json
from pathlib import Path
import tempfile
import unittest
from run_artifacts import paragraphs, sha
from run_artifacts_v2 import compile_writer


class EnvelopeV2(unittest.TestCase):
    def test_source_context_for_both_arms(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = 'Fixture statement.\n'
            common = dict(article_id='fixture', source=source, source_sha256=sha(source.encode()),
                          paragraphs=paragraphs(source), evidence={'records': []},
                          metadata={'published_at':'2026-01-01'}, url='https://example.com/fixture',
                          language='EN', scope='synthetic fixture')
            input_path=root/'input.json'
            input_path.write_text(json.dumps(common))
            contexts=[]
            for arm in ('LOCAL','FULLREWRITE'):
                response=dict(article_id='fixture',source_sha256=common['source_sha256'],
                              input_sha256=sha(input_path.read_bytes()),read_complete=True,status='complete')
                response.update({'patches':[]} if arm=='LOCAL' else {'output':source})
                response_path=root/(arm+'.json')
                response_path.write_text(json.dumps(response))
                output=root/arm
                meta=compile_writer(input_path,response_path,arm,output)
                self.assertTrue(meta['mechanical_valid'])
                packet=json.loads((output/'audit-packet.json').read_text())
                self.assertEqual(packet['audit_envelope_version'],'v2-source-context')
                self.assertEqual(meta['audit_packet_sha256'],sha((output/'audit-packet.json').read_bytes()))
                self.assertEqual(packet['source_context']['metadata'],common['metadata'])
                contexts.append(packet['source_context'])
            self.assertEqual(contexts[0],contexts[1])


if __name__ == '__main__': unittest.main()
