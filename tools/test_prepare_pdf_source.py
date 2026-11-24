from hashlib import sha256
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_pdf_source import prepare

COMMAND = Path(__file__).with_name('prepare_pdf_source.py')


def make_pdf(page_text):
    """Build a real PDF with page objects, content streams and a cross-reference table."""
    kids = ' '.join(f'{4 + index * 2} 0 R' for index in range(len(page_text)))
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               f'<< /Type /Pages /Kids [{kids}] /Count {len(page_text)} >>'.encode(),
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    for index, text in enumerate(page_text):
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] '
                       f'/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + index * 2} 0 R >>'.encode())
        content = f'BT /F1 12 Tf 40 720 Td ({text}) Tj ET'.encode() if text else b'0 0 60 60 re f'
        objects.append(f'<< /Length {len(content)} >>\nstream\n'.encode() + content + b'\nendstream')
    data = bytearray(b'%PDF-1.4\n')
    offsets = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(data))
        data.extend(f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n')
    xref = len(data)
    data.extend(f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode())
    for offset in offsets:
        data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return bytes(data)


class PreparePdfSource(unittest.TestCase):
    @unittest.skipUnless(shutil.which('pdftotext'), 'Poppler pdftotext required for PDF integration')
    def test_cli_page_text_hash_and_no_clobber(self):
        with TemporaryDirectory() as folder:
            pdf = Path(folder, '원본 자료.pdf')
            data = make_pdf(['First page', None, 'Third page', None])
            pdf.write_bytes(data)
            result = subprocess.run([sys.executable, COMMAND, pdf], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = pdf.with_suffix('.journal-source.json')
            self.assertEqual(json.loads(output.read_bytes()), {
                'format': 'journal-pdf-text-v1', 'pdfName': pdf.name, 'pdfSha256': sha256(data).hexdigest(),
                'pages': ['First page\n', '', 'Third page\n', '']})
            existing = Path(folder, 'existing.json')
            existing.write_bytes(b'keep me')
            result = subprocess.run([sys.executable, COMMAND, pdf, '--output', existing], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(existing.read_bytes(), b'keep me')
            self.assertEqual(set(pdf.parent.iterdir()), {pdf, output, existing})

    @unittest.skipUnless(shutil.which('pdftotext'), 'Poppler pdftotext required for PDF integration')
    def test_no_text_and_malformed_inputs_never_publish(self):
        for data in [make_pdf([None, None]), b'', b'not PDF', b'%PDF-1.4\nbroken\n%%EOF\n',
                     make_pdf(['Recoverable text']).split(b'%%EOF')[0]]:
            with self.subTest(length=len(data)), TemporaryDirectory() as folder:
                pdf = Path(folder, 'source.pdf')
                pdf.write_bytes(data)
                output = Path(folder, 'requested.json')
                result = subprocess.run([sys.executable, COMMAND, pdf, '-o', output], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(output.exists())
                self.assertEqual(list(pdf.parent.iterdir()), [pdf])

    def test_extracted_text_and_hash_share_one_snapshot(self):
        data = make_pdf(['Original file'])
        with TemporaryDirectory() as folder:
            pdf = Path(folder, 'source.pdf')
            pdf.write_bytes(data)
            output = Path(folder, 'explicit destination.json')

            def change_during_extraction(command, *, input, **kwargs):
                self.assertEqual(command, ['pdftotext', '-layout', '-enc', 'UTF-8', '-eol', 'unix', '-', '-'])
                self.assertEqual(input, data)
                pdf.write_bytes(make_pdf(['Changed file']))
                return subprocess.CompletedProcess(command, 0, b'  Original file  \n\n\f', b'')

            with patch('prepare_pdf_source.subprocess.run', side_effect=change_during_extraction):
                self.assertEqual(prepare(pdf, output), 1)
            source = json.loads(output.read_bytes())
            self.assertEqual(source['pdfSha256'], sha256(data).hexdigest())
            self.assertEqual(source['pages'], ['  Original file  \n\n'])


if __name__ == '__main__':
    unittest.main()
