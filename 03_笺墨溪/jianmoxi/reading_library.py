"""Queryable reading library. Full text is fetched only when opening a work."""
import hashlib,json,re,sqlite3
from pathlib import Path

SCHEMA='''CREATE TABLE IF NOT EXISTS library_works (
 id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,genre TEXT NOT NULL,
 collection TEXT NOT NULL,sort_order INTEGER NOT NULL,characters INTEGER NOT NULL,
 search_text TEXT NOT NULL,body_hash TEXT NOT NULL,record TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ready');
 CREATE INDEX IF NOT EXISTS library_status ON library_works(status);
 CREATE TABLE IF NOT EXISTS library_book_search(work_id TEXT PRIMARY KEY,search_text TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS library_author ON library_works(author);
 CREATE INDEX IF NOT EXISTS library_genre ON library_works(genre);
 CREATE TABLE IF NOT EXISTS library_import_runs(id INTEGER PRIMARY KEY,finished_at TEXT NOT NULL,body TEXT NOT NULL);
'''

def initialize(db):db.executescript(SCHEMA)

def import_records(db,records):
 prepared=[]
 for r in records:
  if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',r.get('id','')):raise ValueError('Invalid ID')
  if not all(isinstance(r.get(k),str) and r[k].strip() for k in ('title','author','sourceUrl')):raise ValueError('Missing source')
  if not (r['sourceUrl'].startswith('https://zh.wikisource.org/') or r['sourceUrl'] in (
   'https://github.com/sun510001/luxun_dataset/blob/master/data_dir/luxun.json',
   'https://github.com/chinese-poetry/chinese-poetry/blob/master/蒙学/tangshisanbaishou.json',
   'https://github.com/chinese-poetry/chinese-poetry/blob/master/蒙学/guwenguanzhi.json')):raise ValueError('Unexpected source')
  if not isinstance(r.get('body'),list) or not r['body'] or not all(isinstance(p,str) and p for p in r['body']):raise ValueError('Missing full text')
  text='\n'.join(r['body']);characters=len(text)
  if not 20<=characters<=1000000:raise ValueError('Invalid length')
  r={**r,'characters':characters,'genre':r.get('genre','散文'),'category':r.get('genre','散文'),'collection':r.get('collection','')}
  prepared.append((r['id'],r['title'],r['author'],r['genre'],r['collection'],r.get('collectionOrder',0),characters,
    r['title']+' '+r['author']+' '+r['collection']+' '+text,hashlib.sha256(text.encode()).hexdigest(),json.dumps(r,ensure_ascii=False)))
 initialize(db)
 before_changes=db.total_changes
 with db:
  for row in prepared:
   # A refreshed provider never overwrites an existing published edition.
   db.execute('INSERT OR IGNORE INTO library_works(id,title,author,genre,collection,sort_order,characters,search_text,body_hash,record) VALUES (?,?,?,?,?,?,?,?,?,?)',row)
 if db.total_changes>before_changes:
  import library_knowledge
  path=library_knowledge.index_path(db)
  if path and path.exists():library_knowledge.build(db)
 return len(prepared)

def metadata(record):
 r=dict(record);r.pop('body',None);r.pop('sections',None);return r

def catalog(db,q='',genre='',author='',collection='',page=1,limit=12,favorites=None,preferences=None):
 conditions=["status='ready'"];args=[]
 for column,value in [('genre',genre),('author',author),('collection',collection)]:
  if value:conditions.append(column+'=?');args.append(value)
 if q:
  pattern="%"+q.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"
  conditions.append("(search_text LIKE ? ESCAPE '\\' OR id IN (SELECT work_id FROM library_book_search WHERE search_text LIKE ? ESCAPE '\\'))");args.extend([pattern,pattern])
 if favorites is not None:
  conditions.append('id IN ('+','.join('?' for _ in favorites)+')' if favorites else '0');args.extend(favorites)
 where=' AND '.join(conditions)
 total=db.execute('SELECT count(*) FROM library_works WHERE '+where,args).fetchone()[0]
 pages=max(1,(total+limit-1)//limit);page=min(max(1,page),pages)
 priority="CASE title WHEN '盗墓笔记' THEN 0 WHEN '诡秘之主' THEN 1 WHEN '剑来' THEN 2 WHEN '三体全集' THEN 3 WHEN '活着' THEN 4 WHEN '我与地坛' THEN 5 WHEN '文化苦旅' THEN 6 WHEN '雪中悍刀行' THEN 7 ELSE 20 END"
 order='sort_order,title,id' if collection else "CASE WHEN id LIKE 'upload-%' THEN 0 ELSE 1 END,priority,author_round,genre,author,title,id"
 order_args=[]
 if preferences and not any((q,genre,author,collection)):
  scores=[]
  for column,key,weight in [('author','authors',6),('genre','genres',3)]:
   for value in preferences.get(key,[])[:12]:scores.append('CASE WHEN '+column+'=? THEN '+str(weight)+' ELSE 0 END');order_args.append(value)
  for value in preferences.get('keywords',[])[:12]:scores.append('CASE WHEN instr((SELECT search_text FROM library_works w WHERE w.id=ranked.id),?)>0 THEN 2 ELSE 0 END');order_args.append(value)
  if scores:order='('+ '+'.join(scores)+') DESC,'+order
 if q:
  order='CASE WHEN title=? THEN 0 WHEN instr(title,?)>0 THEN 1 WHEN author=? THEN 2 ELSE 3 END,'+order
  order_args=[q,q,q]+order_args
 cte='WITH ranked AS (SELECT id,author,genre,title,sort_order,record,'+priority+' AS priority,ROW_NUMBER() OVER (PARTITION BY genre,author ORDER BY '+priority+',sort_order,title,id) AS author_round FROM library_works WHERE '+where+') '
 rows=db.execute(cte+'SELECT record FROM ranked ORDER BY '+order+' LIMIT ? OFFSET ?',args+order_args+[limit,(page-1)*limit]).fetchall()
 authors=[dict(name=r[0],count=r[1]) for r in db.execute("SELECT author,count(*) FROM library_works WHERE status='ready' GROUP BY author ORDER BY count(*) DESC,author")]
 genres=[dict(name=r[0],count=r[1]) for r in db.execute("SELECT genre,count(*) FROM library_works WHERE status='ready' GROUP BY genre ORDER BY count(*) DESC")]
 collections=[dict(title=r[0],author=r[1],count=r[2]) for r in db.execute("SELECT collection,group_concat(DISTINCT author),count(*) FROM library_works WHERE status='ready' AND collection!='' GROUP BY collection HAVING count(*)>=2 ORDER BY count(*) DESC")]
 return dict(items=[metadata(json.loads(r[0])) for r in rows],total=total,page=page,pages=pages,pageSize=limit,authors=authors,genres=genres,collections=collections,libraryTotal=sum(r['count'] for r in authors))

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--file',required=True);a=p.parse_args()
 with sqlite3.connect(a.db) as db:print('validated works',import_records(db,json.loads(Path(a.file).read_text())))
