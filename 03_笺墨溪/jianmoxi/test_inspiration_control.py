import collections,copy,json,sqlite3,unittest
from unittest.mock import patch
from test_daily_inspiration import DailyInspirationTests
from test_assistant_library import AssistantLibraryTests
import library_knowledge as library,inspiration_preferences as policy,assistant_service as assistant

class PreferenceRankingTests(unittest.TestCase):
 setUp=DailyInspirationTests.setUp
 tearDown=DailyInspirationTests.tearDown
 def test_block_reduce_and_author_caps_are_enforced(self):
  rows=library.cached_inspirations(self.db,preferences={'excludedAuthors':['鲁迅'],'reducedAuthors':['史铁生'],'maxPerAuthor':3})
  self.assertEqual(collections.Counter(r['source']['author'] for r in rows),{'萧红':3,'史铁生':1})
 def test_ai_selection_is_exact_ordered_and_expires_next_day(self):
  prefs={'selectedIds':['7','0','3'],'selectionDay':'2026-11-04','excludedAuthors':['萧红']}
  rows=library.cached_inspirations(self.db,day='2026-11-04',preferences=prefs);self.assertEqual([r['id'] for r in rows],['0','3'])
  tomorrow=library.cached_inspirations(self.db,day='2026-11-05',preferences=prefs);self.assertGreater(len(tomorrow),2);self.assertTrue(all(r['source']['author']!='萧红' for r in tomorrow))
 def test_no_matches_never_falls_back_to_unwanted_quotes(self):
  for prefs in [{'authors':['不存在的作者'],'onlyAuthors':True},{'selectedIds':[],'selectionDay':policy.today()},{'origin':'foreign','onlyOrigin':True},{'avoidKeywords':['阳光']}]:
   self.assertEqual(library.cached_inspirations(self.db,preferences=prefs),[])
 def test_soft_origin_preference_keeps_other_authors(self):
  rows=library.cached_inspirations(self.db,preferences={'origin':'foreign'})
  self.assertEqual(len(rows),30)

