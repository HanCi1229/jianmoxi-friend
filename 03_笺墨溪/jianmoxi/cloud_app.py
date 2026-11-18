"""Cloud writing spaces. Each personal account opens only its own workspace."""
import gzip
import json
import os
import re
import secrets
import sqlite3
import subprocess
import time
from pathlib import Path

from flask import Flask, g, jsonify, redirect, request, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash
import accounts
import ai_service
import image_library
import reading_library
import assistant_service
import chat_threads
import companion
import book_library
import reading_tools
import weather_service
import greeting_service
from server import public_content, upstream_url

ROOT = Path(__file__).resolve().parent
KEYS = {'articles', 'trash', 'saved', 'favs', 'activity', 'goal', 'currentId', 'comment', 'preferences'}
EMPTY = dict(articles=[], trash=[], saved=[], favs=[], activity={}, goal=300, currentId=None, comment='', preferences={})


def validate_state(data):
    if not isinstance(data, dict) or set(data) - KEYS:
        raise ValueError('Invalid state')
    state = {**EMPTY, **data}
    for key in ('articles', 'trash'):
        rows = state[key]
        if not isinstance(rows, list) or len(rows) > 2000:
            raise ValueError('Too many articles')
        seen = set()
        for row in rows:
            if not isinstance(row, dict) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', str(row.get('id', ''))):
                raise ValueError('Invalid ID')
            if row['id'] in seen:
                raise ValueError('Duplicate ID')
            seen.add(row['id'])
            if row.get('status') not in ('draft', 'complete') or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(row.get('date', ''))):
                raise ValueError('Invalid article')
            for field, limit in [('title', 500), ('content', 200000), ('seed', 1000), ('group',60), ('summary',1200)]:
                if not isinstance(row.get(field, ''), str) or len(row.get(field, '')) > limit:
                    raise ValueError('Invalid text')
            if row.get('img') not in (None, '', 'sea', 'forest', 'morning'):
                raise ValueError('Invalid image')
    if {r['id'] for r in state['articles']} & {r['id'] for r in state['trash']}:
        raise ValueError('Article in two places')
    if not isinstance(state['saved'], list) or len(state['saved']) > 2000 or not all(isinstance(s, dict) and isinstance(s.get('id'), str) for s in state['saved']):
        raise ValueError('Invalid saved items')
    for s in state['saved']:
        if s.get('source') and (not isinstance(s['source'], dict) or not str(s['source'].get('url', '')).startswith('https://')):
            raise ValueError('Invalid source')
    if not isinstance(state['favs'], list) or len(state['favs']) > 2000 or not all(isinstance(x, str) for x in state['favs']):
        raise ValueError('Invalid favourites')
    if not isinstance(state['activity'], dict) or len(state['activity']) > 20000:
        raise ValueError('Invalid activity')
    for date, log in state['activity'].items():
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date) or not isinstance(log, dict) or any(type(log.get(k)) is not int or not 0 <= log[k] <= 100000000 for k in ('chars', 'edits')):
            raise ValueError('Invalid activity')
    if type(state['goal']) is not int or not 1 <= state['goal'] <= 1000000:
        raise ValueError('Invalid goal')
    if state['currentId'] is not None and not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', str(state['currentId'])):
        raise ValueError('Invalid current article')
    if not isinstance(state['comment'], str) or len(state['comment']) > 20000:
        raise ValueError('Invalid comment')
    prefs = state['preferences']
    if not isinstance(prefs,dict) or set(prefs)-{'inspiration','reading'}:
        raise ValueError('Invalid preferences')
    import inspiration_preferences
    for scope,value in prefs.items():
        if not isinstance(value,dict) or set(value)-({'note','types','genres','authors','keywords'} | (set(inspiration_preferences.FIELDS) if scope=='inspiration' else set())):
            raise ValueError('Invalid preferences')
        if not isinstance(value.get('note',''),str) or len(value.get('note',''))>1000:
            raise ValueError('Invalid preference text')
        if scope=='inspiration':inspiration_preferences.validate(value)
        for key in ('types','genres','authors','keywords'):
            rows=value.get(key,[])
            if not isinstance(rows,list) or len(rows)>12 or any(not isinstance(v,str) or len(v)>80 for v in rows):
                raise ValueError('Invalid preference values')
    return state


