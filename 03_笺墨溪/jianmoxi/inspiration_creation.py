"""Create source-checked cards through versioned assistant plans, in the app transaction."""
import hashlib,json,os,re,time
import library_knowledge as library
import inspiration_preferences as preferences

SCHEMA='''CREATE TABLE IF NOT EXISTS created_inspirations(
 id TEXT PRIMARY KEY,work_id TEXT,source_hash TEXT,body TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS created_inspiration_work ON created_inspirations(work_id);'''
EXCERPT_POLICY='requested-literary-v1'
ORIGINAL_POLICY='original-literary-v1'
THEMES=('爱与牵挂','孤独与自我','成长与告别','自由与远方','日常与慰藉')
def initialize(db):db.executescript(SCHEMA)
def requested(message):
 return bool(re.search(r'卡片|灵感|文案',message) and re.search(r'做|制作|生成|产出|来|给|补充|加|放|换|更新|推荐|一批|几张',message) and not re.search(r'(?:不要|不用|别|不必).{0,6}(?:生成|制作|做|加|换|更新)',message))
def original_requested(message):return bool(re.search(r'原创|你(?:自己)?(?:来)?写|自己创作',message))
def prepare_research(db,message,selection,plan):
 """A card request also needs retrieval, even if the planner calls it a product operation."""
 plan=dict(plan)
 if requested(message) and not original_requested(message):
  plan['search']=True
  if not plan.get('queries') and not plan.get('chapters'):plan['overview']=True
 return plan

def validate_action(action,data):
 import ai_service
 if not requested(data['message']):raise ValueError('没有要求制作卡片')
 mode=action.get('mode','excerpt');items=action.get('items')
 if mode not in ('excerpt','original') or not isinstance(items,list) or not 1<=len(items)<=12:raise ValueError('每批卡片需为1至12条')
 if mode=='original' and not original_requested(data['message']):raise ValueError('未要求原创，不可用原创替代原文')
 sources={s['id']:s for s in data.get('research',{}).get('sources',[])};cards=[];seen=set()
 for row in items:
  if not isinstance(row,dict):raise ValueError('卡片格式无效')
  quote=ai_service.text(row.get('quote'),70)
  if len(quote)<8:raise ValueError('卡片内容过短')
  if row.get('quality') not in ('哲思','文笔'):raise ValueError('卡片需要文学表达或思考价值')
  source=None
  if mode=='excerpt':
   source=sources.get(row.get('sourceId'))
   if not source:raise ValueError('摘句不在本次检索的原文中')
   quote=library.source_quote(quote,source['text'])
   if not quote or not 8<=len(quote)<=70 or quote not in source['text']:raise ValueError('摘句与原文不符')
   provenance=dict(author=source['author'],work=source['title'],quote=quote,note='书库原文',verified=True,readingId=source['workId'],chapter=source['chapter'],chapterTitle=source['chapterTitle'],sourceId=source['id'])
   identity=source['workId']+'|'+str(source['chapter'])+'|'+quote
  else:
   if any(quote in s.get('text','') for s in sources.values()) or any(quote==r.get('quote') for r in data.get('context',{}).get('inspirationChoices',[])):raise ValueError('不能把已知书籍摘句标成原创')
   name=data.get('context',{}).get('companion',{}).get('profile',{}).get('name','小溪')
   provenance=dict(author=ai_service.text(name,40),work='AI 原创',quote=quote,note='AI 原创文案，非书籍原文',verified=False)
   identity=name+'|'+quote
  key=re.sub(r'\s+','',quote)
  if key in seen:raise ValueError('卡片内容重复')
  seen.add(key)
  themes=row.get('themes',[])
  if not isinstance(themes,list) or not themes or any(t not in THEMES for t in themes):raise ValueError('无效的情感主题')
  summary=ai_service.text(row.get('summary'),160);interpretation=ai_service.text(row.get('interpretation'),1000)
  cards.append(dict(id=('created-' if source else 'original-')+hashlib.sha256(identity.encode()).hexdigest()[:24],contentKind=mode,editorialPolicy=EXCERPT_POLICY if source else ORIGINAL_POLICY,literaryQuality=row['quality'],topic=themes[0],themes=list(dict.fromkeys(themes))[:2],img='forest',summary=summary,short=summary,desc=interpretation,interpretation=interpretation,questions=[],promptKind='ai',source=provenance))
 return dict(type='create_inspiration_cards',mode=mode,cards=cards)

