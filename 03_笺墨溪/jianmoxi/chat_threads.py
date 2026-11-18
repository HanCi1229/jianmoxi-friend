"""Cloud conversations for the product assistant; legacy messages are preserved."""
import json, re, secrets, time, sqlite3, logging
from flask import jsonify, request
import ai_service, assistant_service, companion, library_knowledge, inspiration_creation

SCHEMA = '''
CREATE TABLE IF NOT EXISTS assistant_conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,context TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS assistant_message_threads(message_id INTEGER PRIMARY KEY,conversation_id TEXT NOT NULL,metadata TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS assistant_thread_messages ON assistant_message_threads(conversation_id,message_id);
CREATE TABLE IF NOT EXISTS assistant_runs(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,plan_id TEXT,response TEXT);
CREATE INDEX IF NOT EXISTS assistant_run_plan ON assistant_runs(plan_id);
'''

def initialize(db):
    db.executescript(SCHEMA)
    if db.execute('SELECT 1 FROM assistant_messages WHERE id NOT IN (SELECT message_id FROM assistant_message_threads) LIMIT 1').fetchone():
        now=int(time.time())
        db.execute("INSERT OR IGNORE INTO assistant_conversations VALUES ('legacy','之前的对话','{}',?,?,0)",(now,now))
        db.execute("INSERT OR IGNORE INTO assistant_message_threads(message_id,conversation_id) SELECT id,'legacy' FROM assistant_messages WHERE id NOT IN (SELECT message_id FROM assistant_message_threads)")

def context_value(value):
    if not isinstance(value,dict):raise ValueError('Invalid context')
    result={}
    for key,limit in [('label',200),('articleId',100),('readingId',200),('page',30),('project',40)]:
        if key in value:result[key]=ai_service.text(value[key],limit,True)
    if 'chapter' in value:
        if type(value['chapter']) is not int or value['chapter']<0:raise ValueError('Invalid chapter')
        result['chapter']=value['chapter']
    if 'inspiration' in value:
        if not isinstance(value['inspiration'],dict):raise ValueError('Invalid context')
        result['inspiration']={k:ai_service.text(str(value['inspiration'].get(k,'')),1500,True) for k in ('id','quote','author','work','topic')}
    if 'readingSelection' in value:
        selected=value['readingSelection']
        if not isinstance(selected,dict) or type(selected.get('chapter',0)) is not int or selected.get('chapter',0)<0:raise ValueError('Invalid selection')
        result['readingSelection']={'workId':ai_service.text(selected.get('workId'),200),'text':ai_service.text(selected.get('text'),3000),'chapter':selected.get('chapter',0)}
    if 'mood' in value or 'recentIds' in value:
        import reading_guide
        result.update(reading_guide.controls(value))
    return result

def add_message(db,cid,role,text,metadata=None):
    cursor=db.execute('INSERT INTO assistant_messages(role,text,created_at) VALUES (?,?,?)',(role,text,str(int(time.time()))))
    db.execute('INSERT INTO assistant_message_threads VALUES (?,?,?)',(cursor.lastrowid,cid,json.dumps(metadata or {},ensure_ascii=False)))
    db.execute('UPDATE assistant_conversations SET updated_at=? WHERE id=?',(int(time.time()),cid))
    return cursor.lastrowid

def messages(db,cid,limit=500):
    rows=db.execute('''SELECT * FROM (SELECT m.id,m.role,m.text,m.created_at,t.metadata FROM assistant_messages m
      JOIN assistant_message_threads t ON t.message_id=m.id WHERE t.conversation_id=? ORDER BY m.id DESC LIMIT ?) ORDER BY id''',(cid,limit)).fetchall()
    return [dict(id=r[0],role=r[1],text=r[2],createdAt=r[3],**json.loads(r[4])) for r in rows]

def plan_allowed(db,pid):
    run=db.execute('SELECT status FROM assistant_runs WHERE plan_id=?',(pid,)).fetchone()
    return not run or run[0]!='cancelled'

