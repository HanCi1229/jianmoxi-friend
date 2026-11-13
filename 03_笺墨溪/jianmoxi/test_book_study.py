import json,sqlite3,unittest,time
from unittest.mock import patch
from test_inspiration_creation import CreationTests,Q1,Q2
import book_study as study,library_knowledge as library,reading_library,ai_service

class StudyTests(unittest.TestCase):
 setUpBase=CreationTests.setUpBase
 setUp=CreationTests.setUp
 tearDown=CreationTests.tearDown
 def setup_plan(self):
  with sqlite3.connect(self.path) as db:
   study.plan(db)
   with library.connect(db) as k,k:
    for r in k.execute("SELECT work_id FROM study_books WHERE work_id!='new-novel'").fetchall():study.clean(k,r[0])
 def model(self,task,data):
  result=dict(summary='一封未寄出的信与等待的人。',background='文本中的日常场景，写作背景未知。',people=['写信的人'],events=['等待归来'],emotions=['牵挂'],themes=['等待'],imagery=['树叶','灯'])
  if task=='study_unit':result['quotes']=[dict(quote=q,quality='文笔',summary='等待与归途',interpretation='用灯与未寄的信表达等待，未把等待写成直接诉说。',reason='意象具体，能够独立理解。',themes=['爱与牵挂'],imagery=['灯'],spoiler=False) for q in (Q1,Q2) if q in data['text']]
  elif task=='study_review':result=dict(decisions=[dict(id=q['id'],accept=True,spoiler=False,readability=5,literaryValue=5,faithful=True,needsContext=False,practicalAdvice=False,reason='语义完整，与上下文一致。') for q in data['quotes']])
  return {**ai_service.validate(task,result,data),'model':'test-only'}
 def run_all(self):
  with sqlite3.connect(self.path) as db:
   for _ in range(150):
    job=study.claim(db)
    if not job:break
    study.process(db,job,self.model)
   else:self.fail('Non-terminating queue')
 def test_three_layers_publish_and_resume_without_state_changes(self):
  before=self.client.get('/api/state').json;self.setup_plan();self.run_all()
  with sqlite3.connect(self.path) as db:
   s=study.status(db);self.assertEqual(s['completedWorks'],1);self.assertEqual(s['completedChapters'],1);self.assertEqual(s['acceptedQuotes'],2)
   self.assertTrue(study.evidence(db,'new-novel',[0])['complete'])
   rows=study.quotes(db)['items'];self.assertEqual({r['quote'] for r in rows},{Q1,Q2});self.assertEqual(study.quotes(db,q='不存在')['total'],0)
   self.assertIsNone(study.claim(db));study.plan(db)
   self.assertEqual(study.quotes(db)['total'],2)
  self.assertEqual(before,self.client.get('/api/state').json)
  self.assertEqual(self.client.get('/api/quotes?workId=new-novel&limit=1').json['total'],2)
  self.assertEqual(len(self.client.get('/api/quotes?workId=new-novel&limit=1').json['items']),1)
  self.assertEqual(self.app.test_client().get('/api/quotes').status_code,401)
  self.assertEqual(self.client.get('/api/quotes?limit=bad').status_code,400)
 def test_unreviewed_candidates_never_publish_and_rejections_stay_out(self):
  self.setup_plan()
  with sqlite3.connect(self.path) as db:
   j=study.claim(db);study.process(db,j,self.model);self.assertEqual(study.quotes(db)['total'],0)
   while True:
    j=study.claim(db)
    if not j:break
    def reject(task,data):
     if task=='study_review':return dict(decisions=[dict(id=q['id'],accept=False,spoiler=False,reason='不适合独立阅读') for q in data['quotes']],model='test')
     return self.model(task,data)
    study.process(db,j,reject)
   self.assertEqual(study.quotes(db)['total'],0);self.assertEqual(study.status(db)['completedWorks'],1)
 def test_source_update_invalidates_analysis_quotes_and_running_completion(self):
  self.setup_plan();self.run_all()
  with sqlite3.connect(self.path) as db:
   db.execute("UPDATE library_works SET body_hash='new-source' WHERE id='new-novel'");db.commit()
   self.assertEqual(study.quotes(db)['total'],0);self.assertIsNone(study.evidence(db,'new-novel'));self.assertEqual(study.status(db)['completedWorks'],0)
   study.plan(db)
   with library.connect(db) as k,k:
    for r in k.execute("SELECT work_id FROM study_books WHERE work_id!='new-novel'").fetchall():study.clean(k,r[0])
   j=study.claim(db);self.assertTrue(j)
   db.execute("UPDATE library_works SET body_hash='newer-source' WHERE id='new-novel'");db.commit()
   self.assertFalse(study.process(db,j,self.model))
 def test_lease_recovery_and_failed_dependency_not_complete(self):
  self.setup_plan()
  with sqlite3.connect(self.path) as db:
   j=study.claim(db);self.assertEqual(j['attempts'],1)
   with library.connect(db) as k,k:k.execute("UPDATE study_jobs SET lease_until=0 WHERE id=?",(j['id'],))
   newer=study.claim(db);self.assertEqual(newer['id'],j['id']);self.assertEqual(newer['attempts'],2)
   self.assertFalse(study.process(db,j,self.model));study.failure(db,newer,ValueError('private text'))
   self.assertIsNone(study.claim(db));self.assertEqual(study.status(db)['completedWorks'],0)
   with library.connect(db) as k:self.assertEqual(k.execute('SELECT error FROM study_jobs WHERE id=?',(j['id'],)).fetchone()[0],'ValueError')
 def test_full_text_segmentation_hierarchy_and_offsets(self):
  with sqlite3.connect(self.path) as db:
   text='甲'*8100+Q1+'乙'*8100+Q2
   db.execute("DELETE FROM library_works WHERE id='new-novel'")
   reading_library.import_records(db,[dict(id='new-novel',title='长段测试',author='测试作者',genre='散文',sourceUrl='https://zh.wikisource.org/wiki/test',body=[text])]);db.commit()
  self.setup_plan();self.run_all()
  with sqlite3.connect(self.path) as db:
   s=study.status(db);self.assertEqual(s['analysedSegments'],3);self.assertEqual(s['completedWorks'],1)
   for q in study.quotes(db)['items']:self.assertEqual(text[q['start']:q['end']],q['quote'])
   self.assertTrue(library.inspiration_pool(db));self.assertEqual(len(study.cards(db)),2)
 def test_many_chapters_reduce_in_bounded_groups(self):
  with sqlite3.connect(self.path) as db:
   db.execute("DELETE FROM library_works WHERE id='new-novel'")
   reading_library.import_records(db,[dict(id='new-novel',title='多章测试',author='测试作者',genre='散文',sourceUrl='https://zh.wikisource.org/wiki/test',body=[Q1+Q2]*18,sections=[dict(title='第'+str(i)+'章',start=i) for i in range(18)])]);db.commit()
  self.setup_plan();self.run_all()
  with sqlite3.connect(self.path) as db:
   self.assertEqual(study.status(db)['completedChapters'],18);self.assertTrue(study.evidence(db,'new-novel')['complete'])
   self.assertEqual(study.quotes(db)['total'],2)
   with library.connect(db) as k:self.assertLessEqual(k.execute('SELECT max(n) FROM (SELECT count(*) n FROM study_dependencies GROUP BY parent)').fetchone()[0],16)
 def test_practical_advice_and_context_dependent_quotes_cannot_publish(self):
  row=dict(id='one',accept=True,spoiler=False,readability=5,literaryValue=5,faithful=True,needsContext=False,practicalAdvice=True,reason='实用建议')
  self.assertFalse(study.validate('study_review',dict(decisions=[row]),dict(quotes=[dict(id='one')]))['decisions'][0]['accept'])
  row.update(practicalAdvice=False,needsContext=True)
  self.assertFalse(study.validate('study_review',dict(decisions=[row]),dict(quotes=[dict(id='one')]))['decisions'][0]['accept'])
 def test_bad_quotes_and_incomplete_review_rejected(self):
  data=dict(jobId='j',start=0,text=Q1)
  good=dict(summary='概括',background='未知',quotes=[dict(quote='这句话并不在原文中但是它看起来像是一条语录。',quality='文笔',summary='概括',interpretation='解读',reason='理由',themes=['日常与慰藉'],imagery=[],spoiler=False)])
  self.assertEqual(study.validate('study_unit',good,data)['quotes'],[])
  self.assertEqual(study.validate('study_unit',good,data)['rejectedCandidates'],1)
  with self.assertRaises(ValueError):study.validate('study_review',dict(decisions=[]),dict(quotes=[dict(id='one')]))
 def test_approved_selection_limits_work_and_progress_without_removing_quotes(self):
  self.setup_plan();self.run_all()
  with sqlite3.connect(self.path) as db:
   with library.connect(db) as k,k:
    k.execute("INSERT INTO study_state VALUES ('approved_work_ids','[]')")
    k.execute("UPDATE study_jobs SET status='pending'")
   self.assertIsNone(study.claim(db))
   self.assertEqual(study.status(db)['plannedWorks'],0)
   self.assertEqual(study.status(db)['scope'],'selected')
   self.assertEqual(study.quotes(db)['total'],2)
   with library.connect(db) as k,k:k.execute("UPDATE study_state SET value=? WHERE key='approved_work_ids'",(json.dumps(['new-novel']),))
   self.assertEqual(study.claim(db)['work_id'],'new-novel')
   self.assertEqual(study.status(db)['plannedWorks'],1)
if __name__=='__main__':unittest.main()
