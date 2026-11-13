import json,sqlite3,unittest
from unittest.mock import patch
from test_book_library import BookTests
import ai_service,chat_threads,reading_tools

class ReaderToolsTests(unittest.TestCase):
 setUp=BookTests.setUp
 tearDown=BookTests.tearDown
 def payload(self,**kw):return dict(workId=self.bid,chapter=1,text='章节正文1',**kw)
 def post(self,url,body):return self.c.post(url,json=body,headers={'Origin':'http://localhost'})
 def test_saved_excerpt_is_cloud_deduplicated_and_separate_from_drafts(self):
  with sqlite3.connect(self.path) as db:before=db.execute('SELECT version,body FROM state').fetchone()
  a=self.post('/api/excerpts',self.payload());b=self.post('/api/excerpts',self.payload());self.assertEqual(a.status_code,200);self.assertEqual(a.json['item']['id'],b.json['item']['id'])
  rows=self.c.get('/api/excerpts').json['items'];self.assertEqual(len(rows),1);self.assertEqual(rows[0]['chapter'],1);self.assertEqual(rows[0]['chapterTitle'],'第2章')
  self.c.delete('/api/excerpts/'+rows[0]['id'],json={},headers={'Origin':'http://localhost'});self.assertEqual(self.c.get('/api/excerpts').json['items'],[])
  with sqlite3.connect(self.path) as db:self.assertEqual(before,db.execute('SELECT version,body FROM state').fetchone())
 def test_rejects_wrong_chapter_fabricated_or_oversized_selection(self):
  for changes in [dict(text='不存在的文字'),dict(chapter=0),dict(text='a'*3001),dict(chapter=True)]:
   self.assertEqual(self.post('/api/excerpts',{**self.payload(),**changes}).status_code,400)
  with sqlite3.connect(self.path) as db:db.execute("UPDATE library_works SET status='archived' WHERE id=?",(self.bid,))
  self.assertEqual(self.post('/api/excerpts',self.payload()).status_code,400)
 def test_anonymous_excerpts_and_ai_are_protected(self):
  c=self.app.test_client();self.assertEqual(c.get('/api/excerpts').status_code,401);self.assertEqual(c.post('/api/reading/assist',json=self.payload(mode='interpret'),headers={'Origin':'http://localhost'}).status_code,401)
 def test_association_uses_stored_draft_not_client_injected_content(self):
  with sqlite3.connect(self.path) as db:
   state=json.loads(db.execute('SELECT body FROM state').fetchone()[0]);state['currentId']='my-draft';state['articles']=[dict(id='my-draft',title='窗边',content='窗边的旧灯还亮着。',status='draft',date='2026-11-03')];db.execute('UPDATE state SET body=?',(json.dumps(state),))
  with patch.object(ai_service,'complete',return_value={'summary':'灯与等待','interpretation':'照应结尾的灯。','writingHint':'写一个具体动作。'}) as call:
   r=self.post('/api/reading/assist',self.payload(mode='associate',article={'content':'伪造文章'}))
   self.assertEqual(r.status_code,200);self.assertEqual(call.call_args.args[1]['article']['content'],'窗边的旧灯还亮着。');self.assertEqual(call.call_args.args[1]['selection']['text'],'章节正文1')
  self.assertEqual(self.post('/api/reading/assist',self.payload(mode='associate',articleId='missing')).status_code,400)
 def test_chat_selection_survives_context_validation(self):
  value=chat_threads.context_value(dict(readingId=self.bid,readingSelection=self.payload()))
  self.assertEqual(value['readingSelection']['chapter'],1)
  with sqlite3.connect(self.path) as db:self.assertEqual(reading_tools.selection(db,value['readingSelection'])['text'],'章节正文1')
 def test_ai_output_has_three_distinct_parts(self):
  result={'summary':'概括','interpretation':'语句解读','writingHint':'写作提醒'}
  self.assertEqual(ai_service.validate('reading',result,{}),result)
  with self.assertRaises(ValueError):ai_service.validate('reading',{'text':'不完整'}, {})
  prompt,_=ai_service.prepare('reading',dict(mode='associate',selection={'text':'读者选段'},article={'content':'用户原稿'}));self.assertIn('文稿为核心',prompt)
 def test_association_rejects_invented_draft_anchors(self):
  value=dict(summary='灯光',interpretation='解读',writingHint='提醒',connections=[dict(anchor='他走进了雨里',suggestion='具体建议')]);data=dict(mode='associate',article={'content':'窗边的旧灯还亮着。'})
  with self.assertRaises(ValueError):ai_service.validate('reading',value,data)
  value['connections'][0]['anchor']='窗边的旧灯还亮着。'
  self.assertEqual(ai_service.validate('reading',value,data)['connections'][0]['anchor'],'窗边的旧灯还亮着。')
 def test_cloud_inspiration_quotes_are_present_in_library(self):
  r=self.c.get('/api/inspiration/library?cursor=3');self.assertEqual(r.status_code,200)
  with sqlite3.connect(self.path) as db:
   for s in r.json['items']:
    work=json.loads(db.execute('SELECT record FROM library_works WHERE id=?',(s['source']['readingId'],)).fetchone()[0]);self.assertIn(s['source']['quote'],'\n'.join(work['body']));self.assertEqual(s['source']['quote'].count('“'),s['source']['quote'].count('”'))

if __name__=='__main__':unittest.main()
