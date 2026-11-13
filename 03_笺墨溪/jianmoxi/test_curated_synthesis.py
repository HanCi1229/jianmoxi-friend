import copy,json,sqlite3,tempfile,unittest
from pathlib import Path
import book_study as study
from scripts import import_curated_synthesis as importer

class SynthesisImportTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'app.db'
  self.db=sqlite3.connect(self.path);self.db.row_factory=sqlite3.Row
  self.db.execute('CREATE TABLE library_works(id TEXT,body_hash TEXT,status TEXT)')
  self.db.execute("INSERT INTO library_works VALUES('work','hash','ready')");self.db.commit()
  self.k=sqlite3.connect(self.path.with_name('knowledge.db'));self.k.row_factory=sqlite3.Row;self.k.executescript(study.SCHEMA)
  self.k.execute('INSERT INTO study_books VALUES(?,?,?,?,?,?,?,?,?)',('work','hash','study-v1','{}','root',1,20,1,0))
  self.k.execute('INSERT INTO study_state VALUES(?,?)',('approved_work_ids','["work"]'))
  self.analysis=dict(summary='完整测试摘要',background='测试来源',people=[],events=[],emotions=[],themes=[],imagery=[])
  for jid,kind,status in [('u','unit','done'),('r','review','done'),('c','chapter','done'),('s','synthesis','pending'),('root','book','pending')]:
   self.k.execute('INSERT INTO study_jobs(id,work_id,kind,chapter,part,payload,status,result) VALUES(?,?,?,?,?,?,?,?)',(jid,'work',kind,0,0,'{}',status,study.dump(self.analysis) if status=='done' else None))
  self.k.executemany('INSERT INTO study_dependencies VALUES(?,?)',[('r','u'),('c','u'),('s','c'),('root','s')]);self.k.commit()
  self.packet=dict(book=dict(self.k.execute('SELECT * FROM study_books').fetchone()),jobs=[dict(j) for j in self.k.execute('SELECT * FROM study_jobs')],dependencies=[dict(d) for d in self.k.execute('SELECT * FROM study_dependencies')])
  self.authored=dict(workId='work',sourceHash='hash',processor='codex-direct',reviewMethod='same-agent-second-pass',coverage='完整测试',batchId='test',syntheses=[dict(jobId=j,analysis=self.analysis) for j in ['root','s']])
 def tearDown(self):self.k.close();self.db.close();self.tmp.cleanup()
 def test_topological_atomic_import_and_idempotence(self):
  before=self.db.total_changes
  receipt=importer.apply(self.db,self.packet,self.authored)
  self.assertTrue(receipt['bookComplete']);self.assertEqual(self.db.total_changes,before)
  self.assertTrue(importer.apply(self.db,self.packet,self.authored)['alreadyApplied'])
  root=json.loads(self.k.execute("SELECT result FROM study_jobs WHERE id='root'").fetchone()[0])
  self.assertEqual(root['sourceChildren'],['s']);self.assertIn('s',root['sourceResultHashes'])
  changed=copy.deepcopy(self.authored);changed['coverage']='different'
  with self.assertRaises(AssertionError):importer.apply(self.db,self.packet,changed)
 def test_unreviewed_book_cannot_finish(self):
  self.k.execute("UPDATE study_jobs SET status='pending',result=NULL WHERE id='r'");self.k.commit()
  with self.assertRaises(AssertionError):importer.apply(self.db,self.packet,self.authored)
  self.assertEqual(self.k.execute("SELECT status FROM study_jobs WHERE id='s'").fetchone()[0],'pending')
  self.assertEqual(self.k.execute("SELECT count(*) FROM study_state WHERE key LIKE 'curated_synthesis:%'").fetchone()[0],0)
 def test_source_or_approval_change_rejects(self):
  self.db.execute("UPDATE library_works SET body_hash='changed'");self.db.commit()
  with self.assertRaises(AssertionError):importer.apply(self.db,self.packet,self.authored)
  self.db.execute("UPDATE library_works SET body_hash='hash'");self.db.commit()
  self.k.execute("UPDATE study_state SET value='[]' WHERE key='approved_work_ids'");self.k.commit()
  with self.assertRaises(AssertionError):importer.apply(self.db,self.packet,self.authored)
 def test_missing_reduction_dependency_and_leased_work_reject(self):
  changed=copy.deepcopy(self.authored);changed['syntheses']=changed['syntheses'][:1]
  with self.assertRaises(AssertionError):importer.apply(self.db,self.packet,changed)
  self.k.execute("UPDATE study_jobs SET status='running' WHERE id='s'");self.k.commit()
  with self.assertRaises(AssertionError):importer.apply(self.db,self.packet,self.authored)

if __name__=='__main__':unittest.main()
