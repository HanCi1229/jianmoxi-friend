import unittest
from unittest.mock import patch
import collect_large_gallery as gallery


class GalleryPolicyTests(unittest.TestCase):
    def test_retired_source_cannot_download_or_repopulate_gallery(self):
        with patch('subprocess.run', side_effect=AssertionError('Network request')), \
             patch('sqlite3.connect', side_effect=AssertionError('Database write')), \
             patch('builtins.open', side_effect=AssertionError('File write')):
            result = gallery.run(5000, 60)
        self.assertEqual(result['added'], 0)
        self.assertEqual(result['status'], 'source retired')


if __name__ == '__main__':
    unittest.main()
