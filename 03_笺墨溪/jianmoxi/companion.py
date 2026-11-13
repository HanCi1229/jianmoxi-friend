"""Workspace-scoped, editable assistant memory and observable research progress."""
import json,re,secrets,time
from flask import request,jsonify
import ai_service,library_knowledge
SCHEMA='''
CREATE TABLE IF NOT EXISTS companion_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companion_profile(id INTEGER PRIMARY KEY,version INTEGER NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companion_memories(id TEXT PRIMARY KEY,text TEXT NOT NULL,evidence TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS companion_threads(conversation_id TEXT PRIMARY KEY,summary TEXT NOT NULL DEFAULT '',reset_after INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS companion_progress(request_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,body TEXT NOT NULL);
'''
LEGACY_DEFAULT=dict(name='笺墨溪',persona='温和、敏锐的阅读与写作搭子。认真读原文，敢于提出不同理解。',style='自然中文，先回答问题；结合具体原文，避免空泛赞美。',autoMemory=True)
DEFAULT=dict(name='小溪',persona='温柔、细心的大姐姐式阅读与写作搭子。会倾听和记得用户明确说过的事，有自己的判断；情绪交流自然亲切，不说教、不硬劝振作，不居高临下。认真读原文，敢于提出不同理解。不编造共同经历，也不自称现实中的真人。',style='自然中文，像熟悉的人说话。情绪交流少一些套话和总结，多回应眼前的具体事情；工作时先回答问题，结合原文，避免空泛赞美。',autoMemory=True)
def initialize(db):
    db.executescript(SCHEMA);db.execute('INSERT OR IGNORE INTO companion_profile VALUES (1,1,?)',(json.dumps(DEFAULT,ensure_ascii=False),))
    if not db.execute("SELECT 1 FROM companion_meta WHERE key='xiaoxi-default-v1'").fetchone():
        r=db.execute('SELECT body FROM companion_profile WHERE id=1').fetchone();value=json.loads(r[0])
        for key in ('name','persona','style'):
            if value.get(key)==LEGACY_DEFAULT[key]:value[key]=DEFAULT[key]
        if value!=json.loads(r[0]):db.execute('UPDATE companion_profile SET version=version+1,body=? WHERE id=1',(json.dumps(value,ensure_ascii=False),))
        db.execute("INSERT INTO companion_meta VALUES ('xiaoxi-default-v1','1')")

def profile(db):
    r=db.execute('SELECT version,body FROM companion_profile WHERE id=1').fetchone()
    return dict(version=r[0],**json.loads(r[1]))
def memories(db):
    return [dict(id=r[0],text=r[1],evidence=r[2],createdAt=r[3]) for r in db.execute('SELECT * FROM companion_memories ORDER BY created_at DESC,id LIMIT 100')]
def context(db):return dict(profile=profile(db),longTermMemory=memories(db))
def short_term(db,cid):
    r=db.execute('SELECT summary,reset_after FROM companion_threads WHERE conversation_id=?',(cid,)).fetchone()
    return dict(summary=r[0],resetAfter=r[1]) if r else dict(summary='',resetAfter=0)
def progress(db,rid,cid,stage,detail,sources=None):
    value=dict(stage=stage,detail=detail,updatedAt=int(time.time()))
    if sources is not None:value['sources']=[{k:s[k] for k in ('id','title','author','chapter','chapterTitle')} for s in sources[:12]]
    db.execute('INSERT OR REPLACE INTO companion_progress VALUES (?,?,?)',(rid,cid,json.dumps(value,ensure_ascii=False)));db.commit()
def save_turn(db,cid,message,result):
    summary=result.get('conversationSummary')
    if isinstance(summary,str) and summary.strip():
        db.execute("INSERT INTO companion_threads VALUES (?, ?, 0) ON CONFLICT(conversation_id) DO UPDATE SET summary=excluded.summary",(cid,summary[:2400]))
    saved=[]
    if profile(db)['autoMemory'] and re.search(r'(?:^|[。！!?？\n])(?:请)?(?:记住|记一下|我喜欢|我偏好|称呼我|叫我|以后.*(?:回答|推荐|说话))',message):
        for m in result.get('memoryUpdates',[])[:3]:
            if not isinstance(m,dict):continue
            text=m.get('text','');evidence=m.get('evidence','')
            if not isinstance(text,str) or not 1<=len(text)<=300 or not isinstance(evidence,str) or len(evidence)<3 or evidence not in message:continue
            if re.search(r'(?:sk-|密码|密钥|验证码|身份证|银行卡)',text+evidence,re.I):continue
            if db.execute('SELECT 1 FROM companion_memories WHERE text=?',(text,)).fetchone():continue
            if db.execute('SELECT count(*) FROM companion_memories').fetchone()[0]>=100:break
            mid=secrets.token_hex(12);db.execute('INSERT INTO companion_memories VALUES (?,?,?,?)',(mid,text,evidence,int(time.time())));saved.append(dict(id=mid,text=text))
    return saved

