import http.client
import json
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch
import ai_service
from server import Handler, ROOT


class AIValidationTests(unittest.TestCase):
    def test_unknown_or_duplicate_sources_rejected(self):
        data = {'items': [{'id': 'a'}, {'id': 'b'}]}
        row = dict(id='a', short='光', desc='写一束光', questions=['它在哪里？'])
        for rows in ([row, row], [row, dict(row, id='invented')]):
            with self.assertRaises(ValueError):
                ai_service.validate('inspiration', {'items': rows}, data)

    def test_article_boundaries(self):
        for body in ('', '字' * 12001, None):
            with self.assertRaises(ValueError):
                ai_service.prepare('advice', {'content': body})
        with self.assertRaises(ValueError):
            ai_service.prepare('arbitrary-task', {})

    def test_transport_keeps_credentials_off_argv_and_filters_output(self):
        reply = {'model': 'deepseek-flash', 'choices': [{'finish_reason': 'stop',
                 'message': {'content': json.dumps({'text': '新的一段。', 'extra': 'discard'})}}]}
        with patch.object(ai_service, 'configuration', return_value=('private-test-key', 'deepseek-v4-flash')), \
             patch.object(ai_service.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(reply).encode()+b'\n200')) as call:
            result = ai_service.complete('continue', {'content': '旧的一段。'})
        self.assertNotIn('private-test-key', str(call.call_args.args))
        self.assertIn(b'private-test-key', call.call_args.kwargs['input'])
        self.assertNotIn('extra', result)
        self.assertEqual(result['text'], '新的一段。')

    def test_upstream_error_is_sanitized(self):
        with patch.object(ai_service, 'configuration', return_value=('test-key', 'deepseek-v4-flash')), \
             patch.object(ai_service.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'sensitive diagnostic\n401')):
            with self.assertRaises(ai_service.AIError) as caught:
                ai_service.complete('advice', {'content': '有效正文'})
        self.assertNotIn('sensitive', str(caught.exception))
        self.assertIn('密钥无效', str(caught.exception))


class HTTPBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT/'dist')))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method, path, headers=None, body=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        conn.request(method, path, body, headers or {})
        response = conn.getresponse()
        result = response.status, response.read()
        conn.close()
        return result

    def test_foreign_origin_and_oversized_requests_never_invoke_model(self):
        with patch.object(ai_service, 'complete') as model:
            code, _ = self.request('POST', '/api/ai/advice', {'Origin': 'https://other.example', 'Content-Type': 'application/json'}, '{}')
            self.assertEqual(code, 403)
            code, _ = self.request('POST', '/api/ai/advice', {'Origin': f'http://127.0.0.1:{self.server.server_port}', 'Content-Type': 'application/json'}, 'a'*64001)
            self.assertEqual(code, 413)
            model.assert_not_called()

    def test_private_config_not_served(self):
        code, _ = self.request('GET', '/.env.local')
        self.assertEqual(code, 404)
        code, data = self.request('GET', '/api/ai/status')
        self.assertEqual(code, 200)
        self.assertEqual(set(json.loads(data)), {'configured','requestedModel','connected','actualModel'})


if __name__ == '__main__':
    unittest.main()
