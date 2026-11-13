import copy,json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from werkzeug.security import generate_password_hash
import assistant_service as assistant
import reading_library as library
from cloud_app import create_app,EMPTY

class AssistantLibraryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=str(Path(self.temp.name)/'db');self.app=create_app(dict(TESTING=True,DB_PATH=self.path,PUBLIC_ORIGIN='http://localhost',SECURE_COOKIE=False,OWNER_HASH=generate_password_hash('test-password',method='pbkdf2:sha256:600000')));self.client=self.app.test_client();self.headers={'Origin':'http://localhost'};self.client.post('/api/login',json={'password':'test-password'},headers=self.headers)
 def tearDown(self):self.temp.cleanup()
 def post(self,path,data):return self.client.post('/api/assistant/'+path,json=data,headers=self.headers)
 def plan(self,actions,message='帮我创建一篇文章'):
  def completion(task,data):return assistant.validate(dict(reply='准备执行。',actions=actions),data)
  with patch('cloud_app.ai_service.complete',side_effect=completion):return self.post('chat',dict(message=message)).json
 def test_create_retry_current_version_and_conflict(self):
  plan=self.plan([dict(type='create_article',title='测试稿',content='测试正文',group='生活')]);self.assertEqual(self.client.get('/api/state').json['version'],0)
  first=self.post('apply',dict(planId=plan['planId'])).json;self.assertEqual(len(first['state']['articles']),1)
  second=self.post('apply',dict(planId=plan['planId'])).json;self.assertEqual(second['created'],first['created']);self.assertEqual(second['version'],1)
  stale=self.plan([dict(type='set_goal',value=500)],'将目标改成500字')
  state=copy.deepcopy(first['state']);state['goal']=600
  self.client.put('/api/state',json=dict(state=state,version=1),headers=self.headers)
  self.assertEqual(self.post('apply',dict(planId=stale['planId'])).status_code,409)
  retry=self.post('apply',dict(planId=plan['planId'])).json;self.assertEqual(retry['state']['goal'],600);self.assertEqual(retry['version'],2)
 def test_actual_actions_and_recovery(self):
  p=self.plan([dict(type='create_article',title='雨',content='窗外下起雨，树叶慢慢亮了。',group='')]);first=self.post('apply',dict(planId=p['planId'])).json;identifier=first['created'][0]
  p=self.plan([dict(type='group_articles',groups=[dict(name='自然',ids=[identifier])]),dict(type='summarize_articles',items=[dict(id=identifier,summary='雨中树叶的变化。')])],'把雨分进自然并归纳')
  result=self.post('apply',dict(planId=p['planId'])).json['state']['articles'][0];self.assertEqual(result['group'],'自然');self.assertTrue(result['summary'])
  p=self.plan([dict(type='trash_articles',ids=[identifier])],'删除《雨》');result=self.post('apply',dict(planId=p['planId'])).json;self.assertEqual(len(result['state']['articles']),0);self.assertEqual(result['state']['trash'][0]['id'],identifier)
  p=self.plan([dict(type='restore_articles',ids=[identifier])],'恢复《雨》');result=self.post('apply',dict(planId=p['planId'])).json;self.assertEqual(result['state']['articles'][0]['content'],'窗外下起雨，树叶慢慢亮了。')
 def test_validation_rejects_unknown_and_unrequested_deletion(self):
  data=dict(message='讨论一下这篇',context=dict(articles=[dict(id='a',title='雨')],trash=[],readingChoices=[dict(id='r')]))
  for action in [dict(type='trash_articles',ids=['a']),dict(type='open_article',id='missing'),dict(type='shell',command='bad'),dict(type='bookmark_readings',ids=['r'])]:
   with self.assertRaises(ValueError):assistant.validate(dict(reply='准备执行',actions=[action]),data)
  data['message']='删除《雨》';data['context']['articles'].append(dict(id='b',title='雨'))
  with self.assertRaises(ValueError):assistant.validate(dict(reply='准备执行',actions=[dict(type='trash_articles',ids=['a'])]),data)
 def test_library_complete_pagination_search_and_preferences(self):
  records=json.loads(Path('data/library-works.json').read_text());before=self.client.get('/api/state').json
  with sqlite3.connect(self.path) as db:library.import_records(db,records);library.import_records(db,records)
  first=self.client.get('/api/library').json;self.assertGreater(first['total'],990);self.assertEqual(len(first['items']),12);self.assertNotIn('body',first['items'][0])
  second=self.client.get('/api/library?page=2').json;self.assertFalse({r['id'] for r in first['items']}&{r['id'] for r in second['items']})
  self.assertEqual(self.client.get('/api/library?q=狂人日记').json['items'][0]['title'],'狂人日记')
  found=self.client.get('/api/library?q=白日依山尽').json;self.assertEqual(found['total'],1)
  work=self.client.get('/api/library/'+found['items'][0]['id']).json;self.assertTrue(work['body']);self.assertIn('github.com/chinese-poetry',work['sourceUrl'])
  self.assertEqual(self.client.get('/api/state').json,before)
  p=self.plan([dict(type='set_preferences',scope='reading',note='喜欢李白诗歌',genres=['诗歌'],authors=['李白'],types=[],keywords=[])],'以后多推荐李白诗歌');self.post('apply',dict(planId=p['planId']))
  self.assertEqual(self.client.get('/api/library').json['items'][0]['author'],'李白')
  with sqlite3.connect(self.path) as db:
   context=assistant.context(db,EMPTY,'我想读王维的诗',{})
   self.assertTrue(any(r['author']=='王维' for r in context['readingChoices']))
 def test_auth_and_csrf(self):
  other=self.app.test_client();self.assertEqual(other.get('/api/library').status_code,401);self.assertEqual(other.get('/api/assistant/history').status_code,401);self.assertEqual(self.client.post('/api/assistant/chat',json=dict(message='你好')).status_code,403)
if __name__=='__main__':unittest.main()