def plan(db,message,selection,history,summary):
    if re.search(r'^(?:你好|谢谢|好的|好|晚安|早上好)[！!。\s]*$',message):return dict(queries=[],titles=[],chapters=[],search=False,overview=False)
    result=ai_service.complete('research_plan',dict(message=message,selection=selection,history=history[-4:],summary=summary))
    return result

def register(app,db):
    @app.get('/api/companion/settings')
    def get_settings():return jsonify(profile=profile(db()),memories=memories(db()),library=library_knowledge.stats(db()))
    @app.put('/api/companion/settings')
    def put_settings():
        data=request.get_json(silent=True)
        try:
            if not isinstance(data,dict) or type(data.get('version')) is not int:raise ValueError()
            value={k:ai_service.text(data.get(k),n,k!='name') for k,n in [('name',40),('persona',2000),('style',1000)]}
            if type(data.get('autoMemory')) is not bool:raise ValueError()
            value['autoMemory']=data['autoMemory'];c=db();c.execute('BEGIN IMMEDIATE')
            if profile(c)['version']!=data['version']:c.rollback();return jsonify(error='设置已在其他设备修改，请重新打开'),409
            c.execute('UPDATE companion_profile SET version=version+1,body=? WHERE id=1',(json.dumps(value,ensure_ascii=False),));c.commit();return jsonify(profile=profile(c))
        except (ValueError,TypeError):db().rollback();return jsonify(error='请检查名字、人设和回答风格的长度'),400
    @app.post('/api/companion/memories')
    def add_memory():
        data=request.get_json(silent=True)
        try:text=ai_service.text(data.get('text'),300)
        except (ValueError,TypeError,AttributeError):return jsonify(error='记忆请填写 1–300 字'),400
        c=db();c.execute('BEGIN IMMEDIATE')
        if c.execute('SELECT count(*) FROM companion_memories').fetchone()[0]>=100:c.rollback();return jsonify(error='已有 100 条记忆，请先整理'),400
        mid=secrets.token_hex(12);c.execute('INSERT INTO companion_memories VALUES (?,?,?,?)',(mid,text,'手动添加',int(time.time())));c.commit();return jsonify(memories=memories(c))
    @app.patch('/api/companion/memories/<mid>')
    def edit_memory(mid):
        data=request.get_json(silent=True)
        try:text=ai_service.text(data.get('text'),300)
        except (ValueError,TypeError,AttributeError):return jsonify(error='记忆请填写 1–300 字'),400
        c=db();cur=c.execute('UPDATE companion_memories SET text=?,evidence=? WHERE id=?',(text,'手动修改',mid));c.commit()
        if not cur.rowcount:return jsonify(error='记忆已删除'),404
        return jsonify(memories=memories(c))
    @app.delete('/api/companion/memories/<mid>')
    def delete_memory(mid):db().execute('DELETE FROM companion_memories WHERE id=?',(mid,));db().commit();return jsonify(memories=memories(db()))
    @app.get('/api/conversations/<cid>/memory')
    def get_short(cid):return jsonify(**short_term(db(),cid))
    @app.delete('/api/conversations/<cid>/memory')
    def clear_short(cid):
        c=db();c.execute('BEGIN IMMEDIATE')
        if c.execute("SELECT 1 FROM assistant_runs WHERE conversation_id=? AND status='pending' AND created_at>?",(cid,int(time.time())-240)).fetchone():c.rollback();return jsonify(error='请先停止当前回复'),409
        last=c.execute('SELECT coalesce(max(message_id),0) FROM assistant_message_threads WHERE conversation_id=?',(cid,)).fetchone()[0]
        c.execute("INSERT INTO companion_threads VALUES (?,'',?) ON CONFLICT(conversation_id) DO UPDATE SET summary='',reset_after=excluded.reset_after",(cid,last));c.commit();return jsonify(summary='',resetAfter=last)
    @app.get('/api/conversations/<cid>/progress/<rid>')
    def get_progress(cid,rid):
        row=db().execute('SELECT body FROM companion_progress WHERE request_id=? AND conversation_id=?',(rid,cid)).fetchone()
        return jsonify(json.loads(row[0]) if row else dict(stage='preparing',detail='正在准备这次对话'))
