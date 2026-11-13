"""Atomically review existing derived quotes without changing source or jobs."""
import argparse,hashlib,json,pathlib,sqlite3,sys,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import book_study as study
import library_knowledge as library

def apply(db,batch):
 assert batch['processor']=='codex-direct' and batch['reviewMethod']=='same-agent-second-pass'
 digest=hashlib.sha256(json.dumps(batch,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
 key='curated_quote_review:'+batch['batchId'];changes=batch['reviews']
 assert changes and len({r['quoteId'] for r in changes})==len(changes),'Empty or duplicate reviews'
 with library.connect(db) as k:
  k.execute('BEGIN IMMEDIATE')
  old=k.execute('SELECT value FROM study_state WHERE key=?',(key,)).fetchone()
  if old:
   receipt=json.loads(old[0]);assert receipt['hash']==digest,'Batch reused with changed content'
   k.rollback();return dict(alreadyApplied=True,**receipt)
  approved=study.approved_works(k);saved=[]
  for r in changes:
   assert approved is not None and r['workId'] in approved,'Unapproved work'
   live=db.execute("SELECT body_hash FROM library_works WHERE id=? AND status='ready'",(r['workId'],)).fetchone()
   assert live and live[0]==r['sourceHash'],'Source changed'
   source=k.execute('SELECT source_hash FROM study_books WHERE work_id=?',(r['workId'],)).fetchone()
   assert source and source[0]==r['sourceHash'],'Derived source changed'
   row=k.execute('SELECT * FROM study_quotes WHERE id=?',(r['quoteId'],)).fetchone()
   assert row and row['status']=='accepted','Old status changed'
   assert (row['work_id'],row['source_hash'],row['chapter'],row['quote'])==(r['workId'],r['sourceHash'],r['chapter'],r['quote']),'Quote changed'
   assert json.loads(row['review'])==r['oldReview'],'Old review changed'
   review=study.validate('study_review',dict(decisions=[r['newReview']]),dict(quotes=[dict(id=r['quoteId'])]))['decisions'][0]
   assert r['recommendation']=='rejected' and not review['accept'],'Only explicit rejection supported'
   review.update(processor=batch['processor'],reviewMethod=batch['reviewMethod'],reviewBatchId=batch['batchId'])
   saved.append(dict(oldRow=dict(row),newReview=review,evidence=r['evidence']))
  for r in saved:
   k.execute("UPDATE study_quotes SET status='rejected',review=? WHERE id=?",(study.dump(r['newReview']),r['oldRow']['id']))
  receipt=dict(hash=digest,batchId=batch['batchId'],reviewedAt=int(time.time()),changes=saved,coverage=batch['coverage'])
  k.execute('INSERT INTO study_state VALUES (?,?)',(key,study.dump(receipt)));k.commit()
 return dict(batchId=batch['batchId'],hash=digest,rejected=len(saved))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('analysis');p.add_argument('--db',required=True);a=p.parse_args()
 db=sqlite3.connect('file:'+str(pathlib.Path(a.db).resolve())+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
 print(study.dump(apply(db,json.loads(pathlib.Path(a.analysis).read_text()))))
