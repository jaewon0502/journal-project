"""Public URL/session regression checks; fixtures use invented non-secret markers."""
import unittest
from validate_release import PATTERNS

class SessionURLTests(unittest.TestCase):
    def test_reject_session_carriers(self):
        pattern = PATTERNS['session_url']
        for url in (
            'https://example.org/path;' + 'jsessionid=fixture?fileId=3',
            'https://example.org/path%3B' + 'JSESSIONID%3Dfixture?fileId=3',
            'https://example.org/path?access_' + 'token=fixture',
            'https://example.org/path?fileId=3&' + 'PHPSESSID=fixture',
        ):
            with self.subTest(url=url):
                self.assertIsNotNone(pattern.search(url))

    def test_preserve_source_identifiers(self):
        pattern = PATTERNS['session_url']
        for url in ('https://example.org/path?fileId=3&fileSeq=2',
                    'https://example.org/paper?doi=10.1234/example',
                    'https://example.org/path?session_title=public'):
            with self.subTest(url=url):
                self.assertIsNone(pattern.search(url))

if __name__ == '__main__':
    unittest.main()
