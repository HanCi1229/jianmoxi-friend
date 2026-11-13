"""Validate and atomically import directly authored chapter analyses. No AI calls."""
import argparse, hashlib, json, pathlib, sqlite3, sys, time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import book_study as study
import library_knowledge as library

def prepare(packet, authored):
 book=packet['book'];jobs={j['id']:j for j in packet['jobs']}
 assert authored['workId']==book['work_id'] and authored['sourceHash']==book['source_hash']
 assert authored['processor']=='codex-direct' and authored['reviewMethod']=='same-agent-second-pass'
 chapters=set(authored['coveredChapters']);declared={u['jobId']:u for u in authored['units']}
 expected={j['id'] for j in jobs.values() if j['kind']=='unit' and j['chapter'] in chapters}
 assert expected and set(declared)==expected and len(declared)==len(authored['units']), 'Incomplete chapter coverage'
 dependencies={}
 for d in packet['dependencies']:dependencies.setdefault(d['parent'],[]).append(d['child'])
 texts={};results={};quotes=[]
 for ch in chapters:
  ordered=sorted((j for j in jobs.values() if j['kind']=='unit' and j['chapter']==ch),key=lambda j:j['part'])
  end=0;parts=[]
  for j in ordered:
   p=json.loads(j['payload']);assert p['start']==end and p['end']-p['start']==len(p['text'])
   end=p['end'];parts.append(p['text'])
  texts[ch]=''.join(parts)
 provenance={key:authored[key] for key in ('processor','reviewMethod','coverage','batchId')}
 provenance['model']='codex-direct'
 for jid,u in declared.items():
  j=jobs[jid];p=json.loads(j['payload']);raw=u['analysis']
  analysis=study.validate('study_unit',raw,{**p,'jobId':jid})
  assert analysis['rejectedCandidates']==0 and len(analysis['quotes'])==len(raw['quotes'])
  for q,original in zip(analysis['quotes'],raw['quotes']):
   assert q['quote']==original['quote'], 'Only exact original quotations can be imported'
   assert texts[j['chapter']][q['start']:q['start']+len(q['quote'])]==q['quote']
   title=original.get('articleTitle') or p['title']
   # A subordinate article title must be a standalone heading before the quote.
   if title!=p['title']:
    heading='\n'+title+'\n';pos=texts[j['chapter']].find(heading)
    assert pos>=0 and pos+len(heading)<=q['start'], 'Unverified article title'
   q.update(processor='codex-direct',reviewMethod=authored['reviewMethod'],articleTitle=title)
  analysis.update(provenance,sourceIssues=u.get('sourceIssues',[]));results[jid]=analysis
  decisions=study.validate('study_review',{'decisions':[{**o['review'],'id':q['id']} for o,q in zip(raw['quotes'],analysis['quotes'])]},{'quotes':analysis['quotes']})
  review_jobs=[r for r in jobs.values() if r['kind']=='review' and dependencies.get(r['id'])==[jid]]
  assert len(review_jobs)==1
  decisions.update(provenance);results[review_jobs[0]['id']]=decisions
  for q,d in zip(analysis['quotes'],decisions['decisions']):
   d.update(processor='codex-direct',reviewMethod=authored['reviewMethod'])
   quotes.append((j,q,d))
 for ch in chapters:
  row=next(j for j in jobs.values() if j['kind']=='chapter' and j['chapter']==ch)
  children=dependencies[row['id']]
  assert all(c in results and jobs[c]['kind']=='unit' for c in children), 'Unprocessed reduction dependency'
  if len(children)==1:result={key:v for key,v in results[children[0]].items() if key!='quotes'}
  else:result=study.validate('study_synthesis',authored['chapterSummaries'][str(ch)],{})
  result.update(provenance,sourceUnits=children,sourceIssues=list(dict.fromkeys(i for c in children for i in results[c].get('sourceIssues',[]))))
  results[row['id']]=result
 assert all(jobs[jid]['kind']!='book' for jid in results), 'This importer never marks a whole book complete'
 return jobs,results,quotes,texts

def apply(db,packet,authored):
 jobs,results,quotes,texts=prepare(packet,authored);book=packet['book'];wid=book['work_id']
 digest=hashlib.sha256(json.dumps(authored,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
 key='curated_batch:'+authored['batchId'];now=int(time.time())
 with library.connect(db) as k:
  k.execute('BEGIN IMMEDIATE')
  old=k.execute('SELECT value FROM study_state WHERE key=?',(key,)).fetchone()
  if old:
   assert json.loads(old[0])['hash']==digest,'Batch ID already used for different content'
   k.rollback();return {'alreadyApplied':True,**json.loads(old[0])}
  approved=study.approved_works(k)
  assert approved is not None and wid in approved, 'Book is outside approved selection'
  live=db.execute("SELECT body_hash FROM library_works WHERE id=? AND status='ready'",(wid,)).fetchone()
  row=k.execute('SELECT source_hash,version FROM study_books WHERE work_id=?',(wid,)).fetchone()
  assert live and live[0]==book['source_hash'] and tuple(row)==(book['source_hash'],book['version'])
  for jid in results:
   current=k.execute('SELECT * FROM study_jobs WHERE id=?',(jid,)).fetchone();expected=jobs[jid]
   assert current and current['work_id']==wid and current['payload']==expected['payload']
   assert current['status'] in ('pending','retry','failed'),'Refuse to overwrite completed or leased work'
   actual={r[0] for r in k.execute('SELECT child FROM study_dependencies WHERE parent=?',(jid,))}
   snapshot={d['child'] for d in packet['dependencies'] if d['parent']==jid}
   assert actual==snapshot and actual<=results.keys(),'Dependency graph changed or incomplete'
  for jid,result in results.items():
   k.execute("UPDATE study_jobs SET status='done',result=?,error=NULL,retry_at=0,lease_until=0,updated_at=? WHERE id=?",(study.dump(result),now,jid))
  for j,q,d in quotes:
   status='accepted' if d['accept'] and not d['spoiler'] and not q['spoiler'] else 'rejected'
   k.execute('INSERT INTO study_quotes VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',(q['id'],wid,book['source_hash'],j['chapter'],q['articleTitle'],q['start'],q['start']+len(q['quote']),q['quote'],study.dump(q),study.dump(d),status,now))
  receipt=dict(hash=digest,workId=wid,chapters=len(texts),characters=sum(map(len,texts.values())),accepted=sum(d['accept'] and not d['spoiler'] and not q['spoiler'] for _,q,d in quotes),rejected=sum(not d['accept'] or d['spoiler'] or q['spoiler'] for _,q,d in quotes),completedAt=now,processor='codex-direct')
  k.execute('INSERT INTO study_state VALUES (?,?)',(key,study.dump(receipt)));k.commit()
 return receipt

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('analysis');p.add_argument('--db');args=p.parse_args()
 packet=json.loads(pathlib.Path(args.source).read_text());authored=json.loads(pathlib.Path(args.analysis).read_text())
 if args.db:
  db=sqlite3.connect('file:'+str(pathlib.Path(args.db).resolve())+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
  print(study.dump(apply(db,packet,authored)))
 else:
  _,results,quotes,texts=prepare(packet,authored)
  print(study.dump(dict(valid=True,jobs=len(results),chapters=len(texts),characters=sum(map(len,texts.values())),accepted=sum(d['accept'] for _,q,d in quotes))))
