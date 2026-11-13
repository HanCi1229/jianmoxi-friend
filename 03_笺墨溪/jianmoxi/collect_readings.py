"""Import source-backed complete works from a curated public-source queue."""
import argparse,concurrent.futures,datetime,json,sqlite3,time
from pathlib import Path
from library_source import get_page,extract_record,SourceRateLimited
from reading_library import import_records,initialize

def run(seeds_file,folder,db_path=None,limit=30,workers=2):
 folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
 source=json.loads(Path(seeds_file).read_text())
 records_file=folder/'works.json';existing=json.loads(records_file.read_text()) if records_file.exists() else []
 progress_file=folder/'progress.json';progress=json.loads(progress_file.read_text()) if progress_file.exists() else {}
 candidates=[s for s in source if s['page'] not in progress][:limit]
 def work(seed):
  page=get_page(seed['page'],folder/'sources')
  if not page:return seed,None,'unavailable'
  record=extract_record(seed,page)
  time.sleep(3)
  return seed,record,'ready' if record else 'no-complete-text-or-author-mismatch'
 accepted=[];failed=0;known={r['id'] for r in existing}
 cooldown=folder/'cooldown.json'
 if cooldown.exists() and json.loads(cooldown.read_text()).get('until',0)>time.time():
  return dict(skipped='source-cooldown')
 for seed in candidates:
  try:seed,record,status=work(seed)
  except SourceRateLimited:
   cooldown.write_text(json.dumps(dict(until=int(time.time())+86400)))
   print('Source rate limit: stopped for at least 24 hours',flush=True);break
  if record and record['id'] not in known:accepted.append(record);known.add(record['id'])
  if status!='unavailable':progress[seed['page']]=status
  else:failed+=1
  progress_file.write_text(json.dumps(progress,ensure_ascii=False,indent=2))
  records_file.write_text(json.dumps(existing+accepted,ensure_ascii=False,indent=2))
  print(seed['page'],status,flush=True)
 report=dict(added=len(accepted),total=len(existing)+len(accepted),unavailable=failed,remaining=len(source)-len(progress))
 if db_path:
  with sqlite3.connect(db_path,timeout=30) as db:
   import_records(db,existing+accepted)
   db.execute('INSERT INTO library_import_runs(finished_at,body) VALUES (?,?)',(datetime.datetime.now(datetime.timezone.utc).isoformat(),json.dumps(report)))
   db.execute('DELETE FROM library_import_runs WHERE id<(SELECT MAX(id)-90 FROM library_import_runs)')
 print(json.dumps(report,ensure_ascii=False),flush=True)
 return report

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--seeds',default='data/library-seeds.json');p.add_argument('--folder',required=True);p.add_argument('--db');p.add_argument('--limit',type=int,default=30);p.add_argument('--workers',type=int,default=2);a=p.parse_args();run(a.seeds,a.folder,a.db,min(max(a.limit,1),600),min(max(a.workers,1),3))
