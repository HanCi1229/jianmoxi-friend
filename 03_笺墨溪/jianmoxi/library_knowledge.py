"""Source-grounded full-library retrieval. The derived index lives beside, not inside, user data."""
import contextlib, hashlib, json, re, sqlite3, time, zlib, unicodedata, os, datetime
from pathlib import Path

SCHEMA='''PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS documents(work_id TEXT PRIMARY KEY,source_hash TEXT NOT NULL,metadata TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passages(id INTEGER PRIMARY KEY,work_id TEXT NOT NULL,chapter INTEGER NOT NULL,part INTEGER NOT NULL,chapter_title TEXT NOT NULL,body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS passage_location ON passages(work_id,chapter,part);
CREATE VIRTUAL TABLE IF NOT EXISTS passage_search USING fts5(words,content='');
CREATE TABLE IF NOT EXISTS analyses(work_id TEXT PRIMARY KEY,source_hash TEXT NOT NULL,body TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inspirations(id TEXT PRIMARY KEY,work_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS index_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
'''
def index_path(db):
    path=db.execute('PRAGMA database_list').fetchone()[2]
    return Path(path).with_name('knowledge.db') if path else None
@contextlib.contextmanager
def connect(db,create=False):
    path=index_path(db)
    if path is None or (not create and not path.exists()):yield None;return
    c=sqlite3.connect(str(path),timeout=20);c.row_factory=sqlite3.Row
    try:
        if create:
            c.executescript(SCHEMA);owner=Path(db.execute('PRAGMA database_list').fetchone()[2]).stat()
            for f in path.parent.glob(path.name+'*'):
                if hasattr(os,'geteuid') and os.geteuid()==0:os.chown(f,owner.st_uid,owner.st_gid)
                f.chmod(0o600)
        yield c
    finally:c.close()
def tokens(value):
    chunks=re.findall(r'[\u3400-\u9fff]+|[a-zA-Z0-9]+',value.lower());out=[]
    for s in chunks:
        if re.match('[\u3400-\u9fff]',s):out.extend(s[i:i+2] for i in range(len(s)-1))
        else:out.append(s)
    return ' '.join(out)
def sections(db,work):
    if work.get('chunked') or db.execute('SELECT 1 FROM library_books WHERE id=?',(work['id'],)).fetchone():
        for r in db.execute('SELECT chapter,title,body FROM library_chapters WHERE work_id=? ORDER BY chapter',(work['id'],)):
            yield r[0],r[1],json.loads(zlib.decompress(r[2]))
    else:
        body=work.get('body',[]);parts=work.get('sections',[])
        if parts:
            for i,s in enumerate(parts):yield i,s['title'],body[s['start']:parts[i+1]['start'] if i+1<len(parts) else len(body)]
        else:yield 0,work['title'],body

def build(db,progress=None):
    """Incremental, per-book transactions; never writes the application's database."""
    with connect(db,True) as k:
        ready=set();works=0
        for row in db.execute("SELECT id,body_hash,record FROM library_works WHERE status='ready' ORDER BY id"):
            wid,digest,raw=row;ready.add(wid);work=json.loads(raw)
            old=k.execute('SELECT source_hash FROM documents WHERE work_id=?',(wid,)).fetchone()
            if old and old[0]==digest:works+=1;continue
            with k:
                for p in k.execute('SELECT id,body FROM passages WHERE work_id=?',(wid,)).fetchall():k.execute("INSERT INTO passage_search(passage_search,rowid,words) VALUES ('delete',?,?)",(p[0],tokens(p[1])))
                k.execute('DELETE FROM passages WHERE work_id=?',(wid,));k.execute('DELETE FROM analyses WHERE work_id=?',(wid,));k.execute('DELETE FROM inspirations WHERE work_id=?',(wid,))
                count=0
                for chapter,title,paras in sections(db,work):
                    body='\n'.join(paras)
                    for part,start in enumerate(range(0,len(body),1400)):
                        excerpt=body[start:start+1600]
                        if not excerpt.strip():continue
                        pid=k.execute('INSERT INTO passages(work_id,chapter,part,chapter_title,body) VALUES (?,?,?,?,?)',(wid,chapter,part,title,excerpt)).lastrowid
                        k.execute('INSERT INTO passage_search(rowid,words) VALUES (?,?)',(pid,tokens(excerpt)));count+=1
                metadata={key:work.get(key) for key in ('id','title','author','genre','collection','intro','year','sourceName','sourceUrl','characters','chunked','chapterCount','bookCover','coverId')}
                metadata['indexedPassages']=count
                k.execute('INSERT OR REPLACE INTO documents VALUES (?,?,?)',(wid,digest,json.dumps(metadata,ensure_ascii=False)))
            works+=1
            if progress and works%20==0:progress(works)
        stale=[r[0] for r in k.execute('SELECT work_id FROM documents') if r[0] not in ready]
        with k:
            for wid in stale:
                for p in k.execute('SELECT id,body FROM passages WHERE work_id=?',(wid,)).fetchall():k.execute("INSERT INTO passage_search(passage_search,rowid,words) VALUES ('delete',?,?)",(p[0],tokens(p[1])))
                for table in ('passages','documents','analyses','inspirations'):k.execute('DELETE FROM '+table+' WHERE work_id=?',(wid,))
            k.execute('INSERT OR REPLACE INTO index_state VALUES (?,?)',('updated',str(int(time.time()))))
        k.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        return dict(works=works,passages=k.execute('SELECT count(*) FROM passages').fetchone()[0])
