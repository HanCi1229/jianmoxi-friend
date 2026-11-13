import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
import server


class ContentProxyTests(unittest.TestCase):
    def setUp(self):
        server.CACHE.clear()
        server.LAST_HITOKOTO = 0

    def test_only_known_endpoints_and_categories(self):
        for path, query in [('/api/proxy', {'url': ['https://example.com']}),
                            ('/api/hitokoto', {'category': ['../../secret']}),
                            ('/api/lyrics', {'track_name': ['sec\nret']}),
                            ('/api/lyrics', {'track_name': ['x' * 81]})]:
            with self.subTest(path=path, query=query), self.assertRaises(ValueError):
                server.upstream_url(path, query)

    def test_song_title_cannot_inject_query_parameters(self):
        title = '晴天&url=https://example.com'
        url = server.upstream_url('/api/lyrics', {'track_name': [title]})
        self.assertEqual(urlsplit(url).hostname, 'lrclib.net')
        self.assertEqual(parse_qs(urlsplit(url).query), {'track_name': [title]})

    def test_lyrics_cache_avoids_duplicate_upstream_calls(self):
        with patch.object(server, 'fetch_public', return_value=[{'id': 123}]) as request:
            first = server.public_content('/api/lyrics', {'track_name': ['晴天']})
            second = server.public_content('/api/lyrics', {'track_name': ['晴天']})
        self.assertEqual(first, second)
        request.assert_called_once()

    def test_failed_response_does_not_poison_cache(self):
        with patch.object(server, 'fetch_public', side_effect=OSError('offline')):
            with self.assertRaises(OSError):
                server.public_content('/api/lyrics', {'track_name': ['晴天']})
        self.assertEqual(server.CACHE, {})


if __name__ == '__main__':
    unittest.main()
