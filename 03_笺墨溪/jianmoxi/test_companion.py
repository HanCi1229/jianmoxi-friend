import json,sqlite3,secrets,unittest
from unittest.mock import patch
from test_chat_threads import ChatTests
from test_book_library import BookTests
import ai_service,assistant_service,companion,companion_models,library_knowledge

class MemoryTests(unittest.TestCase):
 setUp=ChatTests.setUp
 tearDown=ChatTests.tearDown
 post=ChatTests.post
 create=ChatTests.create
 get=ChatTests.get
 def test_settings_version_auth_and_persistent_profile(self):
  self.assertEqual(self.app.test_client().get('/api/companion/settings').status_code,401)
  d=self.client.get('/api/companion/settings').json;p=d['profile'];p.update(name='溪溪',persona='认真但不敷衍的阅读搭子',style='先说重点，再引原文')
  r=self.client.put('/api/companion/settings',json=p,headers=self.h);self.assertEqual(r.status_code,200)
  self.assertEqual(self.client.put('/api/companion/settings',json=p,headers=self.h).status_code,409)
  self.post('/api/companion/memories',{'text':'喜欢人物心理分析'})
  with sqlite3.connect(self.path) as db:
   state=json.loads(db.execute('SELECT body FROM state').fetchone()[0]);ctx=assistant_service.context(db,state,'你好',{})
   self.assertEqual(ctx['companion']['profile']['name'],'溪溪');self.assertEqual(ctx['companion']['longTermMemory'][0]['text'],'喜欢人物心理分析')
  mid=self.client.get('/api/companion/settings').json['memories'][0]['id']
  self.client.patch('/api/companion/memories/'+mid,json={'text':'更喜欢简洁回答'},headers=self.h)
  self.assertEqual(self.client.get('/api/companion/settings').json['memories'][0]['text'],'更喜欢简洁回答')
  self.client.delete('/api/companion/memories/'+mid,json={},headers=self.h)
  self.assertEqual(self.client.get('/api/companion/settings').json['memories'],[])
 def test_turn_summary_history_reset_and_memory_write(self):
  cid=self.create()
  def model(task,data):
   if task=='research_plan':return dict(search=False)
   return dict(reply='记住了。',actions=[],thinkingSummary='按你明确的偏好更新。',citations=[],conversationSummary='正在聊写作风格。',memoryUpdates=[dict(text='喜欢简短回答',evidence='我喜欢简短回答')])
  with patch('ai_service.complete',side_effect=model):
   r=self.post('/api/conversations/'+cid+'/messages',dict(message='请记住，我喜欢简短回答',requestId=secrets.token_hex(12)))
  self.assertEqual(r.status_code,200);self.assertEqual(len(r.json['savedMemories']),1)
  self.assertEqual(self.client.get('/api/conversations/'+cid+'/memory').json['summary'],'正在聊写作风格。')
  other=self.create();self.assertEqual(self.client.get('/api/conversations/'+other+'/memory').json['summary'],'')
  self.client.delete('/api/conversations/'+cid+'/memory',json={},headers=self.h)
  with patch('ai_service.complete',side_effect=model) as call:
   self.post('/api/conversations/'+cid+'/messages',dict(message='你好',requestId=secrets.token_hex(12)))
   payload=call.call_args.args[1];self.assertEqual(payload['history'],[]);self.assertEqual(payload['shortTermMemory'],'')
   self.assertEqual(payload['context']['companion']['longTermMemory'][0]['text'],'喜欢简短回答')
  self.assertEqual(len(self.get(cid)['messages']),4)
 def test_cancelled_reply_cannot_write_memory(self):
  cid=self.create();rid=secrets.token_hex(12)
  def model(task,data):
   if task=='research_plan':return dict(search=False)
   with sqlite3.connect(self.path) as db:db.execute("UPDATE assistant_runs SET status='cancelled' WHERE id=?",(rid,))
   return dict(reply='不应保存',actions=[],conversationSummary='不应保存',memoryUpdates=[dict(text='偏好测试',evidence='记住偏好测试')])
  with patch('ai_service.complete',side_effect=model):r=self.post('/api/conversations/'+cid+'/messages',dict(message='记住偏好测试',requestId=rid))
  self.assertTrue(r.json['stopped']);self.assertEqual(self.client.get('/api/companion/settings').json['memories'],[])
 def test_optional_cache_failure_does_not_lose_the_answer(self):
  cid=self.create()
  def model(task,data):return dict(search=True,overview=True) if task=='research_plan' else dict(reply='有出处的回答。',actions=[])
  with patch('ai_service.complete',side_effect=model),patch('library_knowledge.retrieve',return_value=dict(books=[],sources=[])),patch('library_knowledge.connect',side_effect=sqlite3.OperationalError('readonly')):
   r=self.post('/api/conversations/'+cid+'/messages',dict(message='全书概览',requestId=secrets.token_hex(12)))
  self.assertEqual(r.status_code,200);self.assertEqual(self.get(cid)['messages'][-1]['text'],'有出处的回答。')
 def test_memory_requires_current_user_evidence_and_skips_secrets(self):
  with sqlite3.connect(self.path) as db:
   for message,entry in [('分析这个人物',dict(text='用户喜欢犯罪',evidence='分析这个人物')),('记住我的密码12345',dict(text='密码12345',evidence='密码12345')),('记住我喜欢散文',dict(text='偏好诗歌',evidence='我喜欢诗歌'))]:
    self.assertEqual(companion.save_turn(db,'x',message,dict(memoryUpdates=[entry])),[])

