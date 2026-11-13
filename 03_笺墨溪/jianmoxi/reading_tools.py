"""Source-checked reader selections, cloud excerpts and draft-aware interpretation."""
import datetime,hashlib,json,re,zlib
from flask import request,jsonify
import ai_service

THEMES={'爱与牵挂':['爱','思念','相思','故乡','母亲','父亲','朋友'],'孤独与自我':['孤','独','寂寞','自己','沉默','寂静'],'成长与告别':['别','离','长大','岁月','过去','少年'],'自由与远方':['远','行','旅','山','海','自由'],'日常与慰藉':['生活','春','花','晨','温暖','阳光','灯']}
def normalize(value):return re.sub(r'\s+','',value)
def selection(db,value):
 if not isinstance(value,dict):raise ValueError('请选择一段正文')
 bid=ai_service.text(value.get('workId'),200);quote=ai_service.text(value.get('text'),3000)
 index=value.get('chapter',0)
 if type(index) is not int or index<0:raise ValueError('章节无效')
 row=db.execute("SELECT record FROM library_works WHERE id=? AND status='ready'",(bid,)).fetchone()
 if not row:raise ValueError('作品暂不可用')
 work=json.loads(row[0]);chapter_title=''
 if work.get('chunked'):
  ch=db.execute('SELECT title,body FROM library_chapters WHERE work_id=? AND chapter=?',(bid,index)).fetchone()
  if not ch:raise ValueError('章节暂不可用')
  chapter_title=ch[0];body=json.loads(zlib.decompress(ch[1]))
 else:
  body=work.get('body',[]);sections=work.get('sections',[])
  if sections:
   if index>=len(sections):raise ValueError('章节无效')
   chapter_title=sections[index]['title'];body=body[sections[index]['start']:sections[index+1]['start'] if index+1<len(sections) else len(body)]
  elif index!=0:raise ValueError('章节无效')
 if not normalize(quote) or normalize(quote) not in normalize('\n'.join(body)):raise ValueError('选中文字与这一章不一致，请重新选择')
 return dict(workId=bid,title=work['title'],author=work['author'],chapter=index,chapterTitle=chapter_title,text=quote)

def register(app,db,rate):
 def initialize():
  db().execute('''CREATE TABLE IF NOT EXISTS reading_excerpts(id TEXT PRIMARY KEY,record TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT)''');db().commit()
 @app.get('/api/excerpts')
 def excerpts():
  initialize();return jsonify(items=[dict(json.loads(r[1]),id=r[0],createdAt=r[2]) for r in db().execute('SELECT id,record,created_at FROM reading_excerpts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 2000')])
 @app.post('/api/excerpts')
 def add_excerpt():
  try:r=selection(db(),request.get_json(silent=True));initialize()
  except (ValueError,TypeError) as e:return jsonify(error=str(e)),400
  identity=hashlib.sha256((r['workId']+'|'+str(r['chapter'])+'|'+normalize(r['text'])).encode()).hexdigest()[:32];now=datetime.datetime.now(datetime.timezone.utc).isoformat()
  db().execute('INSERT INTO reading_excerpts VALUES (?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET deleted_at=NULL',(identity,json.dumps(r,ensure_ascii=False),now));db().commit()
  return jsonify(item=dict(r,id=identity,createdAt=now))
 @app.delete('/api/excerpts/<identifier>')
 def remove_excerpt(identifier):
  initialize();db().execute('UPDATE reading_excerpts SET deleted_at=? WHERE id=?',(datetime.datetime.now(datetime.timezone.utc).isoformat(),identifier));db().commit();return jsonify(ok=True)
 @app.post('/api/reading/assist')
 def assist():
  if not rate('reading-ai',12,60) or not rate('ai-day',200,86400):return jsonify(error='请求较多，请稍后重试'),429
  try:
   data=request.get_json(silent=True);selected=selection(db(),data);mode=data.get('mode')
   if mode not in ('interpret','associate'):raise ValueError('请选择解读或联想')
   article=None
   if mode=='associate':
    state=json.loads(db().execute('SELECT body FROM state WHERE id=1').fetchone()[0]);aid=data.get('articleId') or state.get('currentId')
    a=next((a for a in state['articles'] if a['id']==aid),None)
    if not a or not a.get('content','').strip():raise ValueError('先选择一篇已有正文的文稿')
    content=a['content'];article=dict(id=a['id'],title=a['title'],content=content if len(content)<=12000 else content[:6000]+'\n[中间正文省略]\n'+content[-6000:],truncated=len(content)>12000)
   result=ai_service.complete('reading',dict(mode=mode,selection=selected,article=article))
   return jsonify(**result,selection=selected,articleId=article['id'] if article else None)
  except (ValueError,TypeError) as e:return jsonify(error=str(e)),400
  except ai_service.AIError as e:return jsonify(error=str(e)),e.status
 @app.get('/api/inspiration/library')
 def library_inspiration():
  import library_knowledge,inspiration_preferences
  try:cursor=int(request.args.get('cursor','0'))%100000
  except ValueError:cursor=0
  items=library_knowledge.cached_inspirations(db(),cursor)
  if request.args.get('fresh')=='1' and rate('book-inspiration',2,60) and rate('ai-day',200,86400):
   try:
    library_knowledge.curate(db(),cursor+int(datetime.datetime.now().timestamp()//3600))
    items=library_knowledge.cached_inspirations(db(),cursor)
   except ai_service.AIError:
    if not items:return jsonify(items=[],status='暂时未能生成新的书库摘句')
  return jsonify(items=items,dailyLimit=library_knowledge.DAILY_INSPIRATION_COUNT,status=inspiration_preferences.status(items,library_knowledge.inspiration_preferences(db())))
