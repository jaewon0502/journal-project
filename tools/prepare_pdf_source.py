"""Prepare an offline, page-aligned Journal source from a PDF using Poppler."""

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
from tempfile import NamedTemporaryFile


def prepare(pdf, output):
    data = pdf.read_bytes()
    if not data.startswith(b'%PDF-') or not data.rstrip(b'\x00\t\n\f\r ').endswith(b'%%EOF'):
        raise ValueError('PDF의 시작 또는 끝이 잘못되었습니다. 원본 PDF를 확인하세요.')
    try:
        extraction = subprocess.run(
            ['pdftotext', '-layout', '-enc', 'UTF-8', '-eol', 'unix', '-', '-'],
            input=data, capture_output=True, env={**os.environ, 'LC_ALL': 'C'})
    except FileNotFoundError:
        raise ValueError('Poppler의 pdftotext를 설치한 뒤 다시 실행하세요.') from None
    if extraction.returncode or b'Syntax Error' in extraction.stderr:
        raise ValueError('PDF를 읽지 못했습니다. 암호 설정이나 파일 손상 여부를 확인하세요.')
    pages = extraction.stdout.decode('utf-8').removesuffix('\f').split('\f')
    if not any(page.strip() for page in pages):
        raise ValueError('추출할 텍스트가 없습니다. 스캔본은 텍스트가 포함된 PDF가 필요합니다.')
    source = {'format': 'journal-pdf-text-v1', 'pdfName': pdf.name,
              'pdfSha256': sha256(data).hexdigest(), 'pages': pages}
    # A hard link publishes the finished file only if the output name is still free.
    temporary = None
    try:
        with NamedTemporaryFile('w', dir=output.parent, encoding='utf-8', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(source, stream, ensure_ascii=False)
            stream.write('\n')
        try:
            os.link(temporary, output)
        except FileExistsError:
            raise ValueError(f'출력 파일이 이미 있습니다. 다른 경로를 지정하세요. {output}') from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return len(pages)


def main():
    parser = argparse.ArgumentParser(description='PDF의 물리 페이지별 원문과 SHA-256을 JSON 파일로 저장합니다.')
    parser.add_argument('pdf', type=Path, help='원본 PDF')
    parser.add_argument('-o', '--output', type=Path, help='출력 경로 (기본값은 PDF 옆의 *.journal-source.json)')
    args = parser.parse_args()
    output = args.output or args.pdf.with_suffix('.journal-source.json')
    try:
        count = prepare(args.pdf, output)
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')
    print(f'{output} ({count}쪽)')


if __name__ == '__main__':
    main()