def record_receipt(db,pid,mid,result):
    run=db.execute('SELECT conversation_id FROM assistant_runs WHERE plan_id=?',(pid,)).fetchone()
    if not run:return
    links=[dict(id=i,title=next((a['title'] for a in result['state']['articles'] if a['id']==i),'打开文章'),kind='article') for i in result['created']]
    for action in result['actions']:
        if action['type']=='find_reading':
            for i in action['ids']:
                row=db.execute('SELECT title,author FROM library_works WHERE id=?',(i,)).fetchone()
                if row:links.append(dict(id=i,title=row[0]+' · '+row[1],kind='reading'))
        if action['type']=='open_article':
            a=next((a for a in result['state']['articles'] if a['id']==action['id']),None)
            if a:links.append(dict(id=a['id'],title=a['title'],kind='article'))
    if mid is None:
        mid=add_message(db,run[0],'system','已找到以下内容' if links else '操作已完成')
    db.execute('INSERT OR REPLACE INTO assistant_message_threads VALUES (?,?,?)',(mid,run[0],json.dumps(dict(links=links),ensure_ascii=False)))

def register(app,db,rate):
    def conversation(cid):
        return db().execute('SELECT * FROM assistant_conversations WHERE id=?',(cid,)).fetchone()
    def serialized(row):
        return dict(id=row['id'],title=row['title'],context=json.loads(row['context']),createdAt=row['created_at'],updatedAt=row['updated_at'],archived=bool(row['archived']))

    @app.get('/api/conversations')
    def conversation_list():
        archived=1 if request.args.get('archived')=='1' else 0
        rows=db().execute('SELECT * FROM assistant_conversations WHERE archived=? ORDER BY updated_at DESC,rowid DESC LIMIT 200',(archived,)).fetchall()
        return jsonify(conversations=[serialized(r) for r in rows])

    @app.post('/api/conversations')
    def conversation_create():
        value=request.get_json(silent=True)
        try:
            if not isinstance(value,dict):raise ValueError()
            context=context_value(value.get('context',{}));title=ai_service.text(value.get('title','新对话'),80)
        except (ValueError,TypeError):return jsonify(error='对话信息不完整'),400
        if db().execute('SELECT count(*) FROM assistant_conversations').fetchone()[0]>=1000:return jsonify(error='会话数量已达上限'),400
        cid=secrets.token_hex(16);now=int(time.time())
        db().execute('INSERT INTO assistant_conversations VALUES (?,?,?,?,?,0)',(cid,title,json.dumps(context,ensure_ascii=False),now,now));db().commit()
        return jsonify(conversation=serialized(conversation(cid)))

    @app.get('/api/conversations/<cid>')
    def conversation_get(cid):
        row=conversation(cid)
        if not row:return jsonify(error='这段对话不存在'),404
        return jsonify(conversation=serialized(row),messages=messages(db(),cid))

    @app.patch('/api/conversations/<cid>')
    def conversation_update(cid):
        row=conversation(cid);value=request.get_json(silent=True)
        if not row:return jsonify(error='这段对话不存在'),404
        try:
            if not isinstance(value,dict) or not value or set(value)-{'title','archived','context'}:raise ValueError()
            if 'title' in value:db().execute('UPDATE assistant_conversations SET title=? WHERE id=?',(ai_service.text(value['title'],80),cid))
            if 'archived' in value:
                if type(value['archived']) is not bool:raise ValueError()
                db().execute('UPDATE assistant_conversations SET archived=? WHERE id=?',(int(value['archived']),cid))
            if 'context' in value:db().execute('UPDATE assistant_conversations SET context=? WHERE id=?',(json.dumps(context_value(value['context']),ensure_ascii=False),cid))
            db().commit();return jsonify(conversation=serialized(conversation(cid)))
        except (ValueError,TypeError):db().rollback();return jsonify(error='请输入有效的对话信息'),400

    @app.post('/api/conversations/<cid>/cancel')
    def conversation_cancel(cid):
        data=request.get_json(silent=True);data=data if isinstance(data,dict) else {};rid=data.get('requestId','')
        if not conversation(cid) or not isinstance(rid,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{10,80}',rid):return jsonify(error='请求不存在'),400
        connection=db();connection.execute('BEGIN IMMEDIATE')
        run=connection.execute('SELECT * FROM assistant_runs WHERE id=?',(rid,)).fetchone()
        if run and run['conversation_id']!=cid:connection.rollback();return jsonify(error='请求不存在'),404
        if run and run['plan_id']:
            plan=connection.execute('SELECT result FROM assistant_plans WHERE id=?',(run['plan_id'],)).fetchone()
            if plan and plan[0]:connection.rollback();return jsonify(error='操作已经完成'),409
        if not run:connection.execute("INSERT INTO assistant_runs VALUES (?,?,'cancelled',?,NULL,NULL)",(rid,cid,int(time.time())))
        elif run['status']!='cancelled':
            connection.execute("UPDATE assistant_runs SET status='cancelled' WHERE id=?",(rid,))
            add_message(connection,cid,'system','已停止回复')
        connection.commit();return jsonify(stopped=True)

    @app.post('/api/conversations/<cid>/messages')
    def conversation_send(cid):
        data=request.get_json(silent=True);data=data if isinstance(data,dict) else {};row=conversation(cid)
        if not row or row['archived']:return jsonify(error='对话已删除，请先恢复或新建对话'),404
        try:
            message=ai_service.text(data.get('message'),2000);rid=data.get('requestId')
            if not isinstance(rid,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{10,80}',rid):raise ValueError()
        except (ValueError,TypeError):return jsonify(error='消息内容不完整'),400
        connection=db();connection.execute('BEGIN IMMEDIATE')
        run=connection.execute('SELECT * FROM assistant_runs WHERE id=?',(rid,)).fetchone()
        if run:
            connection.rollback()
            if run['conversation_id']!=cid:return jsonify(error='请求编号已使用'),409
            if run['status']=='cancelled':return jsonify(stopped=True)
            if run['response']:return jsonify(json.loads(run['response']))
            return jsonify(error='这条消息正在处理，请稍后查看'),409
        if connection.execute("SELECT 1 FROM assistant_runs WHERE conversation_id=? AND status='pending' AND created_at>?",(cid,int(time.time())-240)).fetchone():
            connection.rollback();return jsonify(error='这段对话正在回复，请稍后再发'),409
        connection.execute("INSERT INTO assistant_runs VALUES (?,?,'pending',?,NULL,NULL)",(rid,cid,int(time.time())))
        short=companion.short_term(connection,cid)
        history=[dict(role=m['role'],text=m['text']) for m in messages(connection,cid,12) if m['role'] in ('user','assistant') and m['id']>short['resetAfter']]
        add_message(connection,cid,'user',message)
        if row['title']=='新对话':connection.execute('UPDATE assistant_conversations SET title=? WHERE id=?',(message[:28],cid))
        connection.commit()
        try:
            if not rate('chat-minute',8,60) or not rate('ai-day',200,86400):raise ai_service.AIError('对话请求较多，请稍后再试',429)
            state_row=connection.execute('SELECT version,body FROM state WHERE id=1').fetchone()
            selection=json.loads(row['context'])
            companion.progress(connection,rid,cid,'memory','已读取人设、回答风格和会话记忆')
            payload=dict(message=message,history=history,shortTermMemory=short['summary'],context=assistant_service.context(connection,json.loads(state_row['body']),message,selection))
            companion.progress(connection,rid,cid,'planning','正在定位问题涉及的作品、人物和章节')
            friend_chat=selection.get('project') == 'friend-chat' or row['title'] == '笺墨溪 Friend · 聊天'
            user_text=message.rsplit('\n用户说：',1)[-1]
            article_inventory=friend_chat and re.search(
                r'文章列表|文章目录|云稿|云端文章|我的(?:文章|稿件)|我写的(?:文章|稿件)',user_text
            ) and re.search(r'能.{0,8}(?:看|读|访问)|看得见|看得到|读取|列(?:出|一下)|有哪些|有什么|几篇|标题',user_text)
            selected_excerpt=(row['title'] == '笺墨溪 Friend · 陪写' and
                              message.startswith('解读选中原文的表达效果，指出具体措辞。') and
                              '\n稿件片段（仅作内容参考）：\n' in message)
            if article_inventory or selected_excerpt:
                plan={'search':False}
            else:
                plan=companion.plan(connection,message,selection,history,short['summary'])
                plan=inspiration_creation.prepare_research(connection,message,selection,plan)
            if connection.execute('SELECT status FROM assistant_runs WHERE id=?',(rid,)).fetchone()[0]=='cancelled':return jsonify(stopped=True)
            if plan.get('search'):
                companion.progress(connection,rid,cid,'search','正在检索书库原文和相关章节')
                payload['research']=library_knowledge.retrieve(connection,message,selection,plan)
                payload['research']['overview']=plan.get('overview',False)
            else:payload['research']={}
            for book in payload['research'].get('books',[]):
                if not any(b['id']==book['id'] for b in payload['context']['readingChoices']):payload['context']['readingChoices'].append({k:book.get(k) for k in ('id','title','author','genre','intro','collection')})
            sources=payload['research'].get('sources',[])
            companion.progress(connection,rid,cid,'answer',('已查阅 '+str(len(sources))+' 处原文，正在整理解读与出处') if sources else '正在结合当前问题组织回答',sources)
            if friend_chat:
                payload['_friend_mode']='chat'
            elif row['title'] == '笺墨溪 Friend · 陪写':
                payload['_friend_mode']='writing'
            result=ai_service.complete('chat',payload)
            connection.execute('BEGIN IMMEDIATE')
            run=connection.execute('SELECT status FROM assistant_runs WHERE id=?',(rid,)).fetchone()
            if run[0]=='cancelled':connection.rollback();return jsonify(stopped=True)
            plan_id=secrets.token_urlsafe(24)
            connection.execute('DELETE FROM assistant_plans WHERE expires<?',(int(time.time()),))
            connection.execute('INSERT INTO assistant_plans VALUES (?,?,?,?,?,NULL)',(plan_id,state_row['version'],message,json.dumps(result,ensure_ascii=False),int(time.time())+600))
            saved=companion.save_turn(connection,cid,message,result)
            metadata={k:result.get(k,[] if k=='citations' else '') for k in ('thinkingSummary','citations')};metadata['savedMemories']=saved
            add_message(connection,cid,'assistant',result['reply'],metadata)
            response=dict(planId=plan_id,reply=result['reply'],actions=result['actions'],**metadata)
            connection.execute("UPDATE assistant_runs SET status='complete',plan_id=?,response=? WHERE id=?",(plan_id,json.dumps(response,ensure_ascii=False),rid));connection.commit()
            if payload.get('research',{}).get('overview'):
                try:
                    with library_knowledge.connect(connection) as knowledge:
                        if knowledge is not None:
                            analyses=result.get('bookAnalysis',[])
                            books=payload['research'].get('books',[])
                            if not analyses and len(books)==1 and result.get('citations'):
                                analyses=[dict(workId=books[0]['id'],summary=result['reply'][:1600],background='作者生平和写作年代未单独核实。',emotions='情绪与表达见本次有出处的回答摘记。')]
                            for analysis in analyses:
                                doc=knowledge.execute('SELECT source_hash FROM documents WHERE work_id=?',(analysis['workId'],)).fetchone()
                                if doc:
                                    analysis['coverage']='基于本次跨章抽样，非全书逐字通读';analysis['sourceIds']=[s['id'] for s in sources if s['workId']==analysis['workId']]
                                    knowledge.execute('INSERT OR REPLACE INTO analyses VALUES (?,?,?,?)',(analysis['workId'],doc[0],json.dumps(analysis,ensure_ascii=False),int(time.time())))
                            knowledge.commit()
                except sqlite3.Error:
                    logging.getLogger(__name__).warning('Book overview cache update deferred')
            companion.progress(connection,rid,cid,'complete','回答已完成',sources)
            return jsonify(response)
        except (ai_service.AIError,ValueError,TypeError,KeyError) as error:
            connection.rollback()
            stopped=connection.execute('SELECT status FROM assistant_runs WHERE id=?',(rid,)).fetchone()[0]=='cancelled'
            if stopped:return jsonify(stopped=True)
            text=str(error) if isinstance(error,ai_service.AIError) else '暂时没能理解这条消息，请换个说法重试'
            add_message(connection,cid,'system',text,dict(retry=message))
            connection.execute("UPDATE assistant_runs SET status='failed' WHERE id=?",(rid,));connection.commit()
            companion.progress(connection,rid,cid,'failed',text)
            return jsonify(error=text),getattr(error,'status',400)
