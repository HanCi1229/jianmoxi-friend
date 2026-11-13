import json,sqlite3,unittest
from unittest.mock import patch
from test_inspiration_creation import CreationTests,Q1
import reading_guide as guide,assistant_service as assistant,ai_service

class ReadingGuideTests(unittest.TestCase):
 setUp=CreationTests.setUp
 setUpBase=CreationTests.setUpBase
 tearDown=CreationTests.tearDown
 def model(self,task,data):
  self.assertEqual(task,'reading_recommendation')
  source=next(s for s in data['sources'] if s['workId']=='new-novel')
  return ai_service.validate('reading_recommendation',dict(ids=['new-novel'],quote=dict(sourceId=source['id'],text=Q1),reason='从安静的意象开始今天的阅读。'),data)
 def post(self,body=None):return self.client.post('/api/reading/recommendation',json=body or dict(mood='平静',recentIds=['new-novel']),headers=self.headers)
 def test_daily_quote_is_verified_cached_and_does_not_change_user_state(self):
  before=self.client.get('/api/state').json
  with patch('ai_service.complete',side_effect=self.model) as model:
   r=self.post();self.assertEqual(r.status_code,200,r.json);q=r.json['recommendation']['quote'];self.assertEqual(q['quote'],Q1);self.assertEqual(q['workId'],'new-novel');self.assertEqual(len(q['quote'])<=36,True)
   self.assertEqual(self.post().json,r.json);self.assertEqual(model.call_count,1)
  self.assertEqual(self.client.get('/api/state').json,before)
  self.assertEqual(self.client.get('/api/reading/recommendation').json['recommendation']['quote'],q)
 def test_chat_action_updates_quote_and_books_without_saving_preferences(self):
  before=self.client.get('/api/state').json
  def model(task,data):
   g=data['context']['readingGuide'];s=next(s for s in g['sources'] if s['workId']=='new-novel')
   self.assertEqual(g['mood'],'疲惫');self.assertIn('new-novel',g['recentIds'])
   return assistant.validate(dict(reply='这次先读一本轻一点的。',actions=[dict(type='recommend_reading',ids=['new-novel'],quote=dict(sourceId=s['id'],text=Q1),reason='今天从一段安静的文字开始。')]),data)
  with patch('ai_service.complete',side_effect=model):plan=self.client.post('/api/assistant/chat',json=dict(message='今天想读轻松一点，帮我推荐',selection=dict(page='reading',mood='疲惫',recentIds=['new-novel'])),headers=self.headers).json
  r=self.client.post('/api/assistant/apply',json=dict(planId=plan['planId']),headers=self.headers)
  self.assertEqual(r.status_code,200,r.json);self.assertEqual(r.json['readingRecommendation']['ids'],['new-novel']);self.assertTrue(r.json['readingRecommendation']['manual'])
  self.assertEqual(r.json['state']['preferences'],before['state']['preferences']);self.assertEqual(r.json['state']['articles'],before['state']['articles'])
  again=self.client.post('/api/assistant/apply',json=dict(planId=plan['planId']),headers=self.headers);self.assertEqual(again.json['readingRecommendation'],r.json['readingRecommendation'])
  with patch('ai_service.complete',side_effect=AssertionError('Manual choice must survive reload')):self.assertEqual(self.post().json['recommendation'],r.json['readingRecommendation'])
  self.assertGreater(self.client.get('/api/library').json['total'],1)
 def test_transient_request_cannot_silently_change_long_term_reading_preferences(self):
  data=dict(message='今天想读轻松一点',context=dict(articles=[],trash=[],readingChoices=[]))
  action=dict(type='set_preferences',scope='reading',authors=[],genres=[],types=[],keywords=['轻松'])
  with self.assertRaises(ValueError):assistant.validate(dict(reply='已保存',actions=[action]),data)
  data['message']='以后阅读默认推荐轻松一点的'
  self.assertEqual(assistant.validate(dict(reply='调整偏好',actions=[action]),data)['actions'][0]['keywords'],['轻松'])
 def test_bad_source_long_quote_and_unrelated_book_rejected(self):
  with sqlite3.connect(self.path) as db:g=guide.build_context(db,json.loads(db.execute('SELECT body FROM state').fetchone()[0]),recentIds=['new-novel'])
  s=next(s for s in g['sources'] if s['workId']=='new-novel')
  for q,ids in [(dict(sourceId='P999999',text=Q1),['new-novel']),(dict(sourceId=s['id'],text='这句并不在来源里面。'),['new-novel']),(dict(sourceId=s['id'],text=Q1),['missing'])]:
   with self.assertRaises(ValueError):guide.validate(dict(ids=ids,quote=q,reason='理由'),g)
 def test_stale_background_recommendation_cannot_replace_chat_choice(self):
  def model(task,data):
   result=self.model(task,data)
   with sqlite3.connect(self.path) as db:guide.save(db,{**result,'reason':'对话里刚选定的书单'},manual=True);db.commit()
   return {**result,'reason':'较早发出的自动推荐'}
  with patch('ai_service.complete',side_effect=model):r=self.post()
  self.assertEqual(r.status_code,200);self.assertEqual(r.json['recommendation']['reason'],'对话里刚选定的书单')
 def test_deleted_work_is_not_kept_in_header(self):
  with patch('ai_service.complete',side_effect=self.model):self.post()
  with sqlite3.connect(self.path) as db:db.execute("UPDATE library_works SET status='archived' WHERE id='new-novel'")
  self.assertIsNone(self.client.get('/api/reading/recommendation').json['recommendation'])
 def test_auth_csrf_and_input_validation(self):
  self.assertEqual(self.app.test_client().get('/api/reading/recommendation').status_code,401)
  self.assertEqual(self.client.post('/api/reading/recommendation',json={}).status_code,403)
  self.assertEqual(self.post({'mood':'not-a-mood'}).status_code,400)
if __name__=='__main__':unittest.main()
