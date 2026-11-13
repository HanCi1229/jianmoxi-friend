import copy,json,secrets,sqlite3,unittest
from unittest.mock import patch
from test_assistant_library import AssistantLibraryTests
import assistant_service as assistant,inspiration_creation as creation,library_knowledge as library,reading_library

Q1='窗外的树叶照着阳光，清晨的风经过这里，少年的信始终没有寄出去。'
Q2='有人在很远的地方为你留了一盏灯，纵使长夜未尽，归途仍有光亮。'
class CreationTests(unittest.TestCase):
 setUpBase=AssistantLibraryTests.setUp
 tearDown=AssistantLibraryTests.tearDown
 def setUp(self):
  self.setUpBase()
  with sqlite3.connect(self.path) as db:
   reading_library.import_records(db,[dict(id='new-novel',title='龙族测试本',author='测试作者',genre='网络小说',sourceUrl='https://zh.wikisource.org/wiki/test',body=[Q1,Q2])])
   db.execute('INSERT INTO image_assets(id,body,sha256) VALUES (?,?,?)',('gh-scene',json.dumps(dict(id='gh-scene',tags=['sky','anime'])), 'test-image'))
   db.commit();library.build(db)
  self.context=None
 def plan(self,message='从龙族测试本做一批灵感卡片',mode='excerpt'):
  cid=self.client.post('/api/conversations',json={},headers=self.headers).json['conversation']['id']
  def model(task,data):
   if task=='research_plan':return dict(search=False,titles=['龙族测试本'],queries=[],chapters=[])
   self.context=data
   sources=data.get('research',{}).get('sources',[])
   source=next((r for r in sources if r['workId']=='new-novel'),None)
   items=[dict(quote=q,sourceId=source['id'] if source else 'P999999',quality='文笔',summary='写给远方的灯',interpretation='以灯与长夜的意象表达等待，注意这只是片段的解读。',themes=['日常与慰藉']) for q in ((Q1,Q2) if mode=='excerpt' else ('等风停的时候，也可以先为自己泡一杯热茶。','把今天没来得及说的话留在纸上，明天再慢慢读。'))]
   return assistant.validate(dict(reply='我来制作这批卡片。',actions=[dict(type='create_inspiration_cards',mode=mode,items=items)]),data)
  with patch('ai_service.complete',side_effect=model):
   response=self.client.post('/api/conversations/'+cid+'/messages',json=dict(message=message,requestId=secrets.token_hex(12)),headers=self.headers)
  self.assertEqual(response.status_code,200,response.json)
  return response.json
 def apply(self,plan):return self.client.post('/api/assistant/apply',json={'planId':plan['planId']},headers=self.headers)
 def test_novel_without_preset_creates_persists_and_returns_immediate_cards(self):
  state=self.client.get('/api/state').json
  prefs=dict(authors=['鲁迅'],onlyAuthors=True,maxPerAuthor=1)
  state['state']['preferences']['inspiration']=prefs
  self.assertEqual(self.client.put('/api/state',json=state,headers=self.headers).status_code,200)
  plan=self.plan()
  with sqlite3.connect(self.path) as db:self.assertEqual(db.execute('SELECT count(*) FROM created_inspirations').fetchone()[0],0)
  response=self.apply(plan);self.assertEqual(response.status_code,200,response.json)
  cards=response.json['inspirationFeed']['items'];self.assertEqual(len(cards),2)
  self.assertTrue(all(r['source']['verified'] and r['source']['readingId']=='new-novel' and r['coverId']=='gh-scene' for r in cards))
  self.assertEqual({r['source']['quote'] for r in cards},{Q1,Q2})
  for k,v in prefs.items():self.assertEqual(response.json['state']['preferences']['inspiration'][k],v)
  self.assertEqual(response.json['state']['articles'],state['state']['articles'])
  self.assertEqual(self.client.get('/api/inspiration/library').json['items'],cards)
  again=self.apply(plan);self.assertTrue(again.json['alreadyApplied']);self.assertEqual(again.json['inspirationFeed']['items'],cards)
  with sqlite3.connect(self.path) as db:
   self.assertEqual(db.execute('SELECT count(*) FROM created_inspirations').fetchone()[0],2)
   self.assertEqual(len(library.cached_inspirations(db)),2)
 def test_unrequested_or_unverified_creation_rejected(self):
  self.plan();data=self.context
  item=dict(sourceId=data['research']['sources'][0]['id'],quote='这句话从来没有出现在本次提供的原文当中。',quality='文笔',summary='概括',interpretation='解读',themes=['日常与慰藉'])
  action=dict(type='create_inspiration_cards',mode='excerpt',items=[item])
  with self.assertRaises(ValueError):assistant.validate(dict(reply='制作',actions=[action]),data)
  item['quote']=Q1
  with self.assertRaises(ValueError):assistant.validate(dict(reply='制作',actions=[action]),{**data,'message':'这本书写得怎么样'})
  action['mode']='original'
  with self.assertRaises(ValueError):assistant.validate(dict(reply='制作',actions=[action]),data)
 def test_source_removed_between_generation_and_apply_rolls_back(self):
  plan=self.plan();before=self.client.get('/api/state').json
  with sqlite3.connect(self.path) as db:db.execute("UPDATE library_works SET status='archived' WHERE id='new-novel'")
  self.assertEqual(self.apply(plan).status_code,409)
  self.assertEqual(self.client.get('/api/state').json,before)
  with sqlite3.connect(self.path) as db:self.assertEqual(db.execute('SELECT count(*) FROM created_inspirations').fetchone()[0],0)
 def test_partial_batch_is_rolled_back_when_later_quote_changes(self):
  plan=self.plan();before=self.client.get('/api/state').json
  with sqlite3.connect(self.path) as db:
   record=json.loads(db.execute("SELECT record FROM library_works WHERE id='new-novel'").fetchone()[0]);record['body']=[Q1]
   db.execute("UPDATE library_works SET record=? WHERE id='new-novel'",(json.dumps(record),))
  self.assertEqual(self.apply(plan).status_code,409)
  self.assertEqual(self.client.get('/api/state').json,before)
  with sqlite3.connect(self.path) as db:self.assertEqual(db.execute('SELECT count(*) FROM created_inspirations').fetchone()[0],0)
 def test_changed_book_hash_hides_old_generated_cards(self):
  self.apply(self.plan())
  with sqlite3.connect(self.path) as db:db.execute("UPDATE library_works SET body_hash='changed' WHERE id='new-novel'")
  self.assertEqual(self.client.get('/api/inspiration/library').json['items'],[])
 def test_originals_have_custom_companion_identity_and_no_fake_source(self):
  profile=self.client.get('/api/companion/settings').json['profile'];profile['name']='阿川'
  self.client.put('/api/companion/settings',json=profile,headers=self.headers)
  result=self.apply(self.plan('帮我原创一批灵感卡片',mode='original'))
  self.assertEqual(result.status_code,200,result.json)
  rows=result.json['inspirationFeed']['items'];self.assertEqual(len(rows),2)
  for r in rows:
   self.assertEqual(r['source']['author'],'阿川');self.assertEqual(r['source']['work'],'AI 原创');self.assertFalse(r['source']['verified']);self.assertNotIn('readingId',r['source'])
  self.assertEqual(len(self.client.get('/api/inspiration/library').json['items']),2)
 def test_cancelled_plan_cannot_save_cards(self):
  plan=self.plan()
  with sqlite3.connect(self.path) as db:db.execute("UPDATE assistant_runs SET status='cancelled' WHERE plan_id=?",(plan['planId'],))
  self.assertEqual(self.apply(plan).status_code,409)
  with sqlite3.connect(self.path) as db:self.assertEqual(db.execute('SELECT count(*) FROM created_inspirations').fetchone()[0],0)
if __name__=='__main__':unittest.main()
