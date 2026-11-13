import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from werkzeug.security import generate_password_hash
from cloud_app import create_app, EMPTY


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = dict(TESTING=True, DB_PATH=str(Path(self.temp.name)/'app.db'),
                           PUBLIC_ORIGIN='http://localhost', SECURE_COOKIE=False,
                           OWNER_HASH=generate_password_hash('test-only-password',method='pbkdf2:sha256:600000'))
        self.app = create_app(self.config)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def login(self, client=None):
        client = client or self.client
        return client.post('/api/login', json={'password':'test-only-password'}, headers={'Origin':'http://localhost'})

    def put(self, state, version=0, client=None):
        return (client or self.client).put('/api/state', json={'state':state,'version':version}, headers={'Origin':'http://localhost'})

    def test_auth_csrf_and_secret_paths(self):
        for url in ['/api/state','/api/readings','/data/movies.json','/api/ai/status']:
            self.assertEqual(self.client.get(url).status_code,401)
        self.assertEqual(self.client.post('/api/login',json={'password':'test-only-password'}).status_code,403)
        self.assertEqual(self.client.post('/api/login',json={'password':'wrong'},headers={'Origin':'http://localhost'}).status_code,401)
        cookie=self.login().headers['Set-Cookie']
        self.assertIn('HttpOnly',cookie)
        self.assertIn('SameSite=Strict',cookie)
        self.assertEqual(self.client.put('/api/state',json={'state':EMPTY,'version':0},headers={'Origin':'https://evil.example'}).status_code,403)
        for path in ['/.env.local','/cloud_app.py','/../.env.local','/data/readings.json','/index.html']:
            self.assertEqual(self.client.get(path).status_code,404)
        self.assertEqual(self.client.get('/api/state',headers={'Host':'evil.example'}).status_code,400)

    def test_cross_device_restart_and_conflict(self):
        self.login()
        state={**EMPTY,'articles':[dict(id='check1',title='同步核验',content='这是专门用于测试的文章。',date='2026-11-02',status='draft')]}
        self.assertEqual(self.put(state).status_code,200)
        restarted=create_app(self.config).test_client()
        self.login(restarted)
        self.assertEqual(restarted.get('/api/state').json['state'],state)
        self.assertEqual(self.put(EMPTY,version=0,client=restarted).status_code,409)
        self.assertEqual(self.client.get('/api/state').json['state'],state)
        self.client.post('/api/logout',json={},headers={'Origin':'http://localhost'})
        self.assertEqual(self.client.get('/api/state').status_code,401)
        self.assertEqual(restarted.get('/api/state').status_code,200)

    def test_invalid_import_is_atomic(self):
        self.login()
        state={**EMPTY,'articles':[dict(id='"><script>',title='x',content='x',date='2026-11-02',status='draft')]}
        self.assertEqual(self.put(state).status_code,400)
        self.assertEqual(self.client.get('/api/state').json['version'],0)
        self.assertEqual(self.put({**EMPTY,'articles':'not-list'}).status_code,400)

    def test_compressed_image_catalog(self):
        import gzip
        self.login()
        plain=self.client.get('/api/images')
        compressed=self.client.get('/api/images',headers={'Accept-Encoding':'gzip'})
        self.assertEqual(gzip.decompress(compressed.data),plain.data)
        self.assertEqual(compressed.headers['Vary'],'Accept-Encoding')
        self.assertNotIn('Content-Encoding',self.client.get('/api/images',headers={'Accept-Encoding':'gzip;q=0'}).headers)

    def test_catalog_db_and_ai_limit(self):
        self.login()
        catalog=self.client.get('/api/readings').json
        self.assertEqual(len(catalog),2)
        self.assertTrue(all(r['sourceUrl'].startswith('https://zh.wikisource.org/') and r['author']=='朱自清' for r in catalog))
        self.assertTrue(self.client.get('/data/movies.json').json)
        with patch('cloud_app.ai_service.complete',return_value={'text':'测试续写'}):
            for _ in range(12):
                result=self.client.post('/api/ai/continue',json={'title':'测试','content':'验证用句子'},headers={'Origin':'http://localhost'})
                self.assertEqual(result.status_code,200)
            self.assertEqual(self.client.post('/api/ai/continue',json={'content':'x'},headers={'Origin':'http://localhost'}).status_code,429)


if __name__ == '__main__':
    unittest.main()
