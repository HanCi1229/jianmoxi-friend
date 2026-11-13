import json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import library_knowledge as library

class DailyInspirationTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.db=sqlite3.connect(str(Path(self.temp.name)/'app.db'))
  self.db.execute('CREATE TABLE library_works(id TEXT,record TEXT,status TEXT)')
  for i,author in enumerate(['史铁生','萧红','鲁迅']):
   self.db.execute('INSERT INTO library_works VALUES (?,?,?)',(str(i),json.dumps(dict(genre='散文',author=author)),'ready'))
  self.db.commit()
  with library.connect(self.db,True) as k,k:
   for i in range(60):
    author=['史铁生','萧红','鲁迅'][i%3];source=dict(readingId=str(i%3),author=author,work='测试作品',quote='窗外的树叶照着阳光，这是用于测试推荐的第'+str(i)+'段文字。',verified=True)
    row=dict(id=str(i),source=source,editorialPolicy=library.LITERARY_POLICY)
    k.execute('INSERT INTO inspirations VALUES (?,?,?,?)',(str(i),str(i%3),json.dumps(row),i))
 def tearDown(self):self.db.close();self.temp.cleanup()
 def test_thirty_unique_balanced_and_stable_per_day(self):
  a=library.cached_inspirations(self.db,day='2026-11-04');b=library.cached_inspirations(self.db,day='2026-11-04');c=library.cached_inspirations(self.db,day='2026-11-05')
  self.assertEqual(a,b);self.assertEqual(len(a),30);self.assertEqual(len({r['source']['quote'] for r in a}),30)
  self.assertNotEqual({r['id'] for r in a},{r['id'] for r in c})
  self.assertTrue(all(a[i]['source']['author']!=a[i+1]['source']['author'] for i in range(29)))
 def test_invalid_deleted_and_duplicate_quotes_are_excluded(self):
  self.db.execute("UPDATE library_works SET status='archived' WHERE id='2'");self.db.commit()
  with library.connect(self.db) as k,k:
   r=json.loads(k.execute("SELECT body FROM inspirations WHERE id='0'").fetchone()[0]);r['id']='duplicate';k.execute('INSERT INTO inspirations VALUES (?,?,?,?)',('duplicate','0',json.dumps(r),100))
   r['id']='unverified';r['source']['verified']=False;r['source']['quote']='未经核实的摘录不能为了填满推荐数量而展示出来。';k.execute('INSERT INTO inspirations VALUES (?,?,?,?)',('unverified','0',json.dumps(r),101))
  rows=library.cached_inspirations(self.db,day='2026-11-04');self.assertEqual(len(rows),20)
  self.assertTrue(all(r['source']['readingId']!='2' and r['source']['verified'] for r in rows));self.assertEqual(len({r['source']['quote'] for r in rows}),20)
 def test_small_library_never_pads_with_repetitions(self):
  with library.connect(self.db) as k,k:k.execute('DELETE FROM inspirations WHERE cast(id as integer)>=4')
  self.assertEqual(len(library.cached_inspirations(self.db)),4)
if __name__=='__main__':unittest.main()
