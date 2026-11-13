# -*- coding: utf-8 -*-
"""Normalize extracted editions and build a resumable SQLite import bundle."""
import sys,json,sqlite3,hashlib,zlib,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import book_library
OUT=ROOT/'.deploy/book-import';sources=json.loads((OUT/'sources.json').read_text());summaries=json.loads((OUT/'extraction.json').read_text());by_source={r['source']:r for r in summaries}
fixes={'一句顶一万句- 刘震云':('一句顶一万句','刘震云'),'万族之劫 (老鹰吃小鸡)':('万族之劫','老鹰吃小鸡'),'三寸人间（耳根）':('三寸人间','耳根'),'你也走了很远的路吧- 卢思浩':('你也走了很远的路吧','卢思浩'),'吞噬星空-我吃西红柿':('吞噬星空','我吃西红柿'),'圣墟 辰东':('圣墟','辰东'),'斗罗大陆2绝世唐门 唐家三少':('斗罗大陆2：绝世唐门','唐家三少'),'斗罗大陆3龙王传说':('斗罗大陆3：龙王传说','唐家三少'),'斗罗大陆4终极斗罗':('斗罗大陆4：终极斗罗','唐家三少'),'斗罗大陆5重生唐三':('斗罗大陆5：重生唐三','唐家三少'),'长生界 辰东':('长生界','辰东'),'长相思- 桐华':('长相思','桐华'),'全球通史':('全球通史','L.S.斯塔夫里阿诺斯'),'汤姆索亚历险记双语':('汤姆·索亚历险记（双语）','马克·吐温'),'绿野仙踪':('绿野仙踪（双语）','L.弗兰克·鲍姆'),'王安石词集':('王安石词集','王安石'),'肖申克的救赎（电影剧本）':('肖申克的救赎','斯蒂芬·金'),'卡夫卡文集失踪者':('失踪者','弗朗茨·卡夫卡'),'悲惨世界（上下）':('悲惨世界','维克多·雨果')}
groups={};excluded=[]
for r in summaries:
 if r['status']!='ready':excluded.append(r);continue
 if r['title'] in fixes:r['title'],r['author']=fixes[r['title']]
 if '终极解谜' in r['filename']:r.update(title='盗墓笔记·终极解谜',author='作者待核',genre='人文社科')
 if r['title']=='肖申克的救赎':r['genre']='小说'
 if '盗墓笔记1—8全/盗墓笔记' in r['filename'] and re.search('盗墓笔记[2-8] ',r['filename']):
  r.update(status='duplicate',reason='已并入完整《盗墓笔记》版本');excluded.append(r);continue
 # Same title represents an edition choice. Keep all original files privately.
 groups.setdefault(r['title'],[]).append(r)
def score(r):
 preference={'epub':4,'azw3':3,'txt':2,'pdf':1}[r['format']]
 return preference,(r['characters'] if r['chapters']<100 else r['characters']*(1.02 if r['chapters']>500 else 1)),r['chapters']
selected=[]
for title,rows in groups.items():
 # For long text editions within 10% length, prefer a real chapter directory.
 largest=max(r['characters'] for r in rows);eligible=[r for r in rows if r['format']!='txt' or r['characters']>=largest*.90]
 chosen=max(eligible,key=lambda r:(score(r)[0],r['chapters'] if r['format']=='txt' else r['characters']))
 selected.append(chosen)
 for r in rows:
  if r is not chosen:r.update(status='duplicate',reason='同书保留更适合阅读的版本：'+chosen['filename']);excluded.append(r)
path=OUT/'books.sqlite'
if path.exists():path.unlink()
db=sqlite3.connect(path)
# Match the live library schema exactly; no unrelated source expansion.
import importlib.util
spec=importlib.util.spec_from_file_location('live_reading',OUT/'online/reading_library.py');lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib);lib.initialize(db);book_library.initialize(db)
report=[]
for r in sorted(selected,key=lambda x:x['title']):
 source=next(s for s in sources if s['stored']==r['source']);parsed=json.loads((OUT/'parsed'/(source['sha256']+'.json')).read_text());chapters=parsed['chapters']
 # Drop standalone navigation and cover/advertising pages, preserving all prose.
 if r['format']!='pdf':
  chapters=[c for c in chapters if not (c['body'] and c['body'][0] in ('目录','目 录','Contents') and len(c['body'])>3 and sum(len(x)<100 for x in c['body'])/len(c['body'])>.85)]
  for c in chapters:
   if c['title']=='正文' and c['body'] and len(c['body'][0])<60:c['title']=c['body'][0]
 if not chapters:raise ValueError(r['title'])
 bid='upload-'+hashlib.sha256((r['title']+'|'+r['author']).encode()).hexdigest()[:24];r['id']=bid
 full='\n'.join('\n'.join(c['body']) for c in chapters);chars=len(full)
 collection='网络小说' if r['genre']=='网络小说' else '世界文学' if '百本经典' in source['relative'] else '文学与人文'
 body_sample=chapters[0]['body'];excerpt=next((p for c in chapters[:4] for p in c['body'] if 35<len(p)<300 and not re.search('ISBN|版权|出版社|版权所有|目录|出版|电子书|本书|简介',p)), '')
 record=dict(id=bid,title=r['title'],author=r['author'],genre=r['genre'],category=r['genre'],collection=collection,collectionOrder=0,characters=chars,intro=excerpt[:95],sourceKind='upload',sourceName='个人藏书',sourceUrl='/api/library/'+bid+'/source',format=r['format'],chunked=True,chapterCount=len(chapters),body=body_sample,coverTags=['books'],importedAt='2026-11-03')
 db.execute('INSERT INTO library_works VALUES (?,?,?,?,?,?,?,?,?,?,?)',(bid,r['title'],r['author'],r['genre'],collection,0,chars,r['title']+' '+r['author']+' '+collection+' '+excerpt,hashlib.sha256(full.encode()).hexdigest(),json.dumps(record,ensure_ascii=False),'ready'))
 db.execute('INSERT INTO library_book_search VALUES (?,?)',(bid,full))
 db.execute('INSERT INTO library_books VALUES (?,?,?,?,?)',(bid,source['stored'],r['format'],len(chapters),source['sha256']))
 for i,c in enumerate(chapters):db.execute('INSERT INTO library_chapters VALUES (?,?,?,?,?)',(bid,i,c['title'],zlib.compress(json.dumps(c['body'],ensure_ascii=False).encode(),6),sum(map(len,c['body']))))
 report.append(dict(id=bid,title=r['title'],author=r['author'],format=r['format'],chapters=len(chapters),characters=chars,source=source['relative'],warnings=r.get('warnings',[])))
 db.commit();print('prepared',len(report),r['title'],len(chapters),flush=True)
for source in sources:
 r=by_source[source['stored']];bid=r.get('id');status='ready' if bid else r['status'];reason=r.get('error') or r.get('reason','')
 db.execute('INSERT INTO library_sources VALUES (?,?,?,?,?,?,?)',(source['sha256'],source['relative'],source['stored'],source['bytes'],status,bid,reason))
db.commit();db.close()
(OUT/'import-report.json').write_text(json.dumps(dict(books=report,excluded=excluded,totalSources=len(sources)),ensure_ascii=False,indent=2))
print('DONE',len(report),'books',len(excluded),'excluded',path.stat().st_size//1024//1024,'MB',flush=True)