def initialize_workspace(connection, member=False):
    connection.executescript('''
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS catalog (kind TEXT PRIMARY KEY, body TEXT NOT NULL);
    ''')
    connection.execute('INSERT OR IGNORE INTO state VALUES (1,0,?)', (json.dumps(EMPTY),))
    image_library.initialize(connection)
    for kind in ('movies', 'readings'):
        body = (ROOT / 'dist' / 'data' / (kind + '.json')).read_text(encoding='utf-8')
        connection.execute('INSERT OR IGNORE INTO catalog VALUES (?,?)', (kind, body))
    reading_library.initialize(connection)
    assistant_service.initialize(connection)
    companion.initialize(connection)
    chat_threads.initialize(connection)
    book_library.initialize(connection)
    greeting_service.initialize(connection)
    readings = json.loads(connection.execute("SELECT body FROM catalog WHERE kind='readings'").fetchone()[0])
    for record in readings:
        record['genre'] = record.get('genre', '散文')
        record['coverId'] = {'wikisource-congcong':'ps-42', 'wikisource-beiying':'ps-69'}.get(record['id'])
    bundled_library = ROOT / 'data' / 'library-works.json'
    if member and bundled_library.is_file():
        readings.extend(json.loads(bundled_library.read_text(encoding='utf-8')))
    reading_library.import_records(connection, readings)
    if member:
        import library_knowledge
        library_knowledge.build(connection)
        library_knowledge.seed_public_inspiration(connection, readings)
    connection.commit()