class KnowledgeTests(unittest.TestCase):
 setUp=BookTests.setUp
 tearDown=BookTests.tearDown
 def build(self):
  with sqlite3.connect(self.path) as db:
   import zlib
   db.execute('UPDATE library_chapters SET body=? WHERE work_id=? AND chapter=1',(zlib.compress(json.dumps(['路明非在雨夜想起那封没有寄出的信。孤独在窗边停了很久。']).encode()),self.bid));db.commit()
   return library_knowledge.build(db)
 def test_all_chapters_are_indexed_and_exact_source_can_be_opened(self):
  self.build()
  with sqlite3.connect(self.path) as db:
   r=library_knowledge.retrieve(db,'路明非的信',{},dict(queries=['路明非','信'],titles=[],chapters=[]))
   self.assertTrue(r['sources']);s=next(s for s in r['sources'] if '路明非' in s['text']);self.assertEqual(s['chapter'],1)
   self.assertEqual(s['author'],'验收作者')
   citations=library_knowledge.validated_citations([dict(sourceId=s['id'],quote='路明非在雨夜想起那封没有寄出的信。')],r)
   self.assertEqual(citations[0]['chapterTitle'],'第2章')
   for quote in ['虚构的原文','路明非在雨夜…孤独']:
    with self.assertRaises(ValueError):library_knowledge.validated_citations([dict(sourceId=s['id'],quote=quote)],r)
   with self.assertRaises(ValueError):library_knowledge.validated_citations([dict(sourceId='not-indexed',quote='路明非')],r)
   selected=library_knowledge.retrieve(db,'这三章',{'readingId':self.bid},dict(queries=[],titles=[],chapters=[0,1,2]))
   self.assertTrue({0,1,2}.issubset({s['chapter'] for s in selected['sources']}))
   overview=library_knowledge.retrieve(db,'全书概括',{'readingId':self.bid,'chapter':1},dict(overview=True,queries=[],chapters=[]))
   self.assertTrue({0,101}.issubset({s['chapter'] for s in overview['sources']}))
   db.execute("UPDATE library_works SET status='archived' WHERE id=?",(self.bid,));db.commit()
   r=library_knowledge.retrieve(db,'路明非',{},dict(queries=['路明非']));self.assertFalse(r['sources'])
 def test_new_library_import_updates_existing_index(self):
  self.build()
  import reading_library
  with sqlite3.connect(self.path) as db:
   reading_library.import_records(db,[dict(id='new-after-index',title='新添的书',author='验收作者',sourceUrl='https://zh.wikisource.org/wiki/test',genre='散文',body=['晨光照着青石阶，雨后的石阶上放着一盏旧灯，灯光一直没有熄灭。'])])
   r=library_knowledge.retrieve(db,'青石阶',{},dict(queries=['青石阶']))
   self.assertTrue(any(s['workId']=='new-after-index' for s in r['sources']))
 def test_curated_quote_must_be_contiguous_and_keeps_chapter(self):
  s=dict(id='P1',workId='book1',title='雨夜',author='作者',genre='散文',chapter=3,chapterTitle='第四章',sourceUrl='https://example.com',text='路明非在雨夜想起那封没有寄出的信。孤独在窗边停了很久。',classical=False)
  row=dict(sourceId='P1',quality='文笔',quote='路明非在雨夜想起那封没有寄出的信。',summary='等待',interpretation='借未寄出的信表现迟疑。',writingHint='从没有寄出的信写起。',themes=['孤独与自我'])
  r=companion_models.validate('library_inspiration',{'items':[row]},{'sources':[s]})['items'][0];self.assertEqual(r['source']['chapter'],3);self.assertEqual(r['source']['author'],'作者')
  row['quote']='路明非在雨夜想起那封没有寄出的信!'
  recovered=companion_models.validate('library_inspiration',{'items':[row]},{'sources':[s]})['items'][0]['source']['quote'];self.assertIn(recovered,s['text'])
  row['quote']='路明非在雨夜想起信，孤独在窗边停了很久。'
  with self.assertRaises(ValueError):companion_models.validate('library_inspiration',{'items':[row]},{'sources':[s]})
 def test_cached_feed_rejects_old_policy_and_diversifies_authors(self):
  self.build()
  with sqlite3.connect(self.path) as db,library_knowledge.connect(db) as k:
   record=json.loads(db.execute('SELECT record FROM library_works WHERE id=?',(self.bid,)).fetchone()[0]);record['genre']='散文';db.execute('UPDATE library_works SET record=? WHERE id=?',(json.dumps(record),self.bid));db.commit()
   for i in range(8):
    item=dict(id='x'+str(i),classical=False,editorialPolicy=library_knowledge.LITERARY_POLICY if i>=4 else 'old',source=dict(readingId=self.bid,author='作者'+str(i),work='测试作品',verified=True,quote='这是用于核对来源边界的文学摘句测试文本。'+str(i)))
    k.execute('INSERT INTO inspirations VALUES (?,?,?,?)',(item['id'],self.bid,json.dumps(item),i))
   k.commit();items=library_knowledge.cached_inspirations(db,0)
   self.assertEqual(len(items),4);self.assertTrue(all(x['editorialPolicy']==library_knowledge.LITERARY_POLICY for x in items))

 def test_literary_source_boundary(self):
  self.assertTrue(library_knowledge.literary_eligible(dict(genre='散文',author='作者')))
  self.assertTrue(library_knowledge.literary_eligible(dict(genre='小说',author='余华')))
  for genre in ['网络小说','诗歌','歌词','电影','古文']:
   self.assertFalse(library_knowledge.literary_eligible(dict(genre=genre,author='鲁迅')))
  self.assertFalse(library_knowledge.literary_eligible(dict(genre='小说',author='未入选作者')))

if __name__=='__main__':unittest.main()
