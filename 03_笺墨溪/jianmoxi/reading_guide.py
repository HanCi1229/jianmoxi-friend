"""A source-checked reading selection, separate from persistent user preferences."""
import hashlib,json,re,time
from flask import request,jsonify
import ai_service,reading_library,library_knowledge as library,companion,inspiration_preferences
SCHEMA='CREATE TABLE IF NOT EXISTS reading_recommendation(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);'
def initialize(db):db.execute(SCHEMA)
def controls(value):
 mood=value.get('mood','');recent=value.get('recentIds',[])
 if mood not in ('','平静','愉快','期待','想念','低落','疲惫'):raise ValueError('心情无效')
 if not isinstance(recent,list) or len(recent)>8 or any(not isinstance(i,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',i) for i in recent):raise ValueError('阅读记录无效')
 return dict(mood=mood,recentIds=list(dict.fromkeys(recent)))
def build_context(db,state,mood='',recentIds=None):
 prefs=state.get('preferences',{}).get('reading',{});books=[]
 for wid in (recentIds or [])[:8]:
  r=db.execute("SELECT record FROM library_works WHERE id=? AND status='ready'",(wid,)).fetchone()
  if r:books.append(reading_library.metadata(json.loads(r[0])))
 books+=reading_library.catalog(db,limit=30,preferences=prefs)['items']
 books=list({r['id']:r for r in books if r.get('access','internal')!='external'}.values())[:30]
 sources=[]
 with library.connect(db) as k:
  if k is not None:
   for b in books:
    count=k.execute('SELECT count(*) FROM passages WHERE work_id=?',(b['id'],)).fetchone()[0]
    if not count:continue
    offset=int(hashlib.sha256((inspiration_preferences.today()+b['id']).encode()).hexdigest()[:8],16)%count
    p=k.execute('SELECT * FROM passages WHERE work_id=? ORDER BY chapter,part LIMIT 1 OFFSET ?',(b['id'],offset)).fetchone()
    s=library.canonical(db,k,p)
    if s:s['text']=s['text'][:1100];sources.append(s)
 return dict(current=current(db),books=books,sources=sources,mood=mood,recentIds=recentIds or [],preferences=prefs,profile={k:v for k,v in companion.profile(db).items() if k in ('name','persona','style')})
def validate(value,context):
 ids=value.get('ids');allowed={b['id'] for b in context.get('books',[])}
 if not isinstance(ids,list) or not 1<=len(ids)<=8 or len(set(ids))!=len(ids) or any(not isinstance(i,str) or i not in allowed for i in ids):raise ValueError('荐读作品不在书库候选中')
 q=value.get('quote')
 if not isinstance(q,dict):raise ValueError('缺少荐读短句')
 quote=ai_service.text(q.get('text'),36);s=next((s for s in context.get('sources',[]) if s['id']==q.get('sourceId')),None)
 if not s:raise ValueError('荐读短句缺少原文出处')
 exact=library.source_quote(quote,s['text'])
 if not exact or not 8<=len(exact)<=36 or s['workId'] not in ids:raise ValueError('短句需为推荐作品中的连续原文，8至36字')
 return dict(ids=ids,quote=dict(sourceId=s['id'],workId=s['workId'],title=s['title'],author=s['author'],chapter=s['chapter'],chapterTitle=s['chapterTitle'],quote=exact),reason=ai_service.text(value.get('reason'),300))
def save(db,selection,key='',manual=False):
 import reading_tools
 q=selection['quote'];verified=reading_tools.selection(db,dict(workId=q['workId'],chapter=q['chapter'],text=q['quote']))
 selection={**selection,'quote':{**q,'author':verified['author'],'title':verified['title'],'chapterTitle':verified['chapterTitle']}}
 books=[]
 for wid in selection['ids']:
  r=db.execute("SELECT record FROM library_works WHERE id=? AND status='ready'",(wid,)).fetchone()
  if not r:raise ValueError('推荐作品已经变化，请重试')
  books.append(reading_library.metadata(json.loads(r[0])))
 value=dict(**selection,books=books,day=inspiration_preferences.today(),key=key,manual=manual,revision=str(time.time_ns()),name=companion.profile(db)['name'])
 db.execute('INSERT INTO reading_recommendation VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',(json.dumps(value,ensure_ascii=False),))
 return value

def current(db):
 row=db.execute('SELECT body FROM reading_recommendation WHERE id=1').fetchone()
 if not row:return None
 value=json.loads(row[0])
 if value['day']!=inspiration_preferences.today():return None
 import reading_tools
 try:
  q=value['quote'];verified=reading_tools.selection(db,dict(workId=q['workId'],chapter=q['chapter'],text=q['quote']))
  value['quote'].update(author=verified['author'],title=verified['title'],chapterTitle=verified['chapterTitle'])
  books=[]
  for wid in value['ids']:
   r=db.execute("SELECT record FROM library_works WHERE id=? AND status='ready'",(wid,)).fetchone()
   if not r:return None
   books.append(reading_library.metadata(json.loads(r[0])))
  return dict(value,books=books,name=companion.profile(db)['name'])
 except ValueError:return None

def action_context(data):
 guide=data.get('context',{}).get('readingGuide',{})
 books=list({b['id']:b for b in guide.get('books',[])+data.get('context',{}).get('readingChoices',[])}.values())
 sources=list({s['id']:s for s in guide.get('sources',[])+data.get('research',{}).get('sources',[])}.values())
 return dict(books=books,sources=sources)

def register(app,db,rate):
 @app.get('/api/reading/recommendation')
 def get_recommendation():return jsonify(recommendation=current(db()),name=companion.profile(db())['name'])
 @app.post('/api/reading/recommendation')
 def recommend():
  try:
   data=request.get_json(silent=True)
   if not isinstance(data,dict):raise ValueError('请求无效')
   args=controls(data);state=json.loads(db().execute('SELECT body FROM state WHERE id=1').fetchone()[0])
   key=hashlib.sha256(json.dumps([args,state.get('preferences',{}).get('reading',{}),companion.profile(db())['version']],ensure_ascii=False,sort_keys=True).encode()).hexdigest()
   old=current(db())
   if old and not data.get('refresh') and (old['manual'] or old['key']==key):return jsonify(recommendation=old)
   if not rate('reading-guide',4,60) or not rate('ai-day',200,86400):return jsonify(error='荐读请求较多，请稍后再试'),429
   context=build_context(db(),state,**args)
   if not context['sources']:return jsonify(error='暂时没有可核验的阅读原文，完整书库仍可浏览'),503
   result=ai_service.complete('reading_recommendation',context)
   c=db();c.execute('BEGIN IMMEDIATE');latest=current(c)
   if (latest or {}).get('revision')!=(old or {}).get('revision'):
    c.rollback();return jsonify(recommendation=latest)
   fresh=json.loads(c.execute('SELECT body FROM state WHERE id=1').fetchone()[0])
   if fresh.get('preferences',{}).get('reading',{})!=state.get('preferences',{}).get('reading',{}):c.rollback();return jsonify(error='阅读偏好刚刚更新，请重试'),409
   result=save(c,result,key);c.commit();return jsonify(recommendation=result)
  except (ValueError,TypeError,KeyError):db().rollback();return jsonify(error='暂时没能完成荐读，书库可以继续使用'),400
  except ai_service.AIError as e:db().rollback();return jsonify(error=str(e)),e.status
