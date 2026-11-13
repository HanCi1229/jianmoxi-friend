import copy,json,sqlite3,unittest
from pathlib import Path
import reading_library as library
import assistant_service as assistant
from cloud_app import EMPTY
class ReadingExpansionTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.modern=json.loads(Path('data/library-modern.json').read_text());self.popular=json.loads(Path('data/library-popular.json').read_text())
  library.import_records(self.db,json.loads(Path('data/library-works.json').read_text())+self.modern+self.popular)
 def tearDown(self):self.db.close()
 def test_distinct_modes_and_validation(self):
  catalog=library.catalog(self.db,genre='流行小说');self.assertEqual(catalog['total'],5);self.assertEqual(catalog['externalTotal'],5)
  self.assertTrue(all(r['access']=='external' and r['characters']==0 and 'body' not in r for r in catalog['items']))
  self.assertEqual(library.catalog(self.db,q='龙族')['items'][0]['id'],'popular-longzu')
  for changes in [dict(body=['不应入库的正文']),dict(readingUrl='javascript:alert(1)'),dict(sourceUrl='https://www.qidian.com.evil.test/book/1/'),dict(access='whatever')]:
   with self.assertRaises(ValueError):library.import_records(self.db,[{**self.popular[0],**changes}])
  self.assertFalse(library.trusted_source('https://zh.wikisource.org.evil.test/'))
 def test_diversity_pagination_and_preferences(self):
  first=library.catalog(self.db);second=library.catalog(self.db,page=2)
  self.assertGreaterEqual(len({r['author'] for r in first['items']}),8)
  self.assertLessEqual(sum(r['author']=='鲁迅' for r in first['items']),1)
  self.assertFalse({r['id'] for r in first['items']}&{r['id'] for r in second['items']})
  self.assertEqual(library.catalog(self.db,preferences={'authors':['鲁迅']})['items'][0]['author'],'鲁迅')
  self.assertTrue(all(r['author']=='萧红' for r in library.catalog(self.db,author='萧红')['items']))
  self.assertEqual(library.catalog(self.db,q='呼兰河传')['items'][0]['author'],'萧红')
 def test_full_text_boundaries_and_no_adverts(self):
  hul=next(r for r in self.modern if r['title']=='呼兰河传');life=next(r for r in self.modern if r['title']=='生死场')
  self.assertEqual(len(hul['sections']),8);self.assertEqual(len(life['sections']),17)
  self.assertEqual(hul['sections'][0]['start'],0);self.assertGreater(len(''.join(hul['body'])),90000)
  self.assertIn('忘却不了',hul['body'][-2]);self.assertIn('一九三四',life['body'][-1])
  for r in self.modern:
   self.assertNotIn('附录',r['title']);self.assertNotIn('xiaoshu', ''.join(r['body']).lower())
   starts=[s['start'] for s in r.get('sections',[])];self.assertEqual(starts,sorted(set(starts)))
 def test_external_assistant_is_metadata_only(self):
  c=assistant.context(self.db,copy.deepcopy(EMPTY),'推荐龙族',{'readingId':'popular-longzu'})
  self.assertEqual(c['currentReading']['access'],'external');self.assertEqual(c['currentReading']['content'],'')
  self.assertTrue(any(r['id']=='popular-longzu' and r['access']=='external' for r in c['readingChoices']))
  action=dict(type='set_preferences',scope='reading',note='爱读流行小说',types=[],genres=['流行小说'],authors=['江南'],keywords=[])
  out=assistant.validate(dict(reply='将保存偏好',actions=[action]),dict(message='以后多推荐江南的流行小说',context=c));self.assertEqual(out['actions'][0]['genres'],['流行小说'])
if __name__=='__main__':unittest.main()
