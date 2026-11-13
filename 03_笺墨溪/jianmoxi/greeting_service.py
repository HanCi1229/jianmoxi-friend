"""A short, cached companion greeting. Invoked by visits, never a scheduled AI job."""
import datetime,hashlib,json,re,threading,time
from flask import jsonify,request
import ai_service,companion

LOCK=threading.Lock()
MOODS=('平静','愉快','期待','想念','低落','疲惫')
FALLBACK={'':'来啦，今天过得怎么样？','平静':'这样安安静静地待一会儿，也挺好。','愉快':'什么事这么开心，也讲给我听听呀。','期待':'在盼什么呀？我也有点好奇了。','想念':'想起谁了？要不要和我说说那个人？','低落':'今天不太好过吗？想说的时候，我听着。','疲惫':'累啦？先歇会儿，晚点再写也来得及。'}
TZ=datetime.timezone(datetime.timedelta(hours=8))
def safe(s):return isinstance(s,str) and not re.search(r'(?:sk-|密码|密钥|验证码|身份证|银行卡)',s,re.I)
def payload(db,mood):
    p=companion.profile(db);sources=[]
    for m in companion.memories(db):
        if safe(m['text']):sources.append(dict(id='memory-'+m['id'],text=m['text'],kind='savedMemory'))
    rows=db.execute('''SELECT m.id,m.text,m.created_at FROM assistant_messages m
       JOIN assistant_message_threads t ON t.message_id=m.id
       JOIN assistant_conversations c ON c.id=t.conversation_id
       LEFT JOIN companion_threads s ON s.conversation_id=c.id
       WHERE m.role='user' AND c.archived=0 AND m.id>coalesce(s.reset_after,0)
       AND cast(m.created_at AS INTEGER)>? ORDER BY m.id DESC LIMIT 8''',(int(time.time())-7*86400,)).fetchall()
    for r in reversed(rows):
        if safe(r[1]):sources.append(dict(id='message-'+str(r[0]),text=r[1][:600],date=datetime.datetime.fromtimestamp(int(r[2]),TZ).isoformat(),kind='userMessage'))
    return dict(today=datetime.datetime.now(TZ).strftime('%Y-%m-%d'),mood=mood,profile={k:p[k] for k in ('name','persona','style')},sources=sources)

def initialize(db):
    db.execute('CREATE TABLE IF NOT EXISTS companion_greetings(cache_key TEXT PRIMARY KEY,body TEXT NOT NULL,created_at INTEGER NOT NULL)')


def register(app,db,rate):
    @app.post('/api/companion/greeting')
    def greeting():
        data=request.get_json(silent=True)
        if not isinstance(data,dict) or data.get('mood','') not in ('',)+MOODS:return jsonify(error='请选择有效心情'),400
        mood=data.get('mood','');c=db();info=payload(c,mood)
        key=hashlib.sha256(json.dumps(info,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        cached=c.execute('SELECT body FROM companion_greetings WHERE cache_key=?',(key,)).fetchone()
        if cached:return jsonify(**json.loads(cached[0]),cached=True)
        # Customized personas must not receive a hardcoded sister-style fallback.
        standard=info['profile']['persona']==companion.DEFAULT['persona'] and info['profile']['style']==companion.DEFAULT['style']
        fallback=dict(text=FALLBACK[mood] if standard else '',name=info['profile']['name'],generated=False)
        if not LOCK.acquire(blocking=False):return jsonify(**fallback)
        try:
            if not rate('companion-greeting',6,60) or not rate('ai-day',200,86400):return jsonify(**fallback)
            try:result=ai_service.complete('greeting',info)
            except ai_service.AIError:return jsonify(**fallback)
            # A change made while the model ran must not revive removed memories or old personas.
            current=payload(c,mood)
            if current!=info:return jsonify(text='',name=current['profile']['name'],generated=False)
            value=dict(text=result['text'],name=info['profile']['name'],generated=True)
            c.execute('DELETE FROM companion_greetings WHERE created_at<?',(int(time.time())-2*86400,))
            c.execute('INSERT OR REPLACE INTO companion_greetings VALUES (?,?,?)',(key,json.dumps(value,ensure_ascii=False),int(time.time())))
            c.commit();return jsonify(**value,cached=False)
        finally:LOCK.release()