def stats(db):
    with connect(db) as k:
        if k is None:return dict(works=0,passages=0,analysed=0)
        return dict(works=k.execute('SELECT count(*) FROM documents').fetchone()[0],passages=k.execute('SELECT count(*) FROM passages').fetchone()[0],analysed=k.execute('SELECT count(*) FROM analyses').fetchone()[0])
def canonical(db,k,p):
    r=db.execute("SELECT record FROM library_works WHERE id=? AND status='ready'",(p['work_id'],)).fetchone()
    if not r:return None
    w=json.loads(r[0]);return dict(id='P'+str(p['id']),workId=w['id'],title=w['title'],author=w['author'],genre=w.get('genre',''),chapter=p['chapter'],chapterTitle=p['chapter_title'],part=p['part'],text=p['body'],sourceUrl=w.get('sourceUrl',''))
def resolve_books(db,message,selection,plan):
    found=[]
    for wid,title,author in db.execute("SELECT id,title,author FROM library_works WHERE status='ready' ORDER BY length(title) DESC"):
        if len(title)>1 and title in message:found.append(wid)
    explicit=bool(found)
    if not found:
        for title in plan.get('titles',[])[:3]:
            found.extend(r[0] for r in db.execute("SELECT id FROM library_works WHERE status='ready' AND (title=? OR title LIKE ?) ORDER BY length(title) LIMIT 3",(title,'%'+title+'%')))
    if not found and selection.get('readingId'):found=[selection['readingId']]
    return list(dict.fromkeys(found))[:3],explicit