def create_app(config=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(DB_PATH=os.environ.get('XINGZOU_DB', '/var/lib/xingzou/app.db'),
                      PUBLIC_ORIGIN=os.environ.get('PUBLIC_ORIGIN', 'https://49.234.43.25'),
                      OWNER_HASH=os.environ.get('OWNER_HASH', ''),
                      MAX_CONTENT_LENGTH=8 * 1024 * 1024, SECURE_COOKIE=True)
    if config:
        app.config.update(config)
    dbpath = Path(app.config['DB_PATH'])
    image_folder = Path(app.config.get('IMAGE_FOLDER') or os.environ.get('XINGZOU_IMAGES', str(dbpath.parent / 'images')))
    dbpath.parent.mkdir(parents=True, exist_ok=True)

    def connect(path, existing=False):
        location = path.resolve().as_uri() + '?mode=rw' if existing else path
        connection = sqlite3.connect(location, timeout=20, uri=existing)
        connection.row_factory = sqlite3.Row
        return connection

    def control():
        if 'control_db' not in g:
            g.control_db = connect(dbpath)
        return g.control_db

    def account_mode():
        return control().execute('SELECT 1 FROM accounts WHERE id=?', (accounts.OWNER_ID,)).fetchone() is not None

    def member_path(account_id):
        if not re.fullmatch(r'[a-f0-9]{32}', account_id):
            raise ValueError('Invalid account storage identifier')
        return dbpath.parent / 'accounts' / account_id / 'app.db'

    def db():
        account = g.get('account')
        if not account or account['id'] == accounts.OWNER_ID:
            return control()
        if 'workspace_db' not in g:
            g.workspace_db = connect(member_path(account['id']), existing=True)
        return g.workspace_db

    def prepare_member(account_id):
        path = member_path(account_id)
        path.parent.mkdir(mode=0o700, parents=True)
        connection = connect(path)
        try:
            initialize_workspace(connection, member=True)
        finally:
            connection.close()
        path.chmod(0o600)

    with app.app_context():
        control().executescript('''
          CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL);
        ''')
        accounts.initialize(control())
        initialize_workspace(control())
        os.chmod(dbpath, 0o600)

    @app.teardown_appcontext
    def close_db(_):
        for key in ('workspace_db', 'control_db'):
            connection = g.pop(key, None)
            if connection:
                connection.close()

    def rate_bucket(key, maximum, interval):
        key = f'{key}:{int(time.time()) // interval}'
        connection = control()
        connection.execute('BEGIN IMMEDIATE')
        row = connection.execute('SELECT count FROM limits WHERE key=?', (key,)).fetchone()
        if row and row[0] >= maximum:
            connection.rollback()
            return False
        connection.execute('INSERT INTO limits VALUES (?,1) ON CONFLICT(key) DO UPDATE SET count=count+1', (key,))
        # Bound the bookkeeping table without logging prompts or article contents.
        connection.execute('DELETE FROM limits WHERE rowid < (SELECT MAX(rowid)-10000 FROM limits)')
        connection.commit()
        return True

    def rate(key, maximum, interval):
        account = g.get('account')
        if account and account['id'] != accounts.OWNER_ID and key == 'ai-day':
            if not rate_bucket(key + ':' + account['id'], 40, interval):
                return False
        return rate_bucket(key, maximum, interval)

    def session_key():
        return accounts.digest(request.cookies.get('xingzou_session', ''))

    def authenticated():
        if g.personal_accounts:
            g.account = control().execute('''
                SELECT a.id,a.username FROM account_sessions s
                JOIN accounts a ON a.id=s.account_id WHERE s.token=? AND s.expires>?
            ''', (session_key(), int(time.time()))).fetchone()
            return g.account is not None
        row = control().execute('SELECT expires FROM sessions WHERE token=?', (session_key(),)).fetchone()
        return bool(row and row[0] > time.time())

    @app.before_request
    def protect():
        if request.host != app.config['PUBLIC_ORIGIN'].split('://', 1)[-1]:
            return jsonify(error='访问地址不正确'), 400
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.headers.get('Origin') != app.config['PUBLIC_ORIGIN']:
            return jsonify(error='请求来源不正确'), 403
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and not request.is_json:
            return jsonify(error='需要 JSON 格式'), 415
        g.personal_accounts = account_mode() if request.path.startswith(('/api/', '/data/', '/web-client/')) else False
        protected = (request.path.startswith('/api/') and request.path not in ('/api/session', '/api/login', '/api/register', '/api/weather')) or request.path.startswith('/data/')
        if protected and not authenticated():
            return jsonify(error='请先登录'), 401
        if protected and g.personal_accounts:
            scope = request.headers.get('X-Xingzou-Space')
            requires_scope = request.path == '/api/state' or request.method not in ('GET', 'HEAD', 'OPTIONS')
            if (requires_scope or scope is not None) and scope != g.account['id']:
                return jsonify(error='登录账号已切换，请刷新页面后继续'), 401

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Cache-Control'] = 'no-store' if request.path.startswith('/api/') or request.path == '/' else 'no-cache'
        return response

    @app.errorhandler(413)
    def too_large(_):
        return jsonify(error='数据超过容量限制，请导出副本'), 413

    @app.get('/healthz')
    def health():
        db().execute('SELECT 1').fetchone()
        return jsonify(ok=True)

    @app.get('/api/session')
    def session():
        active = authenticated()
        data = dict(cloud=True, authenticated=active, personalAccounts=g.personal_accounts)
        if g.get('account'):
            data['account'] = dict(id=g.account['id'], username=g.account['username'],
                                   owner=g.account['id'] == accounts.OWNER_ID)
        return jsonify(data)

    def login_response(account_id=None):
        token = secrets.token_urlsafe(32)
        connection = control()
        now = int(time.time())
        expires = now + accounts.TOKEN_LIFETIME
        if account_id is None:
            connection.execute('DELETE FROM sessions WHERE expires<=? OR token=?', (now, session_key()))
            connection.execute('INSERT INTO sessions VALUES (?,?)', (accounts.digest(token), expires))
        else:
            connection.execute('DELETE FROM account_sessions WHERE expires<=? OR token=?', (now, session_key()))
            connection.execute('INSERT INTO account_sessions VALUES (?,?,?)', (accounts.digest(token), account_id, expires))
        connection.commit()
        response = jsonify(ok=True)
        response.set_cookie('xingzou_session', token, max_age=accounts.TOKEN_LIFETIME,
                            secure=app.config['SECURE_COOKIE'], httponly=True, samesite='Strict')
        return response

    @app.post('/api/login')
    def login():
        if not rate('login', 30 if g.personal_accounts else 20, 900):
            return jsonify(error='尝试次数较多，请 15 分钟后再试'), 429
        data = request.get_json(silent=True) or {}
        password = data.get('password', '') if isinstance(data, dict) else ''
        if g.personal_accounts:
            username = accounts.username(data.get('username')) if isinstance(data, dict) else ''
            if not username or not isinstance(password, str) or not password:
                return jsonify(error='账号或密码不正确'), 401
            if not rate('login:' + username, 8, 900):
                return jsonify(error='尝试次数较多，请 15 分钟后再试'), 429
            row = control().execute('SELECT id,password_hash FROM accounts WHERE username=?', (username,)).fetchone()
            if not row or not row['password_hash'] or not check_password_hash(row['password_hash'], password):
                return jsonify(error='账号或密码不正确'), 401
            return login_response(row['id'])
        if not isinstance(password, str) or not password or not app.config['OWNER_HASH'] or not check_password_hash(app.config['OWNER_HASH'], password):
            return jsonify(error='访问密码不正确'), 401
        return login_response()

    @app.post('/api/register')
    def register():
        if not g.personal_accounts:
            return jsonify(error='账号注册暂未启用'), 404
        if not rate('register', 15, 900):
            return jsonify(error='尝试次数较多，请 15 分钟后再试'), 429
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error='请填写账号、密码和邀请码'), 400
        name, password, code = accounts.username(data.get('username')), data.get('password'), data.get('code')
        if not name:
            return jsonify(error='账号用 3–32 位字母、数字或 ._-'), 400
        if not isinstance(password, str) or not password:
            return jsonify(error='请填写密码'), 400
        if not isinstance(code, str) or not accounts.CODE.fullmatch(code):
            return jsonify(error='邀请码无效或已使用'), 400
        connection = control()
        digest = accounts.digest(code)
        find_invite = "SELECT 1 FROM account_invites WHERE digest=? AND expires>? AND purpose='member'"
        if not connection.execute(find_invite, (digest, int(time.time()))).fetchone():
            return jsonify(error='邀请码无效或已使用'), 400
        password_hash = generate_password_hash(password)
        with connection:
            connection.execute('BEGIN IMMEDIATE')
            invite = connection.execute(find_invite, (digest, int(time.time()))).fetchone()
            if not invite:
                return jsonify(error='邀请码无效或已使用'), 400
            if connection.execute('SELECT 1 FROM accounts WHERE username=?', (name,)).fetchone():
                return jsonify(error='该账号已被使用'), 409
            if connection.execute('SELECT count(*) FROM accounts').fetchone()[0] >= accounts.MAX_ACCOUNTS:
                return jsonify(error='邀请人数已达上限'), 409
            account_id = secrets.token_hex(16)
            prepare_member(account_id)
            connection.execute('INSERT INTO accounts VALUES (?,?,?)', (account_id, name, password_hash))
            connection.execute('DELETE FROM account_invites WHERE digest=?', (digest,))
            return login_response(account_id)

    @app.post('/api/account/invites')
    def invite():
        if not g.get('account') or g.account['id'] != accounts.OWNER_ID:
            return jsonify(error='只有空间所有者可以邀请朋友'), 403
        if not rate('account-invites', 15, 86400):
            return jsonify(error='今日邀请次数已达上限'), 429
        connection = control()
        with connection:
            code = accounts.issue_invite(connection)
        return jsonify(code=code, expiresIn=accounts.TOKEN_LIFETIME)

    @app.post('/api/logout')
    def logout():
        table = 'account_sessions' if g.personal_accounts else 'sessions'
        control().execute(f'DELETE FROM {table} WHERE token=?', (session_key(),))
        control().commit()
        response = jsonify(ok=True)
        response.delete_cookie('xingzou_session', secure=app.config['SECURE_COOKIE'], httponly=True, samesite='Strict')
        return response

    @app.route('/api/state', methods=['GET', 'PUT'])
    def state():
        if request.method == 'GET':
            row = db().execute('SELECT version,body FROM state WHERE id=1').fetchone()
            return jsonify(version=row['version'], state=json.loads(row['body']))
        data = request.get_json(silent=True)
        try:
            if not isinstance(data, dict) or type(data.get('version')) is not int:
                raise ValueError('Missing version')
            body = json.dumps(validate_state(data.get('state')), ensure_ascii=False)
        except (ValueError, TypeError, KeyError):
            return jsonify(error='备份数据格式不正确，云端未改动'), 400
        result = db().execute('UPDATE state SET version=version+1,body=? WHERE id=1 AND version=?', (body, data['version']))
        db().commit()
        if result.rowcount != 1:
            return jsonify(error='另一台设备已更新。请先导出当前副本，再重新加载。'), 409
        return jsonify(version=data['version'] + 1)

    @app.get('/api/readings')
    def readings():
        return jsonify(json.loads(db().execute("SELECT body FROM catalog WHERE kind='readings'").fetchone()[0]))

    @app.get('/api/images')
    def images():
        response=jsonify(image_library.active_assets(control(), image_folder))
        if request.accept_encodings['gzip']>0:
            response.set_data(gzip.compress(response.get_data(),compresslevel=5))
            response.headers['Content-Encoding']='gzip'
        response.headers['Vary']='Accept-Encoding'
        return response

    @app.get('/api/library')
    def library_catalog():
        try:
            page = max(1, int(request.args.get('page', 1)))
            limit = max(1, min(24, int(request.args.get('limit', 12))))
        except (TypeError, ValueError):
            return jsonify(error='页码不正确'), 400
        favorites = None
        if request.args.get('favorites') == '1':
            favorites = json.loads(db().execute('SELECT body FROM state WHERE id=1').fetchone()[0]).get('favs', [])
        return jsonify(reading_library.catalog(db(), q=request.args.get('q','')[:160],
            genre=request.args.get('genre','')[:40],author=request.args.get('author','')[:80],
            collection=request.args.get('collection','')[:100],page=page,limit=limit,favorites=favorites,
            preferences=json.loads(db().execute('SELECT body FROM state WHERE id=1').fetchone()[0]).get('preferences',{}).get('reading',{})))

    book_library.register(app,db,app.config.get('BOOK_FOLDER') or str(dbpath.parent / 'books'))

    @app.get('/api/library/<identifier>')
    def library_work(identifier):
        uploaded=book_library.work(db(),identifier)
        if uploaded:return jsonify(uploaded)
        row = db().execute("SELECT record FROM library_works WHERE id=? AND status='ready'", (identifier,)).fetchone()
        if not row:
            return jsonify(error='这部作品暂时无法打开'), 404
        return jsonify(json.loads(row[0]))

    @app.get('/media/library/<identifier>.jpg')
    def library_image(identifier):
        if not re.fullmatch(r'[a-z0-9-]{1,80}', identifier):
            return '', 404
        row = control().execute("SELECT id FROM image_assets WHERE id=? AND status='ready'", (identifier,)).fetchone()
        if not row:
            return '', 404
        return send_from_directory(image_folder / 'files', identifier + '.jpg', mimetype='image/jpeg')

    @app.get('/data/movies.json')
    def movies():
        return jsonify(json.loads(db().execute("SELECT body FROM catalog WHERE kind='movies'").fetchone()[0]))

    @app.get('/api/ai/status')
    def ai_status():
        return jsonify(ai_service.status())

    import reading_guide,book_study
    book_study.register(app,db)
    reading_guide.register(app,db,rate)
    reading_tools.register(app,db,rate)
    chat_threads.register(app,db,rate)
    companion.register(app,db)
    weather_service.register(app,rate)
    greeting_service.register(app,db,rate)

    @app.get('/api/assistant/history')
    def assistant_history():
        chat_threads.initialize(db());db().commit()
        return jsonify(messages=chat_threads.messages(db(),'legacy'))

    @app.post('/api/assistant/chat')
    def assistant_chat():
        if not rate('chat-minute',8,60) or not rate('ai-day',200,86400):
            return jsonify(error='对话请求较多，请稍后再试'),429
        data=request.get_json(silent=True)
        try:
            if not isinstance(data,dict) or not isinstance(data.get('selection',{}),dict):
                raise ValueError('Invalid input')
            message=ai_service.text(data.get('message'),2000)
            row=db().execute('SELECT version,body FROM state WHERE id=1').fetchone()
            state=json.loads(row['body'])
            chat_threads.initialize(db());db().commit()
            payload=dict(message=message,context=assistant_service.context(db(),state,message,data.get('selection',{})),history=[dict(role=m['role'],text=m['text']) for m in chat_threads.messages(db(),'legacy',30) if m['role'] in ('user','assistant')])
            import inspiration_creation,library_knowledge
            if inspiration_creation.requested(message) and not inspiration_creation.original_requested(message):
                plan=companion.plan(db(),message,data.get('selection',{}),payload['history'],'')
                plan=inspiration_creation.prepare_research(db(),message,data.get('selection',{}),plan)
                payload['research']=library_knowledge.retrieve(db(),message,data.get('selection',{}),plan)
            result=ai_service.complete('chat',payload)
            plan_id=secrets.token_urlsafe(24)
            db().execute('DELETE FROM assistant_plans WHERE expires<?',(int(time.time()),))
            db().execute('INSERT INTO assistant_plans VALUES (?,?,?,?,?,NULL)',(plan_id,row['version'],message,json.dumps(result,ensure_ascii=False),int(time.time())+600))
            for role,content in [('user',message),('assistant',result['reply'])]:
                db().execute('INSERT INTO assistant_messages(role,text,created_at) VALUES (?,?,?)',(role,content,str(int(time.time()))))
            # Conversation history is retained; new clients keep separate threads.
            db().commit()
            return jsonify(planId=plan_id,reply=result['reply'],actions=result['actions'])
        except (ValueError,TypeError,KeyError):
            return jsonify(error='未能确认操作对象，请明确文章名称或重试'),400
        except ai_service.AIError as error:
            return jsonify(error=str(error)),error.status

    @app.post('/api/assistant/apply')
    def assistant_apply():
        data=request.get_json(silent=True)
        if not isinstance(data,dict) or not isinstance(data.get('planId'),str):
            return jsonify(error='操作信息不完整'),400
        connection=db();connection.execute('BEGIN IMMEDIATE')
        try:
            plan=connection.execute('SELECT * FROM assistant_plans WHERE id=?',(data['planId'],)).fetchone()
            if not plan or plan['expires']<time.time() or not chat_threads.plan_allowed(connection,data['planId']):
                connection.rollback();return jsonify(error='这次操作已过期，请重新发送'),409
            if plan['result']:
                result=json.loads(plan['result'])
                current=connection.execute('SELECT version,body FROM state WHERE id=1').fetchone()
                result.update(state=json.loads(current['body']),version=current['version'],alreadyApplied=True)
                if any((a['type']=='set_preferences' and a['scope']=='inspiration') or a['type']=='create_inspiration_cards' for a in result.get('actions',[])):
                    import library_knowledge,inspiration_preferences
                    rows=library_knowledge.cached_inspirations(connection)
                    result['inspirationFeed']=dict(items=rows,status=inspiration_preferences.status(rows,result['state'].get('preferences',{}).get('inspiration',{})))
                if any(a['type']=='recommend_reading' for a in result.get('actions',[])):result['readingRecommendation']=reading_guide.current(connection)
                connection.rollback();return jsonify(result)
            row=connection.execute('SELECT version,body FROM state WHERE id=1').fetchone()
            if row['version']!=plan['version']:
                connection.rollback();return jsonify(error='文章已发生变化，本次操作未执行。请重新发送。'),409
            actions=json.loads(plan['body'])['actions'];original=json.loads(row['body'])
            state,receipts,created=assistant_service.apply_actions(original,actions)
            import inspiration_creation
            state,card_receipts,created_cards=inspiration_creation.apply(connection,state,actions)
            receipts.extend(card_receipts)
            reading_recommendation=None
            for action in actions:
                if action['type']=='recommend_reading':
                    reading_recommendation=reading_guide.save(connection,action['selection'],manual=True)
                    receipts.append('已更新本次荐读和阅读短句，共 '+str(len(reading_recommendation['ids']))+' 部作品')
            if state!=original or reading_recommendation is not None:
                state=validate_state(state);version=row['version']+1
                connection.execute('UPDATE state SET version=?,body=? WHERE id=1',(version,json.dumps(state,ensure_ascii=False)))
            else:version=row['version']
            inspiration_feed=None
            if any((a['type']=='set_preferences' and a['scope']=='inspiration') or a['type']=='create_inspiration_cards' for a in actions):
                import library_knowledge,inspiration_preferences
                cards=library_knowledge.cached_inspirations(connection)
                feed_status=inspiration_preferences.status(cards,state.get('preferences',{}).get('inspiration',{}))
                receipts.append(feed_status)
                inspiration_feed=dict(items=cards,status=feed_status)
            result=dict(state=state,version=version,receipts=receipts,created=created,actions=actions,createdInspirations=created_cards)
            if inspiration_feed is not None:result['inspirationFeed']=inspiration_feed
            if reading_recommendation is not None:result['readingRecommendation']=reading_recommendation
            connection.execute('UPDATE assistant_plans SET result=? WHERE id=?',(json.dumps(result,ensure_ascii=False),data['planId']))
            mid=None
            if receipts:mid=connection.execute('INSERT INTO assistant_messages(role,text,created_at) VALUES (?,?,?)',('system','\n'.join(receipts),str(int(time.time())))).lastrowid
            chat_threads.record_receipt(connection,data['planId'],mid,result)
            connection.commit();return jsonify(result)
        except (ValueError,KeyError,TypeError):
            connection.rollback();return jsonify(error='操作对象已变化，本次未修改内容'),409

    @app.post('/api/ai/<task>')
    def ai(task):
        if task not in ('inspiration', 'advice', 'continue'):
            return jsonify(error='接口不存在'), 404
        if not rate('ai-minute', 12, 60) or not rate('ai-day', 200, 86400):
            return jsonify(error='已达到 AI 使用限额，请稍后再试'), 429
        try:
            data = request.get_json(silent=True)
            if task=='inspiration' and isinstance(data,dict):
                preferences=json.loads(db().execute('SELECT body FROM state WHERE id=1').fetchone()[0]).get('preferences',{})
                data={**data,'preferences':preferences.get('inspiration',{})}
            ai_service.prepare(task, data)
            return jsonify(ai_service.complete(task, data))
        except (ValueError, TypeError):
            return jsonify(error='请提供有效内容，正文最多 12000 字'), 400
        except ai_service.AIError as error:
            return jsonify(error=str(error)), error.status

    @app.get('/api/<source>')
    def source(source):
        path = '/api/' + source
        query = request.args.to_dict(flat=False)
        try:
            upstream_url(path, query)
        except ValueError:
            return jsonify(error='接口不存在'), 404
        if not rate('sources', 90, 60):
            return jsonify(error='请求较多，请稍后再试'), 429
        try:
            return jsonify(public_content(path, query))
        except (OSError, ValueError, subprocess.SubprocessError):
            return jsonify(error='内容来源暂时不可用'), 502

    @app.get('/')
    def index():
        html = (ROOT / 'dist' / 'index.html').read_text()
        html = re.sub(r'  <script src="[^\"]+"></script>\n', '', html)
        return html.replace('</head>', '<link rel="stylesheet" href="/cloud.css?v=accounts-1"></head>').replace('<body>', '<body class="cloud-starting">').replace('</body>', '<script src="/auth.js?v=accounts-3"></script><script src="/cloud-boot.js?v=accounts-3"></script></body>')

    @app.get('/web-client/')
    def web_client_index():
        if g.personal_accounts:
            return redirect('/web/index.html')
        return send_from_directory(ROOT / 'web-client', 'index.html')

    @app.get('/web-client/<path:filename>')
    def web_client_static(filename):
        allowed = {'app.js', 'api.js', 'home-api.js', 'reading-api.js', 'base.css', 'layout.css'}
        if filename not in allowed:
            return jsonify(error='未找到'), 404
        return send_from_directory(ROOT / 'web-client', filename)

    @app.get('/<path:filename>')
    def static(filename):
        if filename.startswith('data/') or filename == 'index.html' or any(part.startswith('.') for part in filename.split('/')):
            return jsonify(error='未找到'), 404
        return send_from_directory(ROOT / 'dist', filename)

    return app
