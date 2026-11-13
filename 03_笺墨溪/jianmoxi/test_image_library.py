import hashlib
import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from cloud_app import create_app
from image_library import import_manifest
from werkzeug.security import generate_password_hash

class ImageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.folder=self.root/'images';(self.folder/'files').mkdir(parents=True)
        data=(Path(__file__).parent/'dist/assets/forest.jpg').read_bytes()
        (self.folder/'files/ps-10.jpg').write_bytes(data)
        self.record=dict(id='ps-10',creator='Test author',license='unsplash',tags=['forest'],
            sourceUrl='https://unsplash.com/photos/example',licenseUrl='https://unsplash.com/license',
            originalUrl='https://picsum.photos/id/10/1200/800',sha256=hashlib.sha256(data).hexdigest(),
            url='/media/library/ps-10.jpg')
        (self.folder/'manifest.json').write_text(json.dumps([self.record]))
        self.db=self.root/'app.db'
        self.app=create_app(dict(TESTING=True,DB_PATH=str(self.db),IMAGE_FOLDER=str(self.folder),PUBLIC_ORIGIN='http://localhost',SECURE_COOKIE=False,OWNER_HASH=generate_password_hash('test-pass',method='pbkdf2:sha256:600000')))
        self.client=self.app.test_client()
        self.client.post('/api/login',json={'password':'test-pass'},headers={'Origin':'http://localhost'})

    def tearDown(self):self.temp.cleanup()

    def test_import_dedup_persistence_and_missing_file(self):
        before=self.client.get('/api/state').json
        with sqlite3.connect(self.db) as db:
            import_manifest(db,self.folder);import_manifest(db,self.folder)
        self.assertEqual(len(self.client.get('/api/images').json),1)
        response=self.client.get('/media/library/ps-10.jpg');self.assertEqual(response.status_code,200);response.close()
        self.assertEqual(self.client.get('/api/state').json,before)
        self.assertEqual(self.app.test_client().get('/api/images').status_code,401)
        (self.folder/'files/ps-10.jpg').unlink()
        self.assertEqual(self.client.get('/api/images').json,[])
        self.assertEqual(self.client.get('/media/library/ps-10.jpg').status_code,404)

    def test_archived_images_stay_hidden_after_manifest_reimport(self):
        with sqlite3.connect(self.db) as db:
            import_manifest(db,self.folder)
            db.execute("UPDATE image_assets SET status='archived'")
            db.commit()
            import_manifest(db,self.folder)
            self.assertEqual(db.execute('SELECT status FROM image_assets').fetchone()[0],'archived')
        self.assertEqual(self.client.get('/api/images').json,[])
        self.assertEqual(self.client.get('/media/library/ps-10.jpg').status_code,404)

    def test_pending_and_corrupt_assets_never_published(self):
        with sqlite3.connect(self.db) as db:
            import_manifest(db,self.folder)
            db.execute("UPDATE image_assets SET status='pending'")
        self.assertEqual(self.client.get('/api/images').json,[])
        self.assertEqual(self.client.get('/media/library/ps-10.jpg').status_code,404)
        (self.folder/'files/ps-10.jpg').write_bytes(b'broken')
        with sqlite3.connect(self.db) as db:
            with self.assertRaises(ValueError):import_manifest(db,self.folder)
            self.assertEqual(db.execute('SELECT status FROM image_assets').fetchone()[0],'pending')

if __name__=='__main__':unittest.main()