class PreferenceApplyTests(unittest.TestCase):
 setUp=AssistantLibraryTests.setUp
 tearDown=AssistantLibraryTests.tearDown
 def validated(self,action):
  context={'articles':[],'trash':[],'readingChoices':[],'inspirationChoices':[{'id':'book-real'}],'preferences':{'inspiration':{'excludedAuthors':['鲁迅']}}}
  return assistant.validate({'reply':'我来调整。','actions':[action]},{'message':'灵感少一些史铁生，今天选这一条','context':context})
 def test_real_action_reaches_state_and_feed_and_receipt(self):
  action={'type':'set_preferences','scope':'inspiration','reducedAuthors':['史铁生'],'selectedIds':['book-real']}
  clean=self.validated(action)['actions'][0];self.assertEqual(clean['excludedAuthors'],['鲁迅'])
  with patch('cloud_app.ai_service.complete',return_value={'reply':'我来调整。','actions':[clean]}):
   plan=self.client.post('/api/assistant/chat',json={'message':'灵感少一些史铁生'},headers=self.headers).json
  result=self.client.post('/api/assistant/apply',json={'planId':plan['planId']},headers=self.headers)
  self.assertEqual(result.status_code,200);saved=result.json['state']['preferences']['inspiration'];self.assertEqual(saved['selectedIds'],['book-real']);self.assertEqual(saved['excludedAuthors'],['鲁迅'])
  feed=self.client.get('/api/inspiration/library').json;self.assertEqual(feed['items'],[]);self.assertIn('没有符合',feed['status']);self.assertTrue(any('没有符合' in r for r in result.json['receipts']));self.assertEqual(result.json['inspirationFeed']['items'],feed['items'])
  state=self.client.get('/api/state').json
  self.assertEqual(self.client.put('/api/state',json=state,headers=self.headers).status_code,200)
 def test_saved_preferences_change_actual_home_feed(self):
  import reading_library
  with sqlite3.connect(self.path) as db:
   works=[dict(id='control-'+str(i),title='测试作品'+str(i),author=author,genre='散文',sourceUrl='https://zh.wikisource.org/wiki/test',body=['窗外的树叶照着阳光，清晨的风经过这里，这是用于核验的正文。']) for i,author in enumerate(['鲁迅','史铁生','萧红'])]
   reading_library.import_records(db,works)
   with library.connect(db,True) as k,k:
    for i,w in enumerate(works):
     row=dict(id='control-quote-'+str(i),editorialPolicy=library.LITERARY_POLICY,source=dict(readingId=w['id'],author=w['author'],work=w['title'],quote=w['body'][0]+str(i),verified=True))
     k.execute('INSERT INTO inspirations VALUES (?,?,?,?)',(row['id'],w['id'],json.dumps(row),i))
  clean=self.validated({'type':'set_preferences','scope':'inspiration','reducedAuthors':['史铁生']})['actions'][0]
  with patch('cloud_app.ai_service.complete',return_value={'reply':'我来调整。','actions':[clean]}):
   plan=self.client.post('/api/assistant/chat',json={'message':'灵感不要鲁迅'},headers=self.headers).json
  result=self.client.post('/api/assistant/apply',json={'planId':plan['planId']},headers=self.headers);self.assertEqual(result.status_code,200)
  rows=self.client.get('/api/inspiration/library').json['items'];self.assertEqual(result.json['inspirationFeed']['items'],rows);self.assertEqual({r['source']['author'] for r in rows},{'史铁生','萧红'})
  again=self.client.post('/api/assistant/apply',json={'planId':plan['planId']},headers=self.headers);self.assertTrue(again.json['alreadyApplied']);self.assertEqual(again.json['inspirationFeed']['items'],rows)
  self.assertEqual(self.client.get('/api/state').json['state']['articles'],[])
 def test_refresh_context_excludes_current_cards_but_discussion_keeps_them(self):
  state=self.client.get('/api/state').json['state']
  pool=[dict(id=str(i),source=dict(author='作者',work='作品',quote='真实语录',readingId='work')) for i in range(3)]
  with sqlite3.connect(self.path) as db,patch('library_knowledge.inspiration_pool',return_value=pool),patch('library_knowledge.cached_inspirations',return_value=pool[:2]):
   refresh=assistant.context(db,state,'更新一下灵感卡片',{})
   self.assertEqual([r['id'] for r in refresh['inspirationChoices']],['2'])
   self.assertEqual(refresh['inspirationRefresh']['currentIds'],['0','1'])
   discussion=assistant.context(db,state,'不要更新灵感卡片，解释这句',{})
   self.assertEqual(len(discussion['inspirationChoices']),3)
   exhausted=assistant.context(db,state,'灵感卡片换一批',{})
   exhausted['inspirationChoices']=[]
   action=dict(type='set_preferences',scope='inspiration',selectedIds=['0'])
   with self.assertRaises(ValueError):assistant.validate(dict(reply='更新',actions=[action]),dict(message='灵感换一批',context=exhausted))
   with self.assertRaises(ValueError):assistant.validate(dict(reply='已更新',actions=[]),dict(message='灵感换一批',context=refresh))
   action.pop('selectedIds')
   with self.assertRaises(ValueError):assistant.validate(dict(reply='更新',actions=[action]),dict(message='灵感换一批',context=refresh))
 def test_unknown_ids_rejected(self):
  with self.assertRaises(ValueError):self.validated({'type':'set_preferences','scope':'inspiration','selectedIds':['fabricated']})
 def test_reset_clears_filter_and_selection(self):
  result=self.validated({'type':'set_preferences','scope':'inspiration','excludedAuthors':[],'reducedAuthors':[],'authors':[],'keywords':[],'onlyAuthors':False,'origin':'any','onlyOrigin':False})
  a=result['actions'][0];self.assertEqual(a['excludedAuthors'],[]);self.assertEqual(a['selectionDay'],'')
 def test_candidate_citations_are_grounded_in_exact_supplied_quote(self):
  context=dict(articles=[],trash=[],readingChoices=[],inspirationChoices=[dict(id='book-real',workId='work-real',work='作品',author='作者',quote='窗外的树叶照着阳光，清晨的风经过这里。',chapter=2,chapterTitle='第三章')])
  data=dict(message='挑这一条',context=context)
  value=dict(reply='挑这一条。',actions=[],citations=[dict(sourceId='book-real',quote='窗外的树叶照着阳光')])
  valid=assistant.validate(value,data);self.assertEqual(valid['citations'][0]['workId'],'work-real');self.assertEqual(valid['citations'][0]['chapter'],2)
  value['citations'][0]['quote']='原文里面并没有这一句话'
  with self.assertRaises(ValueError):assistant.validate(value,data)
 def test_invalid_controls_rejected(self):
  for bad in [{'maxPerAuthor':0},{'maxPerAuthor':True},{'selectedIds':[{}]},{'onlyAuthors':'yes'}]:
   with self.assertRaises(ValueError):self.validated({'type':'set_preferences','scope':'inspiration',**bad})
if __name__=='__main__':unittest.main()
