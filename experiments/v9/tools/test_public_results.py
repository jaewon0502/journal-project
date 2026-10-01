"""One public accounting/integrity test, separate from 17 gate contract tests."""
import unittest
from verify_results import main


class PublicResultsTest(unittest.TestCase):
    def test_public_counts_ratings_and_synthetic_hashes(self):
        main()


if __name__ == '__main__':
    unittest.main()
