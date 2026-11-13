"""Import authored reductions after every source dependency is complete. No model calls."""
import argparse,hashlib,json,pathlib,sqlite3,sys,time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import book_study as study
import library_knowledge as library

def prepare(packet,authored):
 book=packet['book'];jobs={j['id']:j for j in packet['jobs']}
 assert authored['workId']==book['work_id'] and authored['sourceHash']==book['source_hash']
 assert authored['processor']=='codex-direct' and authored['reviewMethod']=='same-agent-second-pass'
 provenance={key:authored[key] for key in ('processor','reviewMethod','coverage','batchId')}
 provenance['model']='codex-direct'
 results={}
 for item in authored['syntheses']:
  jid=item['jobId'];assert jid not in results and jid in jobs
  assert jobs[jid]['kind'] in ('synthesis','book'), 'Only reductions; no bypass of chapter reading'
  result=study.validate('study_synthesis',item['analysis'],{})
  result.update(provenance,sourceIssues=item.get('sourceIssues',[]))
  assert all(isinstance(i,str) for i in result['sourceIssues'])
  results[jid]=result
 assert results,'No authored reductions'
 deps={}
 for d in packet['dependencies']:deps.setdefault(d['parent'],set()).add(d['child'])
 # Topological order within this batch; external children must already be done at commit.
 ordered=[];remaining=set(results)
 while remaining:
  ready=sorted(jid for jid in remaining if not (deps.get(jid,set())&remaining))
  assert ready,'Cyclic dependency graph'
  ordered.extend(ready);remaining.difference_update(ready)
 for jid in results:assert deps.get(jid) and deps[jid]<=jobs.keys()
 return jobs,deps,results,ordered

def apply(db,packet,authored):
 jobs,deps,results,ordered=prepare(packet,authored)
 book=packet['book'];wid=book['work_id'];now=int(time.time())
 digest=hashlib.sha256(json.dumps(authored,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
 key='curated_synthesis:'+authored['batchId']
 with library.connect(db) as k:
  k.execute('BEGIN IMMEDIATE')
  old=k.execute('SELECT value FROM study_state WHERE key=?',(key,)).fetchone()
  if old:
   receipt=json.loads(old[0]);assert receipt['hash']==digest,'Batch already used for different content'
   k.rollback();return dict(alreadyApplied=True,**receipt)
  assert wid in (study.approved_works(k) or set()),'Outside approved selection'
  live=db.execute("SELECT body_hash FROM library_works WHERE id=? AND status='ready'",(wid,)).fetchone()
  b=k.execute('SELECT * FROM study_books WHERE work_id=?',(wid,)).fetchone()
  assert live and b and live[0]==b['source_hash']==book['source_hash'] and b['version']==book['version']
  current={j['id']:j for j in k.execute('SELECT * FROM study_jobs WHERE work_id=?',(wid,))}
  actual={}
  for d in k.execute('SELECT d.* FROM study_dependencies d JOIN study_jobs j ON j.id=d.parent WHERE j.work_id=?',(wid,)):
   actual.setdefault(d['parent'],set()).add(d['child'])
  assert actual==deps and current.keys()==jobs.keys(),'Changed dependency graph'
  for jid,j in current.items():
   expected=jobs[jid]
   assert all(j[field]==expected[field] for field in ('work_id','kind','chapter','part','payload')),'Source task changed'
  if any(jobs[jid]['kind']=='book' for jid in results):
   assert b['root_id'] in results,'Unexpected book root'
   for j in current.values():
    if j['id'] not in results:
     assert j['status']=='done' and j['result'],'Whole book has unread or unreviewed work'
   assert sum(j['kind']=='chapter' for j in current.values())==b['chapters']
  available={jid:json.loads(j['result']) for jid,j in current.items() if j['status']=='done' and j['result']}
  for jid in ordered:
   assert current[jid]['status'] in ('pending','retry','failed'),'Refuse overwriting completed or leased work'
   assert deps[jid]<=available.keys(),'Unfinished dependency'
   result=results[jid]
   result['sourceChildren']=sorted(deps[jid])
   result['sourceIssues']=list(dict.fromkeys(result['sourceIssues']+[i for c in sorted(deps[jid]) for i in available[c].get('sourceIssues',[])]))
   result['sourceResultHashes']={c:hashlib.sha256(study.dump(available[c]).encode()).hexdigest() for c in sorted(deps[jid])}
   available[jid]=result
  for jid in ordered:
   k.execute("UPDATE study_jobs SET status='done',result=?,error=NULL,retry_at=0,lease_until=0,updated_at=? WHERE id=?",(study.dump(results[jid]),now,jid))
  receipt=dict(hash=digest,workId=wid,reductions=len(results),bookComplete=b['root_id'] in available,completedAt=now,processor='codex-direct')
  k.execute('INSERT INTO study_state VALUES (?,?)',(key,study.dump(receipt)));k.commit()
 return receipt

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('analysis');p.add_argument('--db');args=p.parse_args()
 packet=json.loads(pathlib.Path(args.source).read_text());authored=json.loads(pathlib.Path(args.analysis).read_text())
 if args.db:
  db=sqlite3.connect('file:'+str(pathlib.Path(args.db).resolve())+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
  print(study.dump(apply(db,packet,authored)))
 else:
  _,_,results,ordered=prepare(packet,authored)
  print(study.dump(dict(valid=True,reductions=len(results),ordered=ordered,dependenciesRequireLiveValidation=True)))
