import json,sqlite3,tempfile,unittest,zlib
from pathlib import Path
from werkzeug.security import generate_password_hash
from cloud_app import create_app
import book_library,reading_library

class BookTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.path=self.root/'app.db';self.books=self.root/'books';(self.books/'sources').mkdir(parents=True)
  self.app=create_app(dict(TESTING=True,DB_PATH=str(self.path),PUBLIC_ORIGIN='http://localhost',SECURE_COOKIE=False,BOOK_FOLDER=str(self.books),OWNER_HASH=generate_password_hash('book-test',method='pbkdf2:sha256:600000')));self.c=self.app.test_client();self.c.post('/api/login',json={'password':'book-test'},headers={'Origin':'http://localhost'})
  self.bid='upload-book-test';self.record=dict(id=self.bid,title='章节测试',author='验收作者',genre='小说',collection='个人藏书',characters=200,body=['第一章内容'],chunked=True,format='txt',chapterCount=102,sourceUrl='/api/library/'+self.bid+'/source',sourceName='个人藏书')
  with sqlite3.connect(self.path) as db:
   db.execute('INSERT INTO library_works VALUES (?,?,?,?,?,?,?,?,?,?,?)',(self.bid,'章节测试','验收作者','小说','个人藏书',0,200,'章节测试 验收作者 第一章内容','h',json.dumps(self.record),'ready'))
   db.execute('INSERT INTO library_books VALUES (?,?,?,?,?)',(self.bid,'a'*64+'.txt','txt',102,'a'*64))
   db.execute('INSERT INTO library_sources VALUES (?,?,?,?,?,?,?)',('a'*64,'测试.txt','a'*64+'.txt',10,'ready',self.bid,''))
   for i in range(102):db.execute('INSERT INTO library_chapters VALUES (?,?,?,?,?)',(self.bid,i,'第'+str(i+1)+'章',zlib.compress(json.dumps(['章节正文'+str(i)],ensure_ascii=False).encode()),10))
  (self.books/'sources'/('a'*64+'.txt')).write_text('原文件正文')
 def tearDown(self):self.temp.cleanup()
 def test_open_is_bounded_and_directory_pages(self):
  r=self.c.get('/api/library/'+self.bid);self.assertEqual(r.status_code,200);self.assertEqual(len(r.json['chapterDirectory']),100);self.assertEqual(r.json['body'],['章节正文0']);self.assertLess(len(r.data),20000)
  r=self.c.get('/api/library/'+self.bid+'/chapters/100');self.assertEqual(r.json['index'],100);self.assertEqual(len(r.json['directory']),2);self.assertEqual(r.json['body'],['章节正文100'])
  self.assertEqual(self.c.get('/api/library/'+self.bid+'/chapters/102').status_code,404)
 def test_catalog_does_not_send_full_text(self):
  r=self.c.get('/api/library?q=章节测试').json;self.assertEqual(r['total'],1);self.assertNotIn('body',r['items'][0]);self.assertEqual(r['items'][0]['chapterCount'],102)
 def test_sources_and_pages_require_login(self):
  other=self.app.test_client()
  for path in ['/api/library/'+self.bid,'/api/library/'+self.bid+'/chapters/0','/api/library/'+self.bid+'/source','/api/library/'+self.bid+'/pages/0']:self.assertEqual(other.get(path).status_code,401)
  r=self.c.get('/api/library/'+self.bid+'/source');self.assertEqual(r.status_code,200);self.assertEqual(r.data.decode(),'原文件正文');r.close()
  self.assertEqual(self.c.get('/api/library/'+self.bid+'/pages/0').status_code,404)
 def test_pdf_original_page(self):
  import fitz
  path=self.books/'sources'/('b'*64+'.pdf');doc=fitz.open();doc.new_page().insert_text((72,72),'Original page 123');doc.save(path);doc.close()
  with sqlite3.connect(self.path) as db:db.execute("UPDATE library_books SET source_file=?,format='pdf',chapter_count=1 WHERE id=?",('b'*64+'.pdf',self.bid))
  r=self.c.get('/api/library/'+self.bid+'/pages/0');self.assertEqual(r.status_code,200);self.assertEqual(r.mimetype,'image/jpeg');self.assertTrue(r.data.startswith(b'\xff\xd8'))
 def test_cover_requires_binding_and_login(self):
  from PIL import Image
  folder=self.books/'covers';folder.mkdir();Image.new('RGB',(200,300),'green').save(folder/(self.bid+'.jpg'))
  endpoint='/api/library/'+self.bid+'/cover'
  self.assertEqual(self.c.get(endpoint).status_code,404)
  self.record['bookCover']={'url':endpoint}
  with sqlite3.connect(self.path) as db:db.execute('UPDATE library_works SET record=? WHERE id=?',(json.dumps(self.record),self.bid))
  self.assertEqual(self.app.test_client().get(endpoint).status_code,401)
  r=self.c.get(endpoint);self.assertEqual(r.status_code,200);self.assertEqual(r.mimetype,'image/jpeg');r.close()
  self.assertEqual(self.c.get('/api/library/upload-other/cover').status_code,404)
 def test_archived_book_is_hidden_and_restorable(self):
  with sqlite3.connect(self.path) as db:db.execute("UPDATE library_works SET status='archived' WHERE id=?",(self.bid,))
  self.assertEqual(self.c.get('/api/library?q=章节测试').json['total'],0)
  for suffix in ('','/chapters/0','/source','/pages/0','/cover'):
   self.assertEqual(self.c.get('/api/library/'+self.bid+suffix).status_code,404)
  self.assertTrue((self.books/'sources'/('a'*64+'.txt')).is_file())
  with sqlite3.connect(self.path) as db:
   self.assertEqual(db.execute('SELECT count(*) FROM library_chapters WHERE work_id=?',(self.bid,)).fetchone()[0],102)
   db.execute("UPDATE library_works SET status='ready' WHERE id=?",(self.bid,))
  self.assertEqual(self.c.get('/api/library/'+self.bid).status_code,200)
  r=self.c.get('/api/library/'+self.bid+'/source');self.assertEqual(r.status_code,200);r.close()
 def test_batch_is_idempotent(self):
  bundle=self.root/'bundle.db'
  with sqlite3.connect(self.path) as src,sqlite3.connect(bundle) as target:src.backup(target)
  with sqlite3.connect(self.path) as db:
   before=db.execute('select count(*) from library_chapters').fetchone()[0];self.assertEqual(book_library.merge(db,bundle),0);self.assertEqual(db.execute('select count(*) from library_chapters').fetchone()[0],before)

if __name__=='__main__':unittest.main()
