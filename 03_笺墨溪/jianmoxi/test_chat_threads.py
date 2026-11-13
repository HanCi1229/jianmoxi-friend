import copy,json,secrets,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from werkzeug.security import generate_password_hash
from cloud_app import create_app,EMPTY
import chat_threads,assistant_service,ai_service

class ChatTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=str(Path(self.temp.name)/'app.db')
  self.config=dict(TESTING=True,DB_PATH=self.path,PUBLIC_ORIGIN='http://localhost',SECURE_COOKIE=False,OWNER_HASH=generate_password_hash('qa-password',method='pbkdf2:sha256:600000'))
  self.app=create_app(self.config);self.client=self.app.test_client();self.h={'Origin':'http://localhost'}
  self.client.post('/api/login',json={'password':'qa-password'},headers=self.h)
 def tearDown(self):self.temp.cleanup()
 def post(self,url,data):return self.client.post(url,json=data,headers=self.h)
 def create(self,context=None):return self.post('/api/conversations',dict(context=context or {})).json['conversation']['id']
 def send(self,cid,text='聊聊写作',rid=None,actions=None):
  with patch('ai_service.complete',return_value=dict(reply='一起读写。',actions=actions or [])):
   return self.post('/api/conversations/'+cid+'/messages',dict(message=text,requestId=rid or secrets.token_hex(12)))
 def get(self,cid):return self.client.get('/api/conversations/'+cid).json
 def test_auth_csrf_and_validation(self):
  self.assertEqual(self.app.test_client().get('/api/conversations').status_code,401)
  self.assertEqual(self.client.post('/api/conversations',json={}).status_code,403)
  self.assertEqual(self.post('/api/conversations',dict(context=[])).status_code,400)
  cid=self.create()
  self.assertEqual(self.post('/api/conversations/'+cid+'/messages',[]).status_code,400)
  self.assertEqual(self.post('/api/conversations/'+cid+'/cancel',[]).status_code,400)
  self.assertEqual(self.client.patch('/api/conversations/'+cid,json=dict(title='changed',archived='bad'),headers=self.h).status_code,400)
  self.assertEqual(self.get(cid)['conversation']['title'],'新对话')
 def test_isolated_history_idempotency_and_restart(self):
  a,b=self.create(),self.create();rid=secrets.token_hex(12)
  self.assertEqual(self.send(a,'第一个话题',rid).status_code,200);self.send(a,'第一个话题',rid)
  self.assertEqual(len(self.get(a)['messages']),2)
  with patch('ai_service.complete',return_value=dict(reply='新的话题',actions=[])) as model:
   self.post('/api/conversations/'+b+'/messages',dict(message='第二个话题',requestId=secrets.token_hex(12)))
   self.assertEqual(model.call_args.args[1]['history'],[])
  with patch('ai_service.complete',return_value=dict(reply='接着聊',actions=[])) as model:
   self.post('/api/conversations/'+a+'/messages',dict(message='继续',requestId=secrets.token_hex(12)))
   self.assertEqual(model.call_args.args[1]['history'][0]['text'],'第一个话题')
   self.assertNotIn('第二个话题',str(model.call_args.args[1]['history']))
  create_app(self.config)
  self.assertEqual(len(self.get(a)['messages']),4)
  self.assertNotIn('legacy',[t['id'] for t in self.client.get('/api/conversations').json['conversations']])
 def test_migration_and_rename_restore(self):
  with sqlite3.connect(self.path) as db:db.execute("INSERT INTO assistant_messages(role,text,created_at) VALUES ('user','旧消息','1')")
  create_app(self.config);create_app(self.config)
  self.assertEqual(len(self.get('legacy')['messages']),1)
  cid=self.create();self.send(cid,'诗歌')
  self.client.patch('/api/conversations/'+cid,json=dict(title='诗歌练习',archived=True),headers=self.h)
  self.assertNotIn(cid,[t['id'] for t in self.client.get('/api/conversations').json['conversations']])
  self.assertEqual(self.send(cid).status_code,404)
  self.assertEqual(self.client.get('/api/conversations?archived=1').json['conversations'][0]['title'],'诗歌练习')
  self.client.patch('/api/conversations/'+cid,json=dict(archived=False),headers=self.h)
  self.assertEqual(len(self.get(cid)['messages']),2)
 def test_cancel_before_and_during_model_blocks_actions(self):
  cid=self.create();rid=secrets.token_hex(12)
  self.post('/api/conversations/'+cid+'/cancel',dict(requestId=rid))
  self.assertTrue(self.send(cid,rid=rid).json['stopped']);self.assertEqual(self.get(cid)['messages'],[])
  rid=secrets.token_hex(12)
  def model(*args):
   with sqlite3.connect(self.path) as db:db.execute("UPDATE assistant_runs SET status='cancelled' WHERE id=?",(rid,))
   return dict(reply='不应显示',actions=[dict(type='set_goal',value=500)])
  with patch('ai_service.complete',side_effect=model):r=self.post('/api/conversations/'+cid+'/messages',dict(message='目标500字',requestId=rid))
  self.assertTrue(r.json['stopped']);self.assertEqual([m['role'] for m in self.get(cid)['messages']],['user'])
  rid=secrets.token_hex(12);result=self.send(cid,rid=rid,actions=[dict(type='set_goal',value=500)]).json
  self.post('/api/conversations/'+cid+'/cancel',dict(requestId=rid))
  self.assertEqual(self.post('/api/assistant/apply',dict(planId=result['planId'])).status_code,409)
  self.assertEqual(self.client.get('/api/state').json['state']['goal'],300)
 def test_action_receipt_persistence_and_stale_plan(self):
  cid=self.create();rid=secrets.token_hex(12)
  r=self.send(cid,rid=rid,actions=[dict(type='create_article',title='雨',content='雨停了。',group='自然')]).json
  applied=self.post('/api/assistant/apply',dict(planId=r['planId']));self.assertEqual(applied.status_code,200)
  self.assertEqual(self.get(cid)['messages'][-1]['links'][0]['title'],'雨')
  self.post('/api/assistant/apply',dict(planId=r['planId']))
  self.assertEqual(len(self.get(cid)['messages']),3)
  self.assertEqual(self.post('/api/conversations/'+cid+'/cancel',dict(requestId=rid)).status_code,409)
  r=self.send(cid,actions=[dict(type='set_goal',value=500)]).json
  state=self.client.get('/api/state').json;state['state']['goal']=600
  self.client.put('/api/state',json=state,headers=self.h)
  self.assertEqual(self.post('/api/assistant/apply',dict(planId=r['planId'])).status_code,409)
  self.assertEqual(self.client.get('/api/state').json['state']['goal'],600)
 def test_model_error_is_visible_and_retriable(self):
  cid=self.create()
  with patch('ai_service.complete',side_effect=ai_service.AIError('暂时不可用',502)):
   r=self.post('/api/conversations/'+cid+'/messages',dict(message='继续聊',requestId=secrets.token_hex(12)))
  self.assertEqual(r.status_code,502);self.assertEqual(self.get(cid)['messages'][-1]['retry'],'继续聊')
  self.assertEqual(self.send(cid).status_code,200)

if __name__=='__main__':unittest.main()
