import json,sqlite3,unittest
from unittest.mock import patch
from test_chat_threads import ChatTests
import ai_service,companion,companion_models,greeting_service,chat_threads

class GreetingTests(unittest.TestCase):
 setUp=ChatTests.setUp
 tearDown=ChatTests.tearDown
 post=ChatTests.post
 create=ChatTests.create
 def test_new_default_and_custom_profile_survive_initialization(self):
  p=self.client.get('/api/companion/settings').json['profile'];self.assertEqual(p['name'],'小溪')
  p.update(name='阿川',persona='沉稳的男性编辑',style='简短直接，不要姐姐语气')
  self.client.put('/api/companion/settings',json=p,headers=self.h)
  with sqlite3.connect(self.path) as db:companion.initialize(db);self.assertEqual(companion.profile(db)['name'],'阿川');self.assertEqual(companion.profile(db)['persona'],p['persona'])
 def test_legacy_defaults_migrate_without_erasing_custom_fields(self):
  with sqlite3.connect(self.path) as db:
   db.execute("DELETE FROM companion_meta WHERE key='xiaoxi-default-v1'");old={**companion.LEGACY_DEFAULT,'style':'我自己设置的回答风格'};db.execute('UPDATE companion_profile SET body=?',(json.dumps(old),));companion.initialize(db)
   p=companion.profile(db);self.assertEqual(p['name'],'小溪');self.assertEqual(p['style'],old['style'])
 def test_auth_invalid_mood_and_cache(self):
  self.assertEqual(self.app.test_client().post('/api/companion/greeting',json={'mood':'低落'},headers=self.h).status_code,401)
  self.assertEqual(self.post('/api/companion/greeting',{'mood':'bogus'}).status_code,400)
  with patch('ai_service.complete',return_value={'text':'想说的时候，我听着。','evidenceIds':[]}) as model:
   first=self.post('/api/companion/greeting',{'mood':'低落'});second=self.post('/api/companion/greeting',{'mood':'低落'})
   self.assertTrue(first.json['generated']);self.assertTrue(second.json['cached']);self.assertEqual(model.call_count,1)
 def test_custom_profile_used_and_invalidates_cache(self):
  with patch('ai_service.complete',return_value={'text':'今天想讨论哪个问题？','evidenceIds':[]}) as model:
   self.post('/api/companion/greeting',{'mood':''})
   p=self.client.get('/api/companion/settings').json['profile'];p.update(name='阿川',persona='沉稳的男性编辑',style='直接，少寒暄')
   self.client.put('/api/companion/settings',json=p,headers=self.h)
   r=self.post('/api/companion/greeting',{'mood':''});self.assertEqual(r.json['name'],'阿川');self.assertEqual(model.call_count,2);self.assertEqual(model.call_args.args[1]['profile']['persona'],p['persona'])
  with patch('ai_service.complete',side_effect=ai_service.AIError('busy')):
   r=self.post('/api/companion/greeting',{'mood':'疲惫'});self.assertEqual(r.json['text'],'');self.assertFalse(r.json['generated'])
 def test_deleted_memory_invalidates_cached_greeting(self):
  self.post('/api/companion/memories',{'text':'喜欢晚饭后散步'})
  with patch('ai_service.complete',return_value={'text':'今晚想出去走走吗？','evidenceIds':[]}) as model:
   self.post('/api/companion/greeting',{'mood':'平静'});self.assertTrue(model.call_args.args[1]['sources'])
   mid=self.client.get('/api/companion/settings').json['memories'][0]['id'];self.client.delete('/api/companion/memories/'+mid,json={},headers=self.h)
   self.post('/api/companion/greeting',{'mood':'平静'});self.assertEqual(model.call_count,2);self.assertEqual(model.call_args.args[1]['sources'],[])
 def test_reset_conversation_is_not_used_as_recent_memory(self):
  cid=self.create()
  with sqlite3.connect(self.path) as db:
   mid=chat_threads.add_message(db,cid,'user','我明天要面试');db.commit()
   self.assertTrue(greeting_service.payload(db,'期待')['sources'])
  self.client.delete('/api/conversations/'+cid+'/memory',json={},headers=self.h)
  with sqlite3.connect(self.path) as db:self.assertEqual(greeting_service.payload(db,'期待')['sources'],[])
 def test_deleted_memory_during_generation_is_not_returned(self):
  self.post('/api/companion/memories',{'text':'喜欢散步'})
  def model(task,data):
   with sqlite3.connect(self.path) as db:db.execute('DELETE FROM companion_memories')
   return {'text':'旧记忆不应继续显示。','evidenceIds':[]}
  with patch('ai_service.complete',side_effect=model):
   r=self.post('/api/companion/greeting',{'mood':''});self.assertFalse(r.json['generated']);self.assertEqual(r.json['text'],'')
 def test_evidence_must_exist_and_no_multiline(self):
  for v in [dict(text='你昨天说要去面试。',evidenceIds=['invented']),dict(text='第一句\n第二句',evidenceIds=[])]:
   with self.assertRaises(ValueError):companion_models.validate('greeting',v,{'sources':[]})
if __name__=='__main__':unittest.main()
