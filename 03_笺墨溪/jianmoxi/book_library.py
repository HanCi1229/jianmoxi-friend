"""Private uploaded editions, chapter delivery, and original PDF pages."""
import hashlib,io,json,re,sqlite3,threading,zlib
from pathlib import Path
from flask import jsonify,request,send_file

SCHEMA='''
CREATE TABLE IF NOT EXISTS library_book_search(work_id TEXT PRIMARY KEY,search_text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS library_books(id TEXT PRIMARY KEY,source_file TEXT NOT NULL,format TEXT NOT NULL,chapter_count INTEGER NOT NULL,source_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS library_chapters(work_id TEXT NOT NULL,chapter INTEGER NOT NULL,title TEXT NOT NULL,body BLOB NOT NULL,characters INTEGER NOT NULL,PRIMARY KEY(work_id,chapter));
CREATE TABLE IF NOT EXISTS library_sources(source_hash TEXT PRIMARY KEY,filename TEXT NOT NULL,source_file TEXT NOT NULL,bytes INTEGER NOT NULL,status TEXT NOT NULL,work_id TEXT,reason TEXT NOT NULL DEFAULT '');
'''
PDF_LOCK=threading.Lock()
def initialize(db):db.executescript(SCHEMA)
def chapter(db,identifier,index):
 row=db.execute('SELECT title,body,characters FROM library_chapters WHERE work_id=? AND chapter=?',(identifier,index)).fetchone()
 if not row:return None
 return dict(index=index,title=row[0],body=json.loads(zlib.decompress(row[1])),characters=row[2])
def work(db,identifier):
 row=db.execute("SELECT w.record,b.chapter_count,b.format FROM library_works w JOIN library_books b ON b.id=w.id WHERE w.id=? AND w.status='ready'",(identifier,)).fetchone()
 if not row:return None
 r=json.loads(row[0]);r['chunked']=True;r['chapterCount']=row[1];r['format']=row[2];r['chapter']=chapter(db,identifier,0)
 r['body']=r['chapter']['body'] if r['chapter'] else []
 r['chapterDirectory']=directory(db,identifier,0)
 return r

def directory(db,identifier,start):
 return [dict(index=r[0],title=r[1]) for r in db.execute('SELECT chapter,title FROM library_chapters WHERE work_id=? AND chapter>=? ORDER BY chapter LIMIT 100',(identifier,start))]

def register(app,db,folder):
 folder=Path(folder)
 @app.get('/api/library/<identifier>/chapters/<int:index>')
 def book_chapter(identifier,index):
  row=db().execute("SELECT b.chapter_count,b.format FROM library_books b JOIN library_works w ON w.id=b.id WHERE b.id=? AND w.status='ready'",(identifier,)).fetchone()
  if not row or index<0 or index>=row[0]:return jsonify(error='没有这一章节'),404
  r=chapter(db(),identifier,index);r.update(chapterCount=row[0],format=row[1],directory=directory(db(),identifier,index//100*100));return jsonify(r)

 @app.get('/api/library/<identifier>/cover')
 def book_cover(identifier):
  if not re.fullmatch(r'upload-[a-z0-9-]{1,80}',identifier):return jsonify(error='没有这张封面'),404
  row=db().execute("SELECT record FROM library_works WHERE id=? AND status='ready'",(identifier,)).fetchone()
  if not row or not json.loads(row[0]).get('bookCover'):return jsonify(error='暂无封面'),404
  path=folder/'covers'/(identifier+'.jpg')
  if not path.is_file():return jsonify(error='暂无封面'),404
  return send_file(path,mimetype='image/jpeg',conditional=True)

 @app.get('/api/library/<identifier>/source')
 def book_source(identifier):
  row=db().execute("SELECT b.source_file,s.filename FROM library_books b JOIN library_sources s ON s.source_hash=b.source_hash JOIN library_works w ON w.id=b.id WHERE b.id=? AND w.status='ready'",(identifier,)).fetchone()
  if not row or not re.fullmatch(r'[a-f0-9]{64}\.(epub|txt|pdf|azw3)',row[0]):return jsonify(error='原文件暂不可用'),404
  path=folder/'sources'/row[0]
  if not path.is_file():return jsonify(error='原文件暂不可用'),404
  return send_file(path,as_attachment=True,download_name=Path(row[1]).name)

 @app.get('/api/library/<identifier>/pages/<int:index>')
 def book_page(identifier,index):
  row=db().execute("SELECT b.source_file,b.chapter_count FROM library_books b JOIN library_works w ON w.id=b.id WHERE b.id=? AND b.format='pdf' AND w.status='ready'",(identifier,)).fetchone()
  if not row or index<0 or index>=row[1] or not re.fullmatch(r'[a-f0-9]{64}\.pdf',row[0]):return jsonify(error='没有这一页'),404
  path=folder/'sources'/row[0]
  if not path.is_file():return jsonify(error='原文件暂不可用'),404
  try:
   with PDF_LOCK:
    import fitz
    with fitz.open(path) as document:
     page=document[index];scale=min(2,1200/max(page.rect.width,1));image=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False).tobytes('jpeg',jpg_quality=85)
   return send_file(io.BytesIO(image),mimetype='image/jpeg')
  except (RuntimeError,ValueError,OSError,ImportError):return jsonify(error='原页暂时无法打开，可切换文字阅读'),503

def merge(db,bundle):
 """Idempotent batch merge; the caller owns the production transaction."""
 initialize(db);db.execute('ATTACH DATABASE ? AS uploaded',(str(bundle),))
 try:
  db.execute('BEGIN IMMEDIATE')
  before=db.execute('SELECT count(*) FROM library_works').fetchone()[0]
  for table in ('library_works','library_books','library_chapters','library_sources','library_book_search'):
   db.execute('INSERT OR IGNORE INTO '+table+' SELECT * FROM uploaded.'+table)
  db.commit();added=db.execute('SELECT count(*) FROM library_works').fetchone()[0]-before
  if added:
   import library_knowledge
   path=library_knowledge.index_path(db)
   if path and path.exists():library_knowledge.build(db)
  return added
 except Exception:db.rollback();raise
 finally:db.execute('DETACH DATABASE uploaded')