def source_url(source):
 base=os.environ.get('PUBLIC_ORIGIN','https://49.234.43.25').rstrip('/')
 # Cards use the existing HTTPS source link contract.
 if not base.startswith('https://'):base='https://49.234.43.25'
 return base+'/api/library/'+source['readingId']+'/source' if source.get('readingId') else base+'/#inspiration'

def save_cards(db,cards):
 """Called inside BEGIN IMMEDIATE; fail the entire batch if a source has changed."""
 written=[];used=set()
 assets=[json.loads(r[0]) for r in db.execute("SELECT body FROM image_assets WHERE status='ready' ORDER BY id")]
 with library.connect(db) as k:
  for raw in cards:
   card=json.loads(json.dumps(raw));s=card['source'];digest=None;wid=s.get('readingId')
   if card['contentKind']=='excerpt':
    if k is None or not re.fullmatch(r'P\d+',s['sourceId']):raise ValueError('原文索引暂不可用')
    p=k.execute('SELECT * FROM passages WHERE id=?',(int(s['sourceId'][1:]),)).fetchone()
    current=library.canonical(db,k,p) if p else None
    if not current or current['workId']!=wid or current['chapter']!=s['chapter'] or s['quote'] not in current['text']:raise ValueError('原文已经变化，请重新制作卡片')
    import reading_tools
    reading_tools.selection(db,dict(workId=wid,chapter=s['chapter'],text=s['quote']))
    s.update(author=current['author'],work=current['title'],chapterTitle=current['chapterTitle'])
    digest=db.execute("SELECT body_hash FROM library_works WHERE id=? AND status='ready'",(wid,)).fetchone()[0]
   s['url']=source_url(s)
   # Persist a real active photo/scenery ID; the client replaces retired assets safely.
   available=[a for a in assets if a['id'] not in used] or assets
   if available:
    photo=available[int(hashlib.sha256(card['id'].encode()).hexdigest()[:8],16)%len(available)]
    card['coverId']=photo['id'];used.add(photo['id'])
   db.execute('INSERT INTO created_inspirations VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_hash=excluded.source_hash,body=excluded.body',(card['id'],wid,digest,json.dumps(card,ensure_ascii=False),int(time.time())))
   written.append(card)
 return written

def apply(db,state,actions):
 batches=[a for a in actions if a['type']=='create_inspiration_cards']
 if not batches:return state,[],[]
 if len(batches)!=1:raise ValueError('一次只制作一批卡片')
 cards=save_cards(db,batches[0]['cards']);ids=[r['id'] for r in cards]
 state.setdefault('preferences',{}).setdefault('inspiration',{}).update(selectedIds=ids,selectionDay=preferences.today(),selectionMode='created')
 return state,['已保存并展示 '+str(len(cards))+' 张'+('原创' if batches[0]['mode']=='original' else '原文摘句')+'卡片'],ids

def stored_pool(db):
 if not db.execute("SELECT 1 FROM sqlite_master WHERE name='created_inspirations'").fetchone():return []
 ready={r[0]:r[1] for r in db.execute("SELECT id,body_hash FROM library_works WHERE status='ready'")}
 rows=[]
 for wid,digest,body in db.execute('SELECT work_id,source_hash,body FROM created_inspirations ORDER BY created_at DESC,id LIMIT 3000'):
  card=json.loads(body)
  if wid and ready.get(wid)!=digest:continue
  rows.append(card)
 return rows