def retrieve(db,message,selection,plan):
    book_ids,_=resolve_books(db,message,selection,plan);sources=[];books=[]
    with connect(db) as k:
        if k is None:return dict(books=[],sources=[],coverage='正文索引尚未就绪，不能声称读过全书。')
        def add(rows):
            for p in rows:
                item=canonical(db,k,p)
                if item and not any(s['id']==item['id'] for s in sources):sources.append(item)
        requested=plan.get('chapters',[])
        selected=selection.get('readingSelection')
        if selected and selected['workId'] in book_ids and not plan.get('overview'):requested=[selected['chapter']]+requested
        elif type(selection.get('chapter')) is int and selection.get('readingId') in book_ids and not plan.get('overview'):requested=[selection['chapter']]+requested
        for wid in book_ids:
            r=k.execute('SELECT metadata FROM documents WHERE work_id=?',(wid,)).fetchone()
            if not r:continue
            meta=json.loads(r[0]);directory=[dict(chapter=p[0],title=p[1]) for p in k.execute('SELECT chapter,chapter_title FROM passages WHERE work_id=? GROUP BY chapter ORDER BY chapter',(wid,))]
            meta['chapterCount']=len(directory);meta['directory']=directory[:160];meta['directoryTruncated']=len(directory)>160
            cached=k.execute('SELECT body FROM analyses WHERE work_id=?',(wid,)).fetchone()
            if cached:meta['analysis']=json.loads(cached[0])
            import book_study
            study=book_study.evidence(db,wid,requested)
            if study:
                meta['study']=study
                if study.get('complete'):meta['analysis']=study['analysis']
            books.append(meta)
            if not requested:
                for quote in book_study.quotes(db,work_id=wid,limit=4)['items']:
                    for passage in k.execute('SELECT * FROM passages WHERE work_id=? AND chapter=? ORDER BY part',(wid,quote['chapter'])):
                        if quote['quote'] in passage['body']:
                            add([passage]);break
            if requested:
                for ch in list(dict.fromkeys(requested))[:5]:
                    add(k.execute('SELECT * FROM passages WHERE work_id=? AND chapter=? ORDER BY part LIMIT ?',(wid,ch,max(2,min(8,24//len(set(requested)))))))
                for ch in [max(0,min(requested)-1),max(requested)+1]:add(k.execute('SELECT * FROM passages WHERE work_id=? AND chapter=? ORDER BY part LIMIT 1',(wid,ch)))
            elif plan.get('overview'):
                # Broad coverage is sampled and explicitly labelled, never passed off as a complete read.
                count=k.execute('SELECT count(*) FROM passages WHERE work_id=?',(wid,)).fetchone()[0]
                for i in sorted(set(round(j*(count-1)/7) for j in range(8))) if count else []:
                    add(k.execute('SELECT * FROM passages WHERE work_id=? ORDER BY chapter,part LIMIT 1 OFFSET ?',(wid,i)))
        terms=plan.get('queries',[])[:6]
        if not terms:terms=re.findall(r'[\u3400-\u9fffA-Za-z0-9]{2,20}',message)[:4]
        pieces=[]
        for term in terms:
            words=list(dict.fromkeys(tokens(term).split()))[:15]
            if words:pieces.append('('+' AND '.join('"'+x+'"' for x in words)+')')
        if pieces:
            sql='SELECT p.* FROM passage_search JOIN passages p ON p.id=passage_search.rowid WHERE passage_search MATCH ?';args=[' OR '.join(pieces)]
            if book_ids:sql+=' AND p.work_id IN ('+','.join('?' for _ in book_ids)+')';args+=book_ids
            sql+=' ORDER BY bm25(passage_search) LIMIT 12'
            add(k.execute(sql,args))
        if not sources:
            for wid in book_ids:add(k.execute('SELECT * FROM passages WHERE work_id=? ORDER BY chapter,part LIMIT 3',(wid,)))
        # A selected quotation must be represented even when it falls late in a long chapter.
        if selected:
            hits=k.execute('SELECT * FROM passages WHERE work_id=? AND chapter=? ORDER BY part',(selected['workId'],selected['chapter']))
            needle=re.sub(r'\s+','',selected['text'])[:100]
            for p in hits:
                if needle and needle in re.sub(r'\s+','',p['body']):
                    item=canonical(db,k,p)
                    if item:sources=[item]+[s for s in sources if s['id']!=item['id']]
                    break
        # Collect the bibliographic identity of globally retrieved works too.
        for wid in dict.fromkeys(s['workId'] for s in sources):
            if not any(b['id']==wid for b in books):
                r=k.execute('SELECT metadata FROM documents WHERE work_id=?',(wid,)).fetchone()
                if r:books.append(json.loads(r[0]))
    sources=sources[:36];total=sum(len(s['text']) for s in sources)
    while total>44000 and sources:total-=len(sources.pop()['text'])
    return dict(books=books,sources=sources,coverage='仅本次列出的原文片段和目录是已查阅证据。原文检索可能为跨章抽样；books.study.complete为真表示后台已逐段分析并分层归纳，非本次逐字通读；未完成时不得声称读完。版本章节编号以书库为准，chapter 从0开始。')
def source_quote(quote,body):
    """Recover the literal source spelling when a model only changes spacing/punctuation."""
    if quote in body:return quote
    def core(s):return ''.join(c for c in s if not c.isspace() and not unicodedata.category(c).startswith('P'))
    needle=core(quote)
    if len(needle)<4:return None
    positions=[i for i,c in enumerate(body) if not c.isspace() and not unicodedata.category(c).startswith('P')]
    at=core(body).find(needle)
    if at<0:return None
    start,end=positions[at],positions[at+len(needle)-1]+1
    while end<len(body) and body[end] in '。！？!?，,；;：:”’」』':end+=1
    return body[start:end]

def validated_citations(value,research):
    allowed={s['id']:s for s in research.get('sources',[])};out=[]
    if not isinstance(value,list) or len(value)>12:raise ValueError('引用格式无效')
    for c in value:
        if not isinstance(c,dict) or c.get('sourceId') not in allowed:raise ValueError('引用不在本次查阅范围')
        s=allowed[c['sourceId']];quote=c.get('quote','')
        if isinstance(quote,str):quote=source_quote(quote,s['text'])
        if not isinstance(quote,str) or not 4<=len(quote)<=300 or re.sub(r'\s+','',quote) not in re.sub(r'\s+','',s['text']):raise ValueError('引用与原文不符')
        out.append({key:s[key] for key in ('id','workId','title','author','chapter','chapterTitle','part')}|dict(quote=quote))
    return out

def classical(meta):
    return meta.get('genre')=='古文' or (meta.get('genre')=='诗歌' and any(x in str(meta) for x in ('chinese-poetry','唐诗','宋词','全唐','唐詩','古诗','古詩')))
LITERARY_POLICY='literary-prose-v1'
CLASSIC_AUTHORS=tuple('鲁迅 朱自清 老舍 沈从文 巴金 余华 莫言 张爱玲 钱钟书 史铁生 汪曾祺 郁达夫 冰心 丰子恺 萧红 林语堂 陈忠实 阿城 王小波 杨绛 茅盾 孙犁 季羡林 迟子建 毕淑敏 张晓风 三毛 梭罗 爱默生 蒙田 川端康成 夏目漱石 太宰治 芥川龙之介 泰戈尔 纪伯伦 马尔克斯 博尔赫斯 加缪 卡夫卡 黑塞 里尔克 普鲁斯特 托尔斯泰 陀思妥耶夫斯基 契诃夫 屠格涅夫 雨果 巴尔扎克 福楼拜 海明威 伍尔夫 奥斯丁 狄更斯'.split())
def literary_eligible(meta):
    genre=meta.get('genre','') or '';author=meta.get('author','') or ''
    if genre in ('网络小说','诗歌','古文','歌词','电影','戏剧'):return False
    return genre=='散文' or (genre in ('小说','人文社科','文学') and any(a in author for a in CLASSIC_AUTHORS))


def seed_public_inspiration(db, works):
    """Seed a new workspace exclusively from the bundled editions."""
    seen = set()
    rows = []
    for work in works:
        if work['author'] in seen or not literary_eligible(work):
            continue
        excerpt = next((line.strip() for paragraph in work['body'][:4]
                        for line in re.split(r'(?<=[。！？])', paragraph)
                        if 16 <= len(line.strip()) <= 70), '')
        if not excerpt:
            continue
        wid = work['id']
        card_id = 'starter-' + wid
        card = dict(id=card_id, topic='文学', short='从一句话开始',
                    desc='挑一个让你停下来的词，想想它让你记起了什么。',
                    questions=['你读到这里时，先想起了哪一个细节？'],
                    editorialPolicy=LITERARY_POLICY, readingId=wid,
                    source=dict(quote=excerpt, author=work['author'], work=work['title'],
                                readingId=wid, verified=True, url=work['sourceUrl'],
                                note='书库原文节选'))
        rows.append((card_id, wid, json.dumps(card, ensure_ascii=False), int(time.time())))
        seen.add(work['author'])
        if len(rows) == 12:
            break
    with connect(db) as index, index:
        index.executemany('INSERT OR IGNORE INTO inspirations VALUES (?,?,?,?)', rows)


def inspiration_candidates(db,cursor):
    out=[]
    with connect(db) as k:
        if k is None:return []
        docs=[json.loads(r[0]) for r in k.execute('SELECT metadata FROM documents ORDER BY work_id')]
        pool=[d for d in docs if literary_eligible(d)];chosen=[];authors=set()
        for i in range(len(pool)):
            d=pool[(cursor*7+i)%len(pool)]
            if d.get('author') in authors:continue
            chosen.append(d);authors.add(d.get('author'))
            if len(chosen)==6:break
        for d in chosen:
            count=k.execute('SELECT count(*) FROM passages WHERE work_id=?',(d['id'],)).fetchone()[0]
            if not count:continue
            p=k.execute('SELECT * FROM passages WHERE work_id=? ORDER BY chapter,part LIMIT 1 OFFSET ?',(d['id'],(cursor*13+count//3)%count)).fetchone()
            source=canonical(db,k,p)
            if source:source['classical']=False;out.append(source)
    return out

def curate(db,cursor):
    import ai_service
    sources=inspiration_candidates(db,cursor)
    if not sources:return []
    result=ai_service.complete('library_inspiration',{'sources':sources});items=result['items']
    with connect(db,True) as k, k:
        for item in items:k.execute('INSERT OR REPLACE INTO inspirations VALUES (?,?,?,?)',(item['id'],item['source']['readingId'],json.dumps(item,ensure_ascii=False),int(time.time())))
    return items

DAILY_INSPIRATION_COUNT = 30

def inspiration_pool(db):
    import inspiration_creation as creation
    ready={r[0]:json.loads(r[1]) for r in db.execute("SELECT id,record FROM library_works WHERE status='ready'")}
    import book_study
    rows=book_study.cards(db)+creation.stored_pool(db)
    with connect(db) as k:
        if k is not None:rows += [json.loads(r[0]) for r in k.execute('SELECT body FROM inspirations ORDER BY created_at DESC,id LIMIT 3000')]
    out=[];seen=set()
    for r in rows:
        source=r.get('source',{});quote=source.get('quote','');policy=r.get('editorialPolicy');work=ready.get(source.get('readingId'))
        if not isinstance(quote,str) or not 8<=len(quote)<=70 or not source.get('author') or not source.get('work'):continue
        if policy==creation.ORIGINAL_POLICY:
            if r.get('contentKind')!='original' or source.get('verified') or source.get('readingId'):continue
        elif policy in (LITERARY_POLICY,creation.EXCERPT_POLICY):
            if not work or not source.get('verified'):continue
            if policy==LITERARY_POLICY and (not literary_eligible(work) or len(quote)<16):continue
        else:continue
        key=(source.get('readingId','original'),re.sub(r'\s+','',quote))
        if key in seen:continue
        seen.add(key);out.append(dict(r,genre=(work or {}).get('genre','')))
    return out

def inspiration_preferences(db):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='state'").fetchone():return {}
    row=db.execute('SELECT body FROM state WHERE id=1').fetchone()
    return json.loads(row[0]).get('preferences',{}).get('inspiration',{}) if row else {}

def cached_inspirations(db,cursor=0,day=None,preferences=None):
    import inspiration_preferences as policy
    prefs=inspiration_preferences(db) if preferences is None else preferences
    day=day or policy.today()
    def rank(value):return hashlib.sha256((day+'|'+str(cursor)+'|'+value).encode()).hexdigest()
    pool=inspiration_pool(db)
    selected=prefs.get('selectedIds',[]) if prefs.get('selectionDay')==day else None
    # An explicitly requested batch wins today without erasing long-term filters.
    if selected is not None and prefs.get('selectionMode')=='created':
        by_id={r['id']:r for r in pool if r.get('editorialPolicy') in ('requested-literary-v1','original-literary-v1')}
        return [by_id[i] for i in selected if i in by_id][:DAILY_INSPIRATION_COUNT]
    rows=[r for r in pool if policy.allows(r,prefs)]
    if selected is not None:
        by_id={r['id']:r for r in rows};rows=[by_id[i] for i in selected if i in by_id]
    else:rows.sort(key=lambda r:(-policy.score(r,prefs),rank(r['id'])))
    groups={}
    for r in rows:groups.setdefault(r['source']['author'],[]).append(r)
    limit=prefs.get('maxPerAuthor',10);counts={};out=[]
    def room(author):return counts.get(author,0)<(1 if policy.matches(author,prefs.get('reducedAuthors',[])) else limit)
    # AI selection keeps its explicit order, subject to exclusions and author limits.
    if selected is not None:
        for r in rows:
            a=r['source']['author']
            if room(a):out.append(r);counts[a]=counts.get(a,0)+1
        return out[:DAILY_INSPIRATION_COUNT]
    authors=sorted(groups,key=lambda a:(policy.matches(a,prefs.get('reducedAuthors',[])),-policy.score(groups[a][0],prefs),rank(a)))
    while authors and len(out)<DAILY_INSPIRATION_COUNT:
        for author in authors:
            if groups[author] and room(author):out.append(groups[author].pop(0));counts[author]=counts.get(author,0)+1
            if len(out)>=DAILY_INSPIRATION_COUNT:break
        authors=[a for a in authors if groups[a] and room(a)]
    return out

def analyse_pending(db,limit=8,report=None):
    """Precompute clearly scoped overviews; unanswered detail questions still retrieve original text."""
    import ai_service
    with connect(db) as k:
        if k is None:return 0
        pending=[r[0] for r in k.execute("SELECT work_id FROM documents WHERE work_id NOT IN (SELECT work_id FROM analyses) ORDER BY CASE WHEN work_id LIKE 'upload-%' THEN 0 ELSE 1 END,work_id LIMIT ?",(limit,))]
    done=0
    for wid in pending:
        evidence=retrieve(db,'',{'readingId':wid},dict(overview=True,queries=[],chapters=[]))
        if not evidence['sources']:continue
        result=ai_service.complete('book_overview',evidence)
        value={k:result[k] for k in ('summary','background','emotions')};value.update(coverage='基于目录及跨章抽样原文，非全书逐字通读',sourceIds=[s['id'] for s in evidence['sources']],model=result['model'])
        with connect(db) as k,k:
            source=k.execute('SELECT source_hash FROM documents WHERE work_id=?',(wid,)).fetchone()
            if source:k.execute('INSERT OR REPLACE INTO analyses VALUES (?,?,?,?)',(wid,source[0],json.dumps(value,ensure_ascii=False),int(time.time())))
        done+=1
        if report:report(done)
    return done
